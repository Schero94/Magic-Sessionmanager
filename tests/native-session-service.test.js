'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SESSION_ENCRYPTION_KEY =
  process.env.SESSION_ENCRYPTION_KEY || 'magic-sessionmanager-test-encryption-key';

const createSessionService = require('../server/src/services/session');
const { hashToken } = require('../server/src/utils/encryption');
const {
  NATIVE_SESSION_PREFIX,
  createNativeSessionKey,
  parseNativeSessionKey,
} = require('../server/src/utils/native-session-view');
const { invalidateSettingsCache } = require('../server/src/utils/settings-loader');

const SESSION_UID = 'plugin::magic-sessionmanager.session';
const USER_UID = 'plugin::users-permissions.user';
const REVOCATION_UID = 'plugin::magic-sessionmanager.revoked-token';

function createLogger() {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

function createHarness({
  mode = 'refresh',
  sessions = [],
  users = [{ id: 7, documentId: 'user-7', email: 'seven@example.test', username: 'seven' }],
  nativeSessions = [],
  isActive = () => true,
  revoke = async () => true,
  listFailure,
  userPageFailure,
  onNativeCall = () => {},
} = {}) {
  const sessionRows = new Map(
    sessions.map((session) => [session.documentId, structuredClone(session)])
  );
  const userRows = users.map((user) => structuredClone(user));
  const revocationRows = new Map();
  const calls = [];
  const manager = {
    async listSessions(userId) {
      calls.push(['listSessions', userId]);
      await onNativeCall('listSessions', userId);
      if (listFailure) throw listFailure;
      return nativeSessions.filter((session) => String(session.userId) === String(userId));
    },
    async isSessionActive(sessionId) {
      calls.push(['isSessionActive', sessionId]);
      onNativeCall('isSessionActive', sessionId);
      return isActive(sessionId);
    },
    async revokeSessionById(userId, sessionId) {
      calls.push(['revokeSessionById', userId, sessionId]);
      onNativeCall('revokeSessionById', userId, sessionId);
      return revoke(userId, sessionId);
    },
    async invalidateRefreshToken() {},
    validateAccessToken() {},
    async validateRefreshToken() {},
  };

  function applyFilters(rows, filters = {}) {
    return rows.filter((row) => {
      for (const [key, expected] of Object.entries(filters)) {
        if (key === '$or') {
          if (!expected.some((part) => applyFilters([row], part).length > 0)) return false;
          continue;
        }
        if (key === 'user' && expected?.documentId) {
          if (row.user?.documentId !== expected.documentId) return false;
          continue;
        }
        if (expected && typeof expected === 'object' && '$ne' in expected) {
          if (row[key] === expected.$ne) return false;
          continue;
        }
        if (expected && typeof expected === 'object' && '$null' in expected) {
          const isNull = row[key] == null;
          if (isNull !== expected.$null) return false;
          continue;
        }
        if (expected && typeof expected === 'object' && '$lt' in expected) {
          if (!(new Date(row[key]) < new Date(expected.$lt))) return false;
          continue;
        }
        if (row[key] !== expected) return false;
      }
      return true;
    });
  }

  const strapi = {
    config: {
      get(key, fallback) {
        if (key === 'plugin::users-permissions.jwtManagement') return mode;
        if (key === 'plugin::magic-sessionmanager')
          return { inactivityTimeout: 60 * 60 * 1000, enableGeolocation: false };
        return fallback;
      },
    },
    sessionManager(origin) {
      assert.equal(origin, 'users-permissions');
      return manager;
    },
    documents(uid) {
      if (uid === SESSION_UID) {
        return {
          async findMany({ filters, sort, start = 0, limit = 1000 } = {}) {
            let rows = applyFilters([...sessionRows.values()], filters);
            if (sort?.loginTime === 'desc') {
              rows.sort((a, b) => new Date(b.loginTime) - new Date(a.loginTime));
            }
            return rows.slice(start, start + limit).map((row) => structuredClone(row));
          },
          async findOne({ documentId }) {
            const row = sessionRows.get(documentId);
            return row ? structuredClone(row) : null;
          },
          async findFirst({ filters } = {}) {
            return structuredClone(applyFilters([...sessionRows.values()], filters)[0] || null);
          },
          async create({ data }) {
            const row = { documentId: `magic-${sessionRows.size + 1}`, ...structuredClone(data) };
            sessionRows.set(row.documentId, row);
            return structuredClone(row);
          },
          async update({ documentId, data }) {
            const row = sessionRows.get(documentId);
            if (!row) throw new Error('missing session');
            Object.assign(row, structuredClone(data));
            return structuredClone(row);
          },
          async delete({ documentId }) {
            sessionRows.delete(documentId);
          },
        };
      }

      if (uid === USER_UID) {
        return {
          async findMany({ start = 0, limit = 100, sort } = {}) {
            if (userPageFailure) throw userPageFailure;
            const rows = [...userRows];
            if (sort?.documentId === 'asc')
              rows.sort((a, b) => a.documentId.localeCompare(b.documentId));
            return rows.slice(start, start + limit).map((row) => structuredClone(row));
          },
          async findOne({ documentId }) {
            return structuredClone(userRows.find((user) => user.documentId === documentId) || null);
          },
        };
      }

      if (uid === REVOCATION_UID) {
        return {
          async findMany() {
            return [];
          },
          async findFirst({ filters } = {}) {
            return structuredClone(
              [...revocationRows.values()].find((row) => row.tokenHash === filters?.tokenHash) ||
                null
            );
          },
          async create({ data }) {
            const row = {
              documentId: `revocation-${revocationRows.size + 1}`,
              ...structuredClone(data),
            };
            revocationRows.set(row.documentId, row);
            return row;
          },
          async update({ documentId, data }) {
            Object.assign(revocationRows.get(documentId), structuredClone(data));
          },
          async delete({ documentId }) {
            revocationRows.delete(documentId);
          },
        };
      }

      assert.fail(`Unexpected document UID: ${uid}`);
    },
    entityService: {
      async findOne(_uid, id) {
        return userRows.find((user) => String(user.id) === String(id)) || null;
      },
    },
    db: {
      query(uid) {
        assert.equal(uid, SESSION_UID);
        return {
          async updateMany({ where, data }) {
            let count = 0;
            for (const row of sessionRows.values()) {
              if (applyFilters([row], where).length) {
                Object.assign(row, structuredClone(data));
                count++;
              }
            }
            return { count };
          },
        };
      },
    },
    store: () => ({ get: async () => null }),
    plugin: () => ({ service: () => ({}) }),
    log: createLogger(),
  };
  strapi.sessionManager.hasOrigin = (origin) => origin === 'users-permissions';

  return {
    service: createSessionService({ strapi }),
    strapi,
    calls,
    sessionRows,
    revocationRows,
    manager,
  };
}

function nativeSession(sessionId, overrides = {}) {
  return {
    userId: '7',
    sessionId,
    origin: 'users-permissions',
    status: 'active',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    metadata: {},
    ...overrides,
  };
}

function magicSidecar(documentId, nativeSessionId, overrides = {}) {
  return {
    documentId,
    sessionId: `sess_${documentId}`,
    nativeSessionId,
    user: { id: 7, documentId: 'user-7', email: 'seven@example.test', username: 'seven' },
    ipAddress: '203.0.113.20',
    userAgent: 'ExampleBrowser/1.0',
    loginTime: new Date(Date.now() - 10_000),
    lastActive: new Date(),
    isActive: true,
    ...overrides,
  };
}

test('createSession links an optional native session and stores only token hashes in refresh mode', async () => {
  invalidateSettingsCache();
  let createdData;
  const harness = createHarness();
  harness.strapi.documents = (uid) => {
    if (uid !== SESSION_UID) return createHarness().strapi.documents(uid);
    return {
      create: async ({ data }) => {
        createdData = data;
        return { documentId: 'magic-created', ...data };
      },
    };
  };

  const accessToken = `access-${'a'.repeat(40)}`;
  const refreshToken = `refresh-${'b'.repeat(40)}`;
  await harness.service.createSession({
    userId: 'user-7',
    nativeSessionId: 'native-created',
    token: accessToken,
    refreshToken,
  });

  assert.equal(createdData.nativeSessionId, 'native-created');
  assert.equal(createdData.token, null);
  assert.equal(createdData.refreshToken, null);
  assert.equal(createdData.tokenHash, hashToken(accessToken));
  assert.equal(createdData.refreshTokenHash, hashToken(refreshToken));
  assert.equal(JSON.stringify(createdData).includes(accessToken), false);
  assert.equal(JSON.stringify(createdData).includes(refreshToken), false);
});

test('createSession preserves encrypted token storage in legacy mode', async () => {
  invalidateSettingsCache();
  let createdData;
  const harness = createHarness({ mode: 'legacy-support' });
  harness.strapi.documents = (uid) => {
    if (uid === SESSION_UID) {
      return {
        create: async ({ data }) => {
          createdData = data;
          return { documentId: 'legacy-created', ...data };
        },
      };
    }
    return createHarness().strapi.documents(uid);
  };

  await harness.service.createSession({
    userId: 'user-7',
    token: 'legacy-access-token',
    refreshToken: 'legacy-refresh-token',
  });

  assert.notEqual(createdData.token, 'legacy-access-token');
  assert.notEqual(createdData.refreshToken, 'legacy-refresh-token');
  assert.equal(createdData.nativeSessionId, undefined);
});

test('native refresh atomically stores the new native ID and token hashes without ciphertext', async () => {
  const accessToken = 'native-access-after-rotation';
  const refreshToken = 'native-refresh-after-rotation';
  let captured;
  const harness = createHarness();
  harness.strapi.db.query = () => ({
    updateMany: async (args) => {
      captured = args;
      return { count: 1 };
    },
  });

  const rotated = await harness.service.rotateSessionTokens({
    sessionId: 'magic-sidecar',
    expectedRefreshToken: 'native-refresh-before-rotation',
    accessToken,
    refreshToken,
    nativeSessionId: 'native-session-after-rotation',
  });

  assert.equal(rotated, true);
  assert.equal(captured.data.nativeSessionId, 'native-session-after-rotation');
  assert.equal(captured.data.token, null);
  assert.equal(captured.data.refreshToken, null);
  assert.equal(captured.data.tokenHash, hashToken(accessToken));
  assert.equal(captured.data.refreshTokenHash, hashToken(refreshToken));
  assert.equal(captured.where.refreshTokenHash, hashToken('native-refresh-before-rotation'));
});

test('native per-user listing merges sidecars, native-only sessions, and external revocation safely', async () => {
  invalidateSettingsCache();
  const sidecars = [
    magicSidecar('magic-linked', 'native-linked'),
    magicSidecar('magic-externally-revoked', 'native-revoked'),
  ];
  const { service, sessionRows } = createHarness({
    sessions: sidecars,
    nativeSessions: [
      nativeSession('native-linked', {
        createdAt: new Date(),
        metadata: {
          loginAt: new Date(Date.now() - 20_000).toISOString(),
          deviceName: 'Actual browser name',
        },
      }),
      nativeSession('native-only'),
    ],
  });

  const sessions = await service.getUserSessions('user-7');
  const byDocumentId = new Map(sessions.map((session) => [session.documentId, session]));

  assert.equal(sessions.length, 3);
  assert.equal(byDocumentId.get('magic-linked').isActive, true);
  assert.equal(byDocumentId.get('magic-externally-revoked').isActive, false);
  assert.equal(byDocumentId.get('magic-externally-revoked').isTrulyActive, false);
  assert.equal(byDocumentId.get('magic-externally-revoked').terminationReason, undefined);
  assert.equal(
    sessionRows.get('magic-externally-revoked').isActive,
    true,
    'listing must reconcile the view without rewriting history'
  );

  const nativeKey = createNativeSessionKey('user-7', 'native-only');
  const nativeOnly = byDocumentId.get(nativeKey);
  assert.ok(nativeOnly);
  assert.equal(nativeOnly.id, nativeKey);
  assert.equal(nativeOnly.sessionId, nativeKey);
  assert.equal(nativeOnly.nativeSessionId, 'native-only');
  assert.equal(nativeOnly.user.documentId, 'user-7');
  assert.equal(nativeOnly.ipAddress, null);
  assert.equal(nativeOnly.userAgent, null);
  assert.equal(nativeOnly.deviceType, null);
  assert.equal(nativeOnly.deviceName, undefined);
  assert.equal(nativeOnly.terminationReason, undefined);
  assert.equal(byDocumentId.get('magic-linked').nativeSessionId, 'native-linked');
  assert.equal(
    nativeOnly.deviceName,
    undefined,
    'native device labels are not inferred without metadata'
  );
});

test('native view may expose an actual native device label without inventing IP or device type', async () => {
  invalidateSettingsCache();
  const { service } = createHarness({
    nativeSessions: [
      nativeSession('native-device', { metadata: { deviceName: 'Firefox on Linux' } }),
    ],
  });

  const [session] = await service.getUserSessions('user-7');
  assert.equal(session.deviceName, 'Firefox on Linux');
  assert.equal(session.ipAddress, null);
  assert.equal(session.deviceType, null);
});

test('normalized linked and native-only rows retain the ID needed to mark the current session', async () => {
  invalidateSettingsCache();
  const { service } = createHarness({
    sessions: [magicSidecar('magic-current-linked', 'native-current-linked')],
    nativeSessions: [nativeSession('native-current-linked'), nativeSession('native-current-only')],
  });

  const sessions = await service.getUserSessions('user-7');
  const currentLinked = sessions.find(
    (session) => session.nativeSessionId === 'native-current-linked'
  );
  const currentNativeOnly = sessions.find(
    (session) => session.nativeSessionId === 'native-current-only'
  );

  assert.equal(currentLinked.documentId, 'magic-current-linked');
  assert.equal(
    currentNativeOnly.documentId,
    createNativeSessionKey('user-7', 'native-current-only')
  );
});

test('admin native listing pages users and bounds concurrent listSessions calls', async () => {
  invalidateSettingsCache();
  const users = Array.from({ length: 205 }, (_, index) => ({
    id: index + 1,
    documentId: `user-${String(index + 1).padStart(3, '0')}`,
  }));
  let activeCalls = 0;
  let maximumActiveCalls = 0;
  const listCalls = [];
  const harness = createHarness({
    users,
    onNativeCall(method, userId) {
      if (method !== 'listSessions') return;
      listCalls.push(userId);
      activeCalls++;
      maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
      return new Promise((resolve) => {
        setTimeout(() => {
          activeCalls--;
          resolve();
        }, 2);
      });
    },
  });

  const sessions = await harness.service.getAllSessions();

  assert.deepEqual(sessions, []);
  assert.deepEqual(
    listCalls,
    users.map((user) => String(user.id))
  );
  assert.ok(maximumActiveCalls > 1);
  assert.ok(maximumActiveCalls <= 8);
});

test('native listing failure is surfaced rather than returned as a complete result', async () => {
  invalidateSettingsCache();
  const { service } = createHarness({ listFailure: new Error('native list unavailable') });

  await assert.rejects(service.getAllSessions(), /native list unavailable/);
});

test('a failed Users & Permissions user page is not reported as a complete native list', async () => {
  invalidateSettingsCache();
  const { service } = createHarness({ userPageFailure: new Error('user page unavailable') });

  await assert.rejects(service.getAllSessions(), /user page unavailable/);
});

test('active admin listing excludes externally revoked rows and includes native-only sessions', async () => {
  invalidateSettingsCache();
  const { service } = createHarness({
    sessions: [
      magicSidecar('magic-still-active', 'native-active'),
      magicSidecar('magic-revoked', 'native-revoked'),
    ],
    nativeSessions: [nativeSession('native-active'), nativeSession('native-only')],
    isActive: (sessionId) => sessionId !== 'native-revoked',
  });

  const sessions = await service.getActiveSessions();
  const ids = sessions.map((session) => session.documentId);

  assert.deepEqual(
    new Set(ids),
    new Set(['magic-still-active', createNativeSessionKey('user-7', 'native-only')])
  );
});

test('native-only session actions resolve one encoded owner without scanning user pages', async () => {
  invalidateSettingsCache();
  const harness = createHarness({ nativeSessions: [nativeSession('native-action')] });
  const originalDocuments = harness.strapi.documents.bind(harness.strapi);
  harness.strapi.documents = (uid) => {
    const api = originalDocuments(uid);
    if (uid === USER_UID) {
      api.findMany = async () => assert.fail('native-only action must not enumerate users');
    }
    return api;
  };
  const viewKey = createNativeSessionKey('user-7', 'native-action');

  assert.ok(viewKey.startsWith(NATIVE_SESSION_PREFIX));
  assert.match(viewKey, /^native_[A-Za-z0-9_-]+$/);
  assert.equal(viewKey.includes('user-7'), false);
  assert.equal(viewKey.includes('native-action'), false);
  assert.deepEqual(
    JSON.parse(
      Buffer.from(viewKey.slice(NATIVE_SESSION_PREFIX.length), 'base64url').toString('utf8')
    ),
    ['user-7', 'native-action']
  );
  assert.deepEqual(parseNativeSessionKey(viewKey), {
    userDocumentId: 'user-7',
    nativeSessionId: 'native-action',
  });

  const result = await harness.service.terminateSession({ sessionId: viewKey, reason: 'manual' });

  assert.equal(result.terminatedCount, 1);
  assert.deepEqual(
    harness.calls.filter(([method]) => method === 'revokeSessionById'),
    [['revokeSessionById', '7', 'native-action']]
  );
  assert.equal(await harness.service.deleteSession(viewKey), true);
  assert.equal(harness.calls.filter(([method]) => method === 'revokeSessionById').length, 2);
});

test('malformed native-only keys fail closed without listing native sessions', async () => {
  invalidateSettingsCache();
  const harness = createHarness();

  await assert.rejects(
    harness.service.terminateSession({ sessionId: 'native_not-valid-base64!', reason: 'manual' }),
    /invalid native session view key/i
  );
  await assert.rejects(
    harness.service.deleteSession('native_not-valid-base64!'),
    /invalid native session view key/i
  );
  assert.equal(
    harness.calls.some(([method]) => method === 'listSessions'),
    false
  );
});

test('encoded owner mismatch cannot revoke a native session owned by someone else', async () => {
  invalidateSettingsCache();
  const harness = createHarness({
    users: [
      { id: 7, documentId: 'user-7' },
      { id: 8, documentId: 'user-8' },
    ],
    nativeSessions: [nativeSession('native-other-owner', { userId: '8' })],
    isActive: () => true,
  });
  const originalDocuments = harness.strapi.documents.bind(harness.strapi);
  harness.strapi.documents = (uid) => {
    const api = originalDocuments(uid);
    if (uid === USER_UID) {
      api.findMany = async () => assert.fail('wrong-owner action must not enumerate users');
    }
    return api;
  };
  const viewKey = createNativeSessionKey('user-7', 'native-other-owner');

  await assert.rejects(
    harness.service.terminateSession({ sessionId: viewKey, reason: 'manual' }),
    /ownership could not be confirmed/i
  );
  assert.equal(
    harness.calls.some(([method]) => method === 'revokeSessionById'),
    false
  );

  const listCallsBeforeMismatch = harness.calls.filter(
    ([method]) => method === 'listSessions'
  ).length;
  await assert.rejects(
    harness.service.terminateSession({
      sessionId: viewKey,
      userId: 'user-8',
      reason: 'manual',
    }),
    /belongs to a different user/i
  );
  assert.equal(
    harness.calls.filter(([method]) => method === 'listSessions').length,
    listCallsBeforeMismatch
  );
});

test('active admin listing does not re-add a native session whose linked Magic sidecar is inactive', async () => {
  invalidateSettingsCache();
  const { service } = createHarness({
    sessions: [
      magicSidecar('magic-policy-inactive', 'native-policy-inactive', { isActive: false }),
    ],
    nativeSessions: [nativeSession('native-policy-inactive')],
  });

  const sessions = await service.getActiveSessions();
  assert.deepEqual(sessions, []);
});

test('admin listing deduplicates links from the selected sidecar page if the auxiliary link query omits them', async () => {
  invalidateSettingsCache();
  const harness = createHarness({
    sessions: [magicSidecar('magic-selected-link', 'native-selected-link')],
    nativeSessions: [nativeSession('native-selected-link')],
  });
  const originalDocuments = harness.strapi.documents.bind(harness.strapi);
  harness.strapi.documents = (uid) => {
    const api = originalDocuments(uid);
    if (uid === SESSION_UID) {
      const findMany = api.findMany;
      api.findMany = async (params = {}) => {
        if (params.populate?.user?.fields?.length === 1) return [];
        return findMany(params);
      };
    }
    return api;
  };

  const sessions = await harness.service.getAllSessions();

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].documentId, 'magic-selected-link');
});

test('admin list reports the existing 1000-row cap with a non-enumerable truncated flag', async () => {
  invalidateSettingsCache();
  const sessions = Array.from({ length: 1001 }, (_, index) => nativeSession(`native-${index + 1}`));
  const { service } = createHarness({ nativeSessions: sessions });

  const result = await service.getAllSessions();

  assert.equal(result.length, 1000);
  assert.equal(result.truncated, true);
  assert.equal(Object.keys(result).includes('truncated'), false);
});

test('native termination completes before sidecar mutation', async () => {
  invalidateSettingsCache();
  const order = [];
  const harness = createHarness({
    sessions: [magicSidecar('magic-to-terminate', 'native-to-terminate')],
    nativeSessions: [nativeSession('native-to-terminate')],
    onNativeCall(method) {
      if (method === 'revokeSessionById') order.push('native-revoke');
    },
  });
  const documents = harness.strapi.documents.bind(harness.strapi);
  harness.strapi.documents = (uid) => {
    const api = documents(uid);
    if (uid === SESSION_UID) {
      const update = api.update;
      api.update = async (args) => {
        order.push('sidecar-update');
        return update(args);
      };
    }
    return api;
  };

  const result = await harness.service.terminateSession({
    sessionId: 'magic-to-terminate',
    reason: 'manual',
  });

  assert.deepEqual(order, ['native-revoke', 'sidecar-update']);
  assert.equal(result.terminatedCount, 1);
  assert.equal(harness.sessionRows.get('magic-to-terminate').isActive, false);
});

test('native revocation failure leaves the sidecar unchanged', async () => {
  invalidateSettingsCache();
  const harness = createHarness({
    sessions: [magicSidecar('magic-still-active', 'native-failure')],
    nativeSessions: [nativeSession('native-failure')],
    revoke: async () => {
      throw new Error('native revoke unavailable');
    },
  });

  await assert.rejects(
    harness.service.terminateSession({ sessionId: 'magic-still-active', reason: 'manual' }),
    /native revoke unavailable/
  );
  assert.equal(harness.sessionRows.get('magic-still-active').isActive, true);
  assert.equal(harness.sessionRows.get('magic-still-active').terminationReason, undefined);
});

test('native user-wide termination preserves the encoded current sidecar until other revokes finish', async () => {
  invalidateSettingsCache();
  const order = [];
  const harness = createHarness({
    sessions: [
      magicSidecar('magic-current', 'native-current'),
      magicSidecar('magic-other', 'native-other'),
    ],
    nativeSessions: [
      nativeSession('native-current'),
      nativeSession('native-other'),
      nativeSession('native-only'),
    ],
    onNativeCall(method, _userId, nativeSessionId) {
      if (method === 'revokeSessionById') order.push(`revoke:${nativeSessionId}`);
    },
  });
  const documents = harness.strapi.documents.bind(harness.strapi);
  harness.strapi.documents = (uid) => {
    const api = documents(uid);
    if (uid === SESSION_UID) {
      const update = api.update;
      api.update = async (args) => {
        order.push(`update:${args.documentId}`);
        return update(args);
      };
    }
    return api;
  };

  const result = await harness.service.terminateSession({
    userId: 'user-7',
    exceptSessionId: createNativeSessionKey('user-7', 'native-current'),
    reason: 'manual',
  });

  assert.deepEqual(order.slice(0, 2), ['revoke:native-other', 'revoke:native-only']);
  assert.deepEqual(order.slice(2), ['update:magic-other']);
  assert.equal(harness.sessionRows.get('magic-current').isActive, true);
  assert.equal(harness.sessionRows.get('magic-other').isActive, false);
  assert.equal(result.terminatedCount, 2);
});

test('a linked session ID that is active under another owner cannot mutate its sidecar', async () => {
  invalidateSettingsCache();
  const harness = createHarness({
    sessions: [magicSidecar('magic-wrong-owner', 'native-owned-elsewhere')],
    nativeSessions: [],
    isActive: () => true,
  });

  await assert.rejects(
    harness.service.terminateSession({ sessionId: 'magic-wrong-owner', reason: 'manual' }),
    /ownership could not be confirmed/
  );
  assert.equal(harness.sessionRows.get('magic-wrong-owner').isActive, true);
});

test('native deletion revokes before preserving the token hash and deleting history', async () => {
  invalidateSettingsCache();
  const order = [];
  const harness = createHarness({
    sessions: [magicSidecar('magic-to-delete', 'native-to-delete', { tokenHash: 'a'.repeat(64) })],
    nativeSessions: [nativeSession('native-to-delete')],
    onNativeCall(method) {
      if (method === 'revokeSessionById') order.push('native-revoke');
    },
  });
  const documents = harness.strapi.documents.bind(harness.strapi);
  harness.strapi.documents = (uid) => {
    const api = documents(uid);
    if (uid === SESSION_UID) {
      const remove = api.delete;
      api.delete = async (args) => {
        order.push('sidecar-delete');
        return remove(args);
      };
    }
    if (uid === REVOCATION_UID) {
      const create = api.create;
      api.create = async (args) => {
        order.push('hash-revocation');
        return create(args);
      };
    }
    return api;
  };

  const deleted = await harness.service.deleteSession('magic-to-delete');

  assert.equal(deleted, true);
  assert.deepEqual(order, ['native-revoke', 'hash-revocation', 'sidecar-delete']);
  assert.equal(harness.sessionRows.has('magic-to-delete'), false);
  assert.equal(harness.revocationRows.size, 1);
});

test('native revocation failure during delete preserves both sidecar and revocation state', async () => {
  invalidateSettingsCache();
  const harness = createHarness({
    sessions: [
      magicSidecar('magic-delete-failure', 'native-delete-failure', { tokenHash: 'b'.repeat(64) }),
    ],
    nativeSessions: [nativeSession('native-delete-failure')],
    revoke: async () => {
      throw new Error('native delete revoke unavailable');
    },
  });

  await assert.rejects(
    harness.service.deleteSession('magic-delete-failure'),
    /native delete revoke unavailable/
  );
  assert.equal(harness.sessionRows.has('magic-delete-failure'), true);
  assert.equal(harness.revocationRows.size, 0);
});

test('native refresh-token logout revokes Strapi before conditional sidecar termination', async () => {
  invalidateSettingsCache();
  const rawRefreshToken = 'native-logout-refresh-token';
  const events = [];
  const harness = createHarness({
    sessions: [
      magicSidecar('magic-token-logout', 'native-token-logout', {
        refreshTokenHash: hashToken(rawRefreshToken),
      }),
    ],
    nativeSessions: [nativeSession('native-token-logout')],
    onNativeCall(method) {
      if (method === 'revokeSessionById') events.push('native-revoke');
    },
  });
  const updateMany = harness.strapi.db.query(SESSION_UID).updateMany;
  harness.strapi.db.query = () => ({
    updateMany: async (args) => {
      events.push('sidecar-logout');
      return updateMany(args);
    },
  });

  assert.equal(await harness.service.terminateSessionByRefreshToken(rawRefreshToken), true);
  assert.deepEqual(events, ['native-revoke', 'sidecar-logout']);
  assert.equal(harness.sessionRows.get('magic-token-logout').isActive, false);
});

test('idle cleanup leaves a linked sidecar active when native revocation fails', async () => {
  invalidateSettingsCache();
  const harness = createHarness({
    sessions: [
      magicSidecar('magic-idle-failure', 'native-idle-failure', {
        lastActive: new Date(Date.now() - 2 * 60 * 60 * 1000),
        loginTime: new Date(Date.now() - 3 * 60 * 60 * 1000),
      }),
    ],
    nativeSessions: [nativeSession('native-idle-failure')],
    revoke: async () => {
      throw new Error('native cleanup revoke unavailable');
    },
  });

  const deactivated = await harness.service.cleanupInactiveSessions();

  assert.equal(deactivated, 0);
  assert.equal(harness.sessionRows.get('magic-idle-failure').isActive, true);
  assert.equal(harness.sessionRows.get('magic-idle-failure').terminationReason, undefined);
});

test('native sidecar IDs are additive optional schema data', () => {
  const schema = require('../server/src/content-types/session/schema.json');
  assert.deepEqual(schema.attributes.nativeSessionId, {
    type: 'string',
    configurable: false,
    private: true,
  });
  assert.equal(schema.attributes.nativeSessionId.required, undefined);
});
