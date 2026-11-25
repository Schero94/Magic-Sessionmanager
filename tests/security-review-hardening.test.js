'use strict';

// 4.17 security review: GeoIP restrictions (F1), proxy warning (F7), the
// Content Manager guard and GraphQL Shadow CRUD (F8), and the one-time
// security log migrations (F3 titles, F5 retention). Unit level with fakes;
// the real Strapi boundary is in tests/isolated-admin-activity-http.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');

const createGeolocationService = require('../server/src/services/geolocation');
const { invalidateSettingsCache } = require('../server/src/utils/settings-loader');
const { isSpecialPurposeIp } = require('../server/src/utils/special-ip-ranges');
const {
  INTERNAL_TYPES,
  contentManagerModelOf,
  createInternalTypeGuard,
  disableGraphqlShadowCrud,
  hasUnboundedProxyTrust,
  migrateSecurityLog,
  warnUnboundedProxyTrust,
} = require('../server/src/utils/security-log-hardening');
const coordination = require('../server/src/utils/coordination');

const silentLog = { debug() {}, error() {}, info() {}, warn() {} };

/**
 * Replaces global fetch with a recorder that fails every call.
 *
 * @param {import('node:test').TestContext} t Test context.
 * @returns {string[]} Hosts that were fetched.
 */
function recordFetch(t) {
  const previous = global.fetch;
  const hosts = [];
  global.fetch = async (input) => {
    hosts.push(new URL(typeof input === 'string' ? input : input.url).hostname);
    throw new Error('network must not be used in this test');
  };
  t.after(() => {
    global.fetch = previous;
  });
  return hosts;
}

test('F1: special-purpose ranges are never looked up (IPv4, IPv6, mapped)', () => {
  for (const ip of [
    '10.1.2.3',
    '100.64.0.1',
    '169.254.169.254',
    '192.0.2.10',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    '::ffff:10.0.0.1',
    '::ffff:a00:1',
    '2001:db8::7',
    '3fff::1',
    '100::1',
    '2001:2::1',
    'fc00::1',
    'fe80::1%eth0',
    'ff02::1',
    '64:ff9b:1::1',
    'not-an-ip',
  ]) {
    assert.equal(isSpecialPurposeIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '2a00:1450:4001::1', '::ffff:8.8.8.8', '64:ff9b::808:808']) {
    assert.equal(isSpecialPurposeIp(ip), false, ip);
  }
});

test('F1: geolocation treats the new special ranges as private, without a network call', async (t) => {
  const hosts = recordFetch(t);
  invalidateSettingsCache();
  const service = createGeolocationService({
    strapi: {
      config: { get: () => ({}) },
      store: () => ({ get: async () => ({ enableGeolocation: true, geoIpProvider: 'ipapi' }) }),
      plugin: () => ({ service: () => ({}) }),
      log: silentLog,
    },
  });
  for (const ip of ['2001:db8:1234::7', '3fff::1', 'ff02::1', '100.64.1.1']) {
    assert.equal(service.isPrivateIp(ip), true, ip);
    assert.equal((await service.getIpInfo(ip))._status, 'private', ip);
  }
  assert.deepEqual(hosts, []);
});

test('F1: the security log lookup never falls back to ipapi.co with the default provider', async (t) => {
  const hosts = recordFetch(t);
  for (const settings of [
    { enableGeolocation: true, geoIpProvider: 'auto' },
    { enableGeolocation: true, geoIpProvider: 'local-mmdb' },
    { enableGeolocation: false, geoIpProvider: 'ipapi' },
    { enableGeolocation: true, geoIpProvider: 'disabled' },
  ]) {
    invalidateSettingsCache();
    const service = createGeolocationService({
      strapi: {
        config: { get: () => ({}) },
        store: () => ({
          get: async () => ({ ...settings, geoIpDatabasePath: 'GeoLite2-City.mmdb' }),
        }),
        plugin: () => ({ service: () => ({}) }),
        log: silentLog,
      },
    });
    assert.equal(await service.getSecurityLogLocation('8.8.8.0'), null, JSON.stringify(settings));
  }
  assert.deepEqual(hosts, [], 'no request to ipapi.co');
});

test('F1: only an explicit ipapi provider sends the (anonymised) address to ipapi.co', async (t) => {
  invalidateSettingsCache();
  const service = createGeolocationService({
    strapi: {
      config: { get: () => ({}) },
      store: () => ({ get: async () => ({ enableGeolocation: true, geoIpProvider: 'ipapi' }) }),
      plugin: () => ({ service: () => ({}) }),
      log: silentLog,
    },
  });
  const asked = [];
  t.mock.method(service, 'getIpapiIpInfo', async (ip) => {
    asked.push(ip);
    return { _status: 'ok', country: 'Synthetic', country_code: 'ZZ', city: 'Example' };
  });
  assert.deepEqual(await service.getSecurityLogLocation('8.8.8.0'), {
    country: 'Synthetic',
    country_code: 'ZZ',
    city: 'Example',
  });
  assert.deepEqual(asked, ['8.8.8.0']);
});

test('F7: warns when Koa trusts proxy headers without a hop limit', () => {
  const config = (values) => ({ config: { get: (key) => values[key] } });
  assert.equal(hasUnboundedProxyTrust(config({ 'server.proxy.koa': true })), true);
  assert.equal(
    hasUnboundedProxyTrust(config({ 'server.proxy.koa': true, 'server.proxy.maxIpsCount': 0 })),
    true
  );
  assert.equal(hasUnboundedProxyTrust(config({ 'server.proxy': true })), true);
  assert.equal(
    hasUnboundedProxyTrust(config({ 'server.proxy.koa': true, 'server.proxy.maxIpsCount': 1 })),
    false
  );
  assert.equal(hasUnboundedProxyTrust(config({})), false);
  const lines = [];
  assert.equal(
    warnUnboundedProxyTrust(config({ 'server.proxy.koa': true }), {
      warn: (line) => lines.push(line),
    }),
    true
  );
  assert.match(lines[0], /maxIpsCount/);
});

test('F8: Content Manager routes of the plugin types answer 404 before routing', async () => {
  const guard = createInternalTypeGuard();
  const run = async (path) => {
    const ctx = { path, status: 200, body: null };
    let reached = false;
    await guard(ctx, async () => {
      reached = true;
    });
    return { reached, status: ctx.status };
  };
  for (const path of [
    '/content-manager/collection-types/plugin::magic-sessionmanager.security-event',
    '/content-manager/collection-types/plugin%3A%3Amagic-sessionmanager.security-event/abc',
    '/content-manager/collection-types/plugin::magic-sessionmanager.session/actions/bulkDelete',
    '/Content-Manager/Collection-Types/plugin::magic-sessionmanager.revoked-token',
    '//content-manager//single-types/plugin::magic-sessionmanager.security-event',
    '/content-manager/relations/plugin::magic-sessionmanager.session/user',
  ]) {
    assert.deepEqual(await run(path), { reached: false, status: 404 }, path);
  }
  for (const path of [
    '/content-manager/collection-types/api::article.article',
    '/content-manager/collection-types/plugin::users-permissions.user',
    '/content-manager/content-types',
    '/magic-sessionmanager/settings',
  ]) {
    assert.deepEqual(await run(path), { reached: true, status: 200 }, path);
  }
  assert.equal(contentManagerModelOf('/content-manager/collection-types/%E0%A4%A'), null);
});

test('F8: GraphQL Shadow CRUD is disabled for every plugin type when GraphQL is installed', () => {
  const disabled = [];
  const strapi = {
    plugin: (name) =>
      name === 'graphql'
        ? {
            service: () => ({
              shadowCRUD: (uid) => ({ disable: () => disabled.push(uid) }),
            }),
          }
        : undefined,
  };
  assert.deepEqual(disableGraphqlShadowCrud(strapi, silentLog), INTERNAL_TYPES);
  assert.deepEqual(disabled, [
    'plugin::magic-sessionmanager.session',
    'plugin::magic-sessionmanager.revoked-token',
    'plugin::magic-sessionmanager.security-event',
  ]);
  assert.deepEqual(disableGraphqlShadowCrud({ plugin: () => undefined }, silentLog), []);
});

test('F3/F5: migrations raise retention below 7 days and strip stored titles, idempotently', async (t) => {
  const original = coordination.getCoordinator;
  coordination.getCoordinator = () => ({
    withLock: async (_name, fn) => fn(),
    getRevision: async () => 0,
    bumpRevision: async () => 1,
  });
  t.after(() => {
    coordination.getCoordinator = original;
  });
  invalidateSettingsCache();
  const store = {
    settings: { securityLogRetentionDays: 3, inactivityTimeout: 20 },
    migrations: null,
  };
  const rows = [
    { id: 1, event: 'admin.content.view', meta: { kind: 'collection', title: 'Old title' } },
    { id: 2, event: 'admin.content.delete', meta: JSON.stringify({ title: 'Gone', locale: 'de' }) },
    { id: 3, event: 'admin.sign-in', meta: { title: 'not a CM row' } },
    { id: 4, event: 'admin.content.update', meta: { kind: 'single' } },
  ];
  const updates = [];
  const lines = [];
  const strapi = {
    config: { get: () => undefined },
    log: silentLog,
    store: () => ({
      get: async ({ key }) => store[key],
      set: async ({ key, value }) => {
        store[key] = value;
      },
    }),
    db: {
      query: (uid) => ({
        findMany: async ({ where, limit }) => {
          if (uid === 'strapi::core-store') return [];
          return rows
            .filter((row) => row.id > where.id.$gt && row.event.startsWith('admin.content.'))
            .slice(0, limit);
        },
        update: async ({ where, data }) => {
          updates.push(where.id);
          Object.assign(
            rows.find((row) => row.id === where.id),
            data
          );
        },
      }),
    },
  };
  const log = { info: (line) => lines.push(line), warn() {} };
  const first = await migrateSecurityLog(strapi, log);
  assert.deepEqual(first, { retentionRaisedFrom: 3, titlesRemoved: 2, titlesDone: true });
  assert.equal(store.settings.securityLogRetentionDays, 7);
  assert.equal(store.settings.inactivityTimeout, 20, 'other settings are kept');
  assert.deepEqual(rows[0].meta, { kind: 'collection' });
  assert.deepEqual(rows[1].meta, { locale: 'de' });
  assert.deepEqual(rows[2].meta, { title: 'not a CM row' }, 'only Content Manager rows');
  assert.equal(store.migrations.securityEventTitlesRemoved, true);
  assert.ok(lines.some((line) => /raised from 3 to 7 days/.test(line)));

  const again = await migrateSecurityLog(strapi, log);
  assert.deepEqual(again, { retentionRaisedFrom: null, titlesRemoved: 0, titlesDone: true });
  assert.deepEqual(updates, [1, 2], 'a second run changes nothing');
});

test('item 6: history reads with an admin API token are audited; browser reads are not', async () => {
  const createController = require('../server/src/controllers/admin-activity');
  const reads = [];
  const viewers = [];
  const strapi = {
    log: silentLog,
    plugin: () => ({
      service: () => ({
        recordTokenRead: (input) => reads.push(input),
        listSignIns: async (_query, viewer) => {
          viewers.push(viewer);
          return { data: [], meta: {} };
        },
        exportBatch: async () => ({ data: [], meta: { nextCursor: null } }),
      }),
    }),
  };
  const controller = createController({ strapi });
  const ctxFor = (strategy, can = () => false) => ({
    query: {},
    state: {
      user: { id: 3 },
      userAbility: { can },
      auth: { strategy: { name: strategy }, credentials: { id: 12 } },
    },
  });
  await controller.listSignIns(ctxFor('admin'));
  assert.equal(reads.length, 0);
  await controller.listSignIns(ctxFor('admin-token', (action) => action === 'admin::users.read'));
  await controller.exportSignIns(ctxFor('admin-token'));
  assert.deepEqual(reads, [
    { adminId: 3, tokenId: 12, list: 'sign-ins', exported: false },
    { adminId: 3, tokenId: 12, list: 'sign-ins', exported: true },
  ]);
  assert.deepEqual(
    viewers.map((viewer) => viewer.canReadAdmins),
    [false, true]
  );
});
