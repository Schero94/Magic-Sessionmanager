'use strict';

/**
 * Paginated admin session list, session statistics and export batches.
 *
 * Every query here is bounded: one page (at most 100 rows) or one export
 * batch (at most 1000 rows) is read, counts are SQL COUNT queries, and only
 * the rows on the page are enriched (user-agent parsing, cached geolocation
 * with the existing per-request lookup budget). Session tokens and their
 * hashes are never selected.
 *
 * Docs: Strapi 5 Query Engine (`strapi.db.query`) findMany/count with
 * `where`, `select`, `populate`, `orderBy`, `offset`, `limit`
 * (docs.strapi.io/cms/api/query-engine); knex query builder for the
 * distinct-user count (knexjs.org/guide/query-builder.html#countdistinct).
 */

const { enhanceSessions } = require('./enhance-session');
const { getNativeSessionManager } = require('./native-session-manager');
const {
  canInspectNativeSessions,
  countNativeOnly,
  getNativeTrackingSince,
} = require('./native-only-insight');
const {
  LIST_FIELDS,
  LIST_USER_FIELDS,
  MAX_EXPORT_BATCH,
  SORT_ORDERS,
  buildSessionWhere,
  afterExportCursor,
  encodeExportCursor,
} = require('./session-list-query');

const SESSION_UID = 'plugin::magic-sessionmanager.session';
const NATIVE_SESSION_UID = 'admin::session';
const NATIVE_ORIGIN = 'users-permissions';
const NATIVE_CHECK_CONCURRENCY = 8;

/** How long one process reuses the dashboard and widget statistics. */
const STATS_CACHE_MS = 5000;

/** Per-Strapi-instance cache: statistics keyed by inactivity timeout. */
let statsCache = new WeakMap();

/** Drops cached statistics (tests, and after admin actions). */
function clearSessionStatsCache() {
  statsCache = new WeakMap();
}

/**
 * Cache map of one Strapi instance.
 *
 * @param {object} strapi
 * @returns {Map<string, {value: object, expiresAt: number}>}
 */
function cacheFor(strapi) {
  let map = statsCache.get(strapi);
  if (!map) {
    map = new Map();
    statsCache.set(strapi, map);
  }
  return map;
}

/**
 * Inactivity cutoff used by the status filters, matching `enhanceSession`.
 *
 * @param {number} inactivityTimeout Milliseconds.
 * @param {number} [now]
 * @returns {Date}
 */
function inactivityCutoff(inactivityTimeout, now = Date.now()) {
  return new Date(now - inactivityTimeout);
}

/**
 * Whether Strapi's own session table is available for read-only lookups.
 *
 * @param {object} strapi
 * @returns {boolean}
 */
function hasNativeSessionTable(strapi) {
  return Boolean(strapi?.contentTypes?.[NATIVE_SESSION_UID]);
}

/**
 * Returns the native session IDs (of the given ones) that Strapi still
 * accepts: origin users-permissions, status active, not expired. One query
 * per page; falls back to the public session API when the table is missing.
 *
 * @param {object} strapi
 * @param {object} nativeManager Checked Users & Permissions session facade.
 * @param {string[]} ids Native session IDs on the page.
 * @returns {Promise<Set<string>>}
 */
async function findActiveNativeIds(strapi, nativeManager, ids) {
  const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id))];
  if (unique.length === 0) return new Set();

  if (hasNativeSessionTable(strapi)) {
    const rows = await strapi.db.query(NATIVE_SESSION_UID).findMany({
      select: ['sessionId'],
      where: {
        sessionId: { $in: unique },
        origin: NATIVE_ORIGIN,
        status: 'active',
        expiresAt: { $gt: new Date() },
      },
    });
    return new Set((Array.isArray(rows) ? rows : []).map((row) => String(row.sessionId)));
  }

  const active = new Set();
  let next = 0;
  const worker = async () => {
    while (next < unique.length) {
      const id = unique[next++];
      if (await nativeManager.isSessionActive(id)) active.add(id);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(NATIVE_CHECK_CONCURRENCY, unique.length) }, worker)
  );
  return active;
}

/**
 * Marks rows whose linked native session ended as ended in the returned
 * view (the stored row is not changed).
 *
 * @param {object} strapi
 * @param {object[]} rows Session rows of one page.
 * @returns {Promise<object[]>}
 */
async function reconcileNativeRows(strapi, rows) {
  const nativeManager = getNativeSessionManager(strapi);
  if (!nativeManager) return rows;
  const ids = rows
    .filter((row) => row.isActive && row.nativeSessionId)
    .map((row) => String(row.nativeSessionId));
  if (ids.length === 0) return rows;
  const active = await findActiveNativeIds(strapi, nativeManager, ids);
  return rows.map((row) =>
    row.isActive && row.nativeSessionId && !active.has(String(row.nativeSessionId))
      ? { ...row, isActive: false }
      : row
  );
}

/**
 * Counts native sessions that Strapi still accepts and that have no Magic
 * session row (see `native-only-insight.js`). They are listed per user
 * (user panel), not in the paginated list.
 *
 * @param {object} strapi
 * @returns {Promise<number>}
 */
async function countNativeOnlySessions(strapi) {
  const { total } = await countNativeOnly(strapi);
  return total;
}

/**
 * Untracked native sessions split by creation before or after the plugin
 * started linking them. `afterTracking` is null when no start date is stored.
 *
 * @param {object} strapi
 * @returns {Promise<{total: number, afterTracking: number|null}>}
 */
async function countNativeOnlySplit(strapi) {
  if (!canInspectNativeSessions(strapi)) return { total: 0, afterTracking: null };
  const trackingSince = await getNativeTrackingSince(strapi);
  return countNativeOnly(strapi, { trackingSince });
}

/**
 * Counts distinct users with an active session (one SQL query).
 *
 * @param {object} strapi
 * @param {Date} cutoff Inactivity cutoff.
 * @returns {Promise<number>}
 */
async function countUsersOnline(strapi, cutoff) {
  const meta = strapi.db.metadata.get(SESSION_UID);
  const userAttribute = meta.attributes.user;
  const joinTable = userAttribute?.joinTable;
  const column = (attribute) => meta.attributes[attribute]?.columnName || attribute;
  const knex = strapi.db.connection;
  const table = meta.tableName;

  if (joinTable?.name && joinTable.joinColumn?.name && joinTable.inverseJoinColumn?.name) {
    const link = joinTable.name;
    const lastActive = `${table}.${column('lastActive')}`;
    const loginTime = `${table}.${column('loginTime')}`;
    const result = await knex(table)
      .join(link, `${link}.${joinTable.joinColumn.name}`, `${table}.id`)
      .where(`${table}.${column('isActive')}`, true)
      .andWhere((qb) => {
        qb.where(lastActive, '>', cutoff).orWhere((inner) => {
          inner.whereNull(lastActive).andWhere(loginTime, '>', cutoff);
        });
      })
      .countDistinct({ count: `${link}.${joinTable.inverseJoinColumn.name}` })
      .first();
    return Number(result?.count ?? 0);
  }

  // Foreign-key layout (no link table): read user ids of active rows in pages.
  const seen = new Set();
  const where = buildSessionWhere({ status: 'active' }, { cutoff });
  for (let offset = 0; ; offset += MAX_EXPORT_BATCH) {
    const rows = await strapi.db.query(SESSION_UID).findMany({
      where,
      select: ['id'],
      populate: { user: { select: ['id'] } },
      orderBy: [{ id: 'asc' }],
      offset,
      limit: MAX_EXPORT_BATCH,
    });
    for (const row of rows) if (row.user?.id) seen.add(row.user.id);
    if (rows.length < MAX_EXPORT_BATCH) break;
  }
  return seen.size;
}

/**
 * Reads one page of sessions with exact totals.
 *
 * @param {object} strapi
 * @param {{page: number, pageSize: number, status: string, reason: string, search: string, sort: string}} query Parsed list query.
 * @param {{inactivityTimeout: number, geolocationService?: object|null}} options
 * @returns {Promise<{rows: object[], pagination: {page: number, pageSize: number, total: number, pageCount: number}}>}
 */
async function listSessionPage(strapi, query, options) {
  const cutoff = inactivityCutoff(options.inactivityTimeout);
  const where = buildSessionWhere(query, { cutoff });
  const sessions = strapi.db.query(SESSION_UID);
  const offset = (query.page - 1) * query.pageSize;

  const [total, rows] = await Promise.all([
    sessions.count({ where }),
    sessions.findMany({
      where,
      select: [...LIST_FIELDS],
      populate: { user: { select: [...LIST_USER_FIELDS] } },
      orderBy: SORT_ORDERS[query.sort] || SORT_ORDERS['loginTime:desc'],
      offset,
      limit: query.pageSize,
    }),
  ]);

  const reconciled = await reconcileNativeRows(strapi, Array.isArray(rows) ? rows : []);
  const enhanced = await enhanceSessions(
    reconciled,
    {
      inactivityTimeout: options.inactivityTimeout,
      geolocationService: options.geolocationService || null,
      strapi,
    },
    Math.min(20, query.pageSize)
  );

  const count = Number(total) || 0;
  return {
    rows: enhanced,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total: count,
      pageCount: Math.max(1, Math.ceil(count / query.pageSize)),
    },
  };
}

/**
 * Session statistics for the dashboard cards and the homepage widget, from
 * COUNT queries only. Cached per process for a few seconds so many open
 * admin tabs share one set of queries.
 *
 * @param {object} strapi
 * @param {{inactivityTimeout: number}} options
 * @returns {Promise<object>} Counts only.
 */
async function getSessionStats(strapi, { inactivityTimeout }) {
  const key = String(inactivityTimeout);
  const cache = cacheFor(strapi);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const cutoff = inactivityCutoff(inactivityTimeout);
  const sessions = strapi.db.query(SESSION_UID);
  const count = (filters) => sessions.count({ where: buildSessionWhere(filters, { cutoff }) });

  const [total, open, active, loggedOut, timedOut, usersOnline, nativeOnly] = await Promise.all([
    count({}),
    count({ status: 'open' }),
    count({ status: 'active' }),
    count({ status: 'ended', reason: 'logout' }),
    count({ status: 'ended', reason: 'idle' }),
    countUsersOnline(strapi, cutoff),
    countNativeOnlySplit(strapi),
  ]);

  const ended = Math.max(0, Number(total) - Number(open));
  const value = {
    total: Number(total),
    open: Number(open),
    active: Number(active),
    idle: Math.max(0, Number(open) - Number(active)),
    ended,
    loggedOut: Number(loggedOut),
    timedOut: Number(timedOut),
    otherReasons: Math.max(0, ended - Number(loggedOut) - Number(timedOut)),
    usersOnline: Number(usersOnline),
    nativeOnly: nativeOnly.total,
    nativeOnlyAfterTracking: nativeOnly.afterTracking,
  };
  cache.set(key, { value, expiresAt: Date.now() + STATS_CACHE_MS });
  if (cache.size > 20) cache.delete(cache.keys().next().value);
  return value;
}

/** How long one process reuses the Analytics aggregates. */
const ANALYTICS_CACHE_MS = 30000;

/** Distinct device/browser values returned at most (largest groups first). */
const MAX_GROUPS = 200;

/**
 * Counts sessions per stored value of one column (GROUP BY, largest first).
 *
 * @param {object} strapi
 * @param {string} attribute Session attribute name (whitelisted by callers).
 * @returns {Promise<Array<{value: string|null, count: number}>>}
 */
async function countByColumn(strapi, attribute) {
  const meta = strapi.db.metadata.get(SESSION_UID);
  const column = meta.attributes[attribute]?.columnName || attribute;
  const rows = await strapi.db
    .connection(meta.tableName)
    .select({ value: column })
    .count({ count: '*' })
    .groupBy(column)
    .orderBy('count', 'desc')
    .limit(MAX_GROUPS);
  return rows.map((row) => ({ value: row.value ?? null, count: Number(row.count) || 0 }));
}

/**
 * Average session length in whole minutes, as the Analytics page defined it:
 * login to last activity for open sessions, login to logout (or last
 * activity) for ended ones; rows without an end are left out. PostgreSQL and
 * MySQL compute it in SQL; other databases read the four time columns in
 * keyset batches.
 *
 * @param {object} strapi
 * @param {Date} now
 * @returns {Promise<number>}
 */
async function averageSessionMinutes(strapi, now) {
  const meta = strapi.db.metadata.get(SESSION_UID);
  const col = (attribute) => meta.attributes[attribute]?.columnName || attribute;
  const knex = strapi.db.connection;
  const client = strapi.db.dialect?.client || '';
  const end = `CASE WHEN ?? THEN COALESCE(??, ?) ELSE COALESCE(??, ??) END`;
  const endBindings = [
    col('isActive'),
    col('lastActive'),
    now,
    col('logoutTime'),
    col('lastActive'),
  ];

  if (client === 'postgres') {
    const row = await knex(meta.tableName)
      .select(
        knex.raw(`AVG(GREATEST(0, FLOOR(EXTRACT(EPOCH FROM ((${end}) - ??)) / 60))) AS avg`, [
          ...endBindings,
          col('loginTime'),
        ])
      )
      .first();
    return Math.floor(Number(row?.avg) || 0);
  }
  if (client === 'mysql' || client === 'mysql2') {
    const row = await knex(meta.tableName)
      .select(
        knex.raw(`AVG(GREATEST(0, FLOOR(TIMESTAMPDIFF(SECOND, ??, (${end})) / 60))) AS avg`, [
          col('loginTime'),
          ...endBindings,
        ])
      )
      .first();
    return Math.floor(Number(row?.avg) || 0);
  }

  let sum = 0;
  let count = 0;
  let lastId = 0;
  const nowMs = now.getTime();
  for (;;) {
    const rows = await strapi.db.query(SESSION_UID).findMany({
      select: ['id', 'loginTime', 'lastActive', 'logoutTime', 'isActive'],
      where: { id: { $gt: lastId } },
      orderBy: [{ id: 'asc' }],
      limit: 5000,
    });
    for (const row of rows) {
      const start = Date.parse(row.loginTime);
      if (!Number.isFinite(start)) continue;
      const lastActive = row.lastActive ? Date.parse(row.lastActive) : Number.NaN;
      const logout = row.logoutTime ? Date.parse(row.logoutTime) : Number.NaN;
      let stop;
      if (row.isActive) stop = Number.isFinite(lastActive) ? lastActive : nowMs;
      else stop = Number.isFinite(logout) ? logout : lastActive;
      if (!Number.isFinite(stop)) continue;
      sum += Math.max(0, Math.floor((stop - start) / 60000));
      count += 1;
    }
    if (rows.length < 5000) break;
    lastId = rows[rows.length - 1].id;
  }
  return count > 0 ? Math.floor(sum / count) : 0;
}

/**
 * Counts distinct users that have any session.
 *
 * @param {object} strapi
 * @returns {Promise<number>}
 */
async function countUsersWithSessions(strapi) {
  const meta = strapi.db.metadata.get(SESSION_UID);
  const joinTable = meta.attributes.user?.joinTable;
  if (!joinTable?.name || !joinTable.inverseJoinColumn?.name) return 0;
  const row = await strapi.db
    .connection(joinTable.name)
    .countDistinct({ count: joinTable.inverseJoinColumn.name })
    .first();
  return Number(row?.count ?? 0);
}

/**
 * Aggregates for the Analytics page over every session (no row cap):
 * counts, sign-ins in the last 24 hours and 7 days, sessions per stored
 * device type and browser value, distinct users and the average length.
 * Cached per process for 30 seconds.
 *
 * @param {object} strapi
 * @param {{inactivityTimeout: number}} options
 * @returns {Promise<object>} Counts and grouped counts only.
 */
async function getSessionAnalytics(strapi, { inactivityTimeout }) {
  const key = `analytics:${inactivityTimeout}`;
  const cache = cacheFor(strapi);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const now = new Date();
  const sessions = strapi.db.query(SESSION_UID);
  const since = (ms) => sessions.count({ where: { loginTime: { $gt: new Date(now - ms) } } });
  const [stats, signIns24h, signIns7d, devices, browsers, uniqueUsers, avgSessionDuration] =
    await Promise.all([
      getSessionStats(strapi, { inactivityTimeout }),
      since(24 * 60 * 60 * 1000),
      since(7 * 24 * 60 * 60 * 1000),
      countByColumn(strapi, 'deviceType'),
      countByColumn(strapi, 'browserName'),
      countUsersWithSessions(strapi),
      averageSessionMinutes(strapi, now),
    ]);

  const value = {
    totalSessions: stats.total,
    activeSessions: stats.active,
    idleSessions: stats.idle,
    endedSessions: stats.ended,
    signInsLast24Hours: Number(signIns24h),
    signInsLast7Days: Number(signIns7d),
    devices,
    browsers,
    uniqueUsers,
    avgSessionDuration,
  };
  cache.set(key, { value, expiresAt: Date.now() + ANALYTICS_CACHE_MS });
  return value;
}

/**
 * Reads one export batch, newest first, with a keyset cursor (no OFFSET).
 * Geolocation is not looked up; stored values are exported as they are.
 *
 * @param {object} strapi
 * @param {{limit: number, status: string, reason: string, search: string}} query Parsed export query.
 * @param {{loginTime: Date|null, id: number}|null} cursor Decoded cursor.
 * @param {{inactivityTimeout: number}} options
 * @returns {Promise<{rows: object[], nextCursor: string|null}>}
 */
async function exportSessionBatch(strapi, query, cursor, { inactivityTimeout }) {
  const cutoff = inactivityCutoff(inactivityTimeout);
  const base = buildSessionWhere(query, { cutoff });
  const where = cursor
    ? { $and: [...(base.$and ? base.$and : []), afterExportCursor(cursor)] }
    : base;

  const rows = await strapi.db.query(SESSION_UID).findMany({
    where,
    select: [...LIST_FIELDS],
    populate: { user: { select: [...LIST_USER_FIELDS] } },
    orderBy: SORT_ORDERS['loginTime:desc'],
    limit: query.limit,
  });
  const list = Array.isArray(rows) ? rows : [];
  const reconciled = await reconcileNativeRows(strapi, list);
  const enhanced = await enhanceSessions(
    reconciled,
    { inactivityTimeout, geolocationService: null, strapi },
    0
  );
  const last = list[list.length - 1];
  return {
    rows: enhanced,
    nextCursor: list.length === query.limit && last ? encodeExportCursor(last) : null,
  };
}

module.exports = {
  STATS_CACHE_MS,
  ANALYTICS_CACHE_MS,
  listSessionPage,
  getSessionStats,
  getSessionAnalytics,
  exportSessionBatch,
  countUsersOnline,
  countNativeOnlySessions,
  reconcileNativeRows,
  clearSessionStatsCache,
  inactivityCutoff,
};
