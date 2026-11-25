'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EVENT_NAME_PATTERN,
  SECURITY_EVENTS,
  boundMeta,
  deriveSessionStates,
  describeContentManagerRequest,
  dropRankOf,
  handlerName,
  pickEntryTitle,
  recordingSwitchOf,
  safeReason,
} = require('../server/src/utils/security-log-model');
const {
  anonymizeIp,
  getRequestIp,
  hashDeviceId,
  normalizeIp,
} = require('../server/src/utils/admin-request-info');
const {
  legacyRetentionBelowMinimum,
  resolveSecurityLogSettings,
  validateSecurityLogSettings,
} = require('../server/src/utils/security-log-settings');

const CM = { info: { pluginName: 'content-manager' } };
const route = (handler) => ({ ...CM, handler });

test('client IP comes only from ctx.request.ip and is normalised', () => {
  assert.equal(getRequestIp({ request: { ip: '::ffff:203.0.113.9' } }), '203.0.113.9');
  assert.equal(getRequestIp({ request: { ip: '2001:DB8::1' } }), '2001:db8::1');
  // A spoofed header is never read; Koa decides (server.proxy).
  assert.equal(
    getRequestIp({
      request: { ip: '127.0.0.1', headers: { 'x-forwarded-for': '198.51.100.1' } },
    }),
    '127.0.0.1'
  );
  assert.equal(getRequestIp({ request: { ip: 'not-an-ip' } }), null);
  assert.equal(normalizeIp('[2001:db8::2]'), '2001:db8::2');
  assert.equal(normalizeIp('203.0.113.4:8080'), '203.0.113.4');
  assert.equal(normalizeIp('fe80::1%en0'), 'fe80::1');
});

test('anonymise removes the last IPv4 octet and all but 48 IPv6 bits', () => {
  assert.equal(anonymizeIp('203.0.113.42'), '203.0.113.0');
  assert.equal(anonymizeIp('2001:db8:abcd:12::1'), '2001:db8:abcd::');
  assert.equal(anonymizeIp('2001:db8::7'), '2001:db8:0::');
  assert.equal(anonymizeIp('::1'), '0:0:0::');
  assert.equal(anonymizeIp(null), null);
});

test('device ids are hashed, bounded and never returned as-is', () => {
  const hash = hashDeviceId('3b1f5d8e-0000-4000-8000-000000000001');
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hashDeviceId('x'.repeat(201)), null);
  assert.equal(hashDeviceId(42), null);
});

test('meta is bounded: scalar values, simple keys, at most 16 keys and 2 KB', () => {
  assert.equal(boundMeta(null), null);
  assert.deepEqual(boundMeta({ a: 1, 'bad key': 2, nested: { x: 1 }, list: [1], ok: true }), {
    a: 1,
    ok: true,
  });
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
  assert.equal(Object.keys(boundMeta(many)).length, 16);
  const big = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`k${i}`, 'x'.repeat(500)]));
  const bounded = boundMeta(big);
  assert.ok(JSON.stringify(bounded).length <= 2048);
  assert.ok(Object.values(bounded).every((value) => value.length <= 255));
});

test('each event family has its recording switch; later families record by default', () => {
  assert.equal(recordingSwitchOf(SECURITY_EVENTS.ADMIN_SIGN_IN), 'signIns');
  assert.equal(recordingSwitchOf(SECURITY_EVENTS.ADMIN_SESSION_REVOKED), 'signIns');
  assert.equal(recordingSwitchOf(SECURITY_EVENTS.ADMIN_LOCKOUT), 'signIns');
  assert.equal(recordingSwitchOf('admin.content.publish'), 'content');
  assert.equal(recordingSwitchOf('user.sign-in.failed'), 'always');
});

test('settings: privacy defaults, stored false wins, invalid values are reported', () => {
  assert.deepEqual(resolveSecurityLogSettings({}), {
    signIns: true,
    content: false,
    storeIp: true,
    anonymizeIp: false,
    geoLookup: false,
    retentionDays: 90,
  });
  assert.equal(resolveSecurityLogSettings({ adminSignInHistory: false }).signIns, false);
  assert.equal(resolveSecurityLogSettings({ securityLogRetentionDays: 9999 }).retentionDays, 90);
  const { values, errors } = validateSecurityLogSettings({
    adminContentActivity: true,
    securityLogStoreIp: 'no',
    securityLogRetentionDays: '30',
  });
  assert.deepEqual(values, { adminContentActivity: true, securityLogRetentionDays: 30 });
  assert.deepEqual(
    errors.map((error) => error.path[0]),
    ['securityLogStoreIp']
  );
  assert.equal(validateSecurityLogSettings({ securityLogRetentionDays: 731 }).errors.length, 1);
  assert.equal(validateSecurityLogSettings({ securityLogRetentionDays: 0 }).errors.length, 1);
});

test('F1: the location lookup of security events is opt-in', () => {
  assert.equal(resolveSecurityLogSettings({}).geoLookup, false);
  assert.equal(resolveSecurityLogSettings({ securityLogGeoLookup: true }).geoLookup, true);
  assert.deepEqual(validateSecurityLogSettings({ securityLogGeoLookup: 'yes' }).errors[0].path, [
    'securityLogGeoLookup',
  ]);
});

test('F5: retention is at least 7 days; stored 1-6 read as 7, new values below 7 are rejected', () => {
  for (const days of [1, 6]) {
    assert.equal(resolveSecurityLogSettings({ securityLogRetentionDays: days }).retentionDays, 7);
    assert.equal(legacyRetentionBelowMinimum({ securityLogRetentionDays: days }), days);
    assert.equal(validateSecurityLogSettings({ securityLogRetentionDays: days }).errors.length, 1);
  }
  assert.equal(legacyRetentionBelowMinimum({ securityLogRetentionDays: 7 }), null);
  assert.equal(legacyRetentionBelowMinimum({}), null);
  assert.equal(validateSecurityLogSettings({ securityLogRetentionDays: 7 }).errors.length, 0);
});

test('queue drop order: failed sign-ins first, account events last', () => {
  assert.equal(dropRankOf(SECURITY_EVENTS.ADMIN_SIGN_IN_FAILED).rank, 0);
  assert.equal(dropRankOf(SECURITY_EVENTS.ADMIN_LOCKOUT).rank, 0);
  assert.equal(dropRankOf(SECURITY_EVENTS.ADMIN_CONTENT_VIEW).rank, 1);
  assert.equal(dropRankOf(SECURITY_EVENTS.ADMIN_CONTENT_UPDATE).rank, 2);
  for (const event of [
    SECURITY_EVENTS.ADMIN_SIGN_IN,
    SECURITY_EVENTS.ADMIN_SIGN_OUT,
    SECURITY_EVENTS.ADMIN_SESSION_REVOKED,
    SECURITY_EVENTS.SETTINGS_UPDATED,
  ]) {
    assert.equal(dropRankOf(event).rank, 3, event);
  }
  assert.equal(recordingSwitchOf(SECURITY_EVENTS.SETTINGS_UPDATED), 'always');
  assert.equal(recordingSwitchOf(SECURITY_EVENTS.LOG_RETENTION_PURGED), 'always');
  for (const event of [
    SECURITY_EVENTS.SETTINGS_UPDATED,
    SECURITY_EVENTS.LOG_RETENTION_PURGED,
    SECURITY_EVENTS.LOG_READ,
  ]) {
    assert.match(event, EVENT_NAME_PATTERN);
  }
});

test('Content Manager requests: entry actions are activity, lists and failures are not', () => {
  const base = { status: 200, params: { model: 'api::article.article', id: 'abc123' } };
  assert.deepEqual(
    describeContentManagerRequest({
      ...base,
      route: route('collection-types.findOne'),
      query: { locale: 'de' },
      responseBody: { data: { documentId: 'abc123', title: 'Hallo' } },
    }),
    {
      action: 'view',
      kind: 'collection',
      contentType: 'api::article.article',
      documentId: 'abc123',
      locale: 'de',
      count: null,
    },
    'F3/item 3: the entry itself is not passed on'
  );
  assert.equal(
    describeContentManagerRequest({ ...base, route: route('collection-types.find') }),
    null
  );
  assert.equal(
    describeContentManagerRequest({
      ...base,
      route: route('collection-types.countDraftRelations'),
    }),
    null
  );
  assert.equal(
    describeContentManagerRequest({
      ...base,
      status: 404,
      route: route('collection-types.findOne'),
    }),
    null
  );
  assert.equal(
    describeContentManagerRequest({
      ...base,
      route: { info: { pluginName: 'upload' }, handler: 'collection-types.findOne' },
    }),
    null
  );
  assert.equal(
    describeContentManagerRequest({
      ...base,
      params: { model: '../../etc', id: 'x' },
      route: route('collection-types.findOne'),
    }),
    null
  );
  const bulk = describeContentManagerRequest({
    status: 200,
    params: { model: 'api::article.article' },
    route: route('collection-types.bulkDelete'),
    requestBody: { documentIds: ['a', 'b', 'c'] },
    responseBody: { data: { count: 3 } },
  });
  assert.deepEqual(
    [bulk.action, bulk.count, bulk.documentId, bulk.data],
    ['delete', 3, null, undefined]
  );
  const single = describeContentManagerRequest({
    status: 200,
    params: { model: 'api::homepage.homepage' },
    route: route('single-types.createOrUpdate'),
    responseBody: { data: { documentId: 'home1', locale: 'en' } },
  });
  assert.deepEqual(
    [single.action, single.kind, single.documentId, single.locale],
    ['update', 'single', 'home1', 'en']
  );
  assert.equal(
    handlerName('plugin::content-manager.collection-types.create'),
    'collection-types.create'
  );
});

test('entry titles come from the main field only, trimmed and bounded', () => {
  assert.equal(pickEntryTitle({ title: '  Spring   news ' }, 'title'), 'Spring news');
  assert.equal(pickEntryTitle({ order: 7 }, 'order'), '7');
  assert.equal(pickEntryTitle({ title: { nested: true } }, 'title'), null);
  assert.equal(pickEntryTitle({ id: 3 }, 'id'), null);
  assert.equal(pickEntryTitle({ title: 'x'.repeat(400) }, 'title').length, 255);
  assert.equal(safeReason('Robert"); DROP'), null);
  assert.equal(safeReason('account_inactive'), 'account_inactive');
});

test('session state of a sign-in: active, signed out (own or by admin), ended, unknown', () => {
  const t = (minute) => `2026-11-24T10:${String(minute).padStart(2, '0')}:00.000Z`;
  const signIns = [
    { id: 1, adminId: '5', deviceHash: 'a', at: t(0) },
    { id: 2, adminId: '5', deviceHash: 'b', at: t(1) },
    { id: 3, adminId: '5', deviceHash: 'c', at: t(2) },
    { id: 4, adminId: '5', deviceHash: 'd', at: t(3) },
    { id: 5, adminId: '5', deviceHash: null, at: t(4) },
    { id: 6, adminId: '6', deviceHash: 'e', at: t(5) },
  ];
  const later = [
    { adminId: '5', event: 'admin.sign-out', deviceHash: 'a', at: t(10), actorId: '5' },
    { adminId: '5', event: 'admin.sign-in', deviceHash: 'c', at: t(11), actorId: '5' },
    { adminId: '6', event: 'admin.session.revoked', deviceHash: null, at: t(12), actorId: '1' },
  ];
  const live = new Map([['5', new Set(['b', 'c'])]]);
  const states = deriveSessionStates(signIns, later, live);
  assert.deepEqual(states.get(1), { state: 'signed-out', endedAt: t(10), endedBy: null });
  assert.deepEqual(states.get(2), { state: 'active', endedAt: null, endedBy: null });
  assert.equal(states.get(3).state, 'ended', 'the same browser signed in again');
  assert.equal(states.get(4).state, 'ended', 'no live session, no sign-out: expired');
  assert.equal(states.get(5).state, 'unknown');
  assert.deepEqual(states.get(6), { state: 'signed-out', endedAt: t(12), endedBy: '1' });
});
