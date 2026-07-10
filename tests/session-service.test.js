'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SESSION_ENCRYPTION_KEY =
  process.env.SESSION_ENCRYPTION_KEY || 'magic-sessionmanager-test-encryption-key';

const createSessionService = require('../server/src/services/session');
const { invalidateSettingsCache } = require('../server/src/utils/settings-loader');

const SESSION_UID = 'plugin::magic-sessionmanager.session';

function createLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
}

test('deleteOldSessions stops after repeated no-progress delete batches', async () => {
  let findManyCalls = 0;
  let deleteCalls = 0;
  const batch = Array.from({ length: 200 }, (_, index) => ({
    documentId: `session-${index}`,
  }));

  const strapi = {
    config: {
      get() {
        return { retentionDays: 1 };
      },
    },
    store: () => ({
      get: async () => null,
    }),
    documents: () => ({
      findMany: async () => {
        findManyCalls++;
        if (findManyCalls > 3) {
          throw new Error('retention loop should have stopped after repeated no-progress batches');
        }
        return batch;
      },
      delete: async () => {
        deleteCalls++;
        throw new Error('delete failed');
      },
    }),
    db: { connection: {} },
    plugin: () => ({
      service: () => ({}),
    }),
    log: createLogger(),
  };

  const service = createSessionService({ strapi });
  const deleted = await service.deleteOldSessions();

  assert.equal(deleted, 0);
  assert.equal(findManyCalls, 3);
  assert.equal(deleteCalls, 600);
});

test('createSession handles 30 concurrent users without session collisions', async () => {
  const createdSessions = [];
  let createCalls = 0;

  const strapi = {
    documents: (uid) => {
      assert.equal(uid, SESSION_UID);
      return {
        create: async ({ data }) => {
          createCalls++;
          const callNumber = createCalls;

          await new Promise((resolve) => {
            setTimeout(resolve, callNumber % 5);
          });

          const created = {
            documentId: `session-doc-${String(callNumber).padStart(2, '0')}`,
            ...data,
          };
          createdSessions.push(created);
          return created;
        },
      };
    },
    log: createLogger(),
  };

  const service = createSessionService({ strapi });
  const users = Array.from({ length: 30 }, (_, index) => ({
    userId: `user-doc-${String(index + 1).padStart(2, '0')}`,
    token: `access-token-${index + 1}-${'x'.repeat(32)}`,
    refreshToken: `refresh-token-${index + 1}-${'y'.repeat(32)}`,
  }));

  const results = await Promise.all(
    users.map((user, index) =>
      service.createSession({
        userId: user.userId,
        ip: `203.0.113.${index + 1}`,
        userAgent: `ConcurrentTestBrowser/${index + 1}`,
        token: user.token,
        refreshToken: user.refreshToken,
      })
    )
  );

  assert.equal(results.length, 30);
  assert.equal(createdSessions.length, 30);
  assert.equal(createCalls, 30);

  assert.equal(new Set(results.map((session) => session.documentId)).size, 30);
  assert.equal(new Set(createdSessions.map((session) => session.sessionId)).size, 30);
  assert.equal(new Set(createdSessions.map((session) => session.tokenHash)).size, 30);
  assert.equal(new Set(createdSessions.map((session) => session.refreshTokenHash)).size, 30);

  for (const [index, user] of users.entries()) {
    const session = results[index];

    assert.equal(session.user, user.userId);
    assert.equal(session.isActive, true);
    assert.equal(session.ipAddress, `203.0.113.${index + 1}`);

    assert.notEqual(session.token, user.token);
    assert.notEqual(session.refreshToken, user.refreshToken);
    assert.match(session.tokenHash, /^[a-f0-9]{64}$/);
    assert.match(session.refreshTokenHash, /^[a-f0-9]{64}$/);
    assert.match(session.sessionId, /^sess_/);
  }
});

test('rotateSessionTokens allows only one concurrent rotation for the old refresh token', async () => {
  const oldRefreshToken = `old-refresh-${'a'.repeat(32)}`;
  const state = {
    documentId: 'session-doc-1',
    isActive: true,
    tokenHash: require('../server/src/utils/encryption').hashToken('old-access'),
    refreshTokenHash: require('../server/src/utils/encryption').hashToken(oldRefreshToken),
  };

  const strapi = {
    db: {
      query(uid) {
        assert.equal(uid, SESSION_UID);
        return {
          async updateMany({ where, data }) {
            const matches =
              state.documentId === where.documentId &&
              state.isActive === where.isActive &&
              state.refreshTokenHash === where.refreshTokenHash;

            if (!matches) return { count: 0 };
            Object.assign(state, data);
            await new Promise((resolve) => setTimeout(resolve, 5));
            return { count: 1 };
          },
        };
      },
    },
    log: createLogger(),
  };

  const service = createSessionService({ strapi });
  const results = await Promise.all([
    service.rotateSessionTokens({
      sessionId: state.documentId,
      expectedRefreshToken: oldRefreshToken,
      accessToken: 'new-access-1',
      refreshToken: 'new-refresh-1',
    }),
    service.rotateSessionTokens({
      sessionId: state.documentId,
      expectedRefreshToken: oldRefreshToken,
      accessToken: 'new-access-2',
      refreshToken: 'new-refresh-2',
    }),
  ]);

  assert.deepEqual(results.sort(), [false, true]);
});

test('rotateSessionTokens handles 30 users refreshing concurrently', async () => {
  const { hashToken } = require('../server/src/utils/encryption');
  const sessions = new Map(Array.from({ length: 30 }, (_, index) => {
    const number = index + 1;
    return [`session-${number}`, {
      documentId: `session-${number}`,
      isActive: true,
      refreshTokenHash: hashToken(`old-refresh-${number}`),
    }];
  }));
  const strapi = {
    db: {
      query: () => ({
        updateMany: async ({ where, data }) => {
          const session = sessions.get(where.documentId);
          if (!session || !session.isActive || session.refreshTokenHash !== where.refreshTokenHash) {
            return { count: 0 };
          }
          Object.assign(session, data);
          await new Promise((resolve) => setTimeout(resolve, Number(where.documentId.split('-')[1]) % 4));
          return { count: 1 };
        },
      }),
    },
    log: createLogger(),
  };

  const service = createSessionService({ strapi });
  const results = await Promise.all(Array.from({ length: 30 }, (_, index) => {
    const number = index + 1;
    return service.rotateSessionTokens({
      sessionId: `session-${number}`,
      expectedRefreshToken: `old-refresh-${number}`,
      accessToken: `new-access-${number}`,
      refreshToken: `new-refresh-${number}`,
    });
  }));

  assert.equal(results.filter(Boolean).length, 30);
  assert.equal(new Set([...sessions.values()].map((session) => session.tokenHash)).size, 30);
  assert.equal(new Set([...sessions.values()].map((session) => session.refreshTokenHash)).size, 30);
});

test('terminateSessionByRefreshToken atomically logs out an active session', async () => {
  const rawRefreshToken = `refresh-${'b'.repeat(32)}`;
  const expectedHash = require('../server/src/utils/encryption').hashToken(rawRefreshToken);
  let updateArgs;
  const strapi = {
    db: {
      query: () => ({
        updateMany: async (args) => {
          updateArgs = args;
          return { count: 1 };
        },
      }),
    },
    log: createLogger(),
  };

  const service = createSessionService({ strapi });
  const terminated = await service.terminateSessionByRefreshToken(rawRefreshToken);

  assert.equal(terminated, true);
  assert.deepEqual(updateArgs.where, {
    refreshTokenHash: expectedHash,
    isActive: true,
  });
  assert.equal(updateArgs.data.isActive, false);
  assert.equal(updateArgs.data.terminationReason, 'logout');
});

test('terminateSession drains more than 1000 active sessions for one user', async () => {
  const active = new Set(Array.from({ length: 1205 }, (_, index) => `session-${index}`));
  let findCalls = 0;
  const strapi = {
    documents: () => ({
      findMany: async ({ limit }) => {
        findCalls++;
        return [...active].slice(0, limit).map((documentId) => ({ documentId }));
      },
      update: async ({ documentId }) => {
        active.delete(documentId);
      },
    }),
    log: createLogger(),
  };

  const service = createSessionService({ strapi });
  const result = await service.terminateSession({ userId: 'user-document-id', reason: 'blocked' });

  assert.equal(result.terminatedCount, 1205);
  assert.equal(active.size, 0);
  assert.ok(findCalls >= 4);
});

test('session lists do not perform GeoIP lookups when all geo features are disabled', async () => {
  invalidateSettingsCache();
  let geoLookups = 0;
  const strapi = {
    config: {
      get(key) {
        if (key === 'plugin::magic-sessionmanager') {
          return {
            enableGeolocation: false,
            enableGeofencing: false,
            blockSuspiciousSessions: false,
          };
        }
        return {};
      },
    },
    store: () => ({ get: async () => null }),
    documents: () => ({
      findMany: async () => [{
        documentId: 'session-no-geo',
        ipAddress: '8.8.8.8',
        userAgent: 'Test/1.0',
        loginTime: new Date(),
        lastActive: new Date(),
        isActive: true,
      }],
    }),
    plugin: () => ({
      service: () => ({
        getIpInfo: async () => {
          geoLookups++;
          return { _status: 'ok', country: 'Germany' };
        },
      }),
    }),
    log: createLogger(),
  };

  const service = createSessionService({ strapi });
  await service.getAllSessions();

  assert.equal(geoLookups, 0);
});

test('createSession preserves a valid security score of zero', async () => {
  let createdData;
  const strapi = {
    documents: () => ({
      create: async ({ data }) => {
        createdData = data;
        return { documentId: 'session-zero', ...data };
      },
    }),
    log: createLogger(),
  };

  const service = createSessionService({ strapi });
  await service.createSession({
    userId: 'user-zero',
    token: 'access-zero',
    geoData: { securityScore: 0 },
  });

  assert.equal(createdData.securityScore, 0);
});
