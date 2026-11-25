'use strict';

// Unit regressions for the second security review (4.22.1). The real-HTTP
// counterparts are in tests/isolated-security-review2-http.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');

const {
  createImpersonationApolloPlugin,
  installGraphqlImpersonationGuard,
} = require('../server/src/utils/graphql-impersonation-guard');
const {
  classifyCallbackOutcome,
  installAuthControllerGuard,
  setAuthControllerHandlers,
  uninstallAuthControllerGuard,
} = require('../server/src/utils/auth-controller-guard');
const { toUserExportEvent } = require('../server/src/utils/user-export');
const { deliverOnce, isBlockedAddress } = require('../server/src/utils/webhook-delivery');
const { normalizeWebhookUrl } = require('../server/src/utils/detection-settings');
const { ipBucket } = require('../server/src/utils/admin-request-info');
const { ipKey } = require('../server/src/utils/login-lockout');
const settingsController = require('../server/src/controllers/settings');

/** Apollo request context of one operation. */
const operationContext = (operation, mark) => ({
  operation: { operation },
  contextValue: { state: {}, koaContext: { state: mark ? { magicImpersonation: mark } : {} } },
});

/** A strapi stub with an impersonation service that records refusals. */
const strapiWithRefusals = () => {
  const refusals = [];
  return {
    refusals,
    strapi: {
      plugin: () => ({
        service: () => ({ recordRefusedCall: (imp, reason) => refusals.push([imp.id, reason]) }),
      }),
    },
  };
};

test('H1: the Apollo plugin refuses every mutation of an impersonated request', async () => {
  const { strapi, refusals } = strapiWithRefusals();
  const listener = await createImpersonationApolloPlugin(strapi).requestDidStart();
  const mark = { id: 'imp1', actorId: '1', targetId: 'user1' };
  await assert.rejects(listener.didResolveOperation(operationContext('mutation', mark)), (err) => {
    assert.equal(err.name, 'ForbiddenError');
    assert.equal(err.extensions.code, 'FORBIDDEN');
    assert.deepEqual(err.extensions.http, { status: 403 });
    assert.equal(err.extensions.error.details.reason, 'impersonation-mutation');
    return true;
  });
  assert.deepEqual(refusals, [['imp1', 'mutation']]);
  // Queries of an impersonation and mutations of a normal request pass.
  await listener.didResolveOperation(operationContext('query', mark));
  await listener.didResolveOperation(operationContext('mutation', null));
  assert.equal(refusals.length, 1);
});

test('H1: the guard is added to the GraphQL Apollo plugins once, next to the host plugins', () => {
  const store = {
    'plugin::graphql.apolloServer': { introspection: false, plugins: [{ host: 1 }] },
  };
  const strapi = {
    plugin: (name) => (name === 'graphql' ? {} : null),
    config: {
      get: (key) => store[key],
      set: (key, value) => {
        store[key] = value;
      },
    },
  };
  assert.equal(installGraphqlImpersonationGuard(strapi), true);
  assert.equal(installGraphqlImpersonationGuard(strapi), true);
  const server = store['plugin::graphql.apolloServer'];
  assert.equal(server.introspection, false);
  assert.equal(server.plugins.length, 2);
  assert.deepEqual(server.plugins[0], { host: 1 });
  assert.equal(typeof server.plugins[1].requestDidStart, 'function');
  // Without the GraphQL plugin nothing is written.
  const none = { plugin: () => null, config: { get: () => undefined, set: () => assert.fail() } };
  assert.equal(installGraphqlImpersonationGuard(none), false);
});

test('M1: the auth controller wrapper runs the handlers for every caller and restores', async () => {
  const calls = [];
  const controller = {
    async callback(ctx) {
      calls.push(['original', this === controller, ctx.id]);
      return 'done';
    },
    async register() {
      return 'registered';
    },
    async forgotPassword() {
      return 'untouched';
    },
  };
  const strapi = { plugin: () => ({ controller: () => controller }) };
  const originalForgot = controller.forgotPassword;
  assert.deepEqual(installAuthControllerGuard(strapi).sort(), ['callback', 'register']);
  assert.deepEqual(installAuthControllerGuard(strapi).sort(), ['callback', 'register']);
  assert.equal(controller.forgotPassword, originalForgot);
  // Before bootstrap supplies handlers, the original runs unchanged.
  assert.equal(await controller.callback({ id: 1 }), 'done');
  setAuthControllerHandlers(strapi, {
    callback: async (ctx, run) => {
      calls.push(['handler', ctx.id]);
      return run();
    },
    newSession: async (_ctx, run) => run(),
  });
  // A route binds the action when Strapi builds the router; GraphQL looks it up per call.
  const bound = controller.callback.bind(controller);
  assert.equal(await bound({ id: 2 }), 'done');
  assert.deepEqual(calls.slice(-2), [
    ['handler', 2],
    ['original', true, 2],
  ]);
  uninstallAuthControllerGuard(strapi);
  calls.length = 0;
  assert.equal(await controller.callback({ id: 3 }), 'done');
  assert.deepEqual(calls, [['original', true, 3]]);
});

test('L2: only "Invalid identifier or password" counts as a failed guess', () => {
  const error = (name, message) => Object.assign(new Error(message), { name });
  assert.equal(
    classifyCallbackOutcome(error('ValidationError', 'Invalid identifier or password'), {}),
    'failure'
  );
  for (const thrown of [
    error('ApplicationError', 'Your account has been blocked by an administrator'),
    error('ApplicationError', 'Your account email is not confirmed'),
    error('ValidationError', 'identifier is a required field'),
    error('ForbiddenError', 'Forbidden'),
    error('Error', 'boom'),
  ]) {
    assert.equal(classifyCallbackOutcome(thrown, {}), 'neutral', thrown.message);
  }
  assert.equal(classifyCallbackOutcome(null, { body: { jwt: 'x' } }), 'success');
  assert.equal(classifyCallbackOutcome(null, { status: 403, body: { error: {} } }), 'neutral');
});

test('L3: the data export shows a fixed text and the duration for impersonations', () => {
  const started = toUserExportEvent({
    id: 7,
    event: 'impersonation.started',
    createdAt: '2026-11-25T10:00:00.000Z',
    ip: null,
    userAgent: null,
    geo: null,
    meta: { reason: 'suspected fraud', durationMinutes: 30, handoff: 'token', notifyUser: false },
  });
  assert.deepEqual(started, {
    event: 'impersonation.started',
    createdAt: '2026-11-25T10:00:00.000Z',
    ip: null,
    userAgent: null,
    geo: null,
    meta: { description: 'An administrator opened your account', durationMinutes: 30 },
  });
  const ended = toUserExportEvent({
    id: 8,
    event: 'impersonation.ended',
    meta: { startedBy: '1', durationMinutes: 30, endReason: 'ended' },
  });
  assert.equal(JSON.stringify(ended).includes('startedBy'), false);
  const signIn = toUserExportEvent({ id: 9, event: 'user.sign-in.failed', meta: { status: 400 } });
  assert.deepEqual(signIn, { event: 'user.sign-in.failed', meta: { status: 400 } });
});

test('hardening 1: IPv4-compatible and IPv4-translated IPv6 forms are blocked', () => {
  for (const address of ['::7f00:1', '::127.0.0.1', '::ffff:0:7f00:1', '::ffff:0:a00:1', '::']) {
    assert.equal(isBlockedAddress(address), true, address);
  }
  for (const address of ['8.8.8.8', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isBlockedAddress(address), false, address);
  }
});

test('hardening 2: a delivery has a total deadline, not only an idle timeout', async () => {
  const original = https.request;
  let captured;
  https.request = (options) => {
    captured = options;
    const request = new EventEmitter();
    request.end = () => {};
    request.destroy = (err) => request.emit('error', err);
    // A receiver that keeps the connection busy but never answers: only the
    // abort signal ends it.
    options.signal.addEventListener('abort', () => {
      const abort = new Error('aborted');
      abort.name = 'AbortError';
      request.emit('error', abort);
    });
    return request;
  };
  // AbortSignal.timeout does not keep a process alive; a running server does.
  const keepAlive = setTimeout(() => {}, 5000);
  try {
    const started = Date.now();
    await assert.rejects(
      deliverOnce({
        url: 'https://hooks.example.com/x',
        body: '{}',
        headers: {},
        resolve: async () => [{ address: '93.184.215.14', family: 4 }],
        deadlineMs: 50,
      }),
      { code: 'timeout' }
    );
    assert.ok(captured.signal, 'the request carries an abort signal');
    assert.ok(Date.now() - started < 2000);
  } finally {
    clearTimeout(keepAlive);
    https.request = original;
  }
});

test('hardening 10: webhook URLs with a non-public IP literal are refused when saved', () => {
  for (const url of [
    'https://127.0.0.1/hook',
    'https://0x7f000001/hook',
    'https://[::1]/hook',
    'https://169.254.169.254/latest',
    'https://10.1.2.3/hook',
    'https://[::ffff:127.0.0.1]/hook',
  ]) {
    assert.equal(normalizeWebhookUrl(url), null, url);
  }
  assert.equal(normalizeWebhookUrl('https://hooks.example.com/x'), 'https://hooks.example.com/x');
});

test('hardening 5: a new webhook URL needs the secret again', () => {
  const current = {
    ...settingsController.DEFAULT_SETTINGS,
    genericWebhookUrl: 'https://hooks.example.com/a',
    genericWebhookSecret: 'stored-encrypted-value',
  };
  const urlOnly = settingsController.validateSettingsUpdate(
    { genericWebhookUrl: 'https://evil.example.com/b' },
    current
  );
  assert.deepEqual(urlOnly.errors[0].path, ['genericWebhookSecret']);
  const sameUrl = settingsController.validateSettingsUpdate(
    { genericWebhookUrl: 'https://hooks.example.com/a' },
    current
  );
  assert.equal(sameUrl.errors.length, 0);
  const removed = settingsController.validateSettingsUpdate({ genericWebhookUrl: '' }, current);
  assert.equal(removed.errors.length, 0);
});

test('hardening 7: IPv6 clients are counted per /64', () => {
  assert.equal(ipBucket('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64');
  assert.equal(ipBucket('2001:db8:1:2:bbbb::2'), '2001:db8:1:2::/64');
  assert.equal(ipBucket('::ffff:192.0.2.1'), '192.0.2.1');
  assert.equal(ipKey('2001:db8:1:2:aaaa::1'), ipKey('2001:db8:1:2:ffff::9'));
  assert.notEqual(ipKey('2001:db8:1:2::1'), ipKey('2001:db8:1:3::1'));
});

test('hardening 9: a short SESSION_ENCRYPTION_KEY warns in every environment and never stops a start', () => {
  const saved = { key: process.env.SESSION_ENCRYPTION_KEY, env: process.env.NODE_ENV };
  const encryptionPath = require.resolve('../server/src/utils/encryption');
  const load = () => {
    delete require.cache[encryptionPath];
    return require(encryptionPath);
  };
  const warn = console.warn;
  const warnings = [];
  console.warn = (message) => warnings.push(String(message));
  try {
    for (const env of ['production', 'staging', 'development']) {
      process.env.SESSION_ENCRYPTION_KEY = 'short-key';
      process.env.NODE_ENV = env;
      const encryption = load();
      assert.equal(encryption.isEncryptionKeyShort(), true);
      assert.ok(encryption.encryptToken('x'), `${env}: a short key still works`);
      encryption.encryptToken('y');
    }
    assert.equal(
      warnings.filter((line) => line.includes('shorter than 32 bytes')).length,
      3,
      'one warning per process and environment'
    );
    process.env.SESSION_ENCRYPTION_KEY = 'a'.repeat(64);
    assert.equal(load().isEncryptionKeyShort(), false);
    // Unchanged: production still refuses to start without any key.
    delete process.env.SESSION_ENCRYPTION_KEY;
    process.env.NODE_ENV = 'production';
    assert.throws(() => load().encryptToken('x'), /Failed to encrypt token/);
  } finally {
    console.warn = warn;
    if (saved.key === undefined) delete process.env.SESSION_ENCRYPTION_KEY;
    else process.env.SESSION_ENCRYPTION_KEY = saved.key;
    if (saved.env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved.env;
    delete require.cache[encryptionPath];
  }
});

test('hardening 9: start-up logs a loud error each time and records one security-log event per key', async () => {
  const bootstrap = require('../server/src/bootstrap');
  const { getCoordinator } = require('../server/src/utils/coordination');
  const saved = process.env.SESSION_ENCRYPTION_KEY;
  const errors = [];
  const events = [];
  const strapi = {
    log: { info() {}, warn() {}, error() {}, debug() {} },
    config: { get: () => ({}) },
    plugin: () => ({
      service: () => ({
        record: (event) => {
          events.push(event);
          return true;
        },
      }),
    }),
  };
  const log = { error: (line) => errors.push(line), debug() {} };
  // A shared cache, as the database coordinator provides it.
  const cache = new Map();
  const coordinator = getCoordinator(strapi);
  coordinator.cacheGet = async (key) => (cache.has(key) ? cache.get(key) : null);
  coordinator.cacheSet = async (key, value) => {
    cache.set(key, value);
  };
  try {
    process.env.SESSION_ENCRYPTION_KEY = 'a'.repeat(64);
    assert.equal(await bootstrap.__private.warnShortEncryptionKey(strapi, log), false);
    assert.equal(errors.length, 0);
    process.env.SESSION_ENCRYPTION_KEY = 'short-key-one';
    for (let start = 0; start < 3; start++) {
      assert.equal(await bootstrap.__private.warnShortEncryptionKey(strapi, log), true);
    }
    assert.equal(errors.length, 3, 'every start warns');
    assert.match(errors[0], /shorter than 32 bytes/);
    assert.match(errors[0], /next major version will refuse/);
    assert.equal(errors[0].includes('short-key-one'), false, 'the key is never logged');
    assert.equal(events.length, 1, 'one event for this key');
    assert.deepEqual(events[0], {
      event: 'config.encryption-key.weak',
      actorType: 'system',
      targetType: 'config',
      meta: { minBytes: 32 },
    });
    process.env.SESSION_ENCRYPTION_KEY = 'short-key-two';
    await bootstrap.__private.warnShortEncryptionKey(strapi, log);
    assert.equal(events.length, 2, 'another short key is recorded again');
  } finally {
    if (saved === undefined) delete process.env.SESSION_ENCRYPTION_KEY;
    else process.env.SESSION_ENCRYPTION_KEY = saved;
  }
});
