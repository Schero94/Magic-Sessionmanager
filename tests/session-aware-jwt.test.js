'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SESSION_ENCRYPTION_KEY =
  process.env.SESSION_ENCRYPTION_KEY || 'magic-sessionmanager-test-encryption-key';

const bootstrap = require('../server/src/bootstrap');
const { invalidateSettingsCache } = require('../server/src/utils/settings-loader');

function createHarness(session, {
  failSettingsRead = false,
  jwtManagement = 'legacy-support',
  nativeSessionManager,
  nativeOriginAvailable = true,
  decoded = { id: 7, iat: Math.floor(Date.now() / 1000) - 120 },
  settings = {},
} = {}) {
  invalidateSettingsCache();

  const updates = [];
  const nativeSessionApi = {
    validateAccessToken: () => ({ isValid: false, payload: null }),
    validateRefreshToken: async () => ({ isValid: false }),
    isSessionActive: async () => true,
    listSessions: async () => [],
    revokeSessionById: async () => true,
    invalidateRefreshToken: async () => {},
    ...nativeSessionManager,
  };
  const jwtService = {
    verify: async () => decoded,
  };
  const strapi = {
    plugin(name) {
      if (name === 'users-permissions') return { service: () => jwtService };
      throw new Error(`Unexpected plugin ${name}`);
    },
    entityService: {
      findOne: async () => ({ documentId: 'user-doc-id' }),
    },
    documents(uid) {
      if (uid === 'plugin::magic-sessionmanager.revoked-token') {
        return { findFirst: async () => null };
      }
      if (uid === 'plugin::users-permissions.user') {
        return {
          findOne: async () => ({ documentId: 'user-doc-id', blocked: false }),
        };
      }

      return {
        findFirst: async () => session,
        update: async (payload) => {
          updates.push(payload);
          return payload;
        },
      };
    },
    config: {
      get(key, fallback) {
        if (key === 'plugin::users-permissions.jwtManagement') return jwtManagement;
        if (key === 'plugin::magic-sessionmanager') {
          return { strictSessionEnforcement: true, ...settings };
        }
        if (key === 'plugin::users-permissions.sessions.cookie.name') return 'strapi_up_refresh';
        if (key === undefined) {
          return { strictSessionEnforcement: false };
        }
        return fallback;
      },
    },
    sessionManager: Object.assign(
      () => nativeSessionApi,
      { hasOrigin: () => nativeOriginAvailable }
    ),
    store: () => ({
      get: async () => {
        if (failSettingsRead) throw new Error('private settings-store detail');
        return ({
          inactivityTimeout: 1,
          maxSessionAgeDays: 30,
          strictSessionEnforcement: true,
          ...settings,
        });
      },
    }),
    log: {
      debug() {},
      error() {},
      info() {},
      warn() {},
    },
  };

  return { jwtService, strapi, updates };
}

test('native JWT verification rejects a revoked session before plugin sidecar policies run', async () => {
  let nativeChecks = 0;
  let pluginQueries = 0;
  const { jwtService, strapi } = createHarness(null, {
    jwtManagement: 'refresh',
    decoded: { id: 7, sessionId: 'native-revoked', iat: Math.floor(Date.now() / 1000) - 120 },
    nativeSessionManager: {
      isSessionActive: async (sessionId) => {
        nativeChecks++;
        assert.equal(sessionId, 'native-revoked');
        return false;
      },
    },
  });
  const documents = strapi.documents.bind(strapi);
  strapi.documents = (uid) => {
    pluginQueries++;
    return documents(uid);
  };

  await bootstrap.__private.registerSessionAwareAuthStrategy(strapi, strapi.log);
  const result = await jwtService.verify('x'.repeat(80));

  assert.equal(result, null);
  assert.equal(nativeChecks, 1);
  assert.equal(pluginQueries, 0, 'native revocation must precede plugin-side policy queries');
});

test('native JWT verification fails closed when the Users & Permissions origin is missing', async () => {
  let originChecks = 0;
  const { jwtService, strapi } = createHarness(null, {
    jwtManagement: 'refresh',
    nativeOriginAvailable: false,
    decoded: { id: 7, sessionId: 'native-current', iat: Math.floor(Date.now() / 1000) - 120 },
    nativeSessionManager: { isSessionActive: async () => true },
  });
  const nativeSessionManager = strapi.sessionManager;
  strapi.sessionManager = Object.assign(
    (...args) => nativeSessionManager(...args),
    {
      hasOrigin: (...args) => {
        originChecks++;
        return nativeSessionManager.hasOrigin(...args);
      },
    }
  );

  await bootstrap.__private.registerSessionAwareAuthStrategy(strapi, strapi.log);
  assert.equal(originChecks, 0, 'Magic bootstrap registration must not require the U&P origin');
  const result = await jwtService.verify('x'.repeat(80));

  assert.equal(result, null);
  assert.equal(originChecks, 1, 'origin availability is checked only on the authenticated request');
});

test('native JWT verification rejects tokens without a native session identifier', async () => {
  let nativeChecks = 0;
  const { jwtService, strapi } = createHarness(null, {
    jwtManagement: 'refresh',
    decoded: { id: 7, iat: Math.floor(Date.now() / 1000) - 120 },
    nativeSessionManager: {
      isSessionActive: async () => {
        nativeChecks++;
        return true;
      },
    },
  });

  await bootstrap.__private.registerSessionAwareAuthStrategy(strapi, strapi.log);
  assert.equal(await jwtService.verify('x'.repeat(80)), null);
  assert.equal(nativeChecks, 0);
});

test('native strict enforcement requires a matching Magic sidecar for ordinary requests', async () => {
  const { jwtService, strapi } = createHarness(null, {
    jwtManagement: 'refresh',
    decoded: { id: 7, sessionId: 'native-current', iat: Math.floor(Date.now() / 1000) - 120 },
    settings: { strictSessionEnforcement: true, inactivityTimeout: 60_000 },
    nativeSessionManager: { isSessionActive: async () => true },
  });

  await bootstrap.__private.registerSessionAwareAuthStrategy(strapi, strapi.log);
  assert.equal(await jwtService.verify('x'.repeat(80)), null);
});

test('native relaxed enforcement may accept an active native session without a Magic sidecar', async () => {
  const { jwtService, strapi } = createHarness(null, {
    jwtManagement: 'refresh',
    decoded: { id: 7, sessionId: 'native-current', iat: Math.floor(Date.now() / 1000) - 120 },
    settings: { strictSessionEnforcement: false, inactivityTimeout: 60_000 },
    nativeSessionManager: { isSessionActive: async () => true },
  });

  await bootstrap.__private.registerSessionAwareAuthStrategy(strapi, strapi.log);
  assert.equal((await jwtService.verify('x'.repeat(80))).id, 7);
});

test('legacy strict enforcement rejects a JWT with no matching Magic sidecar', async () => {
  const { jwtService, strapi } = createHarness(null, {
    settings: { strictSessionEnforcement: true, inactivityTimeout: 60_000 },
  });

  await bootstrap.__private.registerSessionAwareAuthStrategy(strapi, strapi.log);
  assert.equal(await jwtService.verify('x'.repeat(80)), null);
});

test('legacy relaxed enforcement preserves access when no Magic sidecar matches', async () => {
  const { jwtService, strapi } = createHarness(null, {
    settings: { strictSessionEnforcement: false, inactivityTimeout: 60_000 },
  });

  await bootstrap.__private.registerSessionAwareAuthStrategy(strapi, strapi.log);
  assert.equal((await jwtService.verify('x'.repeat(80))).id, 7);
});

test('Magic maximum-age policy remains additive after native session validation', async () => {
  const { jwtService, strapi, updates } = createHarness({
    documentId: 'native-sidecar-old',
    isActive: true,
    terminatedManually: false,
    terminationReason: null,
    lastActive: new Date(),
    loginTime: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
  }, {
    jwtManagement: 'refresh',
    decoded: { id: 7, sessionId: 'native-current', iat: Math.floor(Date.now() / 1000) - 120 },
    settings: { strictSessionEnforcement: true, inactivityTimeout: 60_000, maxSessionAgeDays: 30 },
    nativeSessionManager: { isSessionActive: async () => true },
  });

  await bootstrap.__private.registerSessionAwareAuthStrategy(strapi, strapi.log);
  assert.equal(await jwtService.verify('x'.repeat(80)), null);
  assert.equal(updates[0]?.data.terminationReason, 'expired');
});

test('Magic blocked-user policy remains additive after native session validation', async () => {
  const { jwtService, strapi } = createHarness({
    documentId: 'native-sidecar-active',
    isActive: true,
    lastActive: new Date(),
    loginTime: new Date(),
  }, {
    jwtManagement: 'refresh',
    decoded: { id: 7, sessionId: 'native-current', iat: Math.floor(Date.now() / 1000) - 120 },
    settings: { strictSessionEnforcement: true, inactivityTimeout: 60_000 },
    nativeSessionManager: { isSessionActive: async () => true },
  });
  const documents = strapi.documents.bind(strapi);
  strapi.documents = (uid) => uid === 'plugin::users-permissions.user'
    ? { findOne: async () => ({ documentId: 'user-doc-id', blocked: true }) }
    : documents(uid);

  await bootstrap.__private.registerSessionAwareAuthStrategy(strapi, strapi.log);
  assert.equal(await jwtService.verify('x'.repeat(80)), null);
});
test('JWT verification terminates an active row that exceeded inactivity timeout', async () => {
  const { jwtService, strapi, updates } = createHarness({
    documentId: 'session-idle',
    isActive: true,
    terminatedManually: false,
    terminationReason: null,
    lastActive: new Date(Date.now() - 2 * 60 * 1000),
    loginTime: new Date(Date.now() - 60 * 60 * 1000),
  });

  await bootstrap.__private.registerSessionAwareAuthStrategy(strapi, strapi.log);
  const result = await jwtService.verify('x'.repeat(80));

  assert.equal(result, null);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].data.isActive, false);
  assert.equal(updates[0].data.terminationReason, 'idle');
});

test('JWT verification accepts a recently active session', async () => {
  const { jwtService, strapi, updates } = createHarness({
    documentId: 'session-active',
    isActive: true,
    terminatedManually: false,
    terminationReason: null,
    lastActive: new Date(Date.now() - 10 * 1000),
    loginTime: new Date(Date.now() - 60 * 60 * 1000),
  });

  await bootstrap.__private.registerSessionAwareAuthStrategy(strapi, strapi.log);
  const result = await jwtService.verify('x'.repeat(80));

  assert.equal(result.id, 7);
  assert.equal(updates.length, 0);
});

test('JWT verification fails closed when strict-enforcement settings cannot be read', async () => {
  const { jwtService, strapi } = createHarness(null, { failSettingsRead: true });

  await bootstrap.__private.registerSessionAwareAuthStrategy(strapi, strapi.log);
  const result = await jwtService.verify('x'.repeat(80));

  assert.equal(result, null, 'a settings-store failure must not silently relax strict session enforcement');
});

test('JWT verification preserves an existing manual termination reason', async () => {
  const { jwtService, strapi, updates } = createHarness({
    documentId: 'session-manual',
    isActive: false,
    terminatedManually: true,
    terminationReason: 'manual',
    lastActive: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
    loginTime: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
  });

  await bootstrap.__private.registerSessionAwareAuthStrategy(strapi, strapi.log);
  const result = await jwtService.verify('x'.repeat(80));

  assert.equal(result, null);
  assert.equal(updates.length, 0);
});
