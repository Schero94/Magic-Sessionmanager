'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  accountState,
  adminParamsSchema,
  displayName,
  getAdminSessionManager,
  groupSessionsByDevice,
  listAdmins,
  listQuerySchema,
  parseInput,
  readSessionPolicy,
  sessionParamsSchema,
  signOutAdmin,
  signOutBlockReason,
  summariseByAdmin,
} = require('../server/src/utils/admin-sessions');
const controllerFactory = require('../server/src/controllers/admin-sessions');

const SUPER = { code: 'strapi-super-admin', name: 'Super Admin' };
const EDITOR = { code: 'strapi-editor', name: 'Editor' };

test('list query is strict and bounded', () => {
  assert.deepEqual(parseInput(listQuerySchema, {}).value, {
    page: 1,
    pageSize: 25,
    search: '',
    filter: 'all',
  });
  assert.equal(parseInput(listQuerySchema, { pageSize: '101' }).ok, false);
  assert.equal(parseInput(listQuerySchema, { filter: 'everyone' }).ok, false);
  assert.equal(parseInput(listQuerySchema, { extra: '1' }).ok, false);
  assert.equal(parseInput(listQuerySchema, { search: 'x'.repeat(101) }).ok, false);
  const rejected = parseInput(listQuerySchema, { search: 'x'.repeat(101) });
  assert.ok(!JSON.stringify(rejected.errors).includes('xxxxx'), 'errors never echo input');
});

test('route parameters accept only positive integer ids and Strapi session ids', () => {
  assert.equal(parseInput(adminParamsSchema, { adminId: '12' }).ok, true);
  for (const adminId of ['0', '-1', '1.5', 'abc', '1'.repeat(13), '1 OR 1=1']) {
    assert.equal(parseInput(adminParamsSchema, { adminId }).ok, false, adminId);
  }
  const sessionId = 'a'.repeat(32);
  assert.equal(parseInput(sessionParamsSchema, { adminId: '3', sessionId }).ok, true);
  for (const bad of ['A'.repeat(32), 'a'.repeat(31), 'a'.repeat(33), '../x']) {
    assert.equal(parseInput(sessionParamsSchema, { adminId: '3', sessionId: bad }).ok, false);
  }
});

test('live rows are grouped per browser, newest first, without device ids', () => {
  const rows = [
    {
      userId: '1',
      sessionId: 'b'.repeat(32),
      deviceId: 'dev-2',
      type: 'session',
      createdAt: '2026-11-17T10:00:00.000Z',
      expiresAt: '2026-11-17T12:00:00.000Z',
      absoluteExpiresAt: '2026-12-17T10:00:00.000Z',
      metadata: { deviceName: 'Firefox on Linux', loginAt: '2026-11-17T09:00:00.000Z' },
    },
    {
      userId: '1',
      sessionId: 'a'.repeat(32),
      deviceId: 'dev-1',
      type: 'refresh',
      createdAt: '2026-11-17T08:00:00.000Z',
      expiresAt: '2026-12-01T08:00:00.000Z',
      absoluteExpiresAt: '2026-11-20T08:00:00.000Z',
      metadata: { loginAt: '2026-11-16T08:00:00.000Z' },
    },
    {
      // Second family on the same browser: same group, earlier login wins.
      userId: '1',
      sessionId: 'c'.repeat(32),
      deviceId: 'dev-1',
      type: 'session',
      createdAt: '2026-11-17T07:00:00.000Z',
      expiresAt: '2026-11-17T09:00:00.000Z',
      absoluteExpiresAt: null,
      metadata: { loginAt: '2026-11-15T08:00:00.000Z', deviceName: 'Safari' },
    },
  ];
  const groups = groupSessionsByDevice(rows, 'dev-1');
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], {
    id: 'b'.repeat(32),
    device: 'Firefox on Linux',
    signedInAt: '2026-11-17T09:00:00.000Z',
    lastActiveAt: '2026-11-17T10:00:00.000Z',
    endsAt: '2026-11-17T12:00:00.000Z',
    rememberMe: false,
    current: false,
  });
  assert.equal(groups[1].id, 'a'.repeat(32));
  assert.equal(groups[1].device, null, 'unknown device stays unknown');
  assert.equal(groups[1].signedInAt, '2026-11-15T08:00:00.000Z');
  assert.equal(
    groups[1].endsAt,
    '2026-11-20T08:00:00.000Z',
    'absolute expiry caps the idle expiry'
  );
  assert.equal(groups[1].rememberMe, true);
  assert.equal(groups[1].current, true);
  assert.ok(!JSON.stringify(groups).includes('dev-1'));

  const summary = summariseByAdmin(rows);
  assert.equal(summary.get('1').count, 2);
  assert.equal(summary.get('1').lastActiveAt, '2026-11-17T10:00:00.000Z');
});

test('account state follows what Strapi enforces', () => {
  assert.equal(accountState({ isActive: true, blocked: false }), 'active');
  assert.equal(accountState({ isActive: true, blocked: null }), 'active');
  assert.equal(accountState({ isActive: true, blocked: true }), 'deactivated');
  assert.equal(accountState({ isActive: false }), 'deactivated');
  assert.equal(accountState({ isActive: false, hasRegistrationToken: true }), 'invited');
  assert.equal(
    displayName({ firstname: 'Ada', lastname: 'Owner', email: 'a@example.test' }),
    'Ada Owner'
  );
  assert.equal(displayName({ email: 'a@example.test' }), 'a@example.test');
});

test('only a Super Admin (or the admin themselves) can sign out a Super Admin', () => {
  const superA = { id: 1, roles: [SUPER], isActive: true };
  const superB = { id: 2, roles: [SUPER], isActive: true };
  const editor = { id: 3, roles: [EDITOR], isActive: true };
  const delegate = { id: 4, roles: [{ code: 'custom-revoker' }], isActive: true };
  assert.equal(signOutBlockReason(superA, superB), null);
  assert.equal(
    signOutBlockReason(superA, superA),
    null,
    'self sign-out is allowed (with a warning)'
  );
  assert.equal(signOutBlockReason(superA, editor), null);
  assert.equal(signOutBlockReason(delegate, superA), 'super-admin-protected');
  assert.equal(signOutBlockReason(delegate, editor), null);
  assert.equal(
    signOutBlockReason(superA, { id: 5, roles: [EDITOR], isActive: false }),
    'account-inactive'
  );
});

test('session policy reads the host configuration with Strapi defaults', () => {
  const values = { 'admin.auth.sessions.accessTokenLifespan': 600 };
  const policy = readSessionPolicy({ config: { get: (key) => values[key] } });
  assert.equal(policy.accessTokenLifespan, 600);
  assert.equal(policy.idleSessionLifespan, 7200);
  assert.equal(policy.maxSessionLifespan, 2592000);
});

test('hosts without Strapi session management are reported as unsupported', async () => {
  assert.equal(getAdminSessionManager({}), null);
  const noOrigin = Object.assign(() => ({}), { hasOrigin: () => false });
  assert.equal(getAdminSessionManager({ sessionManager: noOrigin, contentTypes: {} }), null);
  const body = await listAdmins(
    { config: { get: () => undefined } },
    { page: 1, pageSize: 25, search: '', filter: 'all' },
    { id: 1 }
  );
  assert.equal(body.meta.supported, false);
  assert.deepEqual(body.data, []);
  await assert.rejects(
    signOutAdmin({ config: { get: () => undefined } }, { actor: { id: 1 }, adminId: '2' }),
    (error) => error.status === 503
  );
});

/**
 * Minimal Strapi double for the sign-out path: one admin user table and one
 * session table, plus a recording session manager.
 */
function fakeStrapi({ users, sessions }) {
  const calls = [];
  const logs = [];
  const events = [];
  const matches = (row, where = {}) =>
    Object.entries(where).every(([key, value]) => {
      if (key === '$or') return value.some((clause) => matches(row, clause));
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        if ('$gt' in value) return row[key] && new Date(row[key]) > value.$gt;
        if ('$null' in value) return row[key] === null || row[key] === undefined;
        if ('$notNull' in value) return row[key] !== null && row[key] !== undefined;
        return true;
      }
      return String(row[key]) === String(value);
    });
  const manager = {
    async invalidateRefreshToken(userId, deviceId) {
      calls.push({ userId, deviceId });
    },
  };
  const sessionManager = Object.assign(() => manager, { hasOrigin: () => true });
  return {
    calls,
    logs,
    events,
    strapi: {
      sessionManager,
      contentTypes: { 'admin::session': {} },
      config: { get: () => undefined },
      log: { info: (line) => logs.push(line), error() {}, warn() {} },
      eventHub: { emit: (name, payload) => events.push({ name, payload }) },
      db: {
        query(uid) {
          const table = uid === 'admin::user' ? users : sessions;
          return {
            async findOne({ where }) {
              return table.find((row) => matches(row, where)) || null;
            },
            async findMany({ where }) {
              return table.filter((row) => matches(row, where));
            },
            async count({ where }) {
              return table.filter((row) => matches(row, where)).length;
            },
          };
        },
      },
    },
  };
}

test('sign-out deletes per browser, flags self sign-out and audits without personal data', async () => {
  const future = new Date(Date.now() + 3600_000).toISOString();
  const users = [
    { id: 1, email: 'ada@example.test', isActive: true, roles: [SUPER] },
    { id: 2, email: 'erin@example.test', isActive: true, roles: [EDITOR] },
  ];
  const sessions = [
    {
      userId: '1',
      sessionId: 'a'.repeat(32),
      deviceId: 'dev-ada',
      origin: 'admin',
      status: 'active',
      expiresAt: future,
      createdAt: future,
    },
    {
      userId: '2',
      sessionId: 'b'.repeat(32),
      deviceId: 'dev-erin',
      origin: 'admin',
      status: 'active',
      expiresAt: future,
      createdAt: future,
    },
  ];
  const fake = fakeStrapi({ users, sessions });
  const actor = { id: 1, roles: [SUPER], sessionId: 'a'.repeat(32) };

  const one = await signOutAdmin(fake.strapi, { actor, adminId: '2', sessionId: 'b'.repeat(32) });
  assert.deepEqual(one, { ended: 1, signedOutSelf: false, scope: 'one' });
  assert.deepEqual(fake.calls.at(-1), { userId: '2', deviceId: 'dev-erin' });

  await assert.rejects(
    signOutAdmin(fake.strapi, { actor, adminId: '2', sessionId: 'a'.repeat(32) }),
    (error) => error.status === 404,
    'a session of another admin is not found'
  );

  const self = await signOutAdmin(fake.strapi, { actor, adminId: '1' });
  assert.deepEqual(self, { ended: 1, signedOutSelf: true, scope: 'all' });
  assert.deepEqual(fake.calls.at(-1), { userId: '1', deviceId: undefined });

  assert.deepEqual(fake.logs, [
    '[magic-sessionmanager] Admin sign-out: actor=1 target=2 scope=one ended=1',
    '[magic-sessionmanager] Admin sign-out: actor=1 target=1 scope=all ended=1',
  ]);
  const serialized = JSON.stringify([fake.logs, fake.events]);
  for (const secret of ['example.test', 'dev-ada', 'a'.repeat(32)]) {
    assert.ok(!serialized.includes(secret), `audit leaks ${secret.slice(0, 8)}`);
  }
  assert.equal(fake.events[0].name, 'magic-sessionmanager.admin-sessions.signed-out');

  const delegate = { id: 2, roles: [{ code: 'custom' }], sessionId: null };
  await assert.rejects(
    signOutAdmin(fake.strapi, { actor: delegate, adminId: '1' }),
    (error) => error.status === 403 && error.reason === 'super-admin-protected'
  );
  assert.equal(fake.calls.length, 2, 'a refused sign-out deletes nothing');
});

test('sign-out routes refuse admin API tokens before touching anything', async () => {
  let touched = false;
  const strapi = {
    log: { error() {}, info() {}, warn() {} },
    config: { get: () => undefined },
    get sessionManager() {
      touched = true;
      return undefined;
    },
  };
  const controller = controllerFactory({ strapi });
  for (const action of ['signOutSession', 'signOutEverywhere']) {
    let forbidden = null;
    const ctx = {
      state: { user: { id: 1 }, auth: { strategy: { name: 'admin-token' } } },
      params: { adminId: '2', sessionId: 'a'.repeat(32) },
      forbidden: (message, details) => {
        forbidden = { message, details };
        return forbidden;
      },
    };
    await controller[action](ctx);
    assert.equal(forbidden.details.reason, 'browser-session-required');
  }
  assert.equal(touched, false);
});
