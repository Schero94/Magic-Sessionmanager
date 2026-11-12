'use strict';

/**
 * Untracked Strapi sessions: Users & Permissions sessions in Strapi's own
 * session table (`admin::session`, origin `users-permissions`) that Strapi
 * still accepts but that have no Magic session row.
 *
 * "Still accepts" mirrors Strapi's `validateRefreshToken` (installed 5.61.0,
 * `@strapi/core/dist/services/session-manager.js`): status `active`, idle
 * expiry `expiresAt` in the future and, when set, the family expiry
 * `absoluteExpiresAt` in the future. These are unexpired refresh tokens, not
 * users who are online.
 *
 * Everything here returns counts only: no session IDs, user IDs, IP
 * addresses or user agents. All queries are bounded: aggregates are one SQL
 * statement each, the device sample reads at most `DEVICE_SAMPLE_LIMIT` JSON
 * values in keyset batches, and the clean-up deletes at most
 * `END_MAX_ROWS` rows per call in batches of `END_BATCH_SIZE`. The SQL uses
 * only `COUNT`, `SUM(CASE ...)`, `IS NULL` and bound date parameters, which
 * behave the same on SQLite, PostgreSQL and MySQL.
 *
 * Docs: Strapi 5 Query Engine (docs.strapi.io/cms/api/query-engine), plugin
 * store (`strapi.store`), knex query builder (knexjs.org/guide/query-builder.html:
 * whereNotExists, whereIn, del, raw bindings with `??` identifiers).
 */

const { getNativeSessionManager } = require('./native-session-manager');
const { withPluginStoreKey, PLUGIN_ID } = require('./plugin-store');

const SESSION_UID = 'plugin::magic-sessionmanager.session';
const NATIVE_SESSION_UID = 'admin::session';
const NATIVE_ORIGIN = 'users-permissions';

/** Plugin store key of the date from which this plugin links native sessions. */
const TRACKING_STORE_KEY = 'nativeTracking';

/** Creation-month buckets returned, the current month included. */
const MONTH_BUCKETS = 12;

/** Most `metadata` values read to group untracked sessions by device. */
const DEVICE_SAMPLE_LIMIT = 2000;
const DEVICE_SAMPLE_BATCH = 500;

/** Rows deleted per statement and per call of `endNativeOnlySessions`. */
const END_BATCH_SIZE = 200;
const END_MAX_ROWS = 5000;

/**
 * Sessions younger than this are never ended in bulk: a login that is being
 * linked right now must not be revoked by a clean-up that started earlier.
 */
const END_MIN_AGE_MS = 2 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether native refresh-mode sessions can be inspected on this host.
 *
 * @param {object} strapi
 * @returns {boolean}
 */
function canInspectNativeSessions(strapi) {
  return Boolean(
    getNativeSessionManager(strapi) &&
    strapi?.contentTypes?.[NATIVE_SESSION_UID] &&
    strapi?.db?.metadata?.get?.(NATIVE_SESSION_UID)
  );
}

/**
 * Table and column names of the native and Magic session tables, read from
 * Strapi's model metadata (never from the request).
 *
 * @param {object} strapi
 * @returns {object}
 */
function tables(strapi) {
  const nativeMeta = strapi.db.metadata.get(NATIVE_SESSION_UID);
  const sessionMeta = strapi.db.metadata.get(SESSION_UID);
  const column = (meta, attribute) => meta.attributes[attribute]?.columnName || attribute;
  return {
    knex: strapi.db.connection,
    native: nativeMeta.tableName,
    sidecar: sessionMeta.tableName,
    linked: column(sessionMeta, 'nativeSessionId'),
    col: {
      id: column(nativeMeta, 'id'),
      sessionId: column(nativeMeta, 'sessionId'),
      origin: column(nativeMeta, 'origin'),
      status: column(nativeMeta, 'status'),
      expiresAt: column(nativeMeta, 'expiresAt'),
      absoluteExpiresAt: column(nativeMeta, 'absoluteExpiresAt'),
      createdAt: column(nativeMeta, 'createdAt'),
      metadata: column(nativeMeta, 'metadata'),
      deviceId: column(nativeMeta, 'deviceId'),
    },
  };
}

/**
 * Query builder for untracked native sessions that Strapi still accepts.
 * The filter on `origin` keeps admin-panel sessions out of every query.
 *
 * @param {ReturnType<typeof tables>} t
 * @param {Date} now
 * @returns {object} knex query builder
 */
function untrackedQuery(t, now) {
  const { knex, native, sidecar, linked, col } = t;
  return knex(native)
    .where(`${native}.${col.origin}`, NATIVE_ORIGIN)
    .andWhere(`${native}.${col.status}`, 'active')
    .andWhere(`${native}.${col.expiresAt}`, '>', now)
    .andWhere((qb) => {
      qb.whereNull(`${native}.${col.absoluteExpiresAt}`).orWhere(
        `${native}.${col.absoluteExpiresAt}`,
        '>',
        now
      );
    })
    .whereNotExists(function linkedSidecar() {
      this.select(knex.raw('1'))
        .from(sidecar)
        .whereRaw('??.?? = ??.??', [sidecar, linked, native, col.sessionId]);
    });
}

/**
 * `SUM(CASE WHEN <condition> THEN 1 ELSE 0 END) AS <alias>` with bound values.
 *
 * @param {object} knex
 * @param {string} condition SQL with `??`/`?` placeholders.
 * @param {unknown[]} bindings
 * @param {string} alias
 * @returns {object} knex raw
 */
function sumWhen(knex, condition, bindings, alias) {
  return knex.raw(`SUM(CASE WHEN ${condition} THEN 1 ELSE 0 END) AS ??`, [...bindings, alias]);
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function toCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

/**
 * Reads the stored tracking start date.
 *
 * @param {object} strapi
 * @returns {Promise<Date|null>}
 */
async function getNativeTrackingSince(strapi) {
  const value = await strapi
    .store({ type: 'plugin', name: PLUGIN_ID })
    .get({ key: TRACKING_STORE_KEY });
  const since = value && typeof value === 'object' ? new Date(value.since) : null;
  return since && Number.isFinite(since.getTime()) ? since : null;
}

/**
 * Stores, once, the date from which this plugin links native sessions: the
 * login time of the oldest Magic session row that is linked to a native
 * session, or now when there is none yet. Later boots keep the stored value.
 * Sessions created before this date are legacy rows from before linking;
 * sessions created after it should all have a Magic session row.
 *
 * @param {object} strapi
 * @param {Date} [now]
 * @returns {Promise<Date>} The stored date.
 * @sideeffect Writes the plugin store key `nativeTracking` when missing.
 */
async function ensureNativeTrackingSince(strapi, now = new Date()) {
  const existing = await getNativeTrackingSince(strapi);
  if (existing) return existing;

  return withPluginStoreKey(strapi, TRACKING_STORE_KEY, async (store) => {
    const again = await store.get({ key: TRACKING_STORE_KEY });
    const stored = again && typeof again === 'object' ? new Date(again.since) : null;
    if (stored && Number.isFinite(stored.getTime())) return stored;

    const oldest = await strapi.db.query(SESSION_UID).findMany({
      where: { nativeSessionId: { $notNull: true } },
      select: ['loginTime'],
      orderBy: [{ loginTime: 'asc' }],
      limit: 1,
    });
    const first = oldest?.[0]?.loginTime ? new Date(oldest[0].loginTime) : null;
    const since =
      first && Number.isFinite(first.getTime()) && first.getTime() < now.getTime() ? first : now;
    await store.set({
      key: TRACKING_STORE_KEY,
      value: { since: since.toISOString(), source: first ? 'first-linked-session' : 'install' },
    });
    return since;
  });
}

/**
 * Number of untracked sessions, and how many of them were created after
 * linking started (null when the start date is unknown).
 *
 * @param {object} strapi
 * @param {{now?: Date, trackingSince?: Date|null}} [options]
 * @returns {Promise<{total: number, afterTracking: number|null}>}
 */
async function countNativeOnly(strapi, { now = new Date(), trackingSince = null } = {}) {
  if (!canInspectNativeSessions(strapi)) return { total: 0, afterTracking: null };
  const t = tables(strapi);
  const selects = [t.knex.raw('COUNT(*) AS ??', ['total'])];
  if (trackingSince) {
    selects.push(
      sumWhen(t.knex, '??.?? >= ?', [t.native, t.col.createdAt, trackingSince], 'afterTracking')
    );
  }
  const row = await untrackedQuery(t, now)
    .select(...selects)
    .first();
  return {
    total: toCount(row?.total),
    afterTracking: trackingSince ? toCount(row?.afterTracking) : null,
  };
}

/**
 * Start of the UTC month `offset` months from the month of `date`.
 *
 * @param {Date} date
 * @param {number} offset
 * @returns {Date}
 */
function monthStart(date, offset) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
}

/**
 * `YYYY-MM` label of a UTC month start.
 *
 * @param {Date} date
 * @returns {string}
 */
function monthLabel(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Device class from Strapi's session label (`metadata.deviceName`, for
 * example "Chrome on macOS", built by `@strapi/utils` `getDeviceName`).
 * Strapi stores no device type; the label's operating system is the only
 * signal, and anything else stays unknown.
 *
 * @param {unknown} metadata Stored `metadata` value (object or JSON string).
 * @returns {'desktop'|'mobile'|'unknown'}
 */
function deviceClassOf(metadata) {
  let value = metadata;
  if (typeof value === 'string') {
    if (value.length > 4096) return 'unknown';
    try {
      value = JSON.parse(value);
    } catch {
      return 'unknown';
    }
  }
  const name = value && typeof value === 'object' ? value.deviceName : null;
  if (typeof name !== 'string' || !name) return 'unknown';
  const label = name.slice(0, 200);
  if (/\b(?:iOS|Android)\b/.test(label)) return 'mobile';
  if (/\b(?:Windows|macOS|Linux|ChromeOS)\b/.test(label)) return 'desktop';
  return 'unknown';
}

/**
 * Groups at most `DEVICE_SAMPLE_LIMIT` untracked sessions by device class,
 * reading only the `metadata` column in id order (keyset batches).
 *
 * @param {ReturnType<typeof tables>} t
 * @param {Date} now
 * @returns {Promise<{desktop: number, mobile: number, unknown: number, scanned: number, complete: boolean}>}
 */
async function sampleDevices(t, now) {
  const counts = { desktop: 0, mobile: 0, unknown: 0 };
  let scanned = 0;
  let lastId = null;
  let complete = false;
  while (scanned < DEVICE_SAMPLE_LIMIT) {
    const limit = Math.min(DEVICE_SAMPLE_BATCH, DEVICE_SAMPLE_LIMIT - scanned);
    const query = untrackedQuery(t, now)
      .select({ id: `${t.native}.${t.col.id}`, metadata: `${t.native}.${t.col.metadata}` })
      .orderBy(`${t.native}.${t.col.id}`, 'asc')
      .limit(limit);
    if (lastId !== null) query.andWhere(`${t.native}.${t.col.id}`, '>', lastId);
    const rows = await query;
    for (const row of rows) counts[deviceClassOf(row.metadata)] += 1;
    scanned += rows.length;
    if (rows.length < limit) {
      complete = true;
      break;
    }
    lastId = rows[rows.length - 1].id;
  }
  return { ...counts, scanned, complete };
}

/**
 * Count-only diagnostic summary of untracked sessions.
 *
 * - `beforeTracking` / `afterTracking`: created before or after this plugin
 *   started linking sessions (`trackingSince`). Rows before are legacy and
 *   expire on their own; rows after point to a sign-in path that is not
 *   linked.
 * - `byMonth`: creation month (UTC), last 12 months, plus `earlier`.
 * - `bySource`: how Strapi created the row. `signIn` rows carry Strapi's
 *   login metadata (local login, register, provider callback);
 *   `passwordChange` rows have a device ID but no metadata (password change
 *   or reset); `tokenOnly` rows have neither (refresh-mode `jwt.issue()`:
 *   GraphQL email confirmation, custom code, other plugins).
 * - `byDevice`: device class from Strapi's device label, over a bounded
 *   sample (`deviceSample.complete` says whether every row was read).
 * - `expiring`: rows whose idle or absolute expiry falls within 7 and 30 days.
 *
 * @param {object} strapi
 * @param {{now?: Date}} [options]
 * @returns {Promise<object>} Counts only.
 */
async function getNativeOnlySummary(strapi, { now = new Date() } = {}) {
  const trackingSince = canInspectNativeSessions(strapi)
    ? await getNativeTrackingSince(strapi)
    : null;
  const empty = {
    available: false,
    total: 0,
    trackingSince: trackingSince ? trackingSince.toISOString() : null,
    beforeTracking: 0,
    afterTracking: 0,
    byMonth: [],
    earlier: 0,
    bySource: { signIn: 0, passwordChange: 0, tokenOnly: 0 },
    byDevice: { desktop: 0, mobile: 0, unknown: 0 },
    deviceSample: { scanned: 0, limit: DEVICE_SAMPLE_LIMIT, complete: true },
    expiring: { within7Days: 0, within30Days: 0 },
    generatedAt: now.toISOString(),
  };
  if (!canInspectNativeSessions(strapi)) return empty;

  const t = tables(strapi);
  const { knex, native, col } = t;
  const created = [native, col.createdAt];
  const in7 = new Date(now.getTime() + 7 * DAY_MS);
  const in30 = new Date(now.getTime() + 30 * DAY_MS);
  const expiringWithin = (until) => [
    '??.?? <= ? OR (??.?? IS NOT NULL AND ??.?? <= ?)',
    [
      native,
      col.expiresAt,
      until,
      native,
      col.absoluteExpiresAt,
      native,
      col.absoluteExpiresAt,
      until,
    ],
  ];

  const months = Array.from({ length: MONTH_BUCKETS }, (_, index) => {
    const start = monthStart(now, index - (MONTH_BUCKETS - 1));
    return { start, end: monthStart(start, 1), label: monthLabel(start) };
  });

  const selects = [
    knex.raw('COUNT(*) AS ??', ['total']),
    sumWhen(knex, '??.?? IS NOT NULL', [native, col.metadata], 'signIn'),
    sumWhen(
      knex,
      '??.?? IS NULL AND ??.?? IS NOT NULL',
      [native, col.metadata, native, col.deviceId],
      'passwordChange'
    ),
    sumWhen(
      knex,
      '??.?? IS NULL AND ??.?? IS NULL',
      [native, col.metadata, native, col.deviceId],
      'tokenOnly'
    ),
    sumWhen(knex, ...expiringWithin(in7), 'within7Days'),
    sumWhen(knex, ...expiringWithin(in30), 'within30Days'),
    sumWhen(knex, '??.?? < ?', [...created, months[0].start], 'earlier'),
    ...months.map((month, index) =>
      sumWhen(
        knex,
        '??.?? >= ? AND ??.?? < ?',
        [...created, month.start, ...created, month.end],
        `m${index}`
      )
    ),
  ];
  if (trackingSince) {
    selects.push(sumWhen(knex, '??.?? >= ?', [...created, trackingSince], 'afterTracking'));
  }

  const row =
    (await untrackedQuery(t, now)
      .select(...selects)
      .first()) || {};
  const total = toCount(row.total);
  const afterTracking = trackingSince ? toCount(row.afterTracking) : 0;
  const devices = total > 0 ? await sampleDevices(t, now) : null;

  return {
    ...empty,
    available: true,
    total,
    beforeTracking: trackingSince ? Math.max(0, total - afterTracking) : total,
    afterTracking,
    byMonth: months
      .map((month, index) => ({ month: month.label, count: toCount(row[`m${index}`]) }))
      .filter((entry) => entry.count > 0),
    earlier: toCount(row.earlier),
    bySource: {
      signIn: toCount(row.signIn),
      passwordChange: toCount(row.passwordChange),
      tokenOnly: toCount(row.tokenOnly),
    },
    byDevice: devices
      ? { desktop: devices.desktop, mobile: devices.mobile, unknown: devices.unknown }
      : empty.byDevice,
    deviceSample: devices
      ? { scanned: devices.scanned, limit: DEVICE_SAMPLE_LIMIT, complete: devices.complete }
      : empty.deviceSample,
    expiring: { within7Days: toCount(row.within7Days), within30Days: toCount(row.within30Days) },
  };
}

/**
 * Ends untracked Users & Permissions sessions: deletes their rows from
 * Strapi's session table, so their refresh tokens stop working at once.
 * Access tokens already issued stay valid until they expire (Strapi's
 * `accessTokenLifespan`, 10 minutes by default), as with Strapi's own
 * session revocation.
 *
 * Bounded: at most `END_MAX_ROWS` rows per call, `END_BATCH_SIZE` per
 * statement, keyset by id. Every DELETE repeats the full filter (origin
 * `users-permissions`, active, unexpired, no Magic session row, older than
 * two minutes), so admin-panel sessions and sessions that were linked in
 * the meantime are never deleted.
 *
 * @param {object} strapi
 * @param {{now?: Date, maxRows?: number}} [options]
 * @returns {Promise<{ended: number, remaining: number}>}
 * @sideeffect Deletes rows from Strapi's `admin::session` table.
 */
async function endNativeOnlySessions(strapi, { now = new Date(), maxRows = END_MAX_ROWS } = {}) {
  if (!canInspectNativeSessions(strapi)) return { ended: 0, remaining: 0 };
  const t = tables(strapi);
  const limit = Math.max(0, Math.min(END_MAX_ROWS, Math.floor(Number(maxRows) || 0)));
  const createdBefore = new Date(now.getTime() - END_MIN_AGE_MS);
  const idColumn = `${t.native}.${t.col.id}`;
  const oldEnough = (query) => query.andWhere(`${t.native}.${t.col.createdAt}`, '<', createdBefore);

  let ended = 0;
  let lastId = null;
  while (ended < limit) {
    const size = Math.min(END_BATCH_SIZE, limit - ended);
    const select = oldEnough(untrackedQuery(t, now))
      .select({ id: idColumn })
      .orderBy(idColumn, 'asc')
      .limit(size);
    if (lastId !== null) select.andWhere(idColumn, '>', lastId);
    const rows = await select;
    if (rows.length === 0) break;
    const ids = rows.map((row) => row.id);
    lastId = ids[ids.length - 1];

    const deleted = await oldEnough(untrackedQuery(t, now)).whereIn(idColumn, ids).del();
    ended += toCount(deleted);
    if (rows.length < size) break;
  }

  const { total } = await countNativeOnly(strapi, { now });
  return { ended, remaining: total };
}

module.exports = {
  TRACKING_STORE_KEY,
  MONTH_BUCKETS,
  DEVICE_SAMPLE_LIMIT,
  END_BATCH_SIZE,
  END_MAX_ROWS,
  END_MIN_AGE_MS,
  canInspectNativeSessions,
  getNativeTrackingSince,
  ensureNativeTrackingSince,
  countNativeOnly,
  deviceClassOf,
  getNativeOnlySummary,
  endNativeOnlySessions,
};
