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
  const warnings = [];
  let nextId = 1;
  const coordinatorRevision = { value: 0 };
  const strapi = {
    config: { get: () => ({}) },
    log: { warn: (...args) => warnings.push(args.join(' ')), info() {}, debug() {}, error() {} },
    store: () => ({ get: async () => current, set: async ({ value }) => (current = value) }),
    db: {
      query: (uid) => ({
        createMany: async ({ data }) => {
          for (const row of data) rows.push({ id: nextId++, ...row });
          return { count: data.length };
        },
        create: async ({ data }) => {
          const row = { id: nextId++, ...data };
          rows.push(row);
          return row;
        },
        findOne: async ({ where }) => rows.find((row) => row.id === where?.id) || null,
        update: async ({ where, data }) => {
          const row = rows.find((candidate) => candidate.id === where?.id);
          if (row) Object.assign(row, data);
          return row;
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
    warnings,
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

// ------------------------------------------------------------ 4.17 security review

const unknownFailure = (ip = '198.51.100.23', extra = {}) => ({
  event: 'admin.sign-in.failed',
  actorType: 'admin',
  actorId: null,
  targetType: 'admin',
  targetId: null,
  ip,
  userAgent: `Mozilla/5.0 ${'x'.repeat(480)}`,
  meta: { reason: 'invalid_credentials', provider: 'local' },
  ...extra,
});

test('F2: a flood of unknown accounts from one address is one row with a count', async () => {
  const { service, rows } = setup();
  for (let i = 0; i < 300; i += 1) assert.equal(service.record(unknownFailure()), true);
  // A genuine sign-in during the flood is still stored.
  service.record(signIn());
  // Another /24 is its own row.
  service.record(unknownFailure('192.0.2.200'));
  await service.flush();
  const failed = rows.filter((row) => row.event === 'admin.sign-in.failed');
  assert.equal(failed.length, 2);
  const flood = failed.find((row) => row.ip === '198.51.100.0');
  assert.equal(flood.meta.count, 300);
  assert.equal(flood.meta.aggregated, true);
  assert.equal(flood.meta.ipAnonymized, true, 'the aggregate keeps only the /24');
  assert.equal(flood.userAgent.length, 256, 'user agent cut to 256 characters');
  assert.equal(rows.filter((row) => row.event === 'admin.sign-in').length, 1);
  // A later flush in the same 5 minutes raises the count of the same row.
  for (let i = 0; i < 5; i += 1) service.record(unknownFailure('198.51.100.99'));
  await service.flush();
  assert.equal(rows.filter((row) => row.event === 'admin.sign-in.failed').length, 2);
  assert.equal(flood.meta.count, 305);
});

test('F2: failed rows per address are capped; further attempts are counted', async () => {
  const { service, rows } = setup();
  for (let i = 0; i < 40; i += 1) {
    service.record(unknownFailure('203.0.113.77', { actorId: 5, targetId: 5 }));
  }
  await service.flush();
  const failed = rows.filter((row) => row.event === 'admin.sign-in.failed');
  const linked = failed.filter((row) => row.targetId === '5');
  const counted = failed.filter((row) => row.meta?.aggregated === true);
  assert.equal(linked.length, 30);
  assert.equal(counted.length, 1);
  assert.equal(counted[0].meta.count, 10);
  assert.equal(counted[0].meta.reason, 'over_limit');
});

test('item 2: a full queue drops failed sign-ins first and logs the drops per family', async () => {
  const { service, rows, warnings } = setup({ adminContentActivity: true });
  service.record(signIn());
  for (let i = 0; i < 2100; i += 1) {
    service.record(unknownFailure('203.0.113.9', { actorId: 5, targetId: 5 }));
  }
  service.record(signIn({ deviceId: 'second-browser' }));
  await service.flush();
  assert.equal(rows.filter((row) => row.event === 'admin.sign-in').length, 2);
  assert.ok(warnings.some((line) => /Queue full, events dropped: failed=10[0-9]/.test(line)));
});

test('F1: no location lookup by default; opt-in looks up the anonymised address only', async () => {
  for (const [stored, expected] of [
    [{ enableGeolocation: true }, []],
    [{ enableGeolocation: true, securityLogGeoLookup: true }, ['203.0.113.0']],
    [{ enableGeolocation: true, securityLogGeoLookup: true, securityLogStoreIp: false }, []],
  ]) {
    const { service, rows, strapi } = setup(stored);
    const lookups = [];
    strapi.plugin = () => ({
      service: (name) =>
        name === 'geolocation'
          ? {
              getSecurityLogLocation: async (ip) => {
                lookups.push(ip);
                return { country: 'Synthetic', country_code: 'ZZ', city: null };
              },
              getIpInfo: async () => assert.fail('getIpInfo must not be used for the log'),
            }
          : null,
    });
    service.record(signIn());
    await service.flush();
    assert.deepEqual(lookups, expected, JSON.stringify(stored));
    assert.equal(rows[0].ip, stored.securityLogStoreIp === false ? null : '203.0.113.42');
  }
});

test('F7: the anonymised TCP peer is stored when it differs from the client IP', async () => {
  const { service, rows } = setup();
  service.record(signIn({ ip: '198.51.100.7', socketIp: '10.0.0.5' }));
  service.record(signIn({ ip: '198.51.100.8', socketIp: '198.51.100.8' }));
  await service.flush();
  assert.equal(rows[0].meta.socketIp, '10.0.0.0');
  assert.equal(rows[1].meta.socketIp, undefined);
});

test('F3/item 3: no entry content is queued or stored; titles are not read without a reader', async () => {
  const { service, rows } = setup({ adminContentActivity: true });
  service.recordContentAction({
    adminUserId: 1,
    action: 'update',
    kind: 'collection',
    contentType: 'api::article.article',
    documentId: 'abc',
    locale: null,
    count: null,
    data: { title: 'SYNTHETIC-CONFIDENTIAL' },
  });
  await service.flush();
  assert.equal(rows.length, 1);
  assert.ok(!JSON.stringify(rows).includes('SYNTHETIC-CONFIDENTIAL'));
  assert.equal(rows[0].meta.title, undefined);
});

test('F5: retention that deleted rows records security-log.retention.purged with the count', async () => {
  const { service, rows, strapi } = setup({ securityLogRetentionDays: 30 });
  const base = strapi.db.query;
  let deleteCalls = 0;
  strapi.db.query = (uid) => ({
    ...base(uid),
    findMany: async ({ where } = {}) => {
      if (uid === 'admin::user') return [{ id: 1 }];
      if (where?.createdAt?.$lt) return deleteCalls++ === 0 ? [{ id: 91 }, { id: 92 }] : [];
      return [];
    },
    deleteMany: async ({ where }) => ({ count: where?.id?.$in ? where.id.$in.length : 1 }),
    updateMany: async () => ({ count: 0 }),
  });
  const removed = await service.cleanup();
  assert.deepEqual(removed, { expired: 2, orphans: 1 });
  strapi.db.query = base;
  await service.flush();
  const purged = rows.find((row) => row.event === 'security-log.retention.purged');
  assert.ok(purged);
  assert.equal(purged.actorType, 'system');
  assert.deepEqual(
    [purged.meta.count, purged.meta.expired, purged.meta.orphans, purged.meta.retentionDays],
    [3, 2, 1, 30]
  );
});

test('item 6: reads by an admin API token are recorded once per token and list per 5 minutes', async () => {
  const { service, rows } = setup();
  const read = (list, exported = false, tokenId = 4) =>
    service.recordTokenRead({ adminId: 1, tokenId, list, exported });
  assert.equal(read('sign-ins'), true);
  assert.equal(read('sign-ins'), false);
  assert.equal(read('sign-ins', true), true);
  assert.equal(read('content'), true);
  assert.equal(read('sign-ins', false, 8), true);
  await service.flush();
  const reads = rows.filter((row) => row.event === 'security-log.read');
  assert.equal(reads.length, 4);
  assert.deepEqual(reads[0].meta, {
    list: 'sign-ins',
    exported: false,
    via: 'admin-token',
    tokenId: '4',
  });
  assert.equal(reads[0].actorId, '1');
});
