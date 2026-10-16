'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SESSION_ENCRYPTION_KEY =
  process.env.SESSION_ENCRYPTION_KEY || 'magic-sessionmanager-test-encryption-key';

const bootstrap = require('../server/src/bootstrap');
const contentTypes = require('../server/src/content-types');
const createSessionService = require('../server/src/services/session');
const { encryptToken, hashToken } = require('../server/src/utils/encryption');
const {
  cleanupExpiredAccessTokenRevocations,
  getAccessTokenExpiry,
} = require('../server/src/utils/session-revocation');
const { invalidateSettingsCache } = require('../server/src/utils/settings-loader');

const SESSION_UID = 'plugin::magic-sessionmanager.session';
const REVOCATION_UID = 'plugin::magic-sessionmanager.revoked-token';

function makeJwt(exp) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ id: 7, exp })).toString('base64url');
  return `${header}.${payload}.signature`;
}

function createLogger() {
  return { debug() {}, error() {}, info() {}, warn() {} };
}

function createServiceHarness({ sessions, failRevocation = false } = {}) {
  const sessionRows = new Map((sessions || []).map((session) => [session.documentId, { ...session }]));
  const revocations = new Map();
  const events = [];

  const strapi = {
    config: { get: () => ({}) },
    store: () => ({ get: async () => null }),
    db: { connection: () => { throw new Error('unsafe direct delete must not be used'); } },
    plugin: () => ({ service: () => ({}) }),
    log: createLogger(),
    documents(uid) {
      if (uid === SESSION_UID) {
        return {
          findOne: async ({ documentId }) => sessionRows.get(documentId) || null,
          findMany: async ({ filters }) => [...sessionRows.values()].filter((session) => {
            if (filters?.isActive !== undefined) return session.isActive === filters.isActive;
            return true;
          }),
          delete: async ({ documentId }) => {
            events.push(`delete:${documentId}`);
            sessionRows.delete(documentId);
          },
        };
      }

      if (uid === REVOCATION_UID) {
        return {
          findFirst: async ({ filters }) => revocations.get(filters.tokenHash) || null,
          findMany: async ({ filters }) => [...revocations.values()].filter((record) =>
            record.expiresAt && record.expiresAt <= filters.expiresAt.$lte
          ),
          create: async ({ data }) => {
            if (failRevocation) throw new Error('revocation store unavailable');
            const record = { documentId: `revocation-${revocations.size + 1}`, ...data };
            revocations.set(data.tokenHash, record);
            events.push(`revoke:${data.tokenHash}`);
            return record;
          },
          update: async ({ documentId, data }) => {
            const record = [...revocations.values()].find((entry) => entry.documentId === documentId);
            Object.assign(record, data);
            return record;
          },
          delete: async ({ documentId }) => {
            for (const [tokenHash, record] of revocations) {
              if (record.documentId === documentId) revocations.delete(tokenHash);
            }
          },
        };
      }

      throw new Error(`Unexpected content type ${uid}`);
    },
  };

  return { strapi, sessionRows, revocations, events };
}

test('revocation content type is registered but hidden from admin content screens', () => {
  const schema = contentTypes['revoked-token'].schema;
  assert.equal(schema.collectionName, 'magic_session_revocations');
  assert.equal(schema.attributes.tokenHash.private, true);
  assert.equal(schema.attributes.tokenHash.unique, true);
  assert.equal(schema.attributes.expiresAt.type, 'datetime');
  assert.equal(schema.pluginOptions['content-manager'].visible, false);
  assert.equal(schema.pluginOptions['content-type-builder'].visible, false);
});

test('access-token expiry parsing returns no expiry for malformed or non-expiring tokens', () => {
  const expirySeconds = Math.floor(Date.now() / 1000) + 60;
  assert.equal(getAccessTokenExpiry(encryptToken(makeJwt(expirySeconds))).getTime(), expirySeconds * 1000);
  assert.equal(getAccessTokenExpiry(encryptToken('not-a-jwt')), null);
});

test('revocation cleanup removes expired hashes and retains unexpired or unknown ones', async () => {
  const harness = createServiceHarness();
  harness.revocations.set('expired', {
    documentId: 'expired-record',
    tokenHash: 'expired',
    expiresAt: new Date('2026-10-13T00:00:00.000Z'),
  });
  harness.revocations.set('active', {
    documentId: 'active-record',
    tokenHash: 'active',
    expiresAt: new Date('2026-10-15T00:00:00.000Z'),
  });
  harness.revocations.set('unknown', {
    documentId: 'unknown-record',
    tokenHash: 'unknown',
    expiresAt: null,
  });

  const removed = await cleanupExpiredAccessTokenRevocations(
    harness.strapi,
    new Date('2026-10-14T00:00:00.000Z')
  );

  assert.equal(removed, 1);
  assert.deepEqual([...harness.revocations.keys()].sort(), ['active', 'unknown']);
});

function createJwtHarness({
  strict = false,
  session = null,
  revocation = null,
  resolveUser = 'user-doc-id',
  userRecord = { documentId: 'user-doc-id', blocked: false },
  failUserLookup = false,
  failSessionLookup = false,
  failRevocationLookup = false,
} = {}) {
  invalidateSettingsCache();
  const token = makeJwt(Math.floor(Date.now() / 1000) + 3600);
  const jwtService = { verify: async () => ({ id: 7, iat: Math.floor(Date.now() / 1000) - 120 }) };
  let userIdLookups = 0;
  const strapi = {
    plugin(name) {
      if (name === 'users-permissions') return { service: () => jwtService };
      throw new Error(`Unexpected plugin ${name}`);
    },
    entityService: {
      findOne: async () => {
        userIdLookups++;
        return resolveUser ? { documentId: resolveUser } : null;
      },
    },
    documents(uid) {
      if (uid === REVOCATION_UID) {
        return {
          findFirst: async () => {
            if (failRevocationLookup) throw new Error('revocation read failed');
            return revocation;
          },
        };
      }
      if (uid === 'plugin::users-permissions.user') {
        return {
          findOne: async () => {
            if (failUserLookup) throw new Error('user read failed');
            return userRecord;
          },
        };
      }
      if (uid === SESSION_UID) {
        return {
          findFirst: async () => {
            if (failSessionLookup) throw new Error('session read failed');
            return session;
          },
          update: async () => {},
        };
      }
      throw new Error(`Unexpected content type ${uid}`);
    },
    config: { get: () => ({}) },
    store: () => ({ get: async () => ({ strictSessionEnforcement: strict, sessionCreationGraceMs: 0 }) }),
    log: createLogger(),
  };

  return { jwtService, strapi, token, getUserIdLookups: () => userIdLookups };
}

test('deleting an active session persists only its token hash until JWT expiry', async () => {
  const token = makeJwt(Math.floor(Date.now() / 1000) + 3600);
  const session = {
    documentId: 'active-session',
    token: encryptToken(token),
    tokenHash: hashToken(token),
    isActive: true,
    loginTime: new Date(),
  };
  const harness = createServiceHarness({ sessions: [session] });
  const service = createSessionService({ strapi: harness.strapi });

  assert.equal(await service.deleteSession(session.documentId), true);
  assert.equal(harness.sessionRows.has(session.documentId), false);
  assert.deepEqual(harness.events, [`revoke:${hashToken(token)}`, `delete:${session.documentId}`]);
  assert.equal(harness.revocations.size, 1);

  const record = harness.revocations.get(hashToken(token));
  assert.equal(record.token, undefined);
  assert.equal(record.user, undefined);
  assert.equal(record.expiresAt.getTime(), Math.floor(Date.now() / 1000 + 3600) * 1000);
});

test('inactive-session cleanup persists a revocation before removing each unexpired token', async () => {
  const token = makeJwt(Math.floor(Date.now() / 1000) + 3600);
  const session = {
    documentId: 'ended-session',
    token: encryptToken(token),
    tokenHash: hashToken(token),
    isActive: false,
    loginTime: new Date(Date.now() - 86_400_000),
  };
  const harness = createServiceHarness({ sessions: [session] });
  const service = createSessionService({ strapi: harness.strapi });

  assert.equal(await service.deleteInactiveSessions(), 1);
  assert.equal(harness.sessionRows.has(session.documentId), false);
  assert.ok(harness.revocations.has(hashToken(token)));
  assert.deepEqual(harness.events, [`revoke:${hashToken(token)}`, `delete:${session.documentId}`]);
});

test('retention cleanup cannot bypass revocation persistence with direct database deletion', async () => {
  invalidateSettingsCache();
  const token = makeJwt(Math.floor(Date.now() / 1000) + 3600);
  const session = {
    documentId: 'retained-session',
    token: encryptToken(token),
    tokenHash: hashToken(token),
    isActive: false,
    logoutTime: new Date(Date.now() - 3 * 86_400_000),
  };
  const harness = createServiceHarness({ sessions: [session] });
  harness.strapi.store = () => ({ get: async () => ({ retentionDays: 1, cleanupUseDbDirect: true }) });
  const service = createSessionService({ strapi: harness.strapi });

  assert.equal(await service.deleteOldSessions(), 1);
  assert.equal(harness.sessionRows.has(session.documentId), false);
  assert.ok(harness.revocations.has(hashToken(token)));
});

test('session deletion stops when its revocation record cannot be persisted', async () => {
  const token = makeJwt(Math.floor(Date.now() / 1000) + 3600);
  const session = {
    documentId: 'cannot-delete-session',
    token: encryptToken(token),
    tokenHash: hashToken(token),
    isActive: true,
  };
  const harness = createServiceHarness({ sessions: [session], failRevocation: true });
  const service = createSessionService({ strapi: harness.strapi });

  await assert.rejects(service.deleteSession(session.documentId), /revocation store unavailable/);
  assert.equal(harness.sessionRows.has(session.documentId), true);
  assert.deepEqual(harness.events, []);
});

test('expired access tokens do not need a revocation record before session deletion', async () => {
  const token = makeJwt(Math.floor(Date.now() / 1000) - 10);
  const session = {
    documentId: 'expired-session',
    token: encryptToken(token),
    tokenHash: hashToken(token),
    isActive: false,
  };
  const harness = createServiceHarness({ sessions: [session] });
  const service = createSessionService({ strapi: harness.strapi });

  assert.equal(await service.deleteSession(session.documentId), true);
  assert.equal(harness.revocations.size, 0);
  assert.equal(harness.sessionRows.has(session.documentId), false);
});

test('a persisted revocation rejects a JWT after its session row is deleted in relaxed and strict modes', async (t) => {
  for (const strict of [false, true]) {
    await t.test(`strictSessionEnforcement=${strict}`, async () => {
      const token = makeJwt(Math.floor(Date.now() / 1000) + 3600);
      const harness = createJwtHarness({
        strict,
        revocation: { documentId: 'revoked-token-1', expiresAt: new Date(Date.now() + 3600_000) },
        session: null,
      });
      await bootstrap.__private.registerSessionAwareAuthStrategy(harness.strapi, harness.strapi.log);

      assert.equal(await harness.jwtService.verify(token), null);
      assert.equal(harness.getUserIdLookups(), 0);
    });
  }
});

test('expired revocation records do not block relaxed tokens by themselves', async () => {
  const harness = createJwtHarness({
    strict: false,
    revocation: { documentId: 'expired-token-1', expiresAt: new Date(Date.now() - 1000) },
    session: null,
  });
  await bootstrap.__private.registerSessionAwareAuthStrategy(harness.strapi, harness.strapi.log);

  assert.equal((await harness.jwtService.verify(harness.token)).id, 7);
});

test('strict JWT enforcement rejects unresolved users but relaxed mode preserves the configured legacy behavior', async (t) => {
  for (const strict of [true, false]) {
    await t.test(`strictSessionEnforcement=${strict}`, async () => {
      const harness = createJwtHarness({ strict, resolveUser: null });
      await bootstrap.__private.registerSessionAwareAuthStrategy(harness.strapi, harness.strapi.log);
      const result = await harness.jwtService.verify(harness.token);

      assert.equal(result === null, strict);
    });
  }
});

test('strict JWT enforcement rejects a missing user record', async () => {
  const harness = createJwtHarness({ strict: true, userRecord: null });
  await bootstrap.__private.registerSessionAwareAuthStrategy(harness.strapi, harness.strapi.log);

  assert.equal(await harness.jwtService.verify(harness.token), null);
});

test('strict JWT enforcement rejects user-record and session lookup failures immediately', async (t) => {
  for (const failure of ['user', 'session']) {
    await t.test(`${failure} lookup`, async () => {
      const harness = createJwtHarness({
        strict: true,
        failUserLookup: failure === 'user',
        failSessionLookup: failure === 'session',
      });
      await bootstrap.__private.registerSessionAwareAuthStrategy(harness.strapi, harness.strapi.log);

      assert.equal(await harness.jwtService.verify(harness.token), null);
    });
  }
});

test('JWT validation fails closed if persistent revocation lookup fails', async () => {
  const harness = createJwtHarness({ strict: false, failRevocationLookup: true });
  await bootstrap.__private.registerSessionAwareAuthStrategy(harness.strapi, harness.strapi.log);

  assert.equal(await harness.jwtService.verify(harness.token), null);
});
