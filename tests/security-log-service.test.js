'use strict';

// Queue, flush and switch behaviour of the security log service with an
// in-memory Query Engine fake (no database). The real database path is
// covered by tests/isolated-admin-activity-http.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');

const loaderPath = require.resolve('../server/src/utils/settings-loader');
const servicePath = require.resolve('../server/src/services/security-log');

/**
 * Fresh service + loader with a fake Strapi whose plugin store returns `stored`.
 *
 * @param {Record<string, unknown>} stored Stored plugin settings.
 * @returns {{service: any, rows: object[], strapi: any, loader: any, setStored: Function}}
 */
function setup(stored = {}) {
  delete require.cache[loaderPath];
  delete require.cache[servicePath];
  const loader = require(loaderPath);
  const createService = require(servicePath);
  let current = { ...stored };
  const rows = [];
  const coordinatorRevision = { value: 0 };
  const strapi = {
    config: { get: () => ({}) },
    log: { warn() {}, info() {}, debug() {}, error() {} },
    store: () => ({ get: async () => current, set: async ({ value }) => (current = value) }),
    db: {
      query: (uid) => ({
        createMany: async ({ data }) => {
          rows.push(...data);
          return { count: data.length };
        },
        findMany: async ({ where } = {}) =>
          uid === 'admin::user'
            ? [{ id: 5, email: 'erin.editor@example.test' }].filter((admin) =>
                where?.email?.$in?.includes(admin.email)
              )
            : rows,
      }),
    },
    plugin: () => ({ service: () => null }),
    // Coordinator stub (settings revision).
    sessionManagerCoordinator: null,
  };
  const coordination = require('../server/src/utils/coordination');
  const original = coordination.getCoordinator;
  coordination.getCoordinator = () => ({
    getRevision: async () => coordinatorRevision.value,
    bumpRevision: async () => ++coordinatorRevision.value,
  });
  test.after(() => {
    coordination.getCoordinator = original;
  });
  return {
    service: createService({ strapi }),
    rows,
    strapi,
    loader,
    setStored: (next) => {
      current = { ...current, ...next };
    },
  };
}

const signIn = (extra = {}) => ({
  event: 'admin.sign-in',
  actorType: 'admin',
  actorId: 1,
  targetType: 'admin',
  targetId: 1,
  ip: '203.0.113.42',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/133.0',
  deviceId: '7b0f8c2e-0000-4000-8000-000000000001',
  meta: { provider: 'local' },
  ...extra,
});

test('a flush with an empty queue does not block later flushes', async () => {
  const { service, rows } = setup();
  await service.flush();
  await service.flush();
  service.record(signIn());
  await service.flush();
  assert.equal(rows.length, 1);
  service.record(signIn());
  await service.flush();
  assert.equal(rows.length, 2);
});

test('stored rows: IP, user agent, hashed device in meta, no raw device id', async () => {
  const { service, rows } = setup();
  service.record(signIn());
  await service.flush();
  const [row] = rows;
  assert.equal(row.event, 'admin.sign-in');
  assert.equal(row.ip, '203.0.113.42');
  assert.equal(row.actorId, '1');
  assert.equal(row.targetId, '1');
  assert.match(row.meta.deviceHash, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(row).includes('7b0f8c2e'));
  assert.ok(row.createdAt instanceof Date);
});

test('anonymise and IP-off apply to every event family', async () => {
  const { service, rows } = setup({ securityLogAnonymizeIp: true });
  service.record(signIn());
  service.record({ event: 'user.sign-in.failed', actorType: 'user', ip: '2001:db8:1:2::9' });
  await service.flush();
  assert.deepEqual(
    rows.map((row) => [row.ip, row.meta?.ipAnonymized]),
    [
      ['203.0.113.0', true],
      ['2001:db8:1::', true],
    ]
  );
  const off = setup({ securityLogStoreIp: false });
  off.service.record(signIn());
  await off.service.flush();
  assert.equal(off.rows[0].ip, null);
  assert.equal(off.rows[0].geo, null);
});

test('switches off: nothing of that family is stored', async () => {
  const { service, rows } = setup({ adminSignInHistory: false, adminContentActivity: false });
  service.record(signIn());
  service.recordContentAction({
    adminUserId: 1,
    action: 'create',
    kind: 'collection',
    contentType: 'api::article.article',
    documentId: 'abc',
    locale: null,
    count: null,
  });
  await service.flush();
  assert.equal(rows.length, 0);
});

test('opening an entry again within 10 minutes, or after writing it, is one view', async () => {
  const { service, rows } = setup({ adminContentActivity: true });
  const action = (actionName, adminUserId = 1, locale = null) =>
    service.recordContentAction({
      adminUserId,
      action: actionName,
      kind: 'collection',
      contentType: 'api::article.article',
      documentId: 'abc',
      locale,
      count: null,
    });
  assert.equal(action('create'), true);
  assert.equal(action('view'), false, 'view right after create');
  assert.equal(action('view', 2), true, 'another admin');
  assert.equal(action('view', 2), false, 'same admin again');
  assert.equal(action('view', 2, 'de'), true, 'another locale');
  assert.equal(action('update'), true, 'writes are never deduplicated');
  assert.equal(action('update'), true);
  await service.flush();
  assert.deepEqual(
    rows.map((row) => row.event),
    [
      'admin.content.create',
      'admin.content.view',
      'admin.content.view',
      'admin.content.update',
      'admin.content.update',
    ]
  );
  assert.equal(rows[1].targetType, 'api::article.article');
});

test('unknown event names and actor types are ignored', () => {
  const { service } = setup();
  assert.equal(service.record({ event: 'DROP TABLE', actorType: 'admin' }), false);
  assert.equal(service.record({ event: 'admin.sign-in', actorType: 'root' }), false);
  assert.equal(service.record({ event: 'admin', actorType: 'admin' }), false);
  assert.equal(service.record({ event: 'user.new-device', actorType: 'user' }), true);
});

test('lockouts of one account and address within 5 minutes are one event', () => {
  const { service } = setup();
  const lockout = (ip) =>
    service.record({
      event: 'admin.lockout',
      actorType: 'admin',
      targetType: 'admin',
      attemptedEmail: 'Lena@Example.test',
      ip,
    });
  assert.equal(lockout('203.0.113.5'), true);
  assert.equal(lockout('203.0.113.5'), false);
  assert.equal(lockout('203.0.113.6'), true);
});

test('settings cache: a load that started before a change does not cache old values', async () => {
  const { loader, strapi, setStored } = setup({ adminContentActivity: false });
  let release;
  let reading;
  const gate = new Promise((resolve) => (release = resolve));
  const readStarted = new Promise((resolve) => (reading = resolve));
  const store = strapi.store();
  const slowGet = store.get;
  strapi.store = () => ({
    ...store,
    get: async (...args) => {
      const value = await slowGet(...args);
      reading();
      await gate;
      return value;
    },
  });
  const stale = loader.getPluginSettings(strapi);
  await readStarted;
  setStored({ adminContentActivity: true });
  loader.invalidateSettingsCache();
  release();
  assert.equal((await stale).adminContentActivity, false, 'the old load still answers its caller');
  assert.equal(loader.peekCachedSettings(), null, 'but it is not cached');
  strapi.store = () => store;
  assert.equal((await loader.getPluginSettings(strapi)).adminContentActivity, true);
});

test('a failed sign-in without a user from Strapi (5.50) is linked only to an existing admin', async () => {
  const { service, rows } = setup();
  const failed = (email) =>
    service.record({
      event: 'admin.sign-in.failed',
      actorType: 'admin',
      targetType: 'admin',
      attemptedEmail: email,
      actorFromEmail: true,
      meta: { reason: 'invalid_credentials' },
    });
  failed('Erin.Editor@example.test');
  failed('nobody@example.test');
  await service.flush();
  assert.deepEqual(
    rows.map((row) => [row.actorId, row.targetId]),
    [
      ['5', '5'],
      [null, null],
    ]
  );
  assert.ok(!JSON.stringify(rows).includes('example.test'), 'typed emails are not stored');
});
