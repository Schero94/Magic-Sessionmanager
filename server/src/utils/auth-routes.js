'use strict';

const NEW_SESSION_ROUTES = new Set([
  'POST /api/auth/local',
  'POST /api/auth/local/register',
  'POST /api/auth/reset-password',
  'GET /api/auth/email-confirmation',
  'POST /api/auth/email-confirmation',
  'POST /api/magic-link/verify-mfa-totp',
  'POST /api/magic-link/otp/verify',
  'POST /api/magic-link/login-totp',
]);

const FAILED_LOGIN_ROUTES = new Set([
  'POST /api/auth/local',
  'POST /api/magic-link/login-totp',
  'POST /api/magic-link/otp/verify',
  'POST /api/magic-link/verify-mfa-totp',
]);

function requestKey(path, method) {
  return `${String(method || '').toUpperCase()} ${path || ''}`;
}

function isMagicLinkLogin(path, method) {
  const normalizedMethod = String(method || '').toUpperCase();
  return (
    typeof path === 'string' &&
    path.startsWith('/api/magic-link/login') &&
    (normalizedMethod === 'GET' || normalizedMethod === 'POST')
  );
}

function classifyJwtIssuingRequest(path, method) {
  const normalizedMethod = String(method || '').toUpperCase();
  const key = requestKey(path, normalizedMethod);

  if (key === 'POST /api/auth/refresh') return 'refresh';
  if (key === 'POST /api/auth/change-password') return 'rotate-current';
  if (NEW_SESSION_ROUTES.has(key)) return 'new-session';

  if (normalizedMethod === 'GET' && /^\/api\/auth\/[a-z0-9-]+\/callback$/i.test(path || '')) {
    return 'new-session';
  }

  if (isMagicLinkLogin(path, normalizedMethod)) return 'new-session';

  if (
    typeof path === 'string' &&
    path.startsWith('/api/passwordless/') &&
    (normalizedMethod === 'GET' || normalizedMethod === 'POST')
  ) {
    return 'new-session';
  }

  return null;
}

/**
 * Identifies Users & Permissions' password-reset completion. A successful
 * reset issues a new session and must end every older session of that user.
 *
 * @param {string} path Request path
 * @param {string} method HTTP method
 * @returns {boolean} Whether the request completes a password reset
 */
function isPasswordResetRequest(path, method) {
  return requestKey(path, String(method || '').toUpperCase()) === 'POST /api/auth/reset-password';
}

function shouldRunPreAuthGeoGuard(path, method) {
  return classifyJwtIssuingRequest(path, method) === 'new-session';
}

function isFailedLoginTrackedPath(path, method) {
  return FAILED_LOGIN_ROUTES.has(requestKey(path, method)) || isMagicLinkLogin(path, method);
}

const DEFAULT_API_PREFIX = '/api';

/**
 * Normalises a configured REST prefix (`api.rest.prefix`) to a leading slash
 * and no trailing slash. An empty or invalid value falls back to `/api`,
 * Strapi's default.
 *
 * @param {unknown} prefix Configured prefix.
 * @returns {string} Normalised prefix, e.g. `/api` or `/v1`.
 */
function normalizeApiPrefix(prefix) {
  if (typeof prefix !== 'string') return DEFAULT_API_PREFIX;
  const trimmed = prefix.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_API_PREFIX;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/**
 * Maps a request path served under the configured REST prefix to the same
 * path under `/api`, the form every route table in this module uses. Strapi
 * mounts Content API routes at `${api.rest.prefix}/...`, so with a custom
 * prefix such as `/v1` a login arrives as `/v1/auth/local`; without this
 * mapping none of the interceptors matched it and every session created on
 * such a host stayed untracked.
 *
 * Paths outside the prefix are returned unchanged when the prefix is `/api`,
 * and as `null` otherwise, so a stray `/api/...` path on a host whose API
 * lives elsewhere never matches a route table.
 *
 * @param {string} path Request path (`ctx.path`).
 * @param {unknown} prefix Configured `api.rest.prefix`.
 * @returns {string|null} Canonical `/api/...` path, or null outside the API.
 */
function toCanonicalApiPath(path, prefix) {
  if (typeof path !== 'string') return null;
  const normalized = normalizeApiPrefix(prefix);
  if (normalized === DEFAULT_API_PREFIX) return path;
  if (path === normalized) return DEFAULT_API_PREFIX;
  if (path.startsWith(`${normalized}/`)) {
    return `${DEFAULT_API_PREFIX}${path.slice(normalized.length)}`;
  }
  return null;
}

module.exports = {
  normalizeApiPrefix,
  toCanonicalApiPath,
  classifyJwtIssuingRequest,
  isFailedLoginTrackedPath,
  isPasswordResetRequest,
  shouldRunPreAuthGeoGuard,
};
