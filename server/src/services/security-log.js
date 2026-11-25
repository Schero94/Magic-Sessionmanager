'use strict';

// @ts-check

/**
 * Security event log: recording, queries, retention and deletion with the
 * admin account. One table (`plugin::magic-sessionmanager.security-event`)
 * holds every event: admin sign-ins, failed attempts, lockouts, sign-outs,
 * who signed out whom, Content Manager activity, and later app-user events.
 *
 * Recording never runs on the request path. Capture code (see
 * utils/admin-activity-capture.js) calls `record` / `recordContentAction`,
 * which push a plain object onto a bounded in-memory queue and return. A
 * timer flushes the queue about once a second in batches (`createMany`). The
 * flush reads the current settings, so an event whose switch is off is
 * dropped instead of stored, and applies the log-wide IP options (store,
 * anonymise). The location lookup (opt-in since 4.17,
 * `securityLogGeoLookup`) also happens in the flush, with the anonymised
 * address and the local database only unless ipapi.co was chosen explicitly.
 *
 * Floods (4.17, security review F2): failed sign-ins of unknown accounts are
 * counted per anonymised address and 5 minutes into one row (`meta.count`);
 * each address stores at most `MAX_FAILED_ROWS_PER_IP` failed rows per hour,
 * further attempts are counted into that row; when the queue is full, failed
 * sign-ins go first, then Content Manager views, then other activity.
 *
 * Titles (4.17, F3): nothing of an entry is stored or queued. A list resolves
 * the entry titles when it is read, with the reader's own Content Manager
 * permissions (type, conditions and the main field).
 *
 * Storage uses the Query Engine (`strapi.db.query`) like the other
 * plugin-internal tables: no draft/publish, locales or relations.
 */

const {
  ACTOR_TYPES,
  ADMIN_CONTENT_EVENTS,
  CONTENT_ACTIONS,
  EVENT_NAME_PATTERN,
  KEEP_WITHOUT_ACTOR_EVENTS,
  SECURITY_EVENTS,
  SIGN_IN_FILTERS,
  boundMeta,
  contentEvent,
  deriveSessionStates,
  dropRankOf,
  pickEntryTitle,
  recordingSwitchOf,
  safeReason,
  toIso,
  toLocation,
  toObject,
} = require('../utils/security-log-model');
const {
  MAX_USER_AGENT_LENGTH,
  anonymizeIp,
  describeUserAgent,
  hashDeviceId,
  normalizeIp,
} = require('../utils/admin-request-info');
const { resolveSecurityLogSettings } = require('../utils/security-log-settings');
const {
  USER_ACTIVITY_EVENTS,
  userActivityWhere,
  userEventAddress,
  userEventFacts,
} = require('../utils/user-activity-model');
const { getPluginSettings } = require('../utils/settings-loader');
const { shouldResolveGeoData } = require('../utils/enhance-session');
const { createLogger } = require('../utils/logger');

const EVENT_UID = 'plugin::magic-sessionmanager.security-event';
const ADMIN_USER_UID = 'admin::user';
const ADMIN_SESSION_UID = 'admin::session';
const PERMISSION_UID = 'admin::permission';
const USER_UID = 'plugin::users-permissions.user';
const SUPER_ADMIN_CODE = 'strapi-super-admin';

/** Delay between a queued event and its write. */
const FLUSH_DELAY_MS = 1000;
/** Rows per `createMany`. */
const FLUSH_BATCH = 200;
/** Events kept in the queue; see `dropRankOf` for what is dropped first when it is full. */
const MAX_QUEUE = 2000;
/** Failed sign-ins of unknown accounts from one anonymised address within this window are one row. */
const FAILED_WINDOW_MS = 5 * 60 * 1000;
/** Failed-sign-in and lockout rows stored per anonymised address and hour; more are counted. */
const MAX_FAILED_ROWS_PER_IP = 30;
/** Window of the per-address row cap. */
const FAILED_CAP_WINDOW_MS = 60 * 60 * 1000;
/** One `security-log.read` event per admin API token and list within this window. */
const READ_AUDIT_DEDUP_MS = 5 * 60 * 1000;
/** Opening the same entry again within this window is one "view". */
const VIEW_DEDUP_MS = 10 * 60 * 1000;
/** Repeated rejected sign-ins of one account and address within this window are one lockout. */
const LOCKOUT_DEDUP_MS = 5 * 60 * 1000;
/** Bound of the de-duplication maps. */
const MAX_DEDUP_KEYS = 20000;
/** GeoIP lookups per flush. */
const GEO_LOOKUPS_PER_FLUSH = 20;
/** How long a Content Manager main field stays cached. */
const MAIN_FIELD_TTL_MS = 5 * 60 * 1000;
/** Rows per export batch. */
const EXPORT_BATCH = 500;
/** Rows deleted per retention step. */
const DELETE_BATCH = 1000;
/** Retention steps per run (bounded work per day). */
const MAX_DELETE_STEPS = 200;

/**
 * @typedef {object} SecurityEventInput
 * @property {string} event Event name from the registry (`admin.sign-in`, ...).
 * @property {'admin'|'user'|'system'} actorType Who acted.
 * @property {number|string|null} [actorId] Id of the actor, if known.
 * @property {string|null} [targetType] What the event is about (`admin`, a content type uid, ...).
 * @property {number|string|null} [targetId] Id of the target, if known.
 * @property {string|null} [ip] Client IP from `ctx.request.ip`.
 * @property {string|null} [userAgent] User agent.
 * @property {string|null} [deviceId] Browser device id (hashed into `meta.deviceHash`).
 * @property {string|null} [deviceHash] Already hashed device id.
 * @property {Record<string, unknown>|null} [meta] Small facts (bounded before storage).
 * @property {string|null} [attemptedEmail] Typed email of a lockout. Held in memory only, used
 *   once to find an existing admin as the target, never stored or logged.
 * @property {boolean} [actorFromEmail] The admin found by `attemptedEmail` is also the actor.
 * @property {string|null} [socketIp] TCP peer address; stored anonymised when it differs from `ip`.
 * @property {number} [count] Attempts an aggregated failed sign-in stands for (internal).
 * @property {boolean} [aggregate] Counted failed sign-in of an unknown account (internal).
 * @property {Date} [occurredAt] Event time (default now).
 */

/**
 * @typedef {object} Viewer
 * @property {any} [ability] The reader's CASL ability (`ctx.state.userAbility`); Content
 *   Manager titles are resolved with it. Without it, no title is returned.
 * @property {boolean} [canReadAdmins] The reader holds `admin::users.read`; otherwise admin
 *   names are returned empty (the UI shows "Admin #id").
 * @property {boolean} [canSeeImpersonationReason] The reader holds `impersonate.users`; only
 *   then the app-user activity returns the reason an admin gave for an impersonation.
 */

/** Lists whose reads are audited (`security-log.read`, `meta.list`). */
const AUDITED_LISTS = Object.freeze(['sign-ins', 'content', 'user-activity']);

/**
 * @param {unknown} value Candidate id.
 * @returns {string|null} Id as a bounded string, or null.
 */
function toId(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)) return value;
  return null;
}

/**
 * @param {unknown} value Candidate admin id.
 * @returns {number|null} Positive integer id or null.
 */
function toAdminId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id < 1e12 ? id : null;
}

/**
 * Display name of an admin, as in the admin panel list.
 *
 * @param {Record<string, any>|undefined} user Admin user row.
 * @returns {string} Name.
 */
function adminName(user) {
  if (!user) return '';
  const name = [user.firstname, user.lastname]
    .filter((part) => typeof part === 'string' && part.trim())
    .join(' ')
    .trim();
  return (name || user.username || user.email || '').slice(0, 200);
}

/**
 * Keeps a de-duplication map bounded: drops entries older than `windowMs`,
 * then the oldest ones.
 *
 * @param {Map<string, number>} map Key -> last time.
 * @param {number} now Current time.
 * @param {number} windowMs Window.
 * @returns {void}
 */
function pruneDedup(map, now, windowMs) {
  if (map.size <= MAX_DEDUP_KEYS) return;
  for (const [key, at] of map) if (now - at >= windowMs) map.delete(key);
  while (map.size > MAX_DEDUP_KEYS) {
    const first = map.keys().next().value;
    if (first === undefined) break;
    map.delete(first);
  }
}

/**
 * Device hash stored in an event's meta.
 *
 * @param {unknown} meta Stored meta.
 * @returns {string|null} Hash or null.
 */
function deviceHashOf(meta) {
  const value = toObject(meta).deviceHash;
  return typeof value === 'string' ? value : null;
}

/**
 * Grouping key of a failed sign-in: anonymised address and 5-minute window.
 *
 * @param {unknown} ip Client address.
 * @param {number} at Time in ms.
 * @returns {{key: string, anonIp: string|null, windowStart: number}} Key parts.
 */
function failedGroupOf(ip, at) {
  const anonIp = anonymizeIp(normalizeIp(ip));
  const windowStart = Math.floor(at / FAILED_WINDOW_MS) * FAILED_WINDOW_MS;
  return { key: `${anonIp || '-'}|${windowStart}`, anonIp, windowStart };
}

/**
 * A failed sign-in whose account is unknown (no admin id, no typed email to
 * resolve).
 *
 * @param {SecurityEventInput} entry Event.
 * @returns {boolean}
 */
function isUnknownAccountFailure(entry) {
  return (
    entry.event === SECURITY_EVENTS.ADMIN_SIGN_IN_FAILED &&
    !toId(entry.actorId) &&
    !toId(entry.targetId) &&
    typeof entry.attemptedEmail !== 'string'
  );
}

/**
 * Changed setting names of a `settings.updated` event (key names only, never
 * values), bounded to 50 identifier-shaped names.
 *
 * @param {unknown} value Stored comma-separated names.
 * @returns {string[]} Names.
 */
function settingKeysOf(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((key) => key.trim())
    .filter((key) => /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key))
    .slice(0, 50);
}

module.exports = ({ strapi }) => {
  const log = createLogger(strapi);
  /** @type {SecurityEventInput[]} */
  let queue = [];
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timer = null;
  /** @type {Promise<void>|null} */
  let flushing = null;
  let stopped = false;
  /** Dropped events per family since the last log line. */
  /** @type {Record<string, number>} */
  let dropped = {};
  /** @type {Map<string, number>} */
  const viewed = new Map();
  /** @type {Map<string, number>} */
  const lockouts = new Map();
  /** @type {Map<string, {field: string|null, at: number}>} */
  const mainFields = new Map();
  /** Queued aggregate per failed-sign-in group, merged into until the flush takes it. */
  /** @type {Map<string, SecurityEventInput>} */
  const pendingFailed = new Map();
  /** Stored aggregate row per failed-sign-in group (this process). */
  /** @type {Map<string, {id: number, count: number, windowStart: number}>} */
  const storedFailed = new Map();
  /** Failed rows stored per anonymised address in the current hour. */
  /** @type {Map<string, {windowStart: number, rows: number}>} */
  const failedRowsPerIp = new Map();
  /** @type {Map<string, number>} */
  const readAudits = new Map();

  const events = () => strapi.db.query(EVENT_UID);

  /** Schedules one flush. */
  const schedule = () => {
    if (timer || stopped) return;
    timer = setTimeout(() => {
      timer = null;
      service.flush().catch(() => {});
    }, FLUSH_DELAY_MS);
    if (typeof timer.unref === 'function') timer.unref();
  };

  /**
   * Main field of a content type from the Content Manager configuration,
   * cached for a few minutes.
   *
   * @param {string} uid Content type uid.
   * @returns {Promise<string|null>} Field name or null.
   */
  const mainFieldOf = async (uid) => {
    const now = Date.now();
    const cachedField = mainFields.get(uid);
    if (cachedField && now - cachedField.at < MAIN_FIELD_TTL_MS) return cachedField.field;
    let field;
    try {
      const contentTypes = strapi.plugin('content-manager')?.service('content-types');
      const configuration = contentTypes ? await contentTypes.findConfiguration({ uid }) : null;
      const configured = configuration?.settings?.mainField;
      field = typeof configured === 'string' ? configured : null;
    } catch {
      field = null;
    }
    mainFields.set(uid, { field, at: now });
    return field;
  };

  /**
   * Admin rows by id, for names.
   *
   * @param {Array<unknown>} ids Candidate ids.
   * @returns {Promise<Map<number, Record<string, any>>>} Admin rows by id.
   */
  const loadAdmins = async (ids) => {
    const unique = [...new Set(ids.map(toAdminId).filter((id) => id !== null))];
    if (!unique.length) return new Map();
    const rows = await strapi.db.query(ADMIN_USER_UID).findMany({
      where: { id: { $in: unique } },
      select: ['id', 'firstname', 'lastname', 'username', 'email'],
    });
    return new Map((Array.isArray(rows) ? rows : []).map((row) => [Number(row.id), row]));
  };

  /**
   * Whether one more failed-sign-in row may be stored for an address in the
   * current hour; counts the row when it may.
   *
   * @param {string|null} anonIp Anonymised address.
   * @param {number} at Event time.
   * @returns {boolean}
   */
  const takeFailedRowBudget = (anonIp, at) => {
    const key = anonIp || '-';
    const windowStart = Math.floor(at / FAILED_CAP_WINDOW_MS) * FAILED_CAP_WINDOW_MS;
    const current = failedRowsPerIp.get(key);
    const state =
      current && current.windowStart === windowStart ? current : { windowStart, rows: 0 };
    if (state.rows >= MAX_FAILED_ROWS_PER_IP) return false;
    state.rows += 1;
    failedRowsPerIp.set(key, state);
    if (failedRowsPerIp.size > MAX_DEDUP_KEYS) {
      for (const [ip, value] of failedRowsPerIp) {
        if (value.windowStart !== windowStart) failedRowsPerIp.delete(ip);
      }
    }
    return true;
  };

  /**
   * Stores counted failed sign-ins: one row per anonymised address and
   * 5-minute window. A later flush in the same window raises `meta.count` of
   * the row this process already stored.
   *
   * @param {Map<string, {entry: SecurityEventInput, count: number, anonIp: string|null,
   *   windowStart: number}>} groups Groups of this batch.
   * @param {ReturnType<typeof resolveSecurityLogSettings>} options Log settings.
   * @returns {Promise<void>}
   */
  const writeFailedGroups = async (groups, options) => {
    for (const [key, group] of groups) {
      const known = storedFailed.get(key);
      if (known) {
        const row = await events().findOne({ select: ['id', 'meta'], where: { id: known.id } });
        if (row) {
          known.count += group.count;
          const meta = toObject(row.meta);
          await events().update({
            where: { id: known.id },
            data: { meta: boundMeta({ ...meta, count: known.count }) },
          });
          continue;
        }
        storedFailed.delete(key);
      }
      const { entry } = group;
      const ip = options.storeIp ? group.anonIp : null;
      const occurredAt = entry.occurredAt || new Date();
      const created = await events().create({
        data: {
          event: SECURITY_EVENTS.ADMIN_SIGN_IN_FAILED,
          actorType: 'admin',
          actorId: null,
          targetType: 'admin',
          targetId: null,
          ip,
          userAgent:
            typeof entry.userAgent === 'string' && entry.userAgent
              ? entry.userAgent.slice(0, MAX_USER_AGENT_LENGTH)
              : null,
          geo: null,
          meta: boundMeta({
            ...(entry.meta || {}),
            count: group.count,
            aggregated: true,
            ...(ip ? { ipAnonymized: true } : {}),
          }),
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
      });
      if (created?.id !== undefined) {
        storedFailed.set(key, {
          id: Number(created.id),
          count: group.count,
          windowStart: group.windowStart,
        });
      }
    }
    const now = Date.now();
    for (const [key, value] of storedFailed) {
      if (now - value.windowStart > 2 * FAILED_WINDOW_MS) storedFailed.delete(key);
    }
  };

  /**
   * Builds the stored rows of a batch: switch per event family, IP options,
   * location (opt-in, bounded lookups of the anonymised address), device
   * hash and the TCP peer into a bounded `meta`; the typed email of a
   * lockout (Strapi before 5.58) is resolved to an existing admin and then
   * dropped. Failed sign-ins of unknown accounts, and those over the
   * per-address cap, are returned as groups instead of rows.
   *
   * @param {SecurityEventInput[]} batch Queued events.
   * @param {ReturnType<typeof resolveSecurityLogSettings>} options Log settings.
   * @param {Record<string, any>} settings Merged plugin settings.
   * @returns {Promise<{rows: object[], groups: Map<string, any>}>} Rows and failed groups.
   */
  const buildRows = async (batch, options, settings) => {
    /** @type {Map<string, {entry: SecurityEventInput, count: number, anonIp: string|null, windowStart: number}>} */
    const groups = new Map();
    const recordUserSignIns = settings.recordUserSignInEvents !== false;
    const wanted = batch.filter((entry) => {
      const gate = recordingSwitchOf(entry.event);
      if (gate === 'always') return true;
      if (gate === 'userSignIns') return recordUserSignIns;
      return gate === 'signIns' ? options.signIns : options.content;
    });
    if (!wanted.length) return { rows: [], groups };

    const emails = [
      ...new Set(
        wanted
          .map((entry) => (typeof entry.attemptedEmail === 'string' ? entry.attemptedEmail : ''))
          .filter((email) => email && email.length <= 254)
          .map((email) => email.toLowerCase())
      ),
    ];
    /** @type {Map<string, number>} */
    const byEmail = new Map();
    if (emails.length) {
      const found = await strapi.db.query(ADMIN_USER_UID).findMany({
        where: { email: { $in: emails } },
        select: ['id', 'email'],
      });
      for (const row of Array.isArray(found) ? found : []) {
        byEmail.set(String(row.email).toLowerCase(), Number(row.id));
      }
    }

    const geoService =
      options.geoLookup && options.storeIp && shouldResolveGeoData(settings)
        ? strapi.plugin('magic-sessionmanager').service('geolocation')
        : null;
    /** @type {Map<string, object|null>} */
    const geoCache = new Map();
    let geoBudget = GEO_LOOKUPS_PER_FLUSH;

    /**
     * Adds a failed sign-in to its group (anonymised address, 5 minutes).
     *
     * @param {SecurityEventInput} entry Event.
     * @returns {void}
     */
    const addToGroup = (entry) => {
      const at = (entry.occurredAt || new Date()).getTime();
      const { key, anonIp, windowStart } = failedGroupOf(entry.ip, at);
      const group = groups.get(key);
      const count =
        Number.isInteger(entry.count) && Number(entry.count) > 0 ? Number(entry.count) : 1;
      if (group) group.count += count;
      else groups.set(key, { entry, count, anonIp, windowStart });
    };

    const rows = [];
    for (const entry of wanted) {
      let targetId = toId(entry.targetId);
      let actorId = toId(entry.actorId);
      if (!targetId && typeof entry.attemptedEmail === 'string') {
        const found = byEmail.get(entry.attemptedEmail.toLowerCase());
        targetId = found ? String(found) : null;
        if (entry.actorFromEmail && !actorId) actorId = targetId;
      }
      const isFailure =
        entry.event === SECURITY_EVENTS.ADMIN_SIGN_IN_FAILED ||
        entry.event === SECURITY_EVENTS.ADMIN_LOCKOUT;
      if (entry.event === SECURITY_EVENTS.ADMIN_SIGN_IN_FAILED && !targetId) {
        addToGroup(entry);
        continue;
      }
      const at = (entry.occurredAt || new Date()).getTime();
      if (isFailure && !takeFailedRowBudget(anonymizeIp(normalizeIp(entry.ip)), at)) {
        addToGroup({
          ...entry,
          event: SECURITY_EVENTS.ADMIN_SIGN_IN_FAILED,
          meta: { ...(entry.meta || {}), reason: 'over_limit' },
        });
        continue;
      }

      const ip = options.storeIp ? normalizeIp(entry.ip) : null;
      const storedIp = ip && options.anonymizeIp ? anonymizeIp(ip) : ip;
      const lookupIp = ip ? anonymizeIp(ip) : null;
      let geo = null;
      if (lookupIp && geoService) {
        if (geoCache.has(lookupIp)) {
          geo = geoCache.get(lookupIp) || null;
        } else if (geoBudget > 0) {
          geoBudget -= 1;
          try {
            geo = (await geoService.getSecurityLogLocation(lookupIp)) || null;
          } catch {
            geo = null;
          }
          geoCache.set(lookupIp, geo);
        }
      }
      const meta = { ...(entry.meta || {}) };
      const deviceHash = entry.deviceHash || hashDeviceId(entry.deviceId);
      if (deviceHash) meta.deviceHash = deviceHash;
      if (storedIp && options.anonymizeIp) meta.ipAnonymized = true;
      const socketIp = options.storeIp ? normalizeIp(entry.socketIp) : null;
      if (ip && socketIp && socketIp !== ip) meta.socketIp = anonymizeIp(socketIp);
      const occurredAt = entry.occurredAt || new Date();
      rows.push({
        event: entry.event,
        actorType: entry.actorType,
        actorId,
        targetType: typeof entry.targetType === 'string' ? entry.targetType.slice(0, 191) : null,
        targetId,
        ip: storedIp,
        userAgent:
          typeof entry.userAgent === 'string' && entry.userAgent
            ? entry.userAgent.slice(0, MAX_USER_AGENT_LENGTH)
            : null,
        geo,
        meta: boundMeta(meta),
        createdAt: occurredAt,
        updatedAt: occurredAt,
      });
    }
    return { rows, groups };
  };

  /**
   * Deletes rows created before `cutoff`, in id batches.
   *
   * @param {Date} cutoff Oldest time kept.
   * @returns {Promise<number>} Deleted rows.
   */
  const deleteOlderThan = async (cutoff) => {
    let deleted = 0;
    for (let step = 0; step < MAX_DELETE_STEPS; step += 1) {
      const rows = await events().findMany({
        select: ['id'],
        where: { createdAt: { $lt: cutoff } },
        orderBy: { id: 'asc' },
        limit: DELETE_BATCH,
      });
      const ids = (Array.isArray(rows) ? rows : []).map((row) => row.id);
      if (!ids.length) break;
      const result = await events().deleteMany({ where: { id: { $in: ids } } });
      deleted += Number(result?.count ?? ids.length);
      if (ids.length < DELETE_BATCH) break;
    }
    return deleted;
  };

  /**
   * Writes the queue in batches until it is empty. A batch whose settings
   * cannot be read is dropped (nothing is recorded without readable settings).
   *
   * @returns {Promise<void>}
   */
  const writeQueued = async () => {
    while (queue.length) {
      const batch = queue;
      queue = [];
      pendingFailed.clear();
      let settings;
      try {
        settings = await getPluginSettings(strapi);
      } catch {
        return;
      }
      try {
        const options = resolveSecurityLogSettings(settings);
        const { rows, groups } = await buildRows(batch, options, settings);
        for (let i = 0; i < rows.length; i += FLUSH_BATCH) {
          await events().createMany({ data: rows.slice(i, i + FLUSH_BATCH) });
        }
        await writeFailedGroups(groups, options);
      } catch (err) {
        log.warn('[security-log] Events could not be written:', err?.name || 'Error');
      }
    }
    const families = Object.entries(dropped).filter(([, n]) => n > 0);
    if (families.length) {
      log.warn(
        `[security-log] Queue full, events dropped: ${families
          .map(([family, n]) => `${family}=${n}`)
          .join(', ')}`
      );
      dropped = {};
    }
  };

  /**
   * Makes room in a full queue: drops the oldest event of the lowest drop
   * rank (failed sign-ins first; see `dropRankOf`) and counts it.
   *
   * @returns {void}
   */
  const dropOne = () => {
    let index = -1;
    let lowest = 4;
    for (let i = 0; i < queue.length; i += 1) {
      const { rank } = dropRankOf(queue[i].event);
      if (rank < lowest) {
        lowest = rank;
        index = i;
        if (rank === 0) break;
      }
    }
    if (index === -1) return;
    const [removed] = queue.splice(index, 1);
    const { family } = dropRankOf(removed.event);
    const weight =
      Number.isInteger(removed.count) && Number(removed.count) > 0 ? Number(removed.count) : 1;
    dropped[family] = (dropped[family] || 0) + weight;
    for (const [key, value] of pendingFailed) if (value === removed) pendingFailed.delete(key);
  };

  const service = {
    /**
     * Queues one security event. Returns at once; nothing is awaited.
     * Unknown event names or actor types are ignored.
     *
     * @param {SecurityEventInput} input Event.
     * @returns {boolean} Whether the event was queued.
     * @sideeffect Adds to the in-memory queue; the flush stores it when its switch is on.
     */
    record(input) {
      if (stopped || !input || typeof input.event !== 'string') return false;
      if (!EVENT_NAME_PATTERN.test(input.event) || !ACTOR_TYPES.includes(input.actorType)) {
        return false;
      }
      const now = Date.now();
      if (input.event === SECURITY_EVENTS.ADMIN_LOCKOUT) {
        const who = String(input.attemptedEmail || input.targetId || '').toLowerCase();
        const key = `${who}|${input.ip || ''}`;
        const last = lockouts.get(key);
        if (last !== undefined && now - last < LOCKOUT_DEDUP_MS) return false;
        lockouts.set(key, now);
        pruneDedup(lockouts, now, LOCKOUT_DEDUP_MS);
      }
      /** @type {SecurityEventInput} */
      const entry = { ...input, occurredAt: input.occurredAt || new Date(now) };
      if (typeof entry.userAgent === 'string') {
        entry.userAgent = entry.userAgent.slice(0, MAX_USER_AGENT_LENGTH);
      }
      if (isUnknownAccountFailure(entry)) {
        // Counted into the queued event of the same address and window, so a
        // flood of made-up emails holds one queue slot.
        const { key } = failedGroupOf(entry.ip, now);
        const pending = pendingFailed.get(key);
        if (pending) {
          pending.count = (pending.count || 1) + 1;
          schedule();
          return true;
        }
        entry.aggregate = true;
        entry.count = 1;
        pendingFailed.set(key, entry);
        if (pendingFailed.size > MAX_DEDUP_KEYS) pendingFailed.clear();
      }
      queue.push(entry);
      while (queue.length > MAX_QUEUE) dropOne();
      schedule();
      return true;
    },

    /**
     * Records that an admin API token read the security log (4.17): one
     * `security-log.read` event per token and list within 5 minutes. Reads
     * from the admin panel (a person) are not recorded.
     *
     * @param {{adminId: unknown, tokenId: unknown, list: 'sign-ins'|'content',
     *   exported: boolean}} input Who read what.
     * @returns {boolean} Whether an event was queued.
     * @sideeffect Queues one always-on security event.
     */
    recordTokenRead(input) {
      return service.recordLogRead({ ...input, via: 'admin-token' });
    },

    /**
     * Records a read of the security log (`security-log.read`, always on).
     * Reads with an admin API token (4.17) are recorded once per token, list
     * and kind within 5 minutes. An export of the app-user activity from the
     * admin panel (4.22) is recorded each time it starts: it takes personal
     * data of app users out of Strapi.
     *
     * @param {{adminId: unknown, tokenId?: unknown, list: 'sign-ins'|'content'|'user-activity',
     *   exported: boolean, via: 'admin-token'|'admin-panel'}} input Who read what, and how.
     * @returns {boolean} Whether an event was queued.
     * @sideeffect Queues one always-on security event.
     */
    recordLogRead(input) {
      const via = input?.via === 'admin-panel' ? 'admin-panel' : 'admin-token';
      const list = AUDITED_LISTS.includes(/** @type {string} */ (input?.list))
        ? input.list
        : 'sign-ins';
      const tokenId = via === 'admin-token' ? toId(input?.tokenId) : null;
      if (via === 'admin-token') {
        const now = Date.now();
        const key = `${tokenId || '-'}|${list}|${input?.exported ? 'export' : 'list'}`;
        const last = readAudits.get(key);
        if (last !== undefined && now - last < READ_AUDIT_DEDUP_MS) return false;
        readAudits.set(key, now);
        pruneDedup(readAudits, now, READ_AUDIT_DEDUP_MS);
      }
      return service.record({
        event: SECURITY_EVENTS.LOG_READ,
        actorType: 'admin',
        actorId: /** @type {any} */ (input?.adminId) ?? null,
        targetType: 'security-log',
        targetId: null,
        meta: {
          list,
          exported: input?.exported === true,
          via,
          ...(tokenId ? { tokenId } : {}),
        },
      });
    },

    /**
     * Queues one Content Manager action of an admin as
     * `admin.content.<action>` with the entry as target (`targetType` = content
     * type uid, `targetId` = document id). Opening the same entry (same
     * admin, type, document and locale) again within 10 minutes, or right
     * after writing it, is not a new "view".
     *
     * Only the type uid, document id, locale and (bulk) count are queued;
     * the entry itself never is (4.17).
     *
     * @param {{adminUserId: number|string, action: string, kind: 'collection'|'single',
     *   contentType: string, documentId: string|null, locale: string|null,
     *   count: number|null}} input Action.
     * @returns {boolean} Whether the action was queued.
     */
    recordContentAction(input) {
      if (stopped || !input || !CONTENT_ACTIONS.includes(input.action)) return false;
      const now = Date.now();
      const key = `${input.adminUserId}|${input.contentType}|${input.documentId || ''}|${input.locale || ''}`;
      if (input.documentId || input.kind === 'single') {
        if (input.action === 'view') {
          const last = viewed.get(key);
          if (last !== undefined && now - last < VIEW_DEDUP_MS) return false;
        }
        viewed.delete(key);
        viewed.set(key, now);
        pruneDedup(viewed, now, VIEW_DEDUP_MS);
      }
      return service.record({
        event: contentEvent(input.action),
        actorType: 'admin',
        actorId: input.adminUserId,
        targetType: input.contentType,
        targetId: input.documentId,
        meta: {
          kind: input.kind,
          locale: input.locale || null,
          ...(typeof input.count === 'number' ? { count: input.count } : {}),
        },
      });
    },

    /**
     * Writes everything queued. Concurrent calls share one run.
     *
     * @returns {Promise<void>}
     * @sideeffect Inserts rows into the security event table; may call the GeoIP provider.
     */
    async flush() {
      if (flushing) return flushing;
      if (!queue.length) return undefined;
      // `.finally` runs after the assignment even when the run finishes at
      // once, so `flushing` is always cleared again.
      flushing = writeQueued().finally(() => {
        flushing = null;
      });
      return flushing;
    },

    /**
     * Stops recording and writes what is queued (plugin destroy).
     *
     * @returns {Promise<void>}
     */
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await service.flush().catch(() => {});
    },

    /** @returns {boolean} Whether recording was stopped. */
    isStopped() {
      return stopped;
    },

    /**
     * One page of the admin sign-in history, newest first, with names of the
     * admins involved and the session state of each sign-in.
     *
     * @param {{adminId?: number, event?: keyof typeof SIGN_IN_FILTERS, from?: Date|null,
     *   to?: Date|null, page: number, pageSize: number}} query Parsed filters.
     * @param {Viewer} [viewer] Reader (admin names need `admin::users.read`).
     * @returns {Promise<{data: object[], meta: object}>} Response body.
     */
    async listSignIns(query, viewer = {}) {
      const where = signInWhere(query);
      const [total, rows] = await Promise.all([
        events().count({ where }),
        events().findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          offset: (query.page - 1) * query.pageSize,
          limit: query.pageSize,
        }),
      ]);
      return {
        data: await shapeSignIns(Array.isArray(rows) ? rows : [], viewer),
        meta: {
          pagination: paginationOf(query, total),
          recording: await recordingFlags(),
          identity: { names: viewer.canReadAdmins === true },
        },
      };
    },

    /**
     * One page of Content Manager activity, newest first.
     *
     * @param {{adminId?: number, action?: string, contentType?: string, from?: Date|null,
     *   to?: Date|null, page: number, pageSize: number}} query Parsed filters.
     * @param {Viewer} [viewer] Reader (titles need Content Manager read access to the entry and
     *   its main field; admin names need `admin::users.read`).
     * @returns {Promise<{data: object[], meta: object}>} Response body.
     */
    async listContentActivity(query, viewer = {}) {
      const where = activityWhere(query);
      const [total, rows] = await Promise.all([
        events().count({ where }),
        events().findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          offset: (query.page - 1) * query.pageSize,
          limit: query.pageSize,
        }),
      ]);
      return {
        data: await shapeActivity(Array.isArray(rows) ? rows : [], viewer),
        meta: {
          pagination: paginationOf(query, total),
          recording: await recordingFlags(),
          identity: { names: viewer.canReadAdmins === true },
          contentTypes: listContentTypes(),
          ...(query.adminId
            ? { contentManagerAccess: await service.hasContentManagerAccess(query.adminId) }
            : {}),
        },
      };
    },

    /**
     * One page of the app-user security activity (4.22), newest first:
     * failed and refused sign-ins, lockouts, session limits, sign-outs after
     * a password change, new devices, impossible travel, "This wasn't me",
     * data exports and impersonations of app users. Rows older than the
     * retention period are not returned; IP addresses follow the current
     * "Store" and "Anonymise" switches.
     *
     * @param {{event?: string, userId?: string, from?: Date|null, to?: Date|null,
     *   page: number, pageSize: number}} query Parsed filters.
     * @param {Viewer} [viewer] Reader (user emails need Content Manager read access to the
     *   user; admin names `admin::users.read`; impersonation reasons `impersonate.users`).
     * @returns {Promise<{data: object[], meta: object}>} Response body.
     */
    async listUserActivity(query, viewer = {}) {
      const settings = await readSettingsOrDefaults();
      const options = resolveSecurityLogSettings(settings);
      const where = userActivityWhere(query, options);
      const [total, rows] = await Promise.all([
        events().count({ where }),
        events().findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          offset: (query.page - 1) * query.pageSize,
          limit: query.pageSize,
        }),
      ]);
      const shaped = await shapeUserEvents(Array.isArray(rows) ? rows : [], viewer, options);
      return {
        data: shaped.data,
        meta: {
          pagination: paginationOf(query, total),
          recording: {
            ipAddresses: options.storeIp,
            anonymizeIp: options.anonymizeIp,
            retentionDays: options.retentionDays,
            userSignIns: settings.recordUserSignInEvents !== false,
          },
          identity: {
            users: shaped.usersVisible,
            names: viewer.canReadAdmins === true,
            impersonationReasons: viewer.canSeeImpersonationReason === true,
          },
        },
      };
    },

    /**
     * One export batch (newest first, keyset on id) of a list.
     *
     * @param {'sign-ins'|'content'|'user-activity'} kind List.
     * @param {any} query Parsed filters (as for the list).
     * @param {number|null} cursor Id below which to continue.
     * @param {Viewer} [viewer] Reader; the same title and name rules as the lists.
     * @returns {Promise<{data: object[], meta: {nextCursor: string|null}}>} Batch.
     */
    async exportBatch(kind, query, cursor, viewer = {}) {
      const options =
        kind === 'user-activity'
          ? resolveSecurityLogSettings(await readSettingsOrDefaults())
          : null;
      const base =
        kind === 'sign-ins'
          ? signInWhere(query)
          : kind === 'user-activity' && options
            ? userActivityWhere(query, options)
            : activityWhere(query);
      const where = cursor ? { $and: [base, { id: { $lt: cursor } }] } : base;
      const rows = await events().findMany({
        where,
        orderBy: [{ id: 'desc' }],
        limit: EXPORT_BATCH,
      });
      const list = Array.isArray(rows) ? rows : [];
      let data;
      if (kind === 'sign-ins') data = await shapeSignIns(list, viewer);
      else if (kind === 'user-activity' && options) {
        data = (await shapeUserEvents(list, viewer, options)).data;
      } else data = await shapeActivity(list, viewer);
      const last = list[list.length - 1];
      return {
        data,
        meta: { nextCursor: list.length === EXPORT_BATCH && last ? String(last.id) : null },
      };
    },

    /**
     * Whether an admin can use the Content Manager: Super Admin, or a role
     * with any `plugin::content-manager.explorer.*` permission.
     *
     * @param {number} adminId Admin id.
     * @returns {Promise<boolean|null>} Null when the admin does not exist.
     */
    async hasContentManagerAccess(adminId) {
      const user = await strapi.db.query(ADMIN_USER_UID).findOne({
        where: { id: adminId },
        select: ['id'],
        populate: { roles: { select: ['id', 'code'] } },
      });
      if (!user) return null;
      const roles = Array.isArray(user.roles) ? user.roles : [];
      if (roles.some((role) => role?.code === SUPER_ADMIN_CODE)) return true;
      const roleIds = roles.map((role) => role.id).filter((id) => id !== undefined);
      if (!roleIds.length) return false;
      const count = await strapi.db.query(PERMISSION_UID).count({
        where: {
          role: { id: { $in: roleIds } },
          action: { $startsWith: 'plugin::content-manager.explorer.' },
        },
      });
      return Number(count) > 0;
    },

    /**
     * Retention for the whole log: deletes events older than the configured
     * number of days, and the events of admins that no longer exist (where a
     * deleted admin signed someone else out, only the actor is cleared).
     *
     * A run that deleted rows queues an always-on
     * `security-log.retention.purged` event with the counts (4.17).
     *
     * @param {{now?: Date}} [options] Clock for tests.
     * @returns {Promise<{expired: number, orphans: number}>} Deleted rows.
     * @sideeffect Deletes and updates rows of the security event table; queues one event.
     */
    async cleanup({ now = new Date() } = {}) {
      const options = resolveSecurityLogSettings(await getPluginSettings(strapi));
      const cutoff = new Date(now.getTime() - options.retentionDays * 24 * 60 * 60 * 1000);
      const expired = await deleteOlderThan(cutoff);
      const admins = await strapi.db.query(ADMIN_USER_UID).findMany({ select: ['id'] });
      const existing = (Array.isArray(admins) ? admins : []).map((row) => String(row.id));
      let orphans = 0;
      if (existing.length) {
        const removed = await events().deleteMany({
          where: {
            $or: [
              { targetType: 'admin', targetId: { $notNull: true, $notIn: existing } },
              {
                actorType: 'admin',
                actorId: { $notNull: true, $notIn: existing },
                event: { $notIn: [...KEEP_WITHOUT_ACTOR_EVENTS] },
              },
            ],
          },
        });
        orphans = Number(removed?.count || 0);
        await events().updateMany({
          where: {
            event: { $in: [...KEEP_WITHOUT_ACTOR_EVENTS] },
            actorType: 'admin',
            actorId: { $notNull: true, $notIn: existing },
          },
          data: { actorId: null },
        });
      }
      if (expired + orphans > 0) {
        service.record({
          event: SECURITY_EVENTS.LOG_RETENTION_PURGED,
          actorType: 'system',
          targetType: 'security-log',
          meta: {
            count: expired + orphans,
            expired,
            orphans,
            retentionDays: options.retentionDays,
          },
        });
      }
      return { expired, orphans };
    },

    /**
     * Deletes what was recorded about an admin whose account was deleted:
     * events they did and events about their account. Where they signed
     * someone else out, changed settings or read the log with a token, the
     * actor reference is cleared and the event stays.
     *
     * @param {number} adminId Deleted admin id.
     * @returns {Promise<void>}
     * @sideeffect Deletes and updates rows of the security event table.
     */
    /**
     * Deletes what the log holds about an app user whose account was
     * deleted: events about the account and events the user caused.
     *
     * @param {string} userDocumentId Deleted user's documentId.
     * @returns {Promise<void>}
     * @sideeffect Deletes rows of the security event table.
     */
    async deleteUserData(userDocumentId) {
      const key = toId(userDocumentId);
      if (!key) return;
      queue = queue.filter(
        (entry) =>
          !(entry.targetType === 'user' && String(entry.targetId) === key) &&
          !(entry.actorType === 'user' && String(entry.actorId) === key)
      );
      await events().deleteMany({
        where: {
          $or: [
            { targetType: 'user', targetId: key },
            { actorType: 'user', actorId: key },
          ],
        },
      });
    },

    async deleteAdminData(adminId) {
      const id = toAdminId(adminId);
      if (!id) return;
      const key = String(id);
      queue = queue.filter(
        (entry) =>
          !(entry.actorType === 'admin' && String(entry.actorId) === key) &&
          !(entry.targetType === 'admin' && String(entry.targetId) === key)
      );
      await events().deleteMany({
        where: {
          $or: [
            { targetType: 'admin', targetId: key },
            {
              actorType: 'admin',
              actorId: key,
              event: { $notIn: [...KEEP_WITHOUT_ACTOR_EVENTS] },
            },
          ],
        },
      });
      await events().updateMany({
        where: { event: { $in: [...KEEP_WITHOUT_ACTOR_EVENTS] }, actorType: 'admin', actorId: key },
        data: { actorId: null },
      });
    },
  };

  /**
   * @param {{page: number, pageSize: number}} query Paging.
   * @param {unknown} total Row count.
   * @returns {{page: number, pageSize: number, total: number, pageCount: number}} Pagination.
   */
  function paginationOf(query, total) {
    const count = Number(total) || 0;
    return {
      page: query.page,
      pageSize: query.pageSize,
      total: count,
      pageCount: Math.max(1, Math.ceil(count / query.pageSize)),
    };
  }

  /**
   * Query Engine filter of the sign-in history (the admin is the target).
   *
   * @param {any} query Parsed filters.
   * @returns {object} `where`.
   */
  function signInWhere(query) {
    /** @type {any[]} */
    const conditions = [{ event: { $in: [...SIGN_IN_FILTERS[query.event || 'all']] } }];
    if (query.adminId) conditions.push({ targetType: 'admin', targetId: String(query.adminId) });
    if (query.from) conditions.push({ createdAt: { $gte: query.from } });
    if (query.to) conditions.push({ createdAt: { $lte: query.to } });
    return { $and: conditions };
  }

  /**
   * Query Engine filter of the activity list (the admin is the actor).
   *
   * @param {any} query Parsed filters.
   * @returns {object} `where`.
   */
  function activityWhere(query) {
    /** @type {any[]} */
    const conditions = [
      {
        event:
          query.action && query.action !== 'all'
            ? contentEvent(query.action)
            : { $in: [...ADMIN_CONTENT_EVENTS] },
      },
    ];
    if (query.adminId) conditions.push({ actorType: 'admin', actorId: String(query.adminId) });
    if (query.contentType) conditions.push({ targetType: query.contentType });
    if (query.from) conditions.push({ createdAt: { $gte: query.from } });
    if (query.to) conditions.push({ createdAt: { $lte: query.to } });
    return { $and: conditions };
  }

  /**
   * Merged plugin settings, or an empty object (the defaults) when they
   * cannot be read.
   *
   * @returns {Promise<Record<string, any>>} Settings.
   */
  async function readSettingsOrDefaults() {
    try {
      return (await getPluginSettings(strapi)) || {};
    } catch {
      return {};
    }
  }

  /**
   * Current recording switches, for the UI.
   *
   * @returns {Promise<{signIns: boolean, contentActivity: boolean, ipAddresses: boolean,
   *   anonymizeIp: boolean, retentionDays: number}>} Flags.
   */
  async function recordingFlags() {
    const options = resolveSecurityLogSettings(await readSettingsOrDefaults());
    return {
      signIns: options.signIns,
      contentActivity: options.content,
      ipAddresses: options.storeIp,
      anonymizeIp: options.anonymizeIp,
      retentionDays: options.retentionDays,
    };
  }

  /**
   * Content types an admin edits in the Content Manager (for the filter).
   *
   * @returns {Array<{uid: string, name: string, kind: 'collection'|'single'}>} Types.
   */
  function listContentTypes() {
    return Object.entries(strapi.contentTypes || {})
      .filter(([uid, type]) => {
        const visible = /** @type {any} */ (type)?.pluginOptions?.['content-manager']?.visible;
        return uid.startsWith('api::') && visible !== false;
      })
      .map(([uid, type]) => ({
        uid,
        name: String(/** @type {any} */ (type)?.info?.displayName || uid).slice(0, 120),
        kind: /** @type {any} */ (type)?.kind === 'singleType' ? 'single' : 'collection',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Response rows of the sign-in history (allowlisted fields; no device
   * hash). The stored user agent (at most MAX_USER_AGENT_LENGTH characters,
   * as the browser sent it) is returned for the event details dialog, next to its parsed
   * browser and OS. A revoke row also says how many sessions it ended; a
   * sign-in whose session another admin ended names that admin. Settings
   * changes, token reads and retention runs (filter `changes`) carry their
   * own facts: changed key names, which list was read, how many events were
   * deleted.
   *
   * @param {Array<Record<string, any>>} rows Stored rows.
   * @param {Viewer} viewer Reader.
   * @returns {Promise<object[]>} DTOs.
   */
  async function shapeSignIns(rows, viewer) {
    const nameOf = (user) => (viewer.canReadAdmins === true ? adminName(user) : '');
    const states = await sessionStates(rows);
    const admins = await loadAdmins([
      ...rows.flatMap((row) => [row.targetId, row.actorId]),
      ...[...states.values()].map((state) => state.endedBy),
    ]);
    return rows.map((row) => {
      const meta = toObject(row.meta);
      // Settings changes and token reads belong to the admin who did them.
      const ownAction =
        (row.event === SECURITY_EVENTS.SETTINGS_UPDATED ||
          row.event === SECURITY_EVENTS.LOG_READ) &&
        row.actorType === 'admin';
      const admin =
        row.targetType === 'admin'
          ? admins.get(Number(row.targetId))
          : ownAction
            ? admins.get(Number(row.actorId))
            : undefined;
      const revoked = row.event === SECURITY_EVENTS.ADMIN_SESSION_REVOKED;
      const actor = revoked ? admins.get(Number(row.actorId)) : undefined;
      const described = describeUserAgent(row.userAgent || null);
      const state = states.get(Number(row.id));
      const endedBy = state?.endedBy ? admins.get(Number(state.endedBy)) : undefined;
      return {
        id: Number(row.id),
        event: row.event,
        reason: safeReason(meta.reason),
        provider: safeReason(meta.provider),
        // Failed sign-ins of unknown accounts are counted per address and 5 minutes (4.17).
        attempts: meta.aggregated === true && typeof meta.count === 'number' ? meta.count : null,
        scope: revoked ? safeReason(meta.scope) : null,
        at: toIso(row.createdAt),
        ipAddress: row.ip || null,
        ipAnonymized: meta.ipAnonymized === true,
        location: toLocation(row.geo),
        browser: described.browserName,
        os: described.osName,
        deviceType: described.deviceType,
        userAgent:
          typeof row.userAgent === 'string' && row.userAgent
            ? row.userAgent.slice(0, MAX_USER_AGENT_LENGTH)
            : null,
        admin: admin ? { id: Number(admin.id), name: nameOf(admin) } : null,
        actor: actor ? { id: Number(actor.id), name: nameOf(actor) } : null,
        sessionsEnded:
          revoked && Number.isInteger(meta.ended) && meta.ended >= 0 ? meta.ended : null,
        change:
          row.event === SECURITY_EVENTS.SETTINGS_UPDATED
            ? { keys: settingKeysOf(meta.keys), viaToken: meta.via === 'admin-token' }
            : null,
        read:
          row.event === SECURITY_EVENTS.LOG_READ
            ? {
                list: AUDITED_LISTS.includes(meta.list) ? meta.list : 'sign-ins',
                exported: meta.exported === true,
                via: meta.via === 'admin-panel' ? 'admin-panel' : 'admin-token',
              }
            : null,
        purge:
          row.event === SECURITY_EVENTS.LOG_RETENTION_PURGED
            ? {
                count: Number.isInteger(meta.count) ? meta.count : null,
                retentionDays: Number.isInteger(meta.retentionDays) ? meta.retentionDays : null,
              }
            : null,
        session:
          row.event === SECURITY_EVENTS.ADMIN_SIGN_IN && state
            ? {
                state: state.state,
                endedAt: toIso(state.endedAt),
                endedBy: endedBy ? { id: Number(endedBy.id), name: nameOf(endedBy) } : null,
              }
            : null,
      };
    });
  }

  /**
   * Session state of the sign-ins among `rows` (see deriveSessionStates).
   *
   * @param {Array<Record<string, any>>} rows Stored rows of a page.
   * @returns {Promise<Map<number, any>>} State per row id.
   */
  async function sessionStates(rows) {
    const list = rows.filter(
      (row) => row.event === SECURITY_EVENTS.ADMIN_SIGN_IN && toAdminId(row.targetId)
    );
    if (!list.length) return new Map();
    const adminIds = [...new Set(list.map((row) => String(row.targetId)))];
    const oldest = new Date(
      Math.min(...list.map((row) => new Date(toIso(row.createdAt) || Date.now()).getTime()))
    );
    const later = await events().findMany({
      select: ['id', 'event', 'targetId', 'actorId', 'meta', 'createdAt'],
      where: {
        targetType: 'admin',
        targetId: { $in: adminIds },
        event: {
          $in: [
            SECURITY_EVENTS.ADMIN_SIGN_IN,
            SECURITY_EVENTS.ADMIN_SIGN_OUT,
            SECURITY_EVENTS.ADMIN_SESSION_REVOKED,
          ],
        },
        createdAt: { $gte: oldest },
      },
      orderBy: [{ createdAt: 'asc' }],
      limit: 5000,
    });
    /** @type {Map<string, Set<string>>} */
    const live = new Map();
    if (strapi.contentTypes?.[ADMIN_SESSION_UID]) {
      const now = new Date();
      const sessions = await strapi.db.query(ADMIN_SESSION_UID).findMany({
        select: ['userId', 'deviceId'],
        where: {
          origin: 'admin',
          status: 'active',
          userId: { $in: adminIds },
          expiresAt: { $gt: now },
          $or: [{ absoluteExpiresAt: { $null: true } }, { absoluteExpiresAt: { $gt: now } }],
        },
        limit: 10000,
      });
      for (const session of Array.isArray(sessions) ? sessions : []) {
        const hash = hashDeviceId(session.deviceId);
        if (!hash) continue;
        const key = String(session.userId);
        if (!live.has(key)) live.set(key, new Set());
        live.get(key)?.add(hash);
      }
    }
    /** @param {Record<string, any>} row Stored row. */
    const toEvent = (row) => ({
      id: Number(row.id),
      adminId: String(row.targetId),
      event: row.event,
      actorId: row.actorId ? String(row.actorId) : null,
      deviceHash: deviceHashOf(row.meta),
      at: toIso(row.createdAt) || '',
    });
    return deriveSessionStates(
      list.map(toEvent),
      (Array.isArray(later) ? later : []).map(toEvent),
      live
    );
  }

  /**
   * Titles of the entries on a page, as the reader may see them in the
   * Content Manager: the type must be readable, the main field readable
   * (field-level permission), and the entry must pass the permission
   * conditions (for example "is creator"). Deleted entries have no title.
   *
   * @param {Array<Record<string, any>>} rows Stored rows.
   * @param {any} ability Reader's CASL ability, or null.
   * @returns {Promise<Map<string, string>>} Title per `uid|documentId|locale` (and `uid|documentId|`).
   */
  async function resolveTitles(rows, ability) {
    /** @type {Map<string, string>} */
    const titles = new Map();
    if (!ability) return titles;
    let checkers;
    try {
      checkers = strapi.plugin('content-manager')?.service('permission-checker');
    } catch {
      checkers = null;
    }
    if (!checkers) return titles;
    /** @type {Map<string, Set<string>>} */
    const byType = new Map();
    for (const row of rows) {
      const uid = row.targetType;
      const id = toId(row.targetId);
      if (
        typeof uid !== 'string' ||
        !id ||
        !uid.startsWith('api::') ||
        !strapi.contentTypes?.[uid]
      ) {
        continue;
      }
      if (!byType.has(uid)) byType.set(uid, new Set());
      byType.get(uid)?.add(id);
    }
    for (const [uid, ids] of byType) {
      try {
        const checker = checkers.create({ userAbility: ability, model: uid });
        if (checker.cannot.read()) continue;
        const mainField = await mainFieldOf(uid);
        const attributes = strapi.contentTypes[uid]?.attributes || {};
        if (!mainField || mainField === 'id' || !attributes[mainField]) continue;
        if (checker.cannot.read(null, mainField)) continue;
        const select = ['id', 'documentId', mainField];
        if (attributes.locale) select.push('locale');
        if (attributes.publishedAt) select.push('publishedAt');
        const found = await strapi.db.query(uid).findMany({
          select,
          where: { documentId: { $in: [...ids] } },
          ...(attributes.createdBy ? { populate: { createdBy: { select: ['id'] } } } : {}),
          limit: Math.min(ids.size * 20, 10000),
        });
        // Prefer the draft (what the Content Manager edit view shows).
        const ordered = (Array.isArray(found) ? found : []).sort(
          (a, b) => Number(Boolean(a.publishedAt)) - Number(Boolean(b.publishedAt))
        );
        for (const doc of ordered) {
          if (!checker.can.read(doc, mainField)) continue;
          const title = pickEntryTitle(doc, mainField);
          if (!title) continue;
          const exact = `${uid}|${doc.documentId}|${doc.locale || ''}`;
          const any = `${uid}|${doc.documentId}|`;
          if (!titles.has(exact)) titles.set(exact, title);
          if (!titles.has(any)) titles.set(any, title);
        }
      } catch {
        // No title for this type; the list still loads.
      }
    }
    return titles;
  }

  /**
   * Response rows of the activity list.
   *
   * @param {Array<Record<string, any>>} rows Stored rows.
   * @param {Viewer} viewer Reader.
   * @returns {Promise<object[]>} DTOs.
   */
  async function shapeActivity(rows, viewer) {
    const admins = await loadAdmins(rows.map((row) => row.actorId));
    const titles = await resolveTitles(rows, viewer.ability || null);
    return rows.map((row) => {
      const meta = toObject(row.meta);
      const admin = row.actorType === 'admin' ? admins.get(Number(row.actorId)) : undefined;
      const type = strapi.contentTypes?.[row.targetType];
      return {
        id: Number(row.id),
        action: String(row.event).replace(/^admin\.content\./, ''),
        at: toIso(row.createdAt),
        contentType: {
          uid: row.targetType,
          name: String(type?.info?.displayName || row.targetType).slice(0, 120),
          kind: meta.kind === 'single' ? 'single' : 'collection',
          exists: Boolean(type),
        },
        entry: {
          documentId: row.targetId || null,
          locale: typeof meta.locale === 'string' ? meta.locale : null,
          title:
            titles.get(
              `${row.targetType}|${row.targetId}|${typeof meta.locale === 'string' ? meta.locale : ''}`
            ) ||
            titles.get(`${row.targetType}|${row.targetId}|`) ||
            null,
          count: typeof meta.count === 'number' ? meta.count : null,
        },
        admin: admin
          ? { id: Number(admin.id), name: viewer.canReadAdmins === true ? adminName(admin) : '' }
          : null,
      };
    });
  }

  /**
   * App users of a page by documentId, with what this reader may see of
   * them: the email and username only when the reader may read that user in
   * the Content Manager (type, conditions and field-level permission on
   * `email` / `username`), like Settings › Users for admins (4.16.1, F4).
   *
   * @param {Array<unknown>} documentIds Candidate ids.
   * @param {any} ability Reader's CASL ability, or null.
   * @returns {Promise<{users: Map<string, {id: number, documentId: string, email: string,
   *   username: string}>, visible: boolean}>} Users, and whether the reader may read app users
   *   in the Content Manager at all.
   */
  async function loadAppUsers(documentIds, ability) {
    /** @type {Map<string, {id: number, documentId: string, email: string, username: string}>} */
    const users = new Map();
    if (!strapi.contentTypes?.[USER_UID]) return { users, visible: false };
    let checker = null;
    if (ability) {
      try {
        const checkers = strapi.plugin('content-manager')?.service('permission-checker');
        const candidate = checkers?.create({ userAbility: ability, model: USER_UID }) || null;
        checker = candidate && !candidate.cannot.read() ? candidate : null;
      } catch {
        checker = null;
      }
    }
    const ids = [
      ...new Set(
        documentIds.filter((id) => typeof id === 'string' && /^[A-Za-z0-9]{1,64}$/.test(id))
      ),
    ];
    if (!ids.length) return { users, visible: Boolean(checker) };
    const attributes = strapi.contentTypes[USER_UID].attributes || {};
    const found = await strapi.db.query(USER_UID).findMany({
      select: ['id', 'documentId', 'email', 'username'],
      where: { documentId: { $in: ids } },
      ...(attributes.createdBy ? { populate: { createdBy: { select: ['id'] } } } : {}),
      limit: ids.length * 2,
    });
    for (const user of Array.isArray(found) ? found : []) {
      const may = (field) => {
        if (!checker) return false;
        try {
          return checker.can.read(user, field) === true;
        } catch {
          return false;
        }
      };
      const email = may('email') && typeof user.email === 'string' ? user.email : '';
      const username = may('username') && typeof user.username === 'string' ? user.username : '';
      users.set(String(user.documentId), {
        id: Number(user.id),
        documentId: String(user.documentId),
        email: email.slice(0, 254),
        username: username.slice(0, 200),
      });
    }
    return { users, visible: Boolean(checker) };
  }

  /**
   * Response rows of the app-user security activity (4.22): allowlisted
   * fields, the event's own facts (numbers and codes, see userEventFacts),
   * the app user as far as the reader may see them, the admin who acted
   * (lifted a lock, impersonated) with their name only for
   * `admin::users.read`, and the address as the current switches allow it.
   * Rows an admin caused carry no address, browser or user agent: those
   * would be the admin's own.
   * Never the device hash, the socket address, a typed identifier or a token.
   *
   * @param {Array<Record<string, any>>} rows Stored rows.
   * @param {Viewer} viewer Reader.
   * @param {{storeIp: boolean, anonymizeIp: boolean}} options Security log settings.
   * @returns {Promise<{data: object[], usersVisible: boolean}>} DTOs and the identity flag.
   */
  async function shapeUserEvents(rows, viewer, options) {
    const list = rows.filter((row) => USER_ACTIVITY_EVENTS.includes(row.event));
    const { users, visible } = await loadAppUsers(
      list.filter((row) => row.targetType === 'user').map((row) => row.targetId),
      viewer.ability || null
    );
    const admins = await loadAdmins(
      list.filter((row) => row.actorType === 'admin').map((row) => row.actorId)
    );
    const data = list.map((row) => {
      // Events an admin caused (lock lifted, impersonation) store the admin's own request: their
      // address and browser belong to the admin sign-in data (`admin-activity.read`), not to the
      // app user, so this view never returns them.
      const byAdmin = row.actorType === 'admin';
      const userAgent =
        !byAdmin && typeof row.userAgent === 'string' && row.userAgent ? row.userAgent : null;
      const described = describeUserAgent(userAgent);
      const address = byAdmin
        ? { ipAddress: null, ipAnonymized: false, keepLocation: false }
        : userEventAddress(row, options, (ip) => anonymizeIp(normalizeIp(ip)));
      const user =
        row.targetType === 'user' && typeof row.targetId === 'string'
          ? users.get(row.targetId) || null
          : null;
      const admin = row.actorType === 'admin' ? admins.get(Number(row.actorId)) : undefined;
      let actor = null;
      if (row.actorType === 'system') actor = { type: 'system', id: null, name: '' };
      else if (row.actorType === 'admin' && toAdminId(row.actorId)) {
        actor = {
          type: 'admin',
          id: Number(row.actorId),
          name: admin && viewer.canReadAdmins === true ? adminName(admin) : '',
        };
      }
      return {
        id: Number(row.id),
        event: row.event,
        at: toIso(row.createdAt),
        target: row.targetType === 'ip' ? 'ip' : 'user',
        user,
        actor,
        details: userEventFacts(row.event, row.meta, viewer),
        ipAddress: address.ipAddress,
        ipAnonymized: address.ipAnonymized,
        location: address.keepLocation ? toLocation(row.geo) : null,
        browser: described.browserName,
        os: described.osName,
        deviceType: described.deviceType,
        userAgent: userAgent ? userAgent.slice(0, MAX_USER_AGENT_LENGTH) : null,
      };
    });
    return { data, usersVisible: visible };
  }

  return service;
};

module.exports.EVENT_UID = EVENT_UID;
module.exports.VIEW_DEDUP_MS = VIEW_DEDUP_MS;
