'use strict';

// @ts-check

/**
 * Pure helpers of the app-user security activity view (4.22): which stored
 * events belong to it, the filter groups, the read-time privacy rules and the
 * event facts a response may carry. No Strapi access, so every rule is
 * unit-tested directly; the queries and the identity checks live in
 * services/security-log.js.
 *
 * The view lists events about Users & Permissions accounts that 4.17 to 4.20
 * write to the general security log: failed and refused sign-ins, lockouts
 * and their lifting, session limits, the sign-out after a password change,
 * new devices, impossible travel, "This wasn't me", the personal data export
 * and impersonations of app users. Admin events (sign-ins, Content Manager
 * activity, settings changes, previews of admins) never appear in it.
 * Webhook deliveries are not written to the security log, so there is
 * nothing to list for them.
 */

const { REFUSAL_REASONS, SECURITY_EVENTS, toObject } = require('./security-log-model');

/** App-user events (`targetType` is `user`, or `ip` for a lifted IP lock). */
const USER_ACCOUNT_EVENTS = Object.freeze([
  SECURITY_EVENTS.USER_SIGN_IN_FAILED,
  SECURITY_EVENTS.USER_SIGN_IN_REFUSED,
  SECURITY_EVENTS.USER_LOCKOUT,
  SECURITY_EVENTS.USER_LOCKOUT_LIFTED,
  SECURITY_EVENTS.USER_SESSION_LIMIT,
  SECURITY_EVENTS.USER_PASSWORD_CHANGE_ENDED,
  SECURITY_EVENTS.USER_NEW_DEVICE,
  SECURITY_EVENTS.USER_IMPOSSIBLE_TRAVEL,
  SECURITY_EVENTS.USER_NOT_ME,
  SECURITY_EVENTS.USER_DATA_EXPORTED,
]);

/** Impersonation events; only those whose target is an app user belong to the view. */
const USER_IMPERSONATION_EVENTS = Object.freeze([
  SECURITY_EVENTS.IMPERSONATION_STARTED,
  SECURITY_EVENTS.IMPERSONATION_ENDED,
  SECURITY_EVENTS.IMPERSONATION_EXPIRED,
  SECURITY_EVENTS.IMPERSONATION_REFUSED,
]);

/** Every event of the view. */
const USER_ACTIVITY_EVENTS = Object.freeze([...USER_ACCOUNT_EVENTS, ...USER_IMPERSONATION_EVENTS]);

/**
 * Filter groups of the view (API values of `event`), in the order of the
 * filter menu. Each answers one question an admin asks about app users.
 */
const USER_ACTIVITY_FILTERS = Object.freeze({
  all: USER_ACTIVITY_EVENTS,
  failed: Object.freeze([
    SECURITY_EVENTS.USER_SIGN_IN_FAILED,
    SECURITY_EVENTS.USER_SIGN_IN_REFUSED,
  ]),
  lockouts: Object.freeze([SECURITY_EVENTS.USER_LOCKOUT, SECURITY_EVENTS.USER_LOCKOUT_LIFTED]),
  suspicious: Object.freeze([
    SECURITY_EVENTS.USER_NEW_DEVICE,
    SECURITY_EVENTS.USER_IMPOSSIBLE_TRAVEL,
    SECURITY_EVENTS.USER_NOT_ME,
  ]),
  sessions: Object.freeze([
    SECURITY_EVENTS.USER_SESSION_LIMIT,
    SECURITY_EVENTS.USER_PASSWORD_CHANGE_ENDED,
  ]),
  privacy: Object.freeze([SECURITY_EVENTS.USER_DATA_EXPORTED]),
  impersonation: USER_IMPERSONATION_EVENTS,
});

/** Users & Permissions documentId as stored in `targetId`. */
const USER_DOCUMENT_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/;

/**
 * Query Engine filter of the view: the events of a filter group, only
 * impersonations of app users, optionally one user and a period, and never
 * older than the retention period (rows the next retention run will delete
 * are not shown any more).
 *
 * @param {{event?: string, userId?: string, from?: Date|null, to?: Date|null}} query Parsed
 *   filters.
 * @param {{retentionDays: number, now?: Date}} options Retention and clock.
 * @returns {object} `where`.
 */
function userActivityWhere(query, { retentionDays, now = new Date() }) {
  const group =
    /** @type {Record<string, readonly string[]>} */ (USER_ACTIVITY_FILTERS)[
      query.event || 'all'
    ] || USER_ACTIVITY_FILTERS.all;
  const account = group.filter((event) => USER_ACCOUNT_EVENTS.includes(event));
  const impersonation = group.filter((event) => USER_IMPERSONATION_EVENTS.includes(event));
  /** @type {any[]} */
  const kinds = [];
  if (account.length) kinds.push({ event: { $in: account } });
  if (impersonation.length) kinds.push({ event: { $in: impersonation }, targetType: 'user' });
  /** @type {any[]} */
  const conditions = [kinds.length === 1 ? kinds[0] : { $or: kinds }];
  if (query.userId) conditions.push({ targetType: 'user', targetId: String(query.userId) });
  const days = Number.isInteger(retentionDays) && retentionDays > 0 ? retentionDays : 90;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const from = query.from && query.from > cutoff ? query.from : cutoff;
  conditions.push({ createdAt: { $gte: from } });
  if (query.to) conditions.push({ createdAt: { $lte: query.to } });
  return { $and: conditions };
}

/**
 * @param {unknown} value Candidate.
 * @param {number} max Largest accepted value.
 * @returns {number|null} A non-negative integer up to `max`, or null.
 */
const count = (value, max = 1_000_000) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : null;

/**
 * @param {unknown} value Candidate.
 * @param {readonly string[]} allowed Allowed values.
 * @returns {string|null} The value when allowed.
 */
const oneOf = (value, allowed) =>
  typeof value === 'string' && allowed.includes(value) ? value : null;

/**
 * @param {unknown} value Candidate.
 * @returns {string|null} An ISO 3166-1 alpha-2 country code.
 */
const countryCode = (value) =>
  typeof value === 'string' && /^[A-Z]{2}$/.test(value) ? value : null;

/**
 * @param {unknown} value Candidate.
 * @returns {string|null} A short code (`call-credentials`, `already-active`, ...).
 */
const code = (value) =>
  typeof value === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(value) ? value : null;

/**
 * The facts of one event a response may carry, from its stored `meta`:
 * numbers and codes only, each checked against its expected shape. Free
 * text is never returned, except the reason an admin gave for an
 * impersonation, and only to readers who may impersonate app users
 * themselves (`canSeeImpersonationReason`). No typed identifier, token,
 * device hash or socket address is ever part of it.
 *
 * @param {string} event Event name.
 * @param {unknown} storedMeta Stored meta.
 * @param {{canSeeImpersonationReason?: boolean}} [viewer] Reader.
 * @returns {Record<string, string|number|boolean|null>} Facts.
 */
function userEventFacts(event, storedMeta, viewer = {}) {
  const meta = toObject(storedMeta);
  switch (event) {
    case SECURITY_EVENTS.USER_SIGN_IN_FAILED:
      return { status: count(meta.status, 599), unknownAccount: meta.unknownAccount === true };
    case SECURITY_EVENTS.USER_SIGN_IN_REFUSED:
      return {
        reason: oneOf(meta.reason, REFUSAL_REASONS),
        limit: count(meta.limit, 10000),
        lock: oneOf(meta.lock, ['ip', 'account']),
        unknownAccount: meta.unknownAccount === true,
      };
    case SECURITY_EVENTS.USER_LOCKOUT:
      return {
        kind: oneOf(meta.kind, ['ip', 'account']),
        failures: count(meta.failures, 100000),
        minutes: count(meta.minutes, 1_000_000),
      };
    case SECURITY_EVENTS.USER_LOCKOUT_LIFTED:
      return { kind: oneOf(meta.kind, ['ip', 'account']) };
    case SECURITY_EVENTS.USER_SESSION_LIMIT:
      return { ended: count(meta.ended, 100000), limit: count(meta.limit, 10000) };
    case SECURITY_EVENTS.USER_PASSWORD_CHANGE_ENDED:
      return { ended: count(meta.ended, 100000) };
    case SECURITY_EVENTS.USER_IMPOSSIBLE_TRAVEL:
      return {
        distanceKm: count(meta.distanceKm, 50000),
        speedKmh: count(meta.speedKmh, 10_000_000),
        from: countryCode(meta.from),
        to: countryCode(meta.to),
        action: oneOf(meta.action, ['alert', 'reauthenticate']),
      };
    case SECURITY_EVENTS.USER_NOT_ME:
      return { scope: oneOf(meta.scope, ['session', 'all']), ended: count(meta.ended, 100000) };
    case SECURITY_EVENTS.USER_DATA_EXPORTED:
      return { sessions: count(meta.sessions, 1_000_000), events: count(meta.events, 1_000_000) };
    case SECURITY_EVENTS.IMPERSONATION_STARTED:
    case SECURITY_EVENTS.IMPERSONATION_ENDED:
    case SECURITY_EVENTS.IMPERSONATION_EXPIRED:
    case SECURITY_EVENTS.IMPERSONATION_REFUSED: {
      const reason =
        viewer.canSeeImpersonationReason === true &&
        typeof meta.reason === 'string' &&
        meta.reason.trim()
          ? meta.reason.trim().slice(0, 255)
          : null;
      return {
        durationMinutes: count(meta.durationMinutes, 1440),
        handoff: oneOf(meta.handoff, ['frontend', 'token']),
        endReason: oneOf(meta.endReason, ['ended', 'disabled', 'failed', 'revoked']),
        refusal: code(meta.refusal),
        reason,
      };
    }
    default:
      return {};
  }
}

/**
 * IP address and location of an event as the settings allow them now: no
 * address and no location while "Store IP addresses" is off, and the
 * shortened form while "Anonymise IP addresses" is on, also for rows stored
 * before the switch was turned on.
 *
 * @param {{ip?: unknown, geo?: unknown, meta?: unknown}} row Stored row.
 * @param {{storeIp: boolean, anonymizeIp: boolean}} options Security log settings.
 * @param {(ip: string) => string|null} anonymize Anonymiser (/24, /48).
 * @returns {{ipAddress: string|null, ipAnonymized: boolean, keepLocation: boolean}} Address.
 */
function userEventAddress(row, options, anonymize) {
  if (!options.storeIp) return { ipAddress: null, ipAnonymized: false, keepLocation: false };
  const stored = typeof row.ip === 'string' && row.ip ? row.ip : null;
  const alreadyShortened = toObject(row.meta).ipAnonymized === true;
  if (!stored) return { ipAddress: null, ipAnonymized: false, keepLocation: true };
  if (options.anonymizeIp && !alreadyShortened) {
    const shortened = anonymize(stored);
    return { ipAddress: shortened || null, ipAnonymized: Boolean(shortened), keepLocation: true };
  }
  return { ipAddress: stored, ipAnonymized: alreadyShortened, keepLocation: true };
}

module.exports = {
  USER_ACCOUNT_EVENTS,
  USER_ACTIVITY_EVENTS,
  USER_ACTIVITY_FILTERS,
  USER_DOCUMENT_ID_PATTERN,
  USER_IMPERSONATION_EVENTS,
  userActivityWhere,
  userEventAddress,
  userEventFacts,
};
