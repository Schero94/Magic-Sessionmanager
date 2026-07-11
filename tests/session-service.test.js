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

function createSessionLockTransaction(onLock = async () => {}) {
  return async (callback) => {
    let lockedDocumentId = null;
    const trx = (tableName) => {
      assert.equal(tableName, 'magic_sessions');
      let forUpdateCalled = false;
      return {
        where(criteria) {
          lockedDocumentId = criteria.document_id;
          return this;
        },
        forUpdate() {
          forUpdateCalled = true;
          return this;
        },
        async first(column) {
          assert.equal(column, 'document_id');
          assert.ok(forUpdateCalled, 'SELECT lock requires FOR UPDATE');
          await onLock(lockedDocumentId);
          return { document_id: lockedDocumentId };
        },
      };
    };
    return callback({ trx });
  };
}

test('session lock transaction mock rejects SELECT without FOR UPDATE', async () => {
  await assert.rejects(
    createSessionLockTransaction()(async ({ trx }) =>
      trx('magic_sessions')
        .where({ document_id: 'unlocked-session' })
        .first('document_id')
    ),
    /FOR UPDATE/
  );
});

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

test('terminateAuthenticatedSession selects only the authenticated user session by refresh token alone', async () => {
  const { hashToken } = require('../server/src/utils/encryption');
  const refreshToken = `shared-refresh-${'c'.repeat(32)}`;
  const refreshTokenHash = hashToken(refreshToken);
  const sessions = [
    {
      documentId: 'other-user-session',
      user: { documentId: 'other-user' },
      isActive: true,
      refreshTokenHash,
    },
    {
      documentId: 'authenticated-user-session',
      user: { documentId: 'authenticated-user' },
      isActive: true,
      refreshTokenHash,
    },
  ];
  const lookupArgs = [];
  let updateArgs;

  const strapi = {
    db: {
      transaction: createSessionLockTransaction(),
    },
    documents: (uid) => {
      assert.equal(uid, SESSION_UID);
      return {
        findFirst: async (args) => {
          lookupArgs.push(args);
          return sessions.find(
            (session) =>
              session.user.documentId === args.filters.user.documentId &&
              session.isActive === args.filters.isActive &&
              session.refreshTokenHash === args.filters.refreshTokenHash
          );
        },
        findOne: async ({ documentId }) =>
          sessions.find((session) => session.documentId === documentId),
        update: async (args) => {
          updateArgs = args;
        },
      };
    },
    log: createLogger(),
  };

  const service = createSessionService({ strapi });
  const terminated = await service.terminateAuthenticatedSession({
    userDocumentId: 'authenticated-user',
    refreshToken,
  });

  assert.equal(terminated, true);
  assert.deepEqual(lookupArgs, [
    {
      filters: {
        user: { documentId: 'authenticated-user' },
        isActive: true,
        refreshTokenHash,
      },
      fields: ['documentId'],
    },
    {
      filters: {
        documentId: 'authenticated-user-session',
        user: { documentId: 'authenticated-user' },
        isActive: true,
        refreshTokenHash,
      },
      fields: ['documentId'],
    },
  ]);
  assert.equal(updateArgs.documentId, 'authenticated-user-session');
  assert.equal(updateArgs.data.terminationReason, 'logout');
});

test('terminateAuthenticatedSession selects only the authenticated user session by access token', async () => {
  const { hashToken } = require('../server/src/utils/encryption');
  const accessToken = `shared-access-${'f'.repeat(32)}`;
  const accessTokenHash = hashToken(accessToken);
  const sessions = [
    {
      documentId: 'other-user-session',
      user: { documentId: 'other-user' },
      isActive: true,
      tokenHash: accessTokenHash,
    },
    {
      documentId: 'authenticated-user-session',
      user: { documentId: 'authenticated-user' },
      isActive: true,
      tokenHash: accessTokenHash,
    },
  ];
  const lookupArgs = [];
  let updatedDocumentId;

  const strapi = {
    db: {
      transaction: createSessionLockTransaction(),
    },
    documents: (uid) => {
      assert.equal(uid, SESSION_UID);
      return {
        findFirst: async (args) => {
          lookupArgs.push(args);
          const hashField = Object.hasOwn(args.filters, 'refreshTokenHash')
            ? 'refreshTokenHash'
            : 'tokenHash';
          return sessions.find(
            (session) =>
              session.user.documentId === args.filters.user.documentId &&
              session.isActive === args.filters.isActive &&
              session[hashField] === args.filters[hashField]
          );
        },
        findOne: async ({ documentId }) =>
          sessions.find((session) => session.documentId === documentId),
        update: async ({ documentId }) => {
          updatedDocumentId = documentId;
        },
      };
    },
    log: createLogger(),
  };

  const service = createSessionService({ strapi });
  const terminated = await service.terminateAuthenticatedSession({
    userDocumentId: 'authenticated-user',
    accessToken,
  });

  assert.equal(terminated, true);
  assert.deepEqual(
    lookupArgs.map(({ filters }) => filters),
    [
      {
        user: { documentId: 'authenticated-user' },
        isActive: true,
        tokenHash: accessTokenHash,
      },
      {
        documentId: 'authenticated-user-session',
        user: { documentId: 'authenticated-user' },
        isActive: true,
        tokenHash: accessTokenHash,
      },
    ]
  );
  assert.equal(updatedDocumentId, 'authenticated-user-session');
});

test('terminateAuthenticatedSession rejects mismatched access and refresh credentials for the same user', async () => {
  const { hashToken } = require('../server/src/utils/encryption');
  const accessToken = `session-a-access-${'1'.repeat(32)}`;
  const refreshToken = `session-b-refresh-${'2'.repeat(32)}`;
  const sessions = [
    {
      documentId: 'session-a',
      user: { documentId: 'authenticated-user' },
      isActive: true,
      tokenHash: hashToken(accessToken),
      refreshTokenHash: hashToken(`session-a-refresh-${'3'.repeat(32)}`),
    },
    {
      documentId: 'session-b',
      user: { documentId: 'authenticated-user' },
      isActive: true,
      tokenHash: hashToken(`session-b-access-${'4'.repeat(32)}`),
      refreshTokenHash: hashToken(refreshToken),
    },
  ];
  const lookupArgs = [];
  let updatedDocumentId = null;

  const strapi = {
    db: {
      transaction: createSessionLockTransaction(),
    },
    documents: (uid) => {
      assert.equal(uid, SESSION_UID);
      return {
        findFirst: async (args) => {
          lookupArgs.push(args);
          return sessions.find(
            (session) =>
              session.user.documentId === args.filters.user.documentId &&
              session.isActive === args.filters.isActive &&
              (!args.filters.tokenHash || session.tokenHash === args.filters.tokenHash) &&
              (!args.filters.refreshTokenHash ||
                session.refreshTokenHash === args.filters.refreshTokenHash)
          );
        },
        findOne: async ({ documentId }) =>
          sessions.find((session) => session.documentId === documentId),
        update: async ({ documentId }) => {
          updatedDocumentId = documentId;
        },
      };
    },
    log: createLogger(),
  };

  const service = createSessionService({ strapi });
  const terminated = await service.terminateAuthenticatedSession({
    userDocumentId: 'authenticated-user',
    refreshToken,
    accessToken,
  });

  assert.equal(terminated, false);
  assert.deepEqual(lookupArgs, [
    {
      filters: {
        user: { documentId: 'authenticated-user' },
        isActive: true,
        tokenHash: hashToken(accessToken),
        refreshTokenHash: hashToken(refreshToken),
      },
      fields: ['documentId'],
    },
  ]);
  assert.equal(updatedDocumentId, null);
});

test('terminateAuthenticatedSession preserves a terminal reason when the session becomes inactive', async () => {
  const { hashToken } = require('../server/src/utils/encryption');
  const accessToken = `racing-access-${'5'.repeat(32)}`;
  const state = {
    documentId: 'racing-session',
    user: { documentId: 'authenticated-user' },
    isActive: true,
    tokenHash: hashToken(accessToken),
    terminationReason: null,
  };
  let updateCalls = 0;
  let transactionCalls = 0;

  const makeInactive = () => {
    state.isActive = false;
    state.terminationReason = 'blocked';
  };
  const strapi = {
    db: {
      transaction: async (callback) => {
        transactionCalls++;
        makeInactive();
        return createSessionLockTransaction()(callback);
      },
    },
    documents: (uid) => {
      assert.equal(uid, SESSION_UID);
      return {
        findFirst: async ({ filters }) => {
          const matches =
            state.documentId === (filters.documentId || state.documentId) &&
            state.user.documentId === filters.user.documentId &&
            state.isActive === filters.isActive &&
            state.tokenHash === filters.tokenHash;
          return matches ? { documentId: state.documentId } : null;
        },
        findOne: async () => {
          makeInactive();
          return state;
        },
        update: async ({ data }) => {
          updateCalls++;
          Object.assign(state, data);
        },
      };
    },
    log: createLogger(),
  };

  const service = createSessionService({ strapi });
  const terminated = await service.terminateAuthenticatedSession({
    userDocumentId: 'authenticated-user',
    accessToken,
  });

  assert.equal(terminated, false);
  assert.equal(transactionCalls, 1);
  assert.equal(updateCalls, 0);
  assert.equal(state.isActive, false);
  assert.equal(state.terminationReason, 'blocked');
});

test('terminateAuthenticatedSession locks the row before revalidation so a waiting stronger termination wins', async () => {
  const { hashToken } = require('../server/src/utils/encryption');
  const accessToken = `locked-access-${'6'.repeat(32)}`;
  const state = {
    documentId: 'locked-session',
    user: { documentId: 'authenticated-user' },
    isActive: true,
    tokenHash: hashToken(accessToken),
    terminationReason: null,
  };
  const events = [];
  let lookupCalls = 0;
  let lockHeld = false;
  let releaseWaitingTermination;
  let competingTermination;

  const runCompetingTermination = async () => {
    events.push('competing-attempt');
    if (lockHeld) {
      await new Promise((resolve) => {
        releaseWaitingTermination = resolve;
      });
    }
    state.isActive = false;
    state.terminationReason = 'blocked';
    events.push('competing-commit');
  };

  const strapi = {
    db: {
      transaction: async (callback) => {
        let lockedDocumentId = null;
        const trx = (tableName) => {
          assert.equal(tableName, 'magic_sessions');
          let forUpdateCalled = false;
          return {
            where(criteria) {
              lockedDocumentId = criteria.document_id;
              return this;
            },
            forUpdate() {
              forUpdateCalled = true;
              return this;
            },
            async first(column) {
              assert.equal(column, 'document_id');
              assert.equal(lockedDocumentId, state.documentId);
              assert.ok(forUpdateCalled, 'SELECT lock requires FOR UPDATE');
              lockHeld = true;
              events.push('lock-acquired');
              return { document_id: lockedDocumentId };
            },
          };
        };

        const result = await callback({ trx });
        events.push('logout-commit');
        lockHeld = false;
        releaseWaitingTermination?.();
        await competingTermination;
        return result;
      },
    },
    documents: (uid) => {
      assert.equal(uid, SESSION_UID);
      return {
        findFirst: async ({ filters }) => {
          lookupCalls++;
          if (lookupCalls === 1) {
            events.push('initial-selection');
          } else {
            events.push('predicate-revalidation');
            competingTermination = runCompetingTermination();
          }

          const matches =
            state.documentId === (filters.documentId || state.documentId) &&
            state.user.documentId === filters.user.documentId &&
            state.isActive === filters.isActive &&
            state.tokenHash === filters.tokenHash;
          return matches ? { documentId: state.documentId } : null;
        },
        update: async ({ data }) => {
          events.push('logout-update');
          Object.assign(state, data);
        },
      };
    },
    log: createLogger(),
  };

  const service = createSessionService({ strapi });
  const terminated = await service.terminateAuthenticatedSession({
    userDocumentId: 'authenticated-user',
    accessToken,
  });

  assert.equal(terminated, true);
  assert.deepEqual(events, [
    'initial-selection',
    'lock-acquired',
    'predicate-revalidation',
    'competing-attempt',
    'logout-update',
    'logout-commit',
    'competing-commit',
  ]);
  const lockIndex = events.indexOf('lock-acquired');
  assert.ok(lockIndex < events.indexOf('predicate-revalidation'));
  assert.ok(lockIndex < events.indexOf('logout-update'));
  assert.equal(state.isActive, false);
  assert.equal(state.terminationReason, 'blocked');
});

test('terminateAuthenticatedSession returns false when no owned active session matches', async () => {
  let updateCalls = 0;
  const strapi = {
    documents: (uid) => {
      assert.equal(uid, SESSION_UID);
      return {
        findFirst: async () => null,
        update: async () => {
          updateCalls++;
        },
      };
    },
    log: createLogger(),
  };

  const service = createSessionService({ strapi });
  const terminated = await service.terminateAuthenticatedSession({
    userDocumentId: 'authenticated-user',
    refreshToken: `unknown-refresh-${'a'.repeat(32)}`,
  });

  assert.equal(terminated, false);
  assert.equal(updateCalls, 0);
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
