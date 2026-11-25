'use strict';

// App-user security activity (4.22): the controller's read audit and viewer,
// and the service's response rows with an in-memory Query Engine fake. The
// real database, RBAC and Content Manager permission path is covered by
// tests/isolated-user-activity-http.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

test('controller: exports are audited when they start; lists only with an admin API token', async () => {
  const createController = require('../server/src/controllers/user-activity');
  const audits = [];
  const viewers = [];
  const queries = [];
  const strapi = {
    log: silentLog,
    plugin: () => ({
      service: () => ({
        recordLogRead: (input) => audits.push(input),
        listUserActivity: async (query, viewer) => {
          queries.push(query);
          viewers.push(viewer);
          return { data: [], meta: {} };
        },
        exportBatch: async () => ({ data: [], meta: { nextCursor: null } }),
      }),
    }),
  };
  const controller = createController({ strapi });
  const ctxFor = (strategy, query = {}, can = () => false) => ({
    query,
    state: {
      user: { id: 3 },
      userAbility: { can },
      auth: { strategy: { name: strategy }, credentials: { id: 12 } },
    },
    badRequest(message, details) {
      this.status = 400;
      this.body = { error: { message, details } };
      return this.body;
    },
  });

  await controller.list(ctxFor('admin'));
  assert.equal(audits.length, 0, 'a person reading the list in the admin panel is not audited');
  await controller.list(
    ctxFor(
      'admin-token',
      {},
      (action) => action === 'plugin::magic-sessionmanager.impersonate.users'
    )
  );
  await controller.export(ctxFor('admin'));
  await controller.export(ctxFor('admin', { cursor: '500' }));
  await controller.export(ctxFor('admin-token'));
  assert.deepEqual(audits, [
    { adminId: 3, tokenId: 12, list: 'user-activity', exported: false, via: 'admin-token' },
    { adminId: 3, tokenId: null, list: 'user-activity', exported: true, via: 'admin-panel' },
    { adminId: 3, tokenId: 12, list: 'user-activity', exported: true, via: 'admin-token' },
  ]);
  assert.deepEqual(
    viewers.map((viewer) => [viewer.canReadAdmins, viewer.canSeeImpersonationReason]),
    [
      [false, false],
      [false, true],
    ]
  );

  // Strict, bounded query: unknown keys and bad values are a 400 without a service call.
  for (const bad of [
    { event: 'everything' },
    { pageSize: '101' },
    { userId: 'a b' },
    { userId: 'x'.repeat(65) },
    { unknown: '1' },
    { from: '2026-02-01T00:00:00Z', to: '2026-01-01T00:00:00Z' },
  ]) {
    const ctx = ctxFor('admin', bad);
    await controller.list(ctx);
    assert.equal(ctx.status, 400, JSON.stringify(bad));
  }
  assert.equal(queries.length, 2);
  assert.equal(queries[0].event, 'all');
  assert.equal(queries[0].pageSize, 20);
});

test('controller: a failing service answers a fixed 500 without details', async () => {
  const createController = require('../server/src/controllers/user-activity');
  const errors = [];
  const strapi = {
    log: { ...silentLog, error: (...args) => errors.push(args.join(' ')) },
    plugin: () => ({
      service: () => ({
        recordLogRead() {},
        listUserActivity: async () => {
          throw new Error('SQLITE_ERROR near "ann@example.test"');
        },
      }),
    }),
  };
  const ctx = {
    query: {},
    state: { user: { id: 1 }, userAbility: { can: () => true } },
    internalServerError(message) {
      this.status = 500;
      this.body = { error: { message } };
      return this.body;
    },
  };
  await createController({ strapi }).list(ctx);
  assert.equal(ctx.status, 500);
  assert.equal(ctx.body.error.message, 'Security activity could not be loaded.');
  assert.ok(!errors.join(' ').includes('ann@example.test'), 'the error message is not logged');
});

/**
 * Service with a fake Strapi: stored events, two app users and one admin.
 *
 * @param {{settings?: object, ability?: any}} [options] Settings and the reader.
 * @returns {{service: any, rows: object[], strapi: any}} Service.
 */
function setupService({ settings = {}, readable = { email: true, username: true } } = {}) {
  const servicePath = require.resolve('../server/src/services/security-log');
  const loaderPath = require.resolve('../server/src/utils/settings-loader');
  delete require.cache[servicePath];
  delete require.cache[loaderPath];
  const coordination = require('../server/src/utils/coordination');
  const original = coordination.getCoordinator;
  coordination.getCoordinator = () => ({ getRevision: async () => 0, bumpRevision: async () => 1 });
  test.after(() => {
    coordination.getCoordinator = original;
  });
  const createService = require(servicePath);
  const at = new Date();
  const rows = [
    {
      id: 3,
      event: 'user.lockout',
      actorType: 'user',
      actorId: null,
      targetType: 'user',
      targetId: 'usrann',
      ip: '203.0.113.42',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/133.0',
      geo: { country: 'Exampleland', city: 'Sample City' },
      meta: { kind: 'account', failures: 5, minutes: 15, deviceHash: 'a'.repeat(64) },
      createdAt: at,
    },
    {
      id: 2,
      event: 'user.lockout.lifted',
      actorType: 'admin',
      actorId: '9',
      targetType: 'user',
      targetId: 'usrann',
      ip: null,
      userAgent: null,
      geo: null,
      meta: { kind: 'account', socketIp: '127.0.0.0' },
      createdAt: at,
    },
    {
      id: 1,
      event: 'admin.sign-in',
      actorType: 'admin',
      actorId: '9',
      targetType: 'admin',
      targetId: '9',
      meta: {},
      createdAt: at,
    },
  ];
  const strapi = {
    config: { get: () => ({}) },
    log: silentLog,
    store: () => ({ get: async () => settings, set: async () => {} }),
    contentTypes: {
      'plugin::users-permissions.user': { attributes: { email: {}, username: {} } },
    },
    db: {
      query: (uid) => ({
        count: async () => rows.length,
        findMany: async () => {
          if (uid === 'plugin::users-permissions.user') {
            return [{ id: 7, documentId: 'usrann', email: 'ann@example.test', username: 'ann' }];
          }
          if (uid === 'admin::user') {
            return [{ id: 9, firstname: 'Ada', lastname: 'Owner', email: 'ada@example.test' }];
          }
          return rows;
        },
      }),
    },
    plugin: (name) => ({
      service: (service) =>
        name === 'content-manager' && service === 'permission-checker'
          ? {
              create: ({ userAbility }) => ({
                cannot: { read: () => !userAbility },
                can: { read: (_entity, field) => Boolean(userAbility && readable[field]) },
              }),
            }
          : null,
    }),
  };
  return { service: createService({ strapi }), rows, strapi };
}

test('service: rows carry the user only as far as the reader may read users', async () => {
  const query = { page: 1, pageSize: 20 };
  const full = await setupService().service.listUserActivity(query, {
    ability: {},
    canReadAdmins: true,
  });
  assert.deepEqual(
    full.data.map((row) => row.event),
    ['user.lockout', 'user.lockout.lifted'],
    'admin events never reach the app-user view'
  );
  const [lockout, lifted] = full.data;
  assert.deepEqual(lockout.user, {
    id: 7,
    documentId: 'usrann',
    email: 'ann@example.test',
    username: 'ann',
  });
  assert.deepEqual(lockout.details, { kind: 'account', failures: 5, minutes: 15 });
  assert.equal(lockout.ipAddress, '203.0.113.42');
  assert.deepEqual(lockout.location, {
    country: 'Exampleland',
    countryCode: null,
    city: 'Sample City',
  });
  assert.match(lockout.browser, /^Firefox/);
  assert.deepEqual(lifted.actor, { type: 'admin', id: 9, name: 'Ada Owner' });
  assert.deepEqual(full.meta.identity, {
    users: true,
    names: true,
    impersonationReasons: false,
  });
  const raw = JSON.stringify(full);
  assert.ok(!raw.includes('aaaaaaaa'), 'no device hash');
  assert.ok(!raw.includes('socketIp') && !raw.includes('127.0.0.0'), 'no socket address');

  const masked = await setupService().service.listUserActivity(query, { ability: null });
  assert.deepEqual(masked.data[0].user, { id: 7, documentId: 'usrann', email: '', username: '' });
  assert.equal(masked.data[1].actor.name, '', 'admin names need admin::users.read');
  assert.equal(masked.meta.identity.users, false);
  assert.ok(!JSON.stringify(masked).includes('ann@example.test'));

  const fieldLevel = await setupService({
    readable: { email: false, username: true },
  }).service.listUserActivity(query, { ability: {} });
  assert.deepEqual(
    [fieldLevel.data[0].user.email, fieldLevel.data[0].user.username],
    ['', 'ann'],
    'field-level: email hidden, username readable'
  );
});

test('service: current privacy switches apply at read time', async () => {
  const query = { page: 1, pageSize: 20 };
  const anonymised = await setupService({
    settings: { securityLogAnonymizeIp: true },
  }).service.listUserActivity(query, { ability: {} });
  assert.equal(anonymised.data[0].ipAddress, '203.0.113.0');
  assert.equal(anonymised.data[0].ipAnonymized, true);
  const off = await setupService({
    settings: { securityLogStoreIp: false },
  }).service.listUserActivity(query, { ability: {} });
  assert.equal(off.data[0].ipAddress, null);
  assert.equal(off.data[0].location, null, 'no address, no place derived from it');
  assert.equal(off.meta.recording.ipAddresses, false);
});

test('service: browser exports are recorded every time, token reads once per 5 minutes', async () => {
  const { service } = setupService();
  const panel = { adminId: 3, list: 'user-activity', exported: true, via: 'admin-panel' };
  assert.equal(service.recordLogRead(panel), true);
  assert.equal(service.recordLogRead(panel), true);
  const token = { adminId: 3, tokenId: 12, list: 'user-activity', exported: false };
  assert.equal(service.recordTokenRead(token), true);
  assert.equal(service.recordTokenRead(token), false);
  assert.equal(service.recordLogRead({ ...panel, list: 'unknown-list' }), true);
});
