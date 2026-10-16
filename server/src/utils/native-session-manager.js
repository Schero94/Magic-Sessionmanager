'use strict';

const JWT_MANAGEMENT_CONFIG = 'plugin::users-permissions.jwtManagement';
const DEFAULT_JWT_MANAGEMENT = 'legacy-support';
const USERS_PERMISSIONS_ORIGIN = 'users-permissions';

const REQUIRED_METHODS = Object.freeze([
  'validateAccessToken',
  'validateRefreshToken',
  'isSessionActive',
  'listSessions',
  'revokeSessionById',
  'invalidateRefreshToken',
]);

/**
 * Resolves and validates the Users & Permissions API only when an operation is
 * invoked. Strapi registers plugin origins during each plugin's bootstrap, so
 * this lookup must not run during Magic Sessionmanager's earlier bootstrap.
 *
 * @param {object} strapi The active Strapi application instance.
 * @returns {object} The origin-scoped native session manager.
 * @throws {Error} If the origin-scoped API is not available after boot.
 */
function resolveOriginManager(strapi) {
  const sessionManager = strapi?.sessionManager;
  if (typeof sessionManager !== 'function') {
    throw new Error(
      'Native Users & Permissions session operation cannot run in refresh mode because strapi.sessionManager is unavailable. Confirm this Strapi runtime provides native session management.'
    );
  }

  if (typeof sessionManager.hasOrigin !== 'function') {
    throw new Error(
      'Native Users & Permissions session operation requires strapi.sessionManager.hasOrigin("users-permissions") to verify the registered origin.'
    );
  }

  if (!sessionManager.hasOrigin(USERS_PERMISSIONS_ORIGIN)) {
    throw new Error(
      'Native Users & Permissions session operation cannot run because Strapi has not registered the "users-permissions" session-manager origin. Confirm Users & Permissions completed bootstrap before handling requests.'
    );
  }

  const originManager = sessionManager(USERS_PERMISSIONS_ORIGIN);
  if (!originManager || !['object', 'function'].includes(typeof originManager)) {
    throw new Error(
      'Native Users & Permissions session operation could not resolve the origin-scoped session manager.'
    );
  }

  const missingMethods = REQUIRED_METHODS.filter(
    (method) => typeof originManager[method] !== 'function'
  );
  if (missingMethods.length > 0) {
    throw new Error(
      `Native Users & Permissions session operation requires missing method(s): ${missingMethods.join(', ')}.`
    );
  }

  return originManager;
}

/**
 * Forwards one operation to Strapi without storing its arguments.
 *
 * @param {object} strapi The active Strapi application instance.
 * @param {string} method The validated origin-scoped method name.
 * @param {unknown[]} args Arguments used only for this invocation.
 * @returns {unknown} The native method result.
 */
function callNativeMethod(strapi, method, args) {
  const originManager = resolveOriginManager(strapi);
  return Reflect.apply(originManager[method], originManager, args);
}

/**
 * @typedef {object} NativeSessionManagerFacade
 * @property {(token: string) => object} validateAccessToken Validates an access token.
 * @property {(token: string) => Promise<object>} validateRefreshToken Validates a refresh token.
 * @property {(sessionId: string) => Promise<boolean>} isSessionActive Checks native session activity.
 * @property {(userId: string) => Promise<object[]>} listSessions Lists one user's native sessions.
 * @property {(userId: string, sessionId: string) => Promise<boolean>} revokeSessionById Revokes one owned native session.
 * @property {(userId: string, deviceId?: string) => Promise<void>} invalidateRefreshToken Invalidates refresh tokens for a user/device.
 */

/**
 * Resolves Strapi's Users & Permissions session API only when native refresh-token
 * management is enabled. Legacy mode returns `null` so existing plugin-owned
 * session behavior remains in control. The returned facade is limited to native
 * validation and lifecycle methods; it never stores or logs token arguments.
 *
 * @param {object} strapi The active Strapi application instance.
 * @returns {NativeSessionManagerFacade|null} The checked native API, or `null` in legacy mode.
 * @throws {Error} If the configured JWT management mode is unsupported.
 */
function getNativeSessionManager(strapi) {
  const jwtManagement =
    strapi?.config?.get?.(JWT_MANAGEMENT_CONFIG, DEFAULT_JWT_MANAGEMENT) ?? DEFAULT_JWT_MANAGEMENT;

  if (jwtManagement === DEFAULT_JWT_MANAGEMENT) return null;

  if (jwtManagement !== 'refresh') {
    throw new Error(
      `Unsupported Users & Permissions jwtManagement mode "${String(jwtManagement)}"; expected "${DEFAULT_JWT_MANAGEMENT}" or "refresh".`
    );
  }

  // Origin registration happens during Users & Permissions bootstrap, which
  // may follow this plugin's bootstrap. Defer all native API lookup and checks
  // until an auth/session operation runs after Strapi has completed booting.
  const facade = {
    validateAccessToken(token) {
      return callNativeMethod(strapi, 'validateAccessToken', [token]);
    },
    validateRefreshToken(token) {
      return callNativeMethod(strapi, 'validateRefreshToken', [token]);
    },
    isSessionActive(sessionId) {
      return callNativeMethod(strapi, 'isSessionActive', [sessionId]);
    },
    listSessions(userId) {
      return callNativeMethod(strapi, 'listSessions', [userId]);
    },
    revokeSessionById(userId, sessionId) {
      return callNativeMethod(strapi, 'revokeSessionById', [userId, sessionId]);
    },
    invalidateRefreshToken(userId, deviceId) {
      return callNativeMethod(strapi, 'invalidateRefreshToken', [userId, deviceId]);
    },
  };

  return Object.freeze(facade);
}

module.exports = { getNativeSessionManager };
