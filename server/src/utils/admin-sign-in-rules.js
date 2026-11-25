'use strict';
// @ts-check

/**
 * Pure rules of "Sign in as this admin" (4.23): the tested Strapi range, the
 * start body, and which admin API requests an impersonation session may
 * make. No Strapi access here, so every rule is unit-tested directly.
 *
 * Why the version guard: the impersonation tab works because the plugin's
 * admin code keeps the access token in that tab only. Strapi's admin reads
 * its token from `localStorage.jwtToken`, then from the access cookie
 * (`getStoredToken` in `@strapi/admin/dist/admin/admin/src/reducer.mjs`,
 * `getToken` in `utils/getFetchClient.mjs`), refreshes with
 * `POST /admin/access-token` through the global `fetch`, and logs every tab
 * out when `localStorage.isLoggedIn` is removed (`features/Auth.mjs`). None
 * of this is public API. It is identical in 5.50.0, 5.58.0 and 5.64.0
 * (checked 2026-11-25). On a release the plugin was not tested against, the
 * feature switches itself off instead of guessing.
 */

const { REASON_MAX, REASON_MIN, cleanReason, normalizePath } = require('./impersonation-rules');

/** RBAC action: sign in as another admin (Super Admin automatically). */
const ADMIN_SIGN_IN_ACTION = 'plugin::magic-sessionmanager.impersonate.admins.sign-in';

/** Strapi releases the impersonation tab was tested against (inclusive). */
const TESTED_STRAPI = Object.freeze({ major: 5, minMinor: 50, maxMinor: 64 });

/** Durations of an admin sign-in (minutes). */
const ADMIN_SIGN_IN_DURATIONS = Object.freeze([15, 30]);

/** Device id prefix of the Strapi admin session of an impersonation. */
const ADMIN_DEVICE_PREFIX = 'msm-admin-impersonation-';

/** Admin panel path the new tab opens; the plugin's admin code handles it before Strapi routes. */
const LANDING_PATH = '/plugins/magic-sessionmanager/impersonate/land';

/**
 * Whether the running Strapi is a release the feature was tested against.
 *
 * @param {unknown} version `strapi.config.get('info.strapi')`.
 * @returns {{supported: boolean, version: string|null, reason: null|'unknown-version'|'untested-version'}}
 */
function adminSignInSupport(version) {
  const match = typeof version === 'string' ? /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim()) : null;
  if (!match) return { supported: false, version: null, reason: 'unknown-version' };
  const [major, minor] = [Number(match[1]), Number(match[2])];
  const clean = `${match[1]}.${match[2]}.${match[3]}`;
  const supported =
    major === TESTED_STRAPI.major &&
    minor >= TESTED_STRAPI.minMinor &&
    minor <= TESTED_STRAPI.maxMinor;
  return { supported, version: clean, reason: supported ? null : 'untested-version' };
}

/**
 * Durations that fit into one admin access token: the tab never refreshes,
 * so a sign-in cannot outlive the token Strapi issues
 * (`admin.auth.sessions.accessTokenLifespan`, default 30 minutes).
 *
 * @param {unknown} accessTokenLifespanSeconds Configured lifespan in seconds.
 * @returns {number[]} Allowed durations in minutes (may be empty).
 */
function allowedSignInDurations(accessTokenLifespanSeconds) {
  const seconds = Number(accessTokenLifespanSeconds);
  const lifespan = Number.isFinite(seconds) && seconds > 0 ? seconds : 30 * 60;
  return ADMIN_SIGN_IN_DURATIONS.filter((minutes) => minutes * 60 <= lifespan);
}

/**
 * Validates the body of a sign-in start. Unknown keys are refused.
 *
 * @param {unknown} body Request body.
 * @param {readonly number[]} durations Allowed durations.
 * @returns {{value: {reason: string, durationMinutes: number, allowChanges: boolean}|null,
 *   errors: Array<{path: string[], message: string}>}}
 */
function validateSignInBody(body, durations) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { value: null, errors: [{ path: [], message: 'Body must be an object' }] };
  }
  const errors = [];
  const source = /** @type {Record<string, unknown>} */ (body);
  for (const key of Object.keys(source)) {
    if (!['reason', 'durationMinutes', 'allowChanges'].includes(key)) {
      errors.push({ path: [key], message: 'Unknown field' });
    }
  }
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
  if (source.allowChanges !== undefined && typeof source.allowChanges !== 'boolean') {
    errors.push({ path: ['allowChanges'], message: 'allowChanges must be a boolean' });
  }
  if (errors.length) return { value: null, errors };
  return {
    value: {
      reason: /** @type {string} */ (reason),
      durationMinutes: /** @type {number} */ (duration),
      allowChanges: source.allowChanges === true,
    },
    errors,
  };
}

/** Methods that never change anything. */
const SAFE_METHODS = Object.freeze(['GET', 'HEAD', 'OPTIONS']);

/**
 * POST requests of the admin panel that only read (checked in the 5.64
 * admin bundle): RBAC condition checks.
 */
const READ_ONLY_POSTS = Object.freeze(['/admin/permissions/check']);

/**
 * Path prefixes no impersonation may change, even with "Allow changes":
 * the target's own account, password and sessions; admin accounts and
 * roles; API and transfer tokens; SSO providers; and this plugin (no
 * nesting, no ending of other sessions).
 */
const IDENTITY_PREFIXES = Object.freeze([
  '/admin/users',
  '/admin/roles',
  '/admin/api-tokens',
  '/admin/transfer',
  '/admin/providers',
  '/admin/register',
  '/admin/register-admin',
  '/admin/registration-info',
  '/admin/forgot-password',
  '/admin/reset-password',
  '/admin/renew-token',
  '/admin/login',
  '/admin/sessions',
  '/magic-sessionmanager',
]);

/** The plugin's own routes of the impersonation tab. */
const SELF_PATHS = Object.freeze({
  state: '/magic-sessionmanager/admin-impersonation/self',
  end: '/magic-sessionmanager/admin-impersonation/self/end',
});

/**
 * Whether a path equals a prefix or lies below it.
 *
 * @param {string} path Normalised path.
 * @param {string} prefix Prefix.
 * @returns {boolean}
 */
function under(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * What an admin API request made with an impersonation session is.
 *
 * - `self`: the plugin's state and end routes of the impersonation tab.
 * - `logout`: `POST /admin/logout`; ends the impersonation only.
 * - `read`: safe method or a read-only POST.
 * - `identity`: refused even with "Allow changes".
 * - `write`: allowed only with "Allow changes", and recorded.
 *
 * @param {string} method HTTP method.
 * @param {unknown} rawPath Request path.
 * @returns {'self'|'logout'|'read'|'identity'|'write'}
 */
function classifyAdminImpersonationRequest(method, rawPath) {
  const verb = String(method || '').toUpperCase();
  const path = normalizePath(rawPath);
  if (path === SELF_PATHS.state || path === SELF_PATHS.end) return 'self';
  if (verb === 'POST' && path === '/admin/logout') return 'logout';
  if (SAFE_METHODS.includes(verb)) return 'read';
  if (verb === 'POST' && READ_ONLY_POSTS.includes(path)) return 'read';
  if (IDENTITY_PREFIXES.some((prefix) => under(path, prefix))) return 'identity';
  return 'write';
}

/**
 * The path recorded for a write: no query string, ids kept, bounded.
 *
 * @param {unknown} rawPath Request path.
 * @returns {string}
 */
function recordedPath(rawPath) {
  return String(rawPath || '')
    .split('?')[0]
    .slice(0, 200);
}

module.exports = {
  ADMIN_DEVICE_PREFIX,
  ADMIN_SIGN_IN_ACTION,
  ADMIN_SIGN_IN_DURATIONS,
  IDENTITY_PREFIXES,
  LANDING_PATH,
  READ_ONLY_POSTS,
  SELF_PATHS,
  TESTED_STRAPI,
  adminSignInSupport,
  allowedSignInDurations,
  classifyAdminImpersonationRequest,
  recordedPath,
  validateSignInBody,
};
