'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const controller = require('../server/src/controllers/session');

const ACCESS_TOKEN = `Bearer ${'a'.repeat(80)}`;
const USER = { id: 42, documentId: 'user-doc-42' };
const CURRENT_NATIVE_ID = 'current-native-id';

function nativeSessionKey(ownerDocumentId, nativeSessionId) {
  const encoded = Buffer.from(JSON.stringify([ownerDocumentId, nativeSessionId])).toString(
    'base64url'
  );
  return `native_${encoded}`;
}

function nativeRow(nativeSessionId, overrides = {}) {
  const key = nativeSessionKey(USER.documentId, nativeSessionId);
  return {
    documentId: key,
    id: key,
    sessionId: key,
    nativeSessionId,
    user: { id: String(USER.id), documentId: USER.documentId },
    isActive: true,
    isTrulyActive: true,
    loginTime: new Date('2026-10-15T08:00:00.000Z'),
    ...overrides,
  };
}

function linkedNativeRow(nativeSessionId) {
  return nativeRow(nativeSessionId, {
    documentId: 'magic-sidecar-doc-id',
    id: 'magic-sidecar-doc-id',
    sessionId: 'magic-sidecar-session-id',
    nativeSessionId,
  });
}

function markTruncated(sessions) {
  Object.defineProperty(sessions, 'truncated', { value: true });
  return sessions;
}

function createContext({
  user = USER,
  sessionId = CURRENT_NATIVE_ID,
  credentials = null,
  params = {},
  body = {},
  headers = { authorization: ACCESS_TOKEN },
} = {}) {
  return {
    state: {
      user,
      session: sessionId ? { id: sessionId } : undefined,
      auth: credentials ? { credentials } : undefined,
    },
    params,
    request: { headers, body },
    body: null,
    status: 200,
    error: null,
    unauthorized(message) {
      this.error = { status: 401, message };
      return this.error;
    },
    forbidden(message) {
      this.error = { status: 403, message };
      return this.error;
    },
    badRequest(message) {
      this.error = { status: 400, message };
      return this.error;
    },
    notFound(message) {
      this.error = { status: 404, message };
      return this.error;
    },
    internalServerError(message) {
      this.error = { status: 500, message };
      return this.error;
    },
  };
}

function installStrapi(sessionService, { nativeMode = true, documents } = {}) {
  const previous = global.strapi;
  const calls = { service: [], document: [] };
  global.strapi = {
    config: {
      get(key, fallback) {
        assert.equal(key, 'plugin::users-permissions.jwtManagement');
        return nativeMode ? 'refresh' : fallback;
      },
    },
    plugin(name) {
      assert.equal(name, 'magic-sessionmanager');
      return {
        service(serviceName) {
          calls.service.push(serviceName);
          if (serviceName === 'session') return sessionService;
          if (serviceName === 'geolocation') return {};
          throw new Error(`Unexpected service ${serviceName}`);
        },
      };
    },
    documents(uid) {
      calls.document.push(uid);
      if (documents) return documents(uid);
      assert.fail(`Native route must not access Document Service directly: ${uid}`);
    },
    entityService: {
      findOne: async () => ({ documentId: USER.documentId }),
    },
    log: { error() {}, info() {}, warn() {} },
  };
  return {
    calls,
    restore() {
      global.strapi = previous;
    },
  };
}

test('own-session listing renders native-only rows and marks the authenticated current session', async () => {
  const sessions = [nativeRow(CURRENT_NATIVE_ID), nativeRow('other-native-id')];
  let requestedUserId;
  const sessionService = {
    async getUserSessions(userId) {
      requestedUserId = userId;
      return sessions;
    },
  };
  const installed = installStrapi(sessionService);
  const ctx = createContext();

  try {
    await controller.getOwnSessions(ctx);

    assert.equal(requestedUserId, '42');
    assert.equal(ctx.error, null);
    assert.deepEqual(Object.keys(ctx.body).sort(), ['data', 'meta']);
    assert.equal(ctx.body.data.length, 2);
    assert.equal(ctx.body.data[0].documentId, nativeSessionKey(USER.documentId, CURRENT_NATIVE_ID));
    assert.match(ctx.body.data[0].documentId, /^native_[A-Za-z0-9_-]+$/);
    assert.notEqual(ctx.body.data[0].documentId, `native_${CURRENT_NATIVE_ID}`);
    assert.equal(ctx.body.data[0].isCurrentSession, true);
    assert.equal(ctx.body.data[1].isCurrentSession, false);
    assert.deepEqual(ctx.body.meta, {
      count: 2,
      active: 2,
      hasMore: false,
      limit: 200,
    });
    assert.deepEqual(installed.calls.document, []);
  } finally {
    installed.restore();
  }
});

test('current-session returns a native-only row using the existing data envelope', async () => {
  const current = nativeRow(CURRENT_NATIVE_ID);
  const installed = installStrapi({ getUserSessions: async () => [current] });
  const ctx = createContext();

  try {
    await controller.getCurrentSession(ctx);

    assert.equal(ctx.error, null);
    assert.deepEqual(Object.keys(ctx.body), ['data']);
    assert.equal(ctx.body.data.documentId, nativeSessionKey(USER.documentId, CURRENT_NATIVE_ID));
    assert.equal(ctx.body.data.isCurrentSession, true);
    assert.deepEqual(installed.calls.document, []);
  } finally {
    installed.restore();
  }
});

test('own and current-session mark a linked Magic sidecar current from nativeSessionId', async () => {
  const linked = linkedNativeRow(CURRENT_NATIVE_ID);
  const installed = installStrapi({
    getUserSessions: async (userId) => {
      assert.equal(userId, '42');
      return [linked];
    },
  });
  const listContext = createContext();
  const currentContext = createContext();

  try {
    await controller.getOwnSessions(listContext);
    await controller.getCurrentSession(currentContext);

    assert.equal(listContext.body.data[0].documentId, 'magic-sidecar-doc-id');
    assert.equal(listContext.body.data[0].isCurrentSession, true);
    assert.equal(currentContext.body.data.documentId, 'magic-sidecar-doc-id');
    assert.equal(currentContext.body.data.isCurrentSession, true);
    assert.deepEqual(installed.calls.document, []);
  } finally {
    installed.restore();
  }
});

test('native own-session listing exposes service truncation without dropping existing metadata', async () => {
  const sessions = markTruncated([nativeRow(CURRENT_NATIVE_ID)]);
  const installed = installStrapi({ getUserSessions: async () => sessions });
  const ctx = createContext();

  try {
    await controller.getOwnSessions(ctx);

    assert.deepEqual(ctx.body.meta, {
      count: 1,
      active: 1,
      hasMore: true,
      limit: 200,
      truncated: true,
    });
  } finally {
    installed.restore();
  }
});

test('admin all, active and per-user list envelopes expose optional truncation metadata', async () => {
  const all = markTruncated([nativeRow('all-session')]);
  const active = markTruncated([nativeRow('active-session')]);
  const perUser = markTruncated([nativeRow('per-user-session')]);
  const installed = installStrapi({
    getAllSessions: async () => all,
    getActiveSessions: async () => active,
    getUserSessions: async (userId) => {
      assert.equal(userId, '42');
      return perUser;
    },
  });
  const allContext = createContext();
  const activeContext = createContext();
  const userContext = createContext({ params: { userId: '42' } });

  try {
    await controller.getAllSessionsAdmin(allContext);
    await controller.getActiveSessions(activeContext);
    await controller.getUserSessions(userContext);

    assert.deepEqual(allContext.body.meta, {
      count: 1,
      active: 1,
      inactive: 0,
      truncated: true,
    });
    assert.deepEqual(activeContext.body.meta, { count: 1, truncated: true });
    assert.deepEqual(userContext.body.meta, { count: 1, truncated: true });
  } finally {
    installed.restore();
  }
});

test('complete admin lists omit the optional truncated field', async () => {
  const installed = installStrapi({ getActiveSessions: async () => [nativeRow('complete-list')] });
  const ctx = createContext();

  try {
    await controller.getActiveSessions(ctx);

    assert.deepEqual(ctx.body.meta, { count: 1 });
  } finally {
    installed.restore();
  }
});

test('own native-session revoke is scoped to the authenticated owner and keeps the response contract', async () => {
  const terminateCalls = [];
  const installed = installStrapi({
    getUserSessions: async (userId) => {
      assert.equal(userId, '42');
      return [nativeRow('other-native-id')];
    },
    async terminateSession(params) {
      terminateCalls.push(params);
      return { terminatedCount: 1 };
    },
  });
  const key = nativeSessionKey(USER.documentId, 'other-native-id');
  const ctx = createContext({ params: { sessionId: key } });

  try {
    await controller.terminateOwnSession(ctx);

    assert.deepEqual(terminateCalls, [
      {
        sessionId: key,
        userId: '42',
        reason: 'manual',
      },
    ]);
    assert.deepEqual(ctx.body, {
      message: `Session ${key} terminated successfully`,
      success: true,
      alreadyTerminated: false,
    });
    assert.deepEqual(installed.calls.document, []);
  } finally {
    installed.restore();
  }
});

test('native own-session revoke denies keys absent from that authenticated user list', async () => {
  const terminateCalls = [];
  const installed = installStrapi({
    getUserSessions: async (userId) => {
      assert.equal(userId, '42');
      return [nativeRow('owned-native-id')];
    },
    async terminateSession(params) {
      terminateCalls.push(params);
      return { terminatedCount: 1 };
    },
  });
  const foreignKey = nativeSessionKey('another-user-document-id', 'another-users-id');
  const ctx = createContext({ params: { sessionId: foreignKey } });

  try {
    await controller.terminateOwnSession(ctx);

    assert.equal(ctx.error.status, 404);
    assert.deepEqual(terminateCalls, []);
    assert.deepEqual(installed.calls.document, []);
  } finally {
    installed.restore();
  }
});

test('native own-session revoke refuses to terminate the current session', async () => {
  const terminateCalls = [];
  const installed = installStrapi({
    getUserSessions: async () => [nativeRow(CURRENT_NATIVE_ID)],
    async terminateSession(params) {
      terminateCalls.push(params);
      return { terminatedCount: 1 };
    },
  });
  const ctx = createContext({
    params: { sessionId: nativeSessionKey(USER.documentId, CURRENT_NATIVE_ID) },
  });

  try {
    await controller.terminateOwnSession(ctx);

    assert.equal(ctx.error.status, 400);
    assert.deepEqual(terminateCalls, []);
  } finally {
    installed.restore();
  }
});

test('repeating an own native-session revoke preserves the existing idempotent success envelope', async () => {
  const terminateCalls = [];
  const key = nativeSessionKey(USER.documentId, 'already-revoked');
  const installed = installStrapi({
    getUserSessions: async () => [nativeRow('already-revoked', { isActive: false })],
    async terminateSession(params) {
      terminateCalls.push(params);
      return { terminatedCount: 0 };
    },
  });
  const ctx = createContext({ params: { sessionId: key } });

  try {
    await controller.terminateOwnSession(ctx);

    assert.deepEqual(ctx.body, {
      message: `Session ${key} was already terminated`,
      success: true,
      alreadyTerminated: true,
    });
    assert.deepEqual(terminateCalls, []);
  } finally {
    installed.restore();
  }
});

test('native own-session revoke treats a concurrent external revoke as an idempotent success', async () => {
  const key = nativeSessionKey(USER.documentId, 'race-revoked');
  const installed = installStrapi({
    getUserSessions: async () => [nativeRow('race-revoked')],
    terminateSession: async () => ({ terminatedCount: 0 }),
  });
  const ctx = createContext({ params: { sessionId: key } });

  try {
    await controller.terminateOwnSession(ctx);

    assert.deepEqual(ctx.body, {
      message: `Session ${key} was already terminated`,
      success: true,
      alreadyTerminated: true,
    });
  } finally {
    installed.restore();
  }
});

test('native logout revokes only the authenticated user current session', async () => {
  const terminateCalls = [];
  const installed = installStrapi({
    getUserSessions: async (userId) => {
      assert.equal(userId, '42');
      return [nativeRow(CURRENT_NATIVE_ID)];
    },
    async terminateSession(params) {
      terminateCalls.push(params);
      return { terminatedCount: 1 };
    },
  });
  const ctx = createContext({ body: { userId: '999' } });

  try {
    await controller.logout(ctx);

    assert.deepEqual(terminateCalls, [
      {
        sessionId: nativeSessionKey(USER.documentId, CURRENT_NATIVE_ID),
        userId: '42',
        reason: 'logout',
      },
    ]);
    assert.deepEqual(ctx.body, { message: 'Logged out successfully', terminated: true });
  } finally {
    installed.restore();
  }
});

test('native logout with a stale current session remains a successful idempotent no-op', async () => {
  const terminateCalls = [];
  const installed = installStrapi({
    getUserSessions: async () => [],
    terminateSession: async (params) => {
      terminateCalls.push(params);
      return { terminatedCount: 0 };
    },
  });
  const ctx = createContext();

  try {
    await controller.logout(ctx);

    assert.deepEqual(ctx.body, {
      message: 'No active session found — you are already logged out',
      terminated: false,
    });
    assert.deepEqual(terminateCalls, []);
  } finally {
    installed.restore();
  }
});

test('native logout fails closed when verified credentials contain no native session ID', async () => {
  const sessionCalls = [];
  const installed = installStrapi({
    getUserSessions: async () => {
      sessionCalls.push('list');
      return [];
    },
    terminateSession: async () => {
      sessionCalls.push('terminate');
      return { terminatedCount: 1 };
    },
  });
  const ctx = createContext({ sessionId: null, credentials: {} });

  try {
    await controller.logout(ctx);

    assert.equal(ctx.error.status, 500);
    assert.deepEqual(ctx.body, null);
    assert.deepEqual(sessionCalls, []);
  } finally {
    installed.restore();
  }
});

test('native logout cannot revoke a session ID that is not in the authenticated users list', async () => {
  const terminateCalls = [];
  const installed = installStrapi({
    getUserSessions: async (userId) => {
      assert.equal(userId, '42');
      return [nativeRow('another-users-session')];
    },
    async terminateSession(params) {
      terminateCalls.push(params);
      return { terminatedCount: 1 };
    },
  });
  const ctx = createContext();

  try {
    await controller.logout(ctx);

    assert.deepEqual(ctx.body, {
      message: 'No active session found — you are already logged out',
      terminated: false,
    });
    assert.deepEqual(terminateCalls, []);
    assert.deepEqual(installed.calls.document, []);
  } finally {
    installed.restore();
  }
});

test('native logout delegates a linked session through its Magic sidecar key', async () => {
  const terminateCalls = [];
  const installed = installStrapi({
    getUserSessions: async () => [linkedNativeRow(CURRENT_NATIVE_ID)],
    async terminateSession(params) {
      terminateCalls.push(params);
      return { terminatedCount: 1 };
    },
  });
  const ctx = createContext();

  try {
    await controller.logout(ctx);

    assert.deepEqual(terminateCalls, [
      {
        sessionId: 'magic-sidecar-doc-id',
        userId: '42',
        reason: 'logout',
      },
    ]);
    assert.deepEqual(ctx.body, { message: 'Logged out successfully', terminated: true });
  } finally {
    installed.restore();
  }
});

test('native logout-all uses only the authenticated Users & Permissions user ID', async () => {
  const terminateCalls = [];
  const installed = installStrapi({
    async terminateSession(params) {
      terminateCalls.push(params);
      return { terminatedCount: 3 };
    },
  });
  const ctx = createContext({ body: { userId: '999' } });

  try {
    await controller.logoutAll(ctx);

    assert.deepEqual(terminateCalls, [{ userId: '42', reason: 'logout' }]);
    assert.deepEqual(ctx.body, {
      message: 'Logged out from all devices successfully',
      terminatedCount: 3,
    });
  } finally {
    installed.restore();
  }
});

test('native logout-others preserves the authenticated current session', async () => {
  const terminateCalls = [];
  const installed = installStrapi({
    getUserSessions: async (userId) => {
      assert.equal(userId, '42');
      return [nativeRow(CURRENT_NATIVE_ID)];
    },
    async terminateSession(params) {
      terminateCalls.push(params);
      return { terminatedCount: 2 };
    },
  });
  const ctx = createContext();

  try {
    await controller.logoutOthers(ctx);

    assert.deepEqual(terminateCalls, [
      {
        userId: '42',
        exceptSessionId: nativeSessionKey(USER.documentId, CURRENT_NATIVE_ID),
        reason: 'logout',
      },
    ]);
    assert.deepEqual(ctx.body, {
      message: '2 other session(s) terminated',
      terminatedCount: 2,
      currentSessionPreserved: true,
    });
  } finally {
    installed.restore();
  }
});

test('native logout-others preserves the linked Magic sidecar and native session together', async () => {
  const terminateCalls = [];
  const installed = installStrapi({
    getUserSessions: async () => [linkedNativeRow(CURRENT_NATIVE_ID)],
    async terminateSession(params) {
      terminateCalls.push(params);
      return { terminatedCount: 1 };
    },
  });
  const ctx = createContext();

  try {
    await controller.logoutOthers(ctx);

    assert.deepEqual(terminateCalls, [
      {
        userId: '42',
        exceptSessionId: 'magic-sidecar-doc-id',
        reason: 'logout',
      },
    ]);
    assert.deepEqual(ctx.body, {
      message: '1 other session(s) terminated',
      terminatedCount: 1,
      currentSessionPreserved: true,
    });
  } finally {
    installed.restore();
  }
});

test('native logout-others retains the established logout-all fallback when no current row is owned', async () => {
  const terminateCalls = [];
  const installed = installStrapi({
    getUserSessions: async () => [nativeRow('another-users-session')],
    async terminateSession(params) {
      terminateCalls.push(params);
      return { terminatedCount: 1 };
    },
  });
  const ctx = createContext();

  try {
    await controller.logoutOthers(ctx);

    assert.deepEqual(terminateCalls, [{ userId: '42', reason: 'logout' }]);
    assert.deepEqual(ctx.body, {
      message: 'All sessions terminated (could not preserve current session)',
      terminatedCount: 1,
      fellBackToLogoutAll: true,
    });
  } finally {
    installed.restore();
  }
});

test('end-user logout handlers reject requests without an authenticated Users & Permissions user', async () => {
  const terminateCalls = [];
  const installed = installStrapi({
    async terminateSession(params) {
      terminateCalls.push(params);
      return { terminatedCount: 1 };
    },
  });
  const ctx = createContext({ user: null });
  ctx.state.admin = { id: 1 };

  try {
    await controller.logoutAll(ctx);

    assert.equal(ctx.error.status, 401);
    assert.deepEqual(terminateCalls, []);
  } finally {
    installed.restore();
  }
});

test('legacy logout keeps its Magic-token lookup, termination call and response envelope', async () => {
  const { hashToken } = require('../server/src/utils/encryption');
  const token = 'b'.repeat(80);
  const terminateCalls = [];
  const installed = installStrapi(
    {
      async terminateSession(params) {
        terminateCalls.push(params);
        return { terminatedCount: 1 };
      },
    },
    {
      nativeMode: false,
      documents: (uid) => {
        assert.equal(uid, 'plugin::magic-sessionmanager.session');
        return {
          findFirst: async (params) => {
            assert.deepEqual(params, {
              filters: {
                user: { documentId: USER.documentId },
                tokenHash: hashToken(token),
                isActive: true,
              },
              fields: ['documentId'],
            });
            return { documentId: 'magic-session-doc-id' };
          },
        };
      },
    }
  );
  const ctx = createContext({ headers: { authorization: `Bearer ${token}` } });

  try {
    await controller.logout(ctx);

    assert.deepEqual(terminateCalls, [
      {
        sessionId: 'magic-session-doc-id',
        reason: 'logout',
      },
    ]);
    assert.deepEqual(ctx.body, { message: 'Logged out successfully', terminated: true });
    assert.equal(installed.calls.document.length, 1);
  } finally {
    installed.restore();
  }
});

test('legacy own-session revoke remains owner-checked and idempotent', async () => {
  const terminateCalls = [];
  const installed = installStrapi(
    {
      async terminateSession(params) {
        terminateCalls.push(params);
        return { terminatedCount: 1 };
      },
    },
    {
      nativeMode: false,
      documents: (uid) => {
        assert.equal(uid, 'plugin::magic-sessionmanager.session');
        return {
          findOne: async (params) => {
            assert.equal(params.documentId, 'magic-session-doc-id');
            assert.deepEqual(params.populate, { user: { fields: ['documentId'] } });
            return {
              documentId: 'magic-session-doc-id',
              user: { documentId: USER.documentId },
              isActive: false,
            };
          },
        };
      },
    }
  );
  const ctx = createContext({
    params: { sessionId: 'magic-session-doc-id' },
    headers: {},
  });

  try {
    await controller.terminateOwnSession(ctx);

    assert.deepEqual(ctx.body, {
      message: 'Session magic-session-doc-id was already terminated',
      success: true,
      alreadyTerminated: true,
    });
    assert.deepEqual(terminateCalls, []);
  } finally {
    installed.restore();
  }
});
