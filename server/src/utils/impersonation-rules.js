'use strict';
// @ts-check

/**
 * Pure rules of impersonation (4.19): the feature switch, the plugin config
 * of the frontend hand-off, start-request validation, which Content API
 * requests an impersonation may not make. No Strapi
 * access here, so every rule is unit-tested directly.
 *
 * Docs and installed code checked 2026-11-25 (Strapi 5.63.0):
 * - Users & Permissions content-api routes:
 *   `@strapi/plugin-users-permissions/server/src/routes/content-api/{auth,user}.js`.
 */

/** Settings key of the feature switch (protected: `settings.update`). */
const IMPERSONATION_DEFAULTS = Object.freeze({ impersonationEnabled: false });

/** Settings keys owned by impersonation. */
const IMPERSONATION_KEYS = Object.freeze(Object.keys(IMPERSONATION_DEFAULTS));

/** Durations an admin can choose for an app-user impersonation (minutes). */
const USER_DURATIONS = Object.freeze([15, 30, 60]);

/** Durations of an admin permission preview (minutes; at most 30). */
const ADMIN_DURATIONS = Object.freeze([15, 30]);

/** Shortest and longest reason, after trimming. */
const REASON_MIN = 3;
const REASON_MAX = 255;

/** How long a one-time hand-off code can be exchanged. */
const CODE_TTL_MS = 60 * 1000;

/** Response header set on every request made with an impersonation credential. */
const IMPERSONATION_HEADER = 'X-Magic-Impersonation';

/** Hand-off code shape: 43 base64url characters (32 random bytes). */
const CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Users & Permissions documentId / admin id shapes. */
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/;
const ADMIN_ID_PATTERN = /^[1-9][0-9]{0,15}$/;

/** Loopback hosts that may use plain http outside production. */
const LOOPBACK_HOSTS = Object.freeze(['localhost', '127.0.0.1', '[::1]']);

/**
 * Normalises the stored feature switch.
 *
 * @param {Record<string, unknown>|null|undefined} stored Stored settings.
 * @returns {{impersonationEnabled: boolean}} Normalised values.
 */
function normalizeImpersonationSettings(stored) {
  return { impersonationEnabled: stored?.impersonationEnabled === true };
}

/**
 * Validates the impersonation keys of a settings PUT.
 *
 * @param {Record<string, unknown>} body Request body.
 * @returns {{values: Record<string, unknown>, errors: Array<{path: string[], message: string}>}}
 *   Accepted values and field errors.
 */
function validateImpersonationSettings(body) {
  /** @type {Record<string, unknown>} */
  const values = {};
  const errors = [];
  if (Object.prototype.hasOwnProperty.call(body, 'impersonationEnabled')) {
    if (typeof body.impersonationEnabled !== 'boolean') {
      errors.push({
        path: ['impersonationEnabled'],
        message: 'impersonationEnabled must be a boolean',
      });
    } else {
      values.impersonationEnabled = body.impersonationEnabled;
    }
  }
  return { values, errors };
}

/**
 * Parses an origin or URL allowed for the hand-off: https, or http on a
 * loopback host outside production; no user info and no fragment.
 *
 * @param {unknown} value Candidate.
 * @param {{production: boolean}} env Environment.
 * @returns {URL|null} Parsed URL, or null when not allowed.
 */
function parseHandoffUrl(value, env) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || url.hash) return null;
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && !env.production && LOOPBACK_HOSTS.includes(url.hostname)) {
    return url;
  }
  return null;
}

/**
 * Validates the `impersonation` plugin config (config/plugins.js). Throws a
 * plain Error naming the key, never the value.
 *
 * @param {unknown} config `config.impersonation`.
 * @param {{production: boolean}} env Environment.
 * @returns {void}
 * @throws {Error} When the config is invalid.
 */
function validateImpersonationConfig(config, env) {
  if (config === undefined || config === null) return;
  if (typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('impersonation must be an object');
  }
  const { frontendUrl, allowedFrontendOrigins } = /** @type {any} */ (config);
  const unknown = Object.keys(config).filter(
    (key) => !['frontendUrl', 'allowedFrontendOrigins'].includes(key)
  );
  if (unknown.length > 0) throw new Error('impersonation has unknown keys');
  if (allowedFrontendOrigins !== undefined && allowedFrontendOrigins !== null) {
    if (!Array.isArray(allowedFrontendOrigins) || allowedFrontendOrigins.length > 20) {
      throw new Error('impersonation.allowedFrontendOrigins must be a list of at most 20 origins');
    }
    for (const origin of allowedFrontendOrigins) {
      const url = parseHandoffUrl(origin, env);
      if (!url || url.origin !== origin) {
        throw new Error(
          'impersonation.allowedFrontendOrigins entries must be https origins without a path'
        );
      }
    }
  }
  if (frontendUrl === undefined || frontendUrl === null || frontendUrl === '') return;
  const url = parseHandoffUrl(frontendUrl, env);
  if (!url || url.search) {
    throw new Error(
      'impersonation.frontendUrl must be an https URL without user info, query or fragment'
    );
  }
  if (Array.isArray(allowedFrontendOrigins) && !allowedFrontendOrigins.includes(url.origin)) {
    throw new Error('impersonation.frontendUrl must use an origin of allowedFrontendOrigins');
  }
}

/**
 * The frontend hand-off target, or null when the token fallback applies.
 *
 * @param {unknown} config `config.impersonation`.
 * @param {{production: boolean}} env Environment.
 * @returns {{url: string, origin: string}|null} Hand-off target.
 */
function resolveFrontendHandoff(config, env) {
  try {
    validateImpersonationConfig(config, env);
  } catch {
    return null;
  }
  const url = parseHandoffUrl(/** @type {any} */ (config)?.frontendUrl, env);
  return url ? { url: url.toString(), origin: url.origin } : null;
}

/**
 * Cleans and validates a reason: trimmed, control characters replaced by a
 * space, 3 to 255 characters.
 *
 * @param {unknown} value Candidate.
 * @returns {string|null} Clean reason, or null when invalid.
 */
function cleanReason(value) {
  if (typeof value !== 'string' || value.length > REASON_MAX * 4) return null;
  // eslint-disable-next-line no-control-regex -- strips control characters from free text
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (clean.length < REASON_MIN || clean.length > REASON_MAX) return null;
  return clean;
}

/**
 * Validates the body of a start request. Unknown keys are refused.
 *
 * @param {unknown} body Request body.
 * @param {{durations: readonly number[], notify: boolean}} options Allowed durations and
 *   whether `notifyUser` is accepted.
 * @returns {{value: {reason: string, durationMinutes: number, notifyUser: boolean}|null,
 *   errors: Array<{path: string[], message: string}>}} Result.
 */
function validateStartBody(body, { durations, notify }) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { value: null, errors: [{ path: [], message: 'Body must be an object' }] };
  }
  const allowed = ['reason', 'durationMinutes', ...(notify ? ['notifyUser'] : [])];
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) errors.push({ path: [key], message: 'Unknown field' });
  }
  const source = /** @type {Record<string, unknown>} */ (body);
  const reason = cleanReason(source.reason);
  if (reason === null) {
    errors.push({
      path: ['reason'],
      message: `reason must be ${REASON_MIN} to ${REASON_MAX} characters`,
    });
  }
  const duration = source.durationMinutes;
  if (typeof duration !== 'number' || !durations.includes(duration)) {
    errors.push({
      path: ['durationMinutes'],
      message: `durationMinutes must be one of: ${durations.join(', ')}`,
    });
  }
  if (notify && source.notifyUser !== undefined && typeof source.notifyUser !== 'boolean') {
    errors.push({ path: ['notifyUser'], message: 'notifyUser must be a boolean' });
  }
  if (errors.length > 0) return { value: null, errors };
  return {
    value: {
      reason: /** @type {string} */ (reason),
      durationMinutes: /** @type {number} */ (duration),
      notifyUser: source.notifyUser === true,
    },
    errors,
  };
}

/**
 * Lower-cases a request path, collapses repeated slashes and drops a
 * trailing slash, the way Strapi's router matches it.
 *
 * @param {unknown} path Request path.
 * @returns {string} Normalised path.
 */
function normalizePath(path) {
  const value = String(path || '')
    .toLowerCase()
    .replace(/\/{2,}/g, '/');
  return value.length > 1 ? value.replace(/\/+$/, '') || '/' : value;
}

/** Plugin Content API routes an impersonation may still call (reads only). */
const PLUGIN_READ_ROUTES = Object.freeze([
  /^\/magic-sessionmanager\/my-sessions$/,
  /^\/magic-sessionmanager\/current-session$/,
  /^\/magic-sessionmanager\/user\/[^/]{1,64}\/sessions$/,
]);

/**
 * Why an impersonation may not make this Content API request, or null when
 * it may. Covers credential and account changes, creating and ending
 * sessions, the data export, "This wasn't me" links and the plugin's own
 * write routes.
 *
 * @param {string} method HTTP method.
 * @param {string} path Request path.
 * @param {string} apiPrefix REST prefix (`api.rest.prefix`, default `/api`).
 * @returns {null|'credentials'|'account'|'sessions'} Refusal reason.
 */
function classifyRestrictedRequest(method, path, apiPrefix = '/api') {
  const verb = String(method || '').toUpperCase();
  const normalized = normalizePath(path);
  const prefix = normalizePath(apiPrefix || '/api');
  const base = prefix === '/' ? '' : prefix;
  if (!(normalized === base || normalized.startsWith(`${base}/`))) return null;
  const rest = normalized.slice(base.length) || '/';
  const isRead = verb === 'GET' || verb === 'HEAD';

  if (rest === '/auth' || rest.startsWith('/auth/')) {
    if (verb === 'POST' && rest === '/auth/refresh') return null;
    if (isRead && rest === '/auth/sessions') return null;
    if (rest === '/auth/logout' || rest.startsWith('/auth/sessions')) return 'sessions';
    return 'credentials';
  }
  if (rest === '/connect' || rest.startsWith('/connect/')) return 'credentials';
  if (rest === '/users' || rest.startsWith('/users/')) return isRead ? null : 'account';
  if (rest.startsWith('/magic-sessionmanager/') || rest === '/magic-sessionmanager') {
    const sub = rest.slice('/magic-sessionmanager'.length);
    if (isRead && PLUGIN_READ_ROUTES.some((pattern) => pattern.test(`/magic-sessionmanager${sub}`)))
      return null;
    if (sub === '/my-data' || sub === '/not-me') return 'account';
    return 'sessions';
  }
  if (rest.startsWith('/magic-link/') || rest.startsWith('/passwordless/')) {
    return 'credentials';
  }
  return null;
}

/** GraphQL operations that sign in, register or change credentials or the account. */
const GRAPHQL_RESTRICTED =
  /\b(login|register|forgotPassword|resetPassword|changePassword|emailConfirmation|createUsersPermissionsUser|updateUsersPermissionsUser|deleteUsersPermissionsUser)\b/;

/** Longest GraphQL document that is inspected; longer ones are refused. */
const MAX_GRAPHQL_LENGTH = 100 * 1024;

/**
 * Whether a GraphQL request body is a mutation that signs in, registers or
 * changes credentials or the account. Documents too long to inspect are
 * treated as restricted.
 *
 * @param {unknown} body Parsed request body.
 * @param {unknown} queryString `ctx.query.query` for GET requests.
 * @returns {boolean}
 */
function isRestrictedGraphqlRequest(body, queryString) {
  const documents = [];
  const collect = (value) => {
    if (value && typeof value === 'object' && typeof value.query === 'string') {
      documents.push(value.query);
    }
  };
  if (Array.isArray(body)) body.slice(0, 50).forEach(collect);
  else collect(body);
  if (typeof queryString === 'string') documents.push(queryString);
  return documents.some((text) => {
    if (text.length > MAX_GRAPHQL_LENGTH) return true;
    return /\bmutation\b/.test(text) && GRAPHQL_RESTRICTED.test(text);
  });
}

/**
 * Reads a JWT payload without checking the signature. Used only to find the
 * session or impersonation a token claims; the token is verified by Strapi
 * afterwards, so a forged token can only add restrictions, never remove them.
 *
 * @param {unknown} token Raw token.
 * @returns {Record<string, unknown>|null} Payload, or null when unreadable.
 */
function decodeJwtPayload(token) {
  if (typeof token !== 'string' || token.length > 8192) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

module.exports = {
  ADMIN_DURATIONS,
  ADMIN_ID_PATTERN,
  CODE_PATTERN,
  CODE_TTL_MS,
  DOCUMENT_ID_PATTERN,
  IMPERSONATION_DEFAULTS,
  IMPERSONATION_HEADER,
  IMPERSONATION_KEYS,
  REASON_MAX,
  REASON_MIN,
  USER_DURATIONS,
  classifyRestrictedRequest,
  cleanReason,
  decodeJwtPayload,
  isRestrictedGraphqlRequest,
  normalizeImpersonationSettings,
  normalizePath,
  parseHandoffUrl,
  resolveFrontendHandoff,
  validateImpersonationConfig,
  validateImpersonationSettings,
  validateStartBody,
};
