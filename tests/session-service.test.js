'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SESSION_ENCRYPTION_KEY =
  process.env.SESSION_ENCRYPTION_KEY || 'magic-sessionmanager-test-encryption-key';

const createSessionService = require('../server/src/services/session');

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
