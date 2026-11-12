'use strict';

// Untracked native session aggregates and bulk end, against a real SQLite
// database (knex + better-sqlite3) with the column layout Strapi 5.61 uses
// for `admin::session` and the Magic session table. Synthetic rows only.
const assert = require('node:assert/strict');
const test = require('node:test');
const knexFactory = require('knex');

const {
  countNativeOnly,
  deviceClassOf,
  endNativeOnlySessions,
  getNativeOnlySummary,
  END_MIN_AGE_MS,
} = require('../server/src/utils/native-only-insight');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(Date.UTC(2026, 10, 12, 12, 0, 0));

const nativeMeta = {
  tableName: 'strapi_sessions',
  attributes: {
    id: { columnName: 'id' },
    sessionId: { columnName: 'session_id' },
    userId: { columnName: 'user_id' },
    origin: { columnName: 'origin' },
    status: { columnName: 'status' },
    expiresAt: { columnName: 'expires_at' },
    absoluteExpiresAt: { columnName: 'absolute_expires_at' },
    createdAt: { columnName: 'created_at' },
    metadata: { columnName: 'metadata' },
    deviceId: { columnName: 'device_id' },
  },
};
const sidecarMeta = {
  tableName: 'magic_sessions',
  attributes: { nativeSessionId: { columnName: 'native_session_id' } },
};

async function createHost(t, { trackingSince = null, mode = 'refresh' } = {}) {
  const knex = knexFactory({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  t.after(() => knex.destroy());
  await knex.schema.createTable('strapi_sessions', (table) => {
    table.increments('id');
    table.string('session_id').unique();
    table.string('user_id');
    table.string('origin');
    table.string('status');
    table.datetime('expires_at');
    table.datetime('absolute_expires_at');
    table.datetime('created_at');
    table.json('metadata');
    table.string('device_id');
  });
  await knex.schema.createTable('magic_sessions', (table) => {
    table.increments('id');
    table.string('native_session_id');
  });

  const store = trackingSince ? { since: trackingSince.toISOString() } : null;
  const strapi = {
    config: {
      get: (key, fallback) => (key === 'plugin::users-permissions.jwtManagement' ? mode : fallback),
    },
    contentTypes: { 'admin::session': {} },
    db: {
      connection: knex,
      metadata: {
        get: (uid) => ({ 'admin::session': nativeMeta })[uid] || sidecarMeta,
      },
    },
    store: () => ({ get: async () => store }),
  };

  let counter = 0;
  const insert = async ({
    origin = 'users-permissions',
    status = 'active',
    createdAgo = 1 * DAY,
    expiresIn = 10 * DAY,
    absoluteIn = 25 * DAY,
    metadata = { deviceName: 'Chrome on macOS', loginAt: 'synthetic' },
    deviceId = null,
    linked = false,
  } = {}) => {
    counter += 1;
    const sessionId = `synthetic-${counter}`;
    await knex('strapi_sessions').insert({
      session_id: sessionId,
      user_id: String(counter),
      origin,
      status,
      created_at: new Date(NOW.getTime() - createdAgo),
      expires_at: new Date(NOW.getTime() + expiresIn),
      absolute_expires_at: absoluteIn === null ? null : new Date(NOW.getTime() + absoluteIn),
      metadata: metadata ? JSON.stringify(metadata) : null,
      device_id: deviceId,
    });
    if (linked) await knex('magic_sessions').insert({ native_session_id: sessionId });
    return sessionId;
  };
  return { strapi, knex, insert };
}

test('counts only active, unexpired, unlinked Users & Permissions sessions', async (t) => {
  const { strapi, insert } = await createHost(t);
  await insert();
  await insert({ absoluteIn: null });
  await insert({ linked: true });
  await insert({ origin: 'admin' });
  await insert({ status: 'rotated' });
  await insert({ expiresIn: -1000 });
  await insert({ absoluteIn: -1000 });

  const { total, afterTracking } = await countNativeOnly(strapi, { now: NOW });
  assert.equal(
    total,
    2,
    'past absolute expiry, linked, admin, rotated and expired rows are left out'
  );
  assert.equal(afterTracking, null);
});

test('legacy mode reports nothing', async (t) => {
  const { strapi, insert } = await createHost(t, { mode: 'legacy-support' });
  await insert();
  assert.deepEqual(await countNativeOnly(strapi, { now: NOW }), { total: 0, afterTracking: null });
  const summary = await getNativeOnlySummary(strapi, { now: NOW });
  assert.equal(summary.available, false);
  assert.equal(summary.total, 0);
});

test('summary splits by tracking start, month, source, device and expiry - counts only', async (t) => {
  const trackingSince = new Date(NOW.getTime() - 5 * DAY);
  const { strapi, insert } = await createHost(t, { trackingSince });
  // Before tracking: two legacy sign-ins (October) expiring soon.
  await insert({ createdAgo: 20 * DAY, expiresIn: 3 * DAY });
  await insert({
    createdAgo: 18 * DAY,
    expiresIn: 20 * DAY,
    absoluteIn: 6 * DAY,
    metadata: { deviceName: 'Safari on iOS' },
  });
  // After tracking: a password change and a token-only row (November).
  await insert({ createdAgo: 2 * DAY, metadata: null, deviceId: 'synthetic-device' });
  await insert({ createdAgo: 1 * DAY, metadata: null, deviceId: null, expiresIn: 14 * DAY });
  // Not counted at all.
  await insert({ linked: true, createdAgo: 1 * DAY });
  await insert({ origin: 'admin', createdAgo: 1 * DAY });

  const summary = await getNativeOnlySummary(strapi, { now: NOW });
  assert.equal(summary.available, true);
  assert.equal(summary.total, 4);
  assert.equal(summary.trackingSince, trackingSince.toISOString());
  assert.equal(summary.beforeTracking, 2);
  assert.equal(summary.afterTracking, 2);
  assert.deepEqual(summary.byMonth, [
    { month: '2026-10', count: 2 },
    { month: '2026-11', count: 2 },
  ]);
  assert.equal(summary.earlier, 0);
  assert.deepEqual(summary.bySource, { signIn: 2, passwordChange: 1, tokenOnly: 1 });
  assert.deepEqual(summary.byDevice, { desktop: 1, mobile: 1, unknown: 2 });
  assert.deepEqual(summary.deviceSample, { scanned: 4, limit: 2000, complete: true });
  assert.deepEqual(summary.expiring, { within7Days: 2, within30Days: 4 });

  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /synthetic-\d|session_id|user_id|Chrome|Safari/);
});

test('summary without a tracking start counts every row as before tracking', async (t) => {
  const { strapi, insert } = await createHost(t);
  await insert({ createdAgo: 400 * DAY, expiresIn: 1 * DAY, absoluteIn: null });
  const summary = await getNativeOnlySummary(strapi, { now: NOW });
  assert.equal(summary.trackingSince, null);
  assert.equal(summary.beforeTracking, 1);
  assert.equal(summary.afterTracking, 0);
  assert.equal(summary.earlier, 1, 'older than twelve months is grouped as earlier');
  assert.deepEqual(summary.byMonth, []);
});

test('ending untracked sessions never touches admin, linked or brand-new sessions', async (t) => {
  const { strapi, knex, insert } = await createHost(t);
  const untracked = [];
  for (let index = 0; index < 5; index += 1) untracked.push(await insert({ createdAgo: DAY }));
  const admin = await insert({ origin: 'admin', createdAgo: DAY });
  const linked = await insert({ linked: true, createdAgo: DAY });
  const young = await insert({ createdAgo: END_MIN_AGE_MS / 2 });
  const rotated = await insert({ status: 'rotated', createdAgo: DAY });

  const result = await endNativeOnlySessions(strapi, { now: NOW, maxRows: 3 });
  assert.equal(result.ended, 3, 'bounded by maxRows');
  assert.equal(result.remaining, 3, 'two old untracked rows and the young one remain');

  const second = await endNativeOnlySessions(strapi, { now: NOW });
  assert.equal(second.ended, 2);
  assert.equal(second.remaining, 1, 'the session created two minutes ago or less is kept');

  const left = (await knex('strapi_sessions').select('session_id')).map((row) => row.session_id);
  for (const id of untracked) assert.ok(!left.includes(id), 'untracked row deleted');
  for (const id of [admin, linked, young, rotated]) assert.ok(left.includes(id), `${id} kept`);
});

test('device class reads only the operating system in Strapi’s device label', () => {
  assert.equal(deviceClassOf({ deviceName: 'Chrome on Android' }), 'mobile');
  assert.equal(deviceClassOf(JSON.stringify({ deviceName: 'Firefox on Windows' })), 'desktop');
  assert.equal(deviceClassOf({ deviceName: 'Chrome' }), 'unknown');
  assert.equal(deviceClassOf(null), 'unknown');
  assert.equal(deviceClassOf('not json'), 'unknown');
  assert.equal(deviceClassOf('x'.repeat(5000)), 'unknown');
});
