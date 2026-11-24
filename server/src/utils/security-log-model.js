'use strict';

// @ts-check

/**
 * Pure helpers of the security event log: the event registry, which admin
 * route means which event, bounded `meta`, the session state of a sign-in and
 * the response shapes. No Strapi access here, so every rule is unit-tested
 * directly.
 *
 * One row = one event: who acted (`actorType`/`actorId`), on what
 * (`targetType`/`targetId`), from where (`ip`, `userAgent`, `geo`) and a small
 * `meta` object. Event names are plain strings from the registry below, so a
 * new event (failed app-user sign-in, new device, impossible travel) needs no
 * schema change.
 */

/** Event registry. Add new events here; the stored column is a string. */
const SECURITY_EVENTS = Object.freeze({
  ADMIN_SIGN_IN: 'admin.sign-in',
  ADMIN_SIGN_IN_FAILED: 'admin.sign-in.failed',
  ADMIN_LOCKOUT: 'admin.lockout',
  ADMIN_SIGN_OUT: 'admin.sign-out',
  ADMIN_SESSION_REVOKED: 'admin.session.revoked',
  ADMIN_CONTENT_VIEW: 'admin.content.view',
  ADMIN_CONTENT_CREATE: 'admin.content.create',
  ADMIN_CONTENT_UPDATE: 'admin.content.update',
  ADMIN_CONTENT_PUBLISH: 'admin.content.publish',
  ADMIN_CONTENT_UNPUBLISH: 'admin.content.unpublish',
  ADMIN_CONTENT_DISCARD: 'admin.content.discard',
  ADMIN_CONTENT_DELETE: 'admin.content.delete',
  ADMIN_CONTENT_CLONE: 'admin.content.clone',
});

/** Shape every stored event name must have (registry and future events). */
const EVENT_NAME_PATTERN = /^[a-z][a-z0-9-]{0,30}(\.[a-z][a-z0-9-]{0,30}){1,3}$/;

/** Actor types. */
const ACTOR_TYPES = Object.freeze(['admin', 'user', 'system']);

/** Sign-in history events of an admin account (the account is the target). */
const ADMIN_SIGN_IN_EVENTS = Object.freeze([
  SECURITY_EVENTS.ADMIN_SIGN_IN,
  SECURITY_EVENTS.ADMIN_SIGN_IN_FAILED,
  SECURITY_EVENTS.ADMIN_LOCKOUT,
  SECURITY_EVENTS.ADMIN_SIGN_OUT,
  SECURITY_EVENTS.ADMIN_SESSION_REVOKED,
]);

/** Filter groups of the sign-in history (API values). */
const SIGN_IN_FILTERS = Object.freeze({
  all: ADMIN_SIGN_IN_EVENTS,
  succeeded: [SECURITY_EVENTS.ADMIN_SIGN_IN],
  failed: [SECURITY_EVENTS.ADMIN_SIGN_IN_FAILED, SECURITY_EVENTS.ADMIN_LOCKOUT],
  'signed-out': [SECURITY_EVENTS.ADMIN_SIGN_OUT, SECURITY_EVENTS.ADMIN_SESSION_REVOKED],
});

/** Content Manager actions (API values); the event is `admin.content.<action>`. */
const CONTENT_ACTIONS = Object.freeze([
  'view',
  'create',
  'update',
  'publish',
  'unpublish',
  'discard',
  'delete',
  'clone',
]);

/** @param {string} action Content action. @returns {string} Event name. */
const contentEvent = (action) => `admin.content.${action}`;

/** Content Manager events. */
const ADMIN_CONTENT_EVENTS = Object.freeze(CONTENT_ACTIONS.map(contentEvent));

/**
 * Which recording switch governs an event: `signIns` (admin sign-in
 * history), `content` (Content Manager activity) or `always` (events of later
 * features, which bring their own switch).
 *
 * @param {string} event Event name.
 * @returns {'signIns'|'content'|'always'} Switch.
 */
function recordingSwitchOf(event) {
  if (ADMIN_SIGN_IN_EVENTS.includes(event)) return 'signIns';
  if (event.startsWith('admin.content.')) return 'content';
  return 'always';
}

/**
 * Content Manager admin routes (`@strapi/content-manager` 5.63
 * `dist/server/routes/admin.js`) and the action each successful call means.
 * List views (`find`), counts, relations and configuration are not activity.
 */
const CONTENT_MANAGER_HANDLERS = Object.freeze({
  'collection-types.findOne': { action: 'view', kind: 'collection' },
  'collection-types.create': { action: 'create', kind: 'collection' },
  'collection-types.update': { action: 'update', kind: 'collection' },
  'collection-types.clone': { action: 'clone', kind: 'collection' },
  'collection-types.autoClone': { action: 'clone', kind: 'collection' },
  'collection-types.publish': { action: 'publish', kind: 'collection' },
  'collection-types.unpublish': { action: 'unpublish', kind: 'collection' },
  'collection-types.discard': { action: 'discard', kind: 'collection' },
  'collection-types.delete': { action: 'delete', kind: 'collection' },
  'collection-types.bulkDelete': { action: 'delete', kind: 'collection', bulk: true },
  'collection-types.bulkPublish': { action: 'publish', kind: 'collection', bulk: true },
  'collection-types.bulkUnpublish': { action: 'unpublish', kind: 'collection', bulk: true },
  'single-types.find': { action: 'view', kind: 'single' },
  'single-types.createOrUpdate': { action: 'update', kind: 'single' },
  'single-types.delete': { action: 'delete', kind: 'single' },
  'single-types.publish': { action: 'publish', kind: 'single' },
  'single-types.unpublish': { action: 'unpublish', kind: 'single' },
  'single-types.discard': { action: 'discard', kind: 'single' },
});

const UID_PATTERN = /^(api|plugin)::[a-z0-9-]{1,80}\.[a-z0-9-]{1,80}$/;
const LOCALE_PATTERN = /^[A-Za-z0-9-]{1,20}$/;
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/;

/** Largest stored `meta`, as JSON text. */
const MAX_META_BYTES = 2048;
/** Most keys in `meta`. */
const MAX_META_KEYS = 16;

/**
 * Bounds an event's `meta`: at most 16 keys with simple names, scalar values
 * only (strings cut to 255 characters), at most 2 KB as JSON. Anything else
 * is dropped, so a caller cannot store a request body or a nested object.
 *
 * @param {unknown} meta Candidate.
 * @returns {Record<string, string|number|boolean|null>|null} Bounded meta, or null when empty.
 */
function boundMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  /** @type {Record<string, string|number|boolean|null>} */
  const out = {};
  let keys = 0;
  for (const [key, value] of Object.entries(meta)) {
    if (keys >= MAX_META_KEYS) break;
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(key)) continue;
    if (value === null || typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'string') out[key] = value.slice(0, 255);
    else continue;
    keys += 1;
  }
  if (!keys) return null;
  while (JSON.stringify(out).length > MAX_META_BYTES) {
    const longest = Object.keys(out).reduce((a, b) =>
      String(out[a] ?? '').length >= String(out[b] ?? '').length ? a : b
    );
    delete out[longest];
  }
  return Object.keys(out).length ? out : null;
}

/**
 * `controller.action` of a route, without a `plugin::`/`admin::` prefix.
 *
 * @param {unknown} handler Route handler (string for named handlers).
 * @returns {string|null} Handler name or null.
 */
function handlerName(handler) {
  if (typeof handler !== 'string') return null;
  const parts = handler.split('.');
  if (parts.length < 2) return null;
  const tail = parts.slice(-2).join('.');
  return tail.includes('::') ? tail.split('::').pop() || null : tail;
}

/**
 * @param {unknown} value Candidate.
 * @param {RegExp} pattern Allowed shape.
 * @returns {string|null} The value when it is a string of that shape.
 */
function shaped(value, pattern) {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

/**
 * Describes a successful Content Manager request as an activity entry, or
 * null when the request is not activity (list view, count, configuration,
 * failure, unknown model).
 *
 * @param {{status: number, route: any, params?: any, query?: any, requestBody?: any,
 *   responseBody?: any}} request Request facts after the handler ran.
 * @returns {null|{action: string, kind: 'collection'|'single', contentType: string,
 *   documentId: string|null, locale: string|null, count: number|null, data: any}} Entry.
 */
function describeContentManagerRequest({
  status,
  route,
  params,
  query,
  requestBody,
  responseBody,
}) {
  if (!(status >= 200 && status < 300)) return null;
  if (route?.info?.pluginName !== 'content-manager') return null;
  const name = handlerName(route.handler);
  const mapping = name ? /** @type {any} */ (CONTENT_MANAGER_HANDLERS)[name] : null;
  if (!mapping) return null;
  const contentType = shaped(params?.model, UID_PATTERN);
  if (!contentType) return null;
  const data =
    responseBody && typeof responseBody === 'object' && !Array.isArray(responseBody)
      ? responseBody.data
      : null;
  const single = data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  let count = null;
  if (mapping.bulk) {
    const ids = requestBody?.documentIds;
    count = Array.isArray(ids) ? Math.min(ids.length, 100000) : null;
    if (typeof responseBody?.data?.count === 'number') count = responseBody.data.count;
  }
  const documentId = mapping.bulk
    ? null
    : shaped(params?.id, DOCUMENT_ID_PATTERN) || shaped(single?.documentId, DOCUMENT_ID_PATTERN);
  const locale = shaped(query?.locale, LOCALE_PATTERN) || shaped(single?.locale, LOCALE_PATTERN);
  return {
    action: mapping.action,
    kind: mapping.kind,
    contentType,
    documentId,
    locale,
    count,
    data: mapping.bulk ? null : single,
  };
}

/**
 * Cuts a display title out of an entry: the Content Manager main field when
 * it holds text or a number, else nothing (the UI then shows the document id).
 *
 * @param {any} data Entry as the Content Manager returned it.
 * @param {string|null|undefined} mainField Main field from the CM configuration.
 * @returns {string|null} Title of at most 255 characters.
 */
function pickEntryTitle(data, mainField) {
  if (!data || typeof data !== 'object' || !mainField || mainField === 'id') return null;
  const value = data[mainField];
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 255) : null;
}

/**
 * Reason or provider code reduced to a safe token (`invalid_credentials`,
 * `account_inactive`, `login_not_allowed`, `local`, ...).
 *
 * @param {unknown} reason Raw value.
 * @returns {string|null} Token or null.
 */
function safeReason(reason) {
  return typeof reason === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(reason) ? reason : null;
}

/**
 * Session state of each sign-in on a page of history.
 *
 * - `active`: Strapi still has a live session for that browser and no later
 *   sign-in of the same browser replaced it.
 * - `signed-out`: a sign-out (own, or by another admin) of that browser or of
 *   every browser followed the sign-in; `endedAt` and `endedBy` say when and
 *   who.
 * - `ended`: none of the above (expired, ended by a password reset, or the
 *   browser signed in again).
 * - `unknown`: the sign-in has no browser id (an SSO provider sets it
 *   server-side), so it cannot be matched.
 *
 * @param {Array<{id: number, adminId: string, deviceHash: string|null, at: string}>} signIns
 *   Sign-ins of the page.
 * @param {Array<{adminId: string, event: string, deviceHash: string|null, at: string,
 *   actorId: string|null}>} laterEvents Sign-ins and sign-outs of the same admins at or after
 *   the oldest sign-in, any order.
 * @param {Map<string, Set<string>>} liveDevices Hashes of live session devices per admin id.
 * @returns {Map<number, {state: 'active'|'signed-out'|'ended'|'unknown', endedAt: string|null,
 *   endedBy: string|null}>} State per sign-in id.
 */
function deriveSessionStates(signIns, laterEvents, liveDevices) {
  const sorted = [...laterEvents].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  /** @type {Map<number, {state: 'active'|'signed-out'|'ended'|'unknown', endedAt: string|null, endedBy: string|null}>} */
  const out = new Map();
  for (const row of signIns) {
    if (!row.deviceHash) {
      out.set(row.id, { state: 'unknown', endedAt: null, endedBy: null });
      continue;
    }
    /** @type {{state: 'active'|'signed-out'|'ended'|'unknown', endedAt: string|null, endedBy: string|null}|null} */
    let result = null;
    for (const event of sorted) {
      if (event.adminId !== row.adminId || String(event.at) <= String(row.at)) continue;
      const sameDevice = event.deviceHash === row.deviceHash;
      if (event.event === SECURITY_EVENTS.ADMIN_SIGN_IN && sameDevice) {
        result = { state: 'ended', endedAt: null, endedBy: null };
        break;
      }
      const isEnd =
        event.event === SECURITY_EVENTS.ADMIN_SIGN_OUT ||
        event.event === SECURITY_EVENTS.ADMIN_SESSION_REVOKED;
      if (isEnd && (sameDevice || !event.deviceHash)) {
        result = {
          state: 'signed-out',
          endedAt: event.at,
          endedBy: event.event === SECURITY_EVENTS.ADMIN_SESSION_REVOKED ? event.actorId : null,
        };
        break;
      }
    }
    if (!result) {
      const live = liveDevices.get(row.adminId);
      result =
        live && live.has(row.deviceHash)
          ? { state: 'active', endedAt: null, endedBy: null }
          : { state: 'ended', endedAt: null, endedBy: null };
    }
    out.set(row.id, result);
  }
  return out;
}

/**
 * Location stored with an event, reduced to the fields the UI shows.
 *
 * @param {unknown} value Stored JSON.
 * @returns {{country: string|null, countryCode: string|null, city: string|null}|null} Location.
 */
function toLocation(value) {
  let geo = value;
  if (typeof geo === 'string') {
    try {
      geo = JSON.parse(geo);
    } catch {
      return null;
    }
  }
  if (!geo || typeof geo !== 'object') return null;
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null);
  const record = /** @type {Record<string, unknown>} */ (geo);
  const location = {
    country: text(record.country),
    countryCode: text(record.countryCode ?? record.country_code),
    city: text(record.city),
  };
  return location.country || location.city ? location : null;
}

/**
 * Converts a stored date to ISO 8601.
 *
 * @param {unknown} value Date or string.
 * @returns {string|null} ISO date or null.
 */
function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Parses a stored JSON column (SQLite returns text on some drivers).
 *
 * @param {unknown} value Stored value.
 * @returns {Record<string, any>} Object, or an empty object.
 */
function toObject(value) {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {};
    }
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

module.exports = {
  ACTOR_TYPES,
  ADMIN_CONTENT_EVENTS,
  ADMIN_SIGN_IN_EVENTS,
  CONTENT_ACTIONS,
  CONTENT_MANAGER_HANDLERS,
  EVENT_NAME_PATTERN,
  MAX_META_BYTES,
  SECURITY_EVENTS,
  SIGN_IN_FILTERS,
  boundMeta,
  contentEvent,
  deriveSessionStates,
  describeContentManagerRequest,
  handlerName,
  pickEntryTitle,
  recordingSwitchOf,
  safeReason,
  toIso,
  toLocation,
  toObject,
};
