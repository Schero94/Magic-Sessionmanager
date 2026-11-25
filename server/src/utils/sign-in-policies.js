'use strict';

// @ts-check

/**
 * Request-level helpers of the sign-in and session policies (4.17): read the
 * typed account identifier, find the account and its role, enforce the
 * concurrent session limit, and write app-user security events. The
 * middlewares in `bootstrap.js` call these; nothing here touches the
 * response.
 */

const { anonymizeIp, normalizeIp } = require('./admin-request-info');
const { getCoordinator, hashedKey } = require('./coordination');
const { resolveSecurityLogSettings } = require('./security-log-settings');
const { hasRoleOverride, inactivityTimeoutFor, sessionLimitFor } = require('./policy-settings');
const { normalizeIdentifier } = require('./login-lockout');

const USER_UID = 'plugin::users-permissions.user';
const SESSION_UID = 'plugin::magic-sessionmanager.session';
/** Most active sessions read when checking the limit. */
const MAX_SESSIONS_CHECKED = 500;

/**
 * The account identifier a sign-in request names: `identifier` (Users &
 * Permissions `/auth/local`) or `email` (Magic Link OTP/TOTP routes).
 *
 * @param {any} ctx Koa context (body already parsed by `strapi::body`).
 * @returns {string|null} Normalised identifier.
 */
function readSignInIdentifier(ctx) {
  const body = ctx?.request?.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return normalizeIdentifier(body.identifier) || normalizeIdentifier(body.email);
}

/**
 * Finds the Users & Permissions account for a typed identifier, the way
 * `/auth/local` matches it (email lower-cased, or username).
 *
 * @param {any} strapi Strapi instance.
 * @param {string|null} identifier Normalised identifier.
 * @returns {Promise<{documentId: string, email: string|null, username: string|null,
 *   role: string|null}|null>} Account, or null when none matches.
 */
async function findAccountByIdentifier(strapi, identifier) {
  if (!identifier) return null;
  const rows = await strapi.db.query(USER_UID).findMany({
    where: { $or: [{ email: identifier }, { username: identifier }] },
    select: ['documentId', 'email', 'username'],
    populate: { role: { select: ['documentId'] } },
    limit: 2,
  });
  const list = Array.isArray(rows) ? rows : [];
  // A username that equals another account's email is ambiguous: prefer the
  // email match, as Users & Permissions does for the password check.
  const account =
    list.find((row) => String(row.email || '').toLowerCase() === identifier) || list[0];
  if (!account?.documentId) return null;
  return {
    documentId: account.documentId,
    email: typeof account.email === 'string' ? account.email : null,
    username: typeof account.username === 'string' ? account.username : null,
    role: account.role?.documentId || null,
  };
}

/**
 * The role documentId of a user.
 *
 * @param {any} strapi Strapi instance.
 * @param {string} userDocumentId User documentId.
 * @returns {Promise<string|null>} Role documentId.
 */
async function findUserRole(strapi, userDocumentId) {
  if (!userDocumentId) return null;
  const user = await strapi.db.query(USER_UID).findOne({
    where: { documentId: userDocumentId },
    select: ['id'],
    populate: { role: { select: ['documentId'] } },
  });
  return user?.role?.documentId || null;
}

/**
 * The IP to show in the "Locked now" list, following the log's IP options
 * (not stored, or with the last part removed).
 *
 * @param {Record<string, any>} settings Merged settings.
 * @param {string|null} ip Client IP.
 * @returns {string|null} Display IP.
 */
function displayIp(settings, ip) {
  const options = resolveSecurityLogSettings(settings);
  if (!options.storeIp) return null;
  const normalized = normalizeIp(ip || '');
  if (!normalized) return null;
  return options.anonymizeIp ? anonymizeIp(normalized) : normalized;
}

/**
 * Queues an app-user security event and the matching webhook event (when
 * selected). Never throws.
 *
 * @param {any} strapi Strapi instance.
 * @param {import('../services/security-log').SecurityEventInput} input Event.
 * @returns {boolean} Whether it was queued.
 */
function recordUserEvent(strapi, input) {
  try {
    strapi.plugin('magic-sessionmanager').service('webhooks')?.emitSecurityEvent?.(input);
  } catch {
    // Webhooks never block the sign-in.
  }
  try {
    return strapi.plugin('magic-sessionmanager').service('security-log').record(input) === true;
  } catch {
    return false;
  }
}

/**
 * Whether a session still counts as open: active, used within the
 * inactivity timeout and younger than the maximum age.
 *
 * @param {{isActive?: boolean, lastActive?: any, loginTime?: any}} session Row.
 * @param {number} idleMs Inactivity timeout.
 * @param {number} maxAgeDays Maximum session age.
 * @param {number} now Clock.
 * @returns {boolean} True when the session is open.
 */
function isOpenSession(session, idleMs, maxAgeDays, now) {
  if (session.isActive !== true) return false;
  const login = session.loginTime ? new Date(session.loginTime).getTime() : NaN;
  const last = session.lastActive ? new Date(session.lastActive).getTime() : login;
  if (Number.isFinite(last) && now - last > idleMs) return false;
  if (Number.isFinite(login) && now - login > maxAgeDays * 24 * 60 * 60 * 1000) return false;
  return true;
}

/**
 * Creates a session and applies the concurrent session limit in one
 * cluster-wide critical section per user, so parallel sign-ins on several
 * processes cannot both pass the limit.
 *
 * Policy `end-oldest` ends the oldest open sessions beyond the limit;
 * `refuse` ends the new session instead and reports `refused`.
 *
 * @param {{strapi: any, settings: Record<string, any>, userDocumentId: string,
 *   create: () => Promise<any>, sessionService: any}} params
 * @returns {Promise<{session: any, refused: boolean, ended: number, limit: number}>} Outcome.
 * @throws {Error} When creating or ending sessions fails (the caller fails closed).
 * @sideeffect Creates a session row; may end other sessions of the user.
 */
async function createSessionWithinLimit({
  strapi,
  settings,
  userDocumentId,
  create,
  sessionService,
}) {
  // Without a general limit or a role rule for it, no lookup is needed.
  const possible =
    sessionLimitFor(settings, null).limit > 0 || hasRoleOverride(settings, 'maxSessionsPerUser');
  if (!possible) return { session: await create(), refused: false, ended: 0, limit: 0 };
  const role = await findUserRole(strapi, userDocumentId);
  const { limit, policy } = sessionLimitFor(settings, role);
  if (limit <= 0) return { session: await create(), refused: false, ended: 0, limit: 0 };

  return getCoordinator(strapi).withLock(hashedKey('session-limit', userDocumentId), async () => {
    const session = await create();
    if (!session?.documentId) return { session, refused: false, ended: 0, limit };

    const now = Date.now();
    const idleMs = inactivityTimeoutFor(settings, role);
    const maxAgeDays = Number(settings.maxSessionAgeDays) || 30;
    const rows = await strapi.documents(SESSION_UID).findMany({
      filters: { user: { documentId: userDocumentId }, isActive: true },
      fields: ['documentId', 'isActive', 'loginTime', 'lastActive'],
      sort: [{ loginTime: 'asc' }, { id: 'asc' }],
      limit: MAX_SESSIONS_CHECKED,
    });
    const open = (Array.isArray(rows) ? rows : []).filter((row) =>
      isOpenSession(row, idleMs, maxAgeDays, now)
    );
    if (open.length <= limit) return { session, refused: false, ended: 0, limit };

    if (policy === 'refuse') {
      await sessionService.terminateSession({ sessionId: session.documentId, reason: 'manual' });
      return { session, refused: true, ended: 0, limit };
    }

    const others = open.filter((row) => row.documentId !== session.documentId);
    const excess = open.length - limit;
    let ended = 0;
    for (const row of others.slice(0, excess)) {
      const result = await sessionService.terminateSession({
        sessionId: row.documentId,
        reason: 'manual',
      });
      ended += Number(result?.terminatedCount) || 0;
    }
    return { session, refused: false, ended, limit };
  });
}

/**
 * A per-process filter that lets the same refusal (reason, client, account)
 * through once per window, so a client that keeps trying cannot flood the
 * security log.
 *
 * @param {{windowMs?: number, maxKeys?: number}} [options] Window and bound.
 * @returns {(key: string, now?: number) => boolean} True when the event should be recorded.
 */
function createRefusalDedup({ windowMs = 60 * 1000, maxKeys = 5000 } = {}) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  return (key, now = Date.now()) => {
    const last = seen.get(key);
    if (last !== undefined && now - last < windowMs) return false;
    seen.delete(key);
    seen.set(key, now);
    if (seen.size > maxKeys) seen.delete(/** @type {string} */ (seen.keys().next().value));
    return true;
  };
}

/**
 * A per-process cap on stored sign-in events per anonymised client address
 * and hour (same limit as the admin sign-in history, 30), so an address that
 * cycles through many account names cannot flood the log.
 *
 * @param {{max?: number, windowMs?: number, maxKeys?: number}} [options] Cap.
 * @returns {(ip: string|null|undefined, now?: number) => boolean} True while under the cap.
 */
function createAddressCap({ max = 30, windowMs = 60 * 60 * 1000, maxKeys = 5000 } = {}) {
  /** @type {Map<string, {count: number, windowStart: number}>} */
  const counts = new Map();
  return (ip, now = Date.now()) => {
    const key = anonymizeIp(normalizeIp(ip || '')) || '-';
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const entry = counts.get(key);
    if (!entry || entry.windowStart !== windowStart) {
      counts.delete(key);
      counts.set(key, { count: 1, windowStart });
      if (counts.size > maxKeys) counts.delete(/** @type {string} */ (counts.keys().next().value));
      return true;
    }
    entry.count += 1;
    return entry.count <= max;
  };
}

/**
 * Maps a geo rule decision reason (`utils/geo-firewall.js`) to the refusal
 * reason stored in the log.
 *
 * @param {string|null|undefined} reason Decision reason.
 * @returns {'country'|'location-unavailable'|'risk'} Logged reason.
 */
function refusalReasonOfGeoDecision(reason) {
  const value = String(reason || '');
  if (value.startsWith('country_')) return 'country';
  if (value.startsWith('geo_lookup_unavailable')) return 'location-unavailable';
  return 'risk';
}

module.exports = {
  createAddressCap,
  createRefusalDedup,
  refusalReasonOfGeoDecision,
  createSessionWithinLimit,
  displayIp,
  findAccountByIdentifier,
  findUserRole,
  isOpenSession,
  readSignInIdentifier,
  recordUserEvent,
};
