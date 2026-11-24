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
 * anonymise). GeoIP lookups (the existing geolocation service, unchanged)
 * also happen in the flush.
 *
 * Storage uses the Query Engine (`strapi.db.query`) like the other
 * plugin-internal tables: no draft/publish, locales or relations.
 */

const {
  ACTOR_TYPES,
  ADMIN_CONTENT_EVENTS,
  CONTENT_ACTIONS,
  EVENT_NAME_PATTERN,
  SECURITY_EVENTS,
  SIGN_IN_FILTERS,
  boundMeta,
  contentEvent,
  deriveSessionStates,
  pickEntryTitle,
  recordingSwitchOf,
  safeReason,
  toIso,
  toLocation,
  toObject,
} = require('../utils/security-log-model');
const {
  anonymizeIp,
  describeUserAgent,
  hashDeviceId,
  normalizeIp,
} = require('../utils/admin-request-info');
const { resolveSecurityLogSettings } = require('../utils/security-log-settings');
const { getPluginSettings } = require('../utils/settings-loader');
const { shouldResolveGeoData } = require('../utils/enhance-session');
const { createLogger } = require('../utils/logger');

const EVENT_UID = 'plugin::magic-sessionmanager.security-event';
const ADMIN_USER_UID = 'admin::user';
const ADMIN_SESSION_UID = 'admin::session';
const PERMISSION_UID = 'admin::permission';
const SUPER_ADMIN_CODE = 'strapi-super-admin';

/** Delay between a queued event and its write. */
const FLUSH_DELAY_MS = 1000;
/** Rows per `createMany`. */
const FLUSH_BATCH = 200;
/** Events kept in the queue; older ones are dropped when the database is slow. */
const MAX_QUEUE = 2000;
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
 * @property {any} [entryData] Content Manager entry, only to read its title in the flush.
 * @property {Date} [occurredAt] Event time (default now).
 */

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

module.exports = ({ strapi }) => {
  const log = createLogger(strapi);
  /** @type {SecurityEventInput[]} */
  let queue = [];
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timer = null;
  /** @type {Promise<void>|null} */
  let flushing = null;
  let stopped = false;
  let dropped = 0;
  /** @type {Map<string, number>} */
  const viewed = new Map();
  /** @type {Map<string, number>} */
  const lockouts = new Map();
  /** @type {Map<string, {field: string|null, at: number}>} */
  const mainFields = new Map();

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
   * The latest title the log holds for an entry (from an earlier open or edit).
   *
   * @param {string} targetType Content type uid.
   * @param {string} targetId Document id.
   * @returns {Promise<string|null>} Title or null.
   */
  const titleFromLog = async (targetType, targetId) => {
    const rows = await events().findMany({
      select: ['meta'],
      where: { targetType, targetId, event: { $startsWith: 'admin.content.' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      limit: 10,
    });
    for (const row of Array.isArray(rows) ? rows : []) {
      const title = toObject(row.meta).title;
      if (typeof title === 'string' && title) return title;
    }
    return null;
  };

  /**
   * Builds the stored rows of a batch: switch per event family, IP options,
   * location (bounded lookups), device hash and title into a bounded `meta`;
   * the typed email of a lockout is resolved to an existing admin and then
   * dropped.
   *
   * @param {SecurityEventInput[]} batch Queued events.
   * @param {ReturnType<typeof resolveSecurityLogSettings>} options Log settings.
   * @param {Record<string, any>} settings Merged plugin settings.
   * @returns {Promise<object[]>} Rows.
   */
  const buildRows = async (batch, options, settings) => {
    const wanted = batch.filter((entry) => {
      const gate = recordingSwitchOf(entry.event);
      return gate === 'always' || (gate === 'signIns' ? options.signIns : options.content);
    });
    if (!wanted.length) return [];

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
      options.storeIp && shouldResolveGeoData(settings)
        ? strapi.plugin('magic-sessionmanager').service('geolocation')
        : null;
    /** @type {Map<string, object|null>} */
    const geoCache = new Map();
    let geoBudget = GEO_LOOKUPS_PER_FLUSH;

    /** @type {Map<string, string|null>} */
    const knownTitles = new Map();
    for (const entry of wanted) {
      const title =
        entry.entryData && entry.targetType && entry.targetId
          ? pickEntryTitle(entry.entryData, await mainFieldOf(entry.targetType))
          : null;
      if (title) knownTitles.set(`${entry.targetType}|${toId(entry.targetId)}`, title);
    }

    const rows = [];
    for (const entry of wanted) {
      const ip = options.storeIp ? normalizeIp(entry.ip) : null;
      const storedIp = ip && options.anonymizeIp ? anonymizeIp(ip) : ip;
      let geo = null;
      if (storedIp && geoService) {
        if (geoCache.has(storedIp)) {
          geo = geoCache.get(storedIp) || null;
        } else if (geoBudget > 0) {
          geoBudget -= 1;
          try {
            const info = await geoService.getIpInfo(storedIp);
            geo =
              info && info._status === 'ok'
                ? {
                    country: info.country || null,
                    country_code: info.country_code || null,
                    city: info.city || null,
                  }
                : null;
          } catch {
            geo = null;
          }
          geoCache.set(storedIp, geo);
        }
      }
      let targetId = toId(entry.targetId);
      let actorId = toId(entry.actorId);
      if (!targetId && typeof entry.attemptedEmail === 'string') {
        const found = byEmail.get(entry.attemptedEmail.toLowerCase());
        targetId = found ? String(found) : null;
        if (entry.actorFromEmail && !actorId) actorId = targetId;
      }
      const meta = { ...(entry.meta || {}) };
      const deviceHash = entry.deviceHash || hashDeviceId(entry.deviceId);
      if (deviceHash) meta.deviceHash = deviceHash;
      if (storedIp && options.anonymizeIp) meta.ipAnonymized = true;
      if (entry.entryData && entry.targetType) {
        const title = pickEntryTitle(entry.entryData, await mainFieldOf(entry.targetType));
        if (title) meta.title = title;
      }
      // A delete answers without the entry: keep the name it had in the log.
      if (!meta.title && entry.event.startsWith('admin.content.') && entry.targetType) {
        const id = toId(entry.targetId);
        if (id) {
          const key = `${entry.targetType}|${id}`;
          if (!knownTitles.has(key)) knownTitles.set(key, await titleFromLog(entry.targetType, id));
          const known = knownTitles.get(key);
          if (known) meta.title = known;
        }
      }
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
            ? entry.userAgent.slice(0, 500)
            : null,
        geo,
        meta: boundMeta(meta),
        createdAt: occurredAt,
        updatedAt: occurredAt,
      });
    }
    return rows;
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
      let settings;
      try {
        settings = await getPluginSettings(strapi);
      } catch {
        return;
      }
      try {
        const rows = await buildRows(batch, resolveSecurityLogSettings(settings), settings);
        for (let i = 0; i < rows.length; i += FLUSH_BATCH) {
          await events().createMany({ data: rows.slice(i, i + FLUSH_BATCH) });
        }
      } catch (err) {
        log.warn('[security-log] Events could not be written:', err?.name || 'Error');
      }
    }
    if (dropped > 0) {
      log.warn(`[security-log] ${dropped} queued events were dropped (queue full)`);
      dropped = 0;
    }
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
      queue.push({ ...input, occurredAt: input.occurredAt || new Date(now) });
      if (queue.length > MAX_QUEUE) {
        dropped += queue.length - MAX_QUEUE;
        queue = queue.slice(queue.length - MAX_QUEUE);
      }
      schedule();
      return true;
    },

    /**
     * Queues one Content Manager action of an admin as
     * `admin.content.<action>` with the entry as target (`targetType` = content
     * type uid, `targetId` = document id). Opening the same entry (same
     * admin, type, document and locale) again within 10 minutes, or right
     * after writing it, is not a new "view".
     *
     * @param {{adminUserId: number|string, action: string, kind: 'collection'|'single',
     *   contentType: string, documentId: string|null, locale: string|null,
     *   count: number|null, data?: any}} input Action.
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
        entryData: input.data || null,
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
     * @returns {Promise<{data: object[], meta: object}>} Response body.
     */
    async listSignIns(query) {
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
        data: await shapeSignIns(Array.isArray(rows) ? rows : []),
        meta: {
          pagination: paginationOf(query, total),
          recording: await recordingFlags(),
        },
      };
    },

    /**
     * One page of Content Manager activity, newest first.
     *
     * @param {{adminId?: number, action?: string, contentType?: string, from?: Date|null,
     *   to?: Date|null, page: number, pageSize: number}} query Parsed filters.
     * @returns {Promise<{data: object[], meta: object}>} Response body.
     */
    async listContentActivity(query) {
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
        data: await shapeActivity(Array.isArray(rows) ? rows : []),
        meta: {
          pagination: paginationOf(query, total),
          recording: await recordingFlags(),
          contentTypes: listContentTypes(),
          ...(query.adminId
            ? { contentManagerAccess: await service.hasContentManagerAccess(query.adminId) }
            : {}),
        },
      };
    },

    /**
     * One export batch (newest first, keyset on id) of either list.
     *
     * @param {'sign-ins'|'content'} kind List.
     * @param {any} query Parsed filters (as for the list).
     * @param {number|null} cursor Id below which to continue.
     * @returns {Promise<{data: object[], meta: {nextCursor: string|null}}>} Batch.
     */
    async exportBatch(kind, query, cursor) {
      const base = kind === 'sign-ins' ? signInWhere(query) : activityWhere(query);
      const where = cursor ? { $and: [base, { id: { $lt: cursor } }] } : base;
      const rows = await events().findMany({
        where,
        orderBy: [{ id: 'desc' }],
        limit: EXPORT_BATCH,
      });
      const list = Array.isArray(rows) ? rows : [];
      const data = kind === 'sign-ins' ? await shapeSignIns(list) : await shapeActivity(list);
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
     * @param {{now?: Date}} [options] Clock for tests.
     * @returns {Promise<{expired: number, orphans: number}>} Deleted rows.
     * @sideeffect Deletes and updates rows of the security event table.
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
                event: { $ne: SECURITY_EVENTS.ADMIN_SESSION_REVOKED },
              },
            ],
          },
        });
        orphans = Number(removed?.count || 0);
        await events().updateMany({
          where: {
            event: SECURITY_EVENTS.ADMIN_SESSION_REVOKED,
            actorType: 'admin',
            actorId: { $notNull: true, $notIn: existing },
          },
          data: { actorId: null },
        });
      }
      return { expired, orphans };
    },

    /**
     * Deletes what was recorded about an admin whose account was deleted:
     * events they did and events about their account. Where they signed
     * someone else out, the actor reference is cleared and the target keeps
     * the event.
     *
     * @param {number} adminId Deleted admin id.
     * @returns {Promise<void>}
     * @sideeffect Deletes and updates rows of the security event table.
     */
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
              event: { $ne: SECURITY_EVENTS.ADMIN_SESSION_REVOKED },
            },
          ],
        },
      });
      await events().updateMany({
        where: { event: SECURITY_EVENTS.ADMIN_SESSION_REVOKED, actorType: 'admin', actorId: key },
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
   * Current recording switches, for the UI.
   *
   * @returns {Promise<{signIns: boolean, contentActivity: boolean, ipAddresses: boolean,
   *   anonymizeIp: boolean, retentionDays: number}>} Flags.
   */
  async function recordingFlags() {
    let settings;
    try {
      settings = await getPluginSettings(strapi);
    } catch {
      settings = {};
    }
    const options = resolveSecurityLogSettings(settings);
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
   * hash, no raw user agent).
   *
   * @param {Array<Record<string, any>>} rows Stored rows.
   * @returns {Promise<object[]>} DTOs.
   */
  async function shapeSignIns(rows) {
    const admins = await loadAdmins(rows.flatMap((row) => [row.targetId, row.actorId]));
    const states = await sessionStates(rows);
    return rows.map((row) => {
      const meta = toObject(row.meta);
      const admin = row.targetType === 'admin' ? admins.get(Number(row.targetId)) : undefined;
      const revoked = row.event === SECURITY_EVENTS.ADMIN_SESSION_REVOKED;
      const actor = revoked ? admins.get(Number(row.actorId)) : undefined;
      const described = describeUserAgent(row.userAgent || null);
      const state = states.get(Number(row.id));
      return {
        id: Number(row.id),
        event: row.event,
        reason: safeReason(meta.reason),
        provider: safeReason(meta.provider),
        scope: revoked ? safeReason(meta.scope) : null,
        at: toIso(row.createdAt),
        ipAddress: row.ip || null,
        ipAnonymized: meta.ipAnonymized === true,
        location: toLocation(row.geo),
        browser: described.browserName,
        os: described.osName,
        deviceType: described.deviceType,
        admin: admin ? { id: Number(admin.id), name: adminName(admin) } : null,
        actor: actor ? { id: Number(actor.id), name: adminName(actor) } : null,
        session:
          row.event === SECURITY_EVENTS.ADMIN_SIGN_IN && state
            ? { state: state.state, endedAt: toIso(state.endedAt) }
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
   * Response rows of the activity list.
   *
   * @param {Array<Record<string, any>>} rows Stored rows.
   * @returns {Promise<object[]>} DTOs.
   */
  async function shapeActivity(rows) {
    const admins = await loadAdmins(rows.map((row) => row.actorId));
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
          title: typeof meta.title === 'string' ? meta.title : null,
          count: typeof meta.count === 'number' ? meta.count : null,
        },
        admin: admin ? { id: Number(admin.id), name: adminName(admin) } : null,
      };
    });
  }

  return service;
};

module.exports.EVENT_UID = EVENT_UID;
module.exports.VIEW_DEDUP_MS = VIEW_DEDUP_MS;
