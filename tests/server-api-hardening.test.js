'use strict';

// Regression tests for the 2026-11-06 API/security review (API-1, API-5..API-12,
// GA-09/API-4, F12). Every case uses synthetic fixtures and in-process fakes.
const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SESSION_ENCRYPTION_KEY =
  process.env.SESSION_ENCRYPTION_KEY || 'magic-sessionmanager-test-encryption-key';

const rateLimit = require('../server/src/middlewares/rate-limit');
const settingsController = require('../server/src/controllers/settings');
const sessionController = require('../server/src/controllers/session');
const createLicenseController = require('../server/src/controllers/license');
const createGeoipController = require('../server/src/controllers/geoip');
const createSessionService = require('../server/src/services/session');
const register = require('../server/src/register');
const sessionRequiredPolicy = require('../server/src/policies/session-required');
const { invalidateSettingsCache } = require('../server/src/utils/settings-loader');

const SESSION_UID = 'plugin::magic-sessionmanager.session';
const REVOCATION_UID = 'plugin::magic-sessionmanager.revoked-token';
const USER_UID = 'plugin::users-permissions.user';
const silentLog = { debug() {}, info() {}, warn() {}, error() {} };

function withGlobalStrapi(value, fn) {
  const previous = global.strapi;
  global.strapi = value;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      global.strapi = previous;
      invalidateSettingsCache();
    });
}

function createCtx({ body, params = {}, state = {}, headers = {} } = {}) {
  const respond = (status) =>
    function respondWith(message, details) {
      this.status = status;
      this.body = { data: null, error: { status, message, details } };
      return this.body;
    };
  let responseBody;
  const ctx = {
    params,
    state,
    request: { body, headers },
    status: undefined,
    headers: {},
    set(name, value) {
      this.headers[name] = value;
    },
    send(payload) {
      this.status = 200;
      this.body = payload;
    },
    badRequest: respond(400),
    unauthorized: respond(401),
    forbidden: respond(403),
    notFound: respond(404),
    internalServerError: respond(500),
    badGateway: respond(502),
    serviceUnavailable: respond(503),
  };
  // Like Koa: assigning a body without an explicit status implies 200.
  Object.defineProperty(ctx, 'body', {
    enumerable: true,
    get() {
      return responseBody;
    },
    set(value) {
      responseBody = value;
      if (ctx.status === undefined) ctx.status = 200;
    },
  });
  return ctx;
}

// ---------------------------------------------------------------- API-1 / API-5

function createRateLimitContext({ path, method = 'DELETE', route, userId = 4242 }) {
  return {
    path,
    method,
    request: { ip: '192.0.2.10' },
    state: { user: { id: userId }, ...(route ? { route } : {}) },
    set() {},
    status: 200,
    body: {},
  };
}

test('API-1: write buckets are keyed on the route template, not the raw request path', async () => {
  rateLimit.__private.reset();
  const middleware = rateLimit({ max: 3, window: 60_000 }, { strapi: { log: silentLog } });
  const route = {
    method: 'DELETE',
    path: '/my-sessions/:sessionId',
    handler: 'session.terminateOwnSession',
  };
  const variants = [
    '/api/magic-sessionmanager/my-sessions/a',
    '/api/magic-sessionmanager/my-sessions/b',
    '/API/Magic-SessionManager/MY-SESSIONS/c',
    '/api/magic-sessionmanager/my-sessions/d/',
  ];
  const statuses = [];
  for (const path of variants) {
    const ctx = createRateLimitContext({ path, route });
    await middleware(ctx, async () => {});
    statuses.push(ctx.status);
  }
  assert.deepEqual(statuses, [200, 200, 200, 429]);
});

test('API-1: without route info the fallback key ignores case and trailing slashes', async () => {
  rateLimit.__private.reset();
  const middleware = rateLimit({ max: 1, window: 60_000 }, { strapi: { log: silentLog } });
  const first = createRateLimitContext({
    path: '/api/magic-sessionmanager/logout',
    method: 'POST',
  });
  await middleware(first, async () => {});
  for (const path of ['/API/MAGIC-SESSIONMANAGER/LOGOUT', '/api/magic-sessionmanager/logout/']) {
    const ctx = createRateLimitContext({ path, method: 'POST' });
    await middleware(ctx, async () => {});
    assert.equal(ctx.status, 429, path);
  }
});

test('API-1: different callers and different routes keep separate buckets', async () => {
  rateLimit.__private.reset();
  const middleware = rateLimit({ max: 1, window: 60_000 }, { strapi: { log: silentLog } });
  const logout = { method: 'POST', path: '/logout', handler: 'session.logout' };
  const logoutAll = { method: 'POST', path: '/logout-all', handler: 'session.logoutAll' };
  const a = createRateLimitContext({
    path: '/api/magic-sessionmanager/logout',
    method: 'POST',
    route: logout,
    userId: 1,
  });
  const b = createRateLimitContext({
    path: '/api/magic-sessionmanager/logout',
    method: 'POST',
    route: logout,
    userId: 2,
  });
  const c = createRateLimitContext({
    path: '/api/magic-sessionmanager/logout-all',
    method: 'POST',
    route: logoutAll,
    userId: 1,
  });
  for (const ctx of [a, b, c]) {
    await middleware(ctx, async () => {});
    assert.equal(ctx.status, 200);
  }
});

test('API-5: settings can shorten neither the write window nor raise the write rate', async () => {
  rateLimit.__private.reset();
  invalidateSettingsCache();
  const strapi = {
    log: silentLog,
    config: { get: () => ({}) },
    store: () => ({ get: async () => ({ rateLimitWriteMax: 10, rateLimitWindowSeconds: 10 }) }),
  };
  try {
    const write = await rateLimit.__private.resolveLimits({
      profile: 'write',
      routeMax: 10,
      routeWindowMs: 60_000,
      strapi,
    });
    assert.equal(write.max, 10);
    assert.ok(
      write.windowMs >= 60_000,
      `write window ${write.windowMs} must not undercut the route window`
    );
    assert.ok(
      write.max / write.windowMs <= 10 / 60_000,
      'write rate must not exceed the route rate'
    );

    const read = await rateLimit.__private.resolveLimits({
      profile: 'read',
      routeMax: 120,
      routeWindowMs: 60_000,
      strapi,
    });
    assert.equal(read.windowMs, 10_000, 'read limits may still be relaxed by settings');
  } finally {
    rateLimit.__private.reset();
    invalidateSettingsCache();
  }
});

test('API-5: a longer settings window and a lower write max still tighten writes', async () => {
  rateLimit.__private.reset();
  invalidateSettingsCache();
  const strapi = {
    log: silentLog,
    config: { get: () => ({}) },
    store: () => ({ get: async () => ({ rateLimitWriteMax: 3, rateLimitWindowSeconds: 300 }) }),
  };
  try {
    const write = await rateLimit.__private.resolveLimits({
      profile: 'write',
      routeMax: 10,
      routeWindowMs: 60_000,
      strapi,
    });
    assert.deepEqual(write, { max: 3, windowMs: 300_000 });
  } finally {
    rateLimit.__private.reset();
    invalidateSettingsCache();
  }
});

// ---------------------------------------------------------------- API-6 / API-7 (settings)

function createSettingsStrapi(stored) {
  const state = { stored, writes: 0 };
  return {
    state,
    strapi: {
      store: () => ({
        get: async () => state.stored,
        set: async ({ value }) => {
          state.writes += 1;
          state.stored = value;
        },
      }),
      log: silentLog,
    },
  };
}

test('API-6: a partial settings PUT merges over the stored settings', async () => {
  const { strapi, state } = createSettingsStrapi({
    ...settingsController.DEFAULT_SETTINGS,
    inactivityTimeout: 30,
    enableGeolocation: true,
    alertOnSuspiciousLogin: true,
    alertOnNewLocation: true,
    alertOnVpnProxy: true,
    discordWebhookUrl: 'https://discord.com/api/webhooks/synthetic',
    blockedCountries: ['RU'],
    emailTemplates: {
      suspiciousLogin: { subject: 'Synthetic subject', html: '<p>x</p>', text: 'x' },
      newLocation: { subject: '', html: '', text: '' },
      vpnProxy: { subject: '', html: '', text: '' },
    },
  });
  await withGlobalStrapi(strapi, async () => {
    const ctx = createCtx({ body: { inactivityTimeout: 20 } });
    await settingsController.updateSettings(ctx);
    assert.equal(ctx.status, 200);
    assert.equal(state.stored.inactivityTimeout, 20);
    assert.equal(state.stored.enableGeolocation, true);
    assert.equal(state.stored.alertOnSuspiciousLogin, true);
    assert.equal(state.stored.alertOnNewLocation, true);
    assert.equal(state.stored.alertOnVpnProxy, true);
    assert.equal(state.stored.discordWebhookUrl, 'https://discord.com/api/webhooks/synthetic');
    assert.deepEqual(state.stored.blockedCountries, ['RU']);
    assert.equal(state.stored.emailTemplates.suspiciousLogin.subject, 'Synthetic subject');
    assert.equal(ctx.body.settings.inactivityTimeout, 20);
    assert.equal(ctx.body.success, true);
  });
});

test('API-6: a partial email template update keeps the other templates', async () => {
  const { strapi, state } = createSettingsStrapi({
    emailTemplates: {
      suspiciousLogin: { subject: 'Keep me', html: '', text: '' },
      newLocation: { subject: 'Old', html: '', text: '' },
      vpnProxy: { subject: '', html: '', text: '' },
    },
  });
  await withGlobalStrapi(strapi, async () => {
    const ctx = createCtx({
      body: { emailTemplates: { newLocation: { subject: 'New', html: '', text: '' } } },
    });
    await settingsController.updateSettings(ctx);
    assert.equal(ctx.status, 200);
    assert.equal(state.stored.emailTemplates.suspiciousLogin.subject, 'Keep me');
    assert.equal(state.stored.emailTemplates.newLocation.subject, 'New');
  });
});

test('API-6: the full payload the admin UI sends keeps working', async () => {
  const { strapi, state } = createSettingsStrapi(null);
  await withGlobalStrapi(strapi, async () => {
    const body = {
      ...settingsController.DEFAULT_SETTINGS,
      inactivityTimeout: '45',
      retentionDays: -1,
      allowedCountries: ['de', 'AT'],
      slackWebhookUrl: 'https://hooks.slack.com/services/synthetic',
      someUnknownKey: 'ignored',
    };
    const ctx = createCtx({ body });
    await settingsController.updateSettings(ctx);
    assert.equal(ctx.status, 200);
    assert.equal(state.stored.inactivityTimeout, 45);
    assert.equal(state.stored.retentionDays, -1);
    assert.deepEqual(state.stored.allowedCountries, ['DE', 'AT']);
    assert.equal(state.stored.slackWebhookUrl, 'https://hooks.slack.com/services/synthetic');
    assert.equal(state.stored.someUnknownKey, undefined, 'unknown keys are never persisted');
  });
});

test('API-6: invalid values are rejected with field errors instead of being clamped', async () => {
  for (const [field, value] of [
    ['inactivityTimeout', 0],
    ['inactivityTimeout', 2000],
    ['inactivityTimeout', 'abc'],
    ['inactivityTimeout', 1.5],
    ['cleanupInterval', 1],
    ['lastSeenRateLimit', 400],
    ['maxSessionAgeDays', 0],
    ['retentionDays', 0],
    ['retentionDays', 500],
    ['sessionCreationGraceMs', 60_000],
    ['rateLimitWriteMax', 0],
    ['rateLimitReadMax', 20_000],
    ['rateLimitWindowSeconds', 5],
    ['maxFailedLogins', -3],
    ['maxFailedLogins', ''],
    ['enableGeolocation', 'true'],
    ['strictSessionEnforcement', 1],
    ['allowedCountries', 'DE'],
    ['blockedCountries', ['XYZ']],
    ['geoIpProvider', 'mystery-provider'],
    ['geoLookupFailureMode', 'panic'],
    ['discordWebhookUrl', 'https://evil.example/hook'],
    ['slackWebhookUrl', 'http://hooks.slack.com/services/x'],
    ['emailTemplates', 'not-an-object'],
  ]) {
    const { strapi, state } = createSettingsStrapi({ ...settingsController.DEFAULT_SETTINGS });
    await withGlobalStrapi(strapi, async () => {
      const ctx = createCtx({ body: { [field]: value } });
      await settingsController.updateSettings(ctx);
      assert.equal(ctx.status, 400, `${field}=${JSON.stringify(value)}`);
      const errors = ctx.body.error.details?.errors || [];
      assert.ok(
        errors.some(
          (error) =>
            Array.isArray(error.path) &&
            error.path[0] === field &&
            typeof error.message === 'string'
        ),
        `${field} must be named in the field errors`
      );
      assert.equal(state.writes, 0, `${field} must not be persisted`);
    });
  }
});

test('API-6: clearing a webhook with an empty string is still allowed', async () => {
  const { strapi, state } = createSettingsStrapi({
    discordWebhookUrl: 'https://discord.com/api/webhooks/old',
  });
  await withGlobalStrapi(strapi, async () => {
    const ctx = createCtx({ body: { discordWebhookUrl: '' } });
    await settingsController.updateSettings(ctx);
    assert.equal(ctx.status, 200);
    assert.equal(state.stored.discordWebhookUrl, '');
  });
});

test('API-7: settings store failures return 500 with a safe message', async () => {
  const detail = 'synthetic-store-detail';
  const strapi = {
    store: () => ({
      get: async () => {
        throw new Error(detail);
      },
      set: async () => {
        throw new Error(detail);
      },
    }),
    log: silentLog,
  };
  await withGlobalStrapi(strapi, async () => {
    for (const action of ['getSettings', 'updateSettings']) {
      const ctx = createCtx({ body: { inactivityTimeout: 20 } });
      await settingsController[action](ctx);
      assert.equal(ctx.status, 500, action);
      assert.equal(JSON.stringify(ctx.body).includes(detail), false, action);
    }
  });
});

// ---------------------------------------------------------------- API-7 / API-8 (license, GeoIP)

function createLicenseHarness({
  createResult = { licenseKey: 'synthetic-license-key' },
  failStore = false,
} = {}) {
  const calls = [];
  const guard = {
    createLicense: async (input) => {
      calls.push(['createLicense', input]);
      return createResult;
    },
    verifyLicense: async (key) => {
      calls.push(['verifyLicense', key]);
      return { valid: true, data: {} };
    },
    getLicenseByKey: async (key) => {
      calls.push(['getLicenseByKey', key]);
      return null;
    },
    storeLicenseKey: async (key) => {
      calls.push(['storeLicenseKey', key]);
    },
  };
  const strapi = {
    plugin: () => ({ service: () => guard }),
    store: () => ({
      get: async () => {
        if (failStore) throw new Error('synthetic-store-detail');
        return 'synthetic-license-key';
      },
    }),
    log: silentLog,
  };
  return { controller: createLicenseController({ strapi }), calls };
}

test('API-7: an unreachable license provider returns 503, internal failures 500', async () => {
  const unreachable = createLicenseHarness({ createResult: null });
  const ctx = createCtx({ state: { user: { email: 'admin@example.invalid' } } });
  await unreachable.controller.autoCreate(ctx);
  assert.equal(ctx.status, 503);

  const manual = createCtx({
    body: { email: 'owner@example.invalid', firstName: 'Test', lastName: 'Owner' },
  });
  await unreachable.controller.createAndActivate(manual);
  assert.equal(manual.status, 503);

  const broken = createLicenseHarness({ failStore: true });
  for (const action of ['getStatus', 'ping']) {
    const failing = createCtx();
    await broken.controller[action](failing);
    assert.equal(failing.status, 500, action);
    assert.equal(JSON.stringify(failing.body).includes('synthetic-store-detail'), false);
  }
});

test('API-8: store-key rejects non-string keys and emails before calling the provider', async () => {
  for (const [body, message] of [
    [{ licenseKey: 12345 }, 'License key is required'],
    [{ licenseKey: { value: 'x' } }, 'License key is required'],
    [{ licenseKey: '   ' }, 'License key is required'],
    [{ licenseKey: 'synthetic-key', email: 42 }, 'Email must be a valid email address'],
    [{ licenseKey: 'synthetic-key', email: 'not-an-email' }, 'Email must be a valid email address'],
  ]) {
    const { controller, calls } = createLicenseHarness();
    const ctx = createCtx({ body });
    await controller.storeKey(ctx);
    assert.equal(ctx.status, 400, JSON.stringify(body));
    assert.equal(ctx.body.error.message, message);
    assert.deepEqual(calls, [], 'the provider must not be called');
  }
  const { controller } = createLicenseHarness();
  const ok = createCtx({ body: { licenseKey: 'synthetic-key', email: '' } });
  await controller.storeKey(ok);
  assert.equal(ok.status, 200, 'an empty optional email remains accepted');
});

test('API-7: GeoIP store failures return 500 and updater failures 502', async () => {
  const detail = 'synthetic-geoip-detail';
  invalidateSettingsCache();
  const failingStrapi = {
    config: { get: () => ({}) },
    store: () => ({
      get: async () => {
        throw new Error(detail);
      },
      set: async () => {
        throw new Error(detail);
      },
    }),
    log: silentLog,
  };
  const controller = createGeoipController({ strapi: failingStrapi });
  for (const [action, body] of [
    ['getStatus'],
    ['storeCredentials', { accountId: '1', licenseKey: 'k' }],
  ]) {
    const ctx = createCtx({ body });
    await controller[action](ctx);
    assert.equal(ctx.status, 500, action);
    assert.equal(JSON.stringify(ctx.body).includes(detail), false);
  }

  invalidateSettingsCache();
  const storedStrapi = {
    config: { get: () => ({}) },
    store: () => ({
      get: async ({ key }) =>
        key === 'geoipCredentials' ? { accountId: '1', licenseKey: 'synthetic' } : null,
    }),
    log: silentLog,
  };
  const updater = createGeoipController({
    strapi: storedStrapi,
    updateGeoIpDatabase: async () => {
      throw new Error(detail);
    },
  });
  const ctx = createCtx({ body: {} });
  await updater.updateDatabase(ctx);
  invalidateSettingsCache();
  assert.equal(ctx.status, 502);
  assert.equal(JSON.stringify(ctx.body).includes(detail), false);
});

// ---------------------------------------------------------------- API-9

function createCleanupHarness({ rows, failingIds }) {
  const sessionRows = new Map(rows.map((row) => [row.documentId, { ...row }]));
  const events = [];
  const strapi = {
    config: { get: () => ({}) },
    store: () => ({ get: async () => null }),
    plugin: () => ({ service: () => ({}) }),
    log: silentLog,
    documents(uid) {
      if (uid === SESSION_UID) {
        return {
          findMany: async ({ filters, limit }) => {
            const excluded = new Set(filters?.documentId?.$notIn || []);
            return [...sessionRows.values()]
              .filter((row) => row.isActive === false && !excluded.has(row.documentId))
              .slice(0, limit);
          },
          delete: async ({ documentId }) => {
            if (failingIds.includes(documentId)) throw new Error('synthetic-delete-failure');
            sessionRows.delete(documentId);
          },
        };
      }
      if (uid === REVOCATION_UID) {
        return {
          findFirst: async () => null,
          create: async () => ({}),
          findMany: async () => {
            events.push('revocation-cleanup');
            return [];
          },
          delete: async () => {},
        };
      }
      throw new Error(`Unexpected content type ${uid}`);
    },
  };
  return { strapi, sessionRows, events };
}

test('API-9: inactive cleanup continues past a failed row and reports partial counts', async () => {
  const rows = Array.from({ length: 205 }, (_, index) => ({
    documentId: `ended-${index}`,
    isActive: false,
  }));
  const harness = createCleanupHarness({ rows, failingIds: ['ended-0', 'ended-150'] });
  const service = createSessionService({ strapi: harness.strapi });

  await assert.rejects(
    () => service.deleteInactiveSessions(),
    (error) => {
      assert.equal(error.name, 'PartialCleanupError');
      assert.equal(error.deletedCount, 203);
      assert.equal(error.failedCount, 2);
      return true;
    }
  );
  assert.equal(harness.sessionRows.size, 2, 'only the failing rows remain');
  assert.ok(harness.events.includes('revocation-cleanup'), 'expired revocation cleanup still runs');
});

test('API-9: the cleanup endpoint returns the partial counts with a 500', async () => {
  const partial = Object.assign(new Error('partial'), {
    name: 'PartialCleanupError',
    deletedCount: 7,
    failedCount: 1,
  });
  const strapi = {
    plugin: () => ({
      service: () => ({
        deleteInactiveSessions: async () => {
          throw partial;
        },
      }),
    }),
    log: silentLog,
  };
  await withGlobalStrapi(strapi, async () => {
    const ctx = createCtx();
    await sessionController.cleanInactiveSessions(ctx);
    assert.equal(ctx.status, 500);
    assert.deepEqual(ctx.body.error.details, { deletedCount: 7, failedCount: 1 });
  });
});

test('API-9: a fully successful cleanup keeps the existing response contract', async () => {
  const rows = [
    { documentId: 'ended-a', isActive: false },
    { documentId: 'ended-b', isActive: false },
  ];
  const harness = createCleanupHarness({ rows, failingIds: [] });
  const service = createSessionService({ strapi: harness.strapi });
  assert.equal(await service.deleteInactiveSessions(), 2);
});

// ---------------------------------------------------------------- API-10

test('API-10: a foreign and an absent session id get the same 404 response', async () => {
  const sessions = {
    'foreign-session': {
      documentId: 'foreign-session',
      isActive: true,
      user: { documentId: 'someone-else' },
    },
  };
  let terminated = false;
  const strapi = {
    config: { get: (_key, fallback) => fallback },
    plugin: () => ({
      service: () => ({
        terminateSession: async () => {
          terminated = true;
        },
      }),
    }),
    documents: () => ({ findOne: async ({ documentId }) => sessions[documentId] || null }),
    log: silentLog,
  };
  await withGlobalStrapi(strapi, async () => {
    const responses = [];
    for (const sessionId of ['foreign-session', 'absent-session']) {
      const ctx = createCtx({
        params: { sessionId },
        state: { user: { id: 1, documentId: 'owner' } },
      });
      await sessionController.terminateOwnSession(ctx);
      responses.push({ status: ctx.status, body: ctx.body });
    }
    assert.deepEqual(responses[0], responses[1]);
    assert.equal(responses[0].status, 404);
    assert.equal(responses[0].body.error.message, 'Session not found');
    assert.equal(terminated, false);
  });
});

// ---------------------------------------------------------------- API-12 / GA-09 / API-4

async function createBlockHarness({ blocked = false } = {}) {
  let lifecycle;
  const terminateCalls = [];
  const user = { id: 9, documentId: 'synthetic-block-user', blocked };
  const sessionService = {
    terminateSession: async (args) => {
      terminateCalls.push(args);
      return { terminatedCount: 1 };
    },
  };
  const strapi = {
    admin: { services: { permission: { actionProvider: { registerMany() {} } } } },
    contentType: () => ({ attributes: {} }),
    db: {
      lifecycles: {
        subscribe(value) {
          if (value.models?.includes(USER_UID)) lifecycle = value;
        },
      },
      query: () => ({ findOne: async () => ({ documentId: user.documentId }) }),
    },
    entityService: { findOne: async () => ({ documentId: user.documentId }) },
    plugin: () => ({ service: () => sessionService }),
    documents: () => ({
      findOne: async () => ({ ...user }),
      update: async ({ data }) => {
        Object.assign(user, data);
        // Mirror Strapi's document service, which runs afterUpdate inside update.
        await lifecycle.afterUpdate({ result: { ...user }, params: { data } });
        return { ...user };
      },
    }),
    log: silentLog,
  };
  await register({ strapi });
  return { strapi, user, terminateCalls, lifecycle };
}

test('API-12: an admin block revokes sessions once and surfaces errors from that single path', async () => {
  const harness = await createBlockHarness();
  await withGlobalStrapi(harness.strapi, async () => {
    const ctx = createCtx({ params: { userId: harness.user.documentId }, body: { blocked: true } });
    await sessionController.toggleUserBlock(ctx);
    assert.equal(ctx.status, 200);
    assert.equal(
      harness.terminateCalls.length,
      1,
      'lifecycle must not repeat the controller revocation'
    );
    assert.deepEqual(harness.terminateCalls[0], {
      userId: harness.user.documentId,
      reason: 'blocked',
    });
  });
});

test('API-12: a block from outside the controller is still revoked by the lifecycle', async () => {
  const harness = await createBlockHarness();
  await harness.lifecycle.afterUpdate({
    result: { documentId: harness.user.documentId, blocked: true },
    params: { data: { blocked: true } },
  });
  assert.equal(harness.terminateCalls.length, 1);
});

test('GA-09/API-4: a bodyless toggle-block keeps the legacy toggle and the old response fields', async () => {
  for (const [initial, body] of [
    [false, undefined],
    [true, undefined],
    [false, {}],
  ]) {
    const harness = await createBlockHarness({ blocked: initial });
    await withGlobalStrapi(harness.strapi, async () => {
      const ctx = createCtx({ params: { userId: harness.user.documentId }, body });
      await sessionController.toggleUserBlock(ctx);
      assert.equal(ctx.status, 200, `initial=${initial}`);
      assert.equal(ctx.body.success, true);
      assert.equal(ctx.body.blocked, !initial);
      assert.equal(ctx.body.message, `User ${!initial ? 'blocked' : 'unblocked'} successfully`);
      assert.equal(ctx.body.mode, 'toggle');
      assert.equal(harness.user.blocked, !initial);
    });
  }
});

test('GA-09/API-4: an explicit state is applied idempotently and reported additively', async () => {
  const harness = await createBlockHarness({ blocked: true });
  await withGlobalStrapi(harness.strapi, async () => {
    const ctx = createCtx({ params: { userId: harness.user.documentId }, body: { blocked: true } });
    await sessionController.toggleUserBlock(ctx);
    assert.equal(ctx.status, 200);
    assert.deepEqual(Object.keys(ctx.body).slice(0, 3), ['message', 'blocked', 'success']);
    assert.equal(ctx.body.blocked, true);
    assert.equal(ctx.body.mode, 'explicit');
    assert.equal(harness.user.blocked, true, 'repeating a block never unblocks');
  });
});

test('GA-09/API-4: a present but non-boolean blocked value is rejected without mutation', async () => {
  for (const blocked of ['false', 'true', null, 0, 1]) {
    const harness = await createBlockHarness();
    await withGlobalStrapi(harness.strapi, async () => {
      const ctx = createCtx({ params: { userId: harness.user.documentId }, body: { blocked } });
      await sessionController.toggleUserBlock(ctx);
      assert.equal(ctx.status, 400, JSON.stringify(blocked));
      assert.equal(harness.user.blocked, false);
      assert.equal(harness.terminateCalls.length, 0);
    });
  }
});

// ---------------------------------------------------------------- F12

const RAW_SESSION = {
  documentId: 'doc-1',
  id: 'doc-1',
  sessionId: 'sess_synthetic_tracking',
  nativeSessionId: '0123456789abcdef0123456789abcdef',
  tokenHash: 'synthetic-hash',
  token: 'synthetic-token',
  refreshToken: 'synthetic-refresh',
  refreshTokenHash: 'synthetic-refresh-hash',
  isTrulyActive: true,
};
const FORBIDDEN_ADMIN_FIELDS = [
  'sessionId',
  'nativeSessionId',
  'tokenHash',
  'token',
  'refreshToken',
  'refreshTokenHash',
];

test('F12: admin session lists never expose raw session identifiers or token material', async () => {
  const service = {
    getAllSessions: async () => [{ ...RAW_SESSION }],
    getActiveSessions: async () => [{ ...RAW_SESSION }],
    getUserSessions: async () => [{ ...RAW_SESSION }],
  };
  const strapi = {
    config: { get: (_k, fallback) => fallback },
    plugin: () => ({ service: () => service }),
    log: silentLog,
  };
  await withGlobalStrapi(strapi, async () => {
    for (const action of ['getAllSessionsAdmin', 'getActiveSessions', 'getUserSessions']) {
      const ctx = createCtx({
        params: { userId: 'synthetic-user' },
        state: { userAbility: {}, user: { id: 1 } },
      });
      await sessionController[action](ctx);
      const row = ctx.body.data[0];
      assert.equal(row.documentId, 'doc-1', `${action} keeps the action identifier`);
      for (const field of FORBIDDEN_ADMIN_FIELDS) {
        assert.equal(Object.hasOwn(row, field), false, `${action} must not expose ${field}`);
      }
    }
  });
});

test('F12: content API lists keep the documented tracking id but drop native ids and tokens', async () => {
  const service = { getUserSessions: async () => [{ ...RAW_SESSION }] };
  const strapi = {
    config: { get: (_k, fallback) => fallback },
    plugin: () => ({ service: () => service }),
    log: silentLog,
  };
  await withGlobalStrapi(strapi, async () => {
    const ctx = createCtx({
      params: { userId: 'owner' },
      state: { user: { id: 1, documentId: 'owner' } },
    });
    await sessionController.getUserSessions(ctx);
    const row = ctx.body.data[0];
    assert.equal(row.sessionId, 'sess_synthetic_tracking');
    for (const field of FORBIDDEN_ADMIN_FIELDS.filter((field) => field !== 'sessionId')) {
      assert.equal(Object.hasOwn(row, field), false, `content API must not expose ${field}`);
    }
  });
});

// ---------------------------------------------------------------- API-11

test('API-11: in refresh mode the opt-in policy matches the verified native session', async () => {
  invalidateSettingsCache();
  let filters;
  const strapi = {
    config: {
      get(key, fallback) {
        if (key === 'plugin::users-permissions.jwtManagement') return 'refresh';
        if (key === 'plugin::magic-sessionmanager') return { strictSessionEnforcement: true };
        return fallback;
      },
    },
    store: () => ({ get: async () => null }),
    documents: () => ({
      findFirst: async (query) => {
        filters = query.filters;
        return { documentId: 's', isActive: true };
      },
    }),
    log: silentLog,
  };
  const context = {
    state: { user: { documentId: 'owner' }, session: { id: 'native-session-1' } },
    request: { headers: { authorization: `Bearer ${'a'.repeat(80)}` } },
  };
  try {
    assert.equal(await sessionRequiredPolicy(context, {}, { strapi }), true);
    assert.equal(filters.nativeSessionId, 'native-session-1');
    assert.ok(filters.tokenHash);

    invalidateSettingsCache();
    const unverified = { ...context, state: { user: { documentId: 'owner' } } };
    await assert.rejects(
      () => sessionRequiredPolicy(unverified, {}, { strapi }),
      /No valid session/
    );
  } finally {
    invalidateSettingsCache();
  }
});
