'use strict';

/**
 * Oldest Strapi release this plugin works on. Strapi 5.50.0 added the
 * session-manager methods the plugin calls (`listSessions`,
 * `revokeSessionById`) and the `metadata` column of `admin::session`
 * ("active devices session management", strapi/strapi#26628). On older
 * releases the refresh-mode sign-in fails closed with 503 and the admin panel
 * sessions routes return 500 (measured with the real-HTTP suites on 5.24.0,
 * 5.30.0, 5.40.0, 5.45.0 and 5.49.0). Keep in sync with the `@strapi/strapi`
 * and `@strapi/plugin-users-permissions` peer ranges and the CI floor job.
 */
const MIN_STRAPI_VERSION = '5.50.0';

/**
 * Parses a plain `major.minor.patch` version (pre-release suffix ignored).
 *
 * @param {unknown} version Version string.
 * @returns {number[]|null} `[major, minor, patch]`, or null when not a version.
 */
function parseVersion(version) {
  if (typeof version !== 'string') return null;
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1, 4).map(Number) : null;
}

/**
 * Tells whether a Strapi version is inside the supported range
 * `^MIN_STRAPI_VERSION` (same major, not older than the floor).
 *
 * @param {unknown} version Running Strapi version, e.g. `strapi.config.get('info.strapi')`.
 * @returns {boolean|null} true or false, or null when the version is unknown.
 */
function isSupportedStrapiVersion(version) {
  const current = parseVersion(version);
  if (!current) return null;
  const floor = /** @type {number[]} */ (parseVersion(MIN_STRAPI_VERSION));
  if (current[0] !== floor[0]) return false;
  for (let i = 1; i < 3; i += 1) {
    if (current[i] !== floor[i]) return current[i] > floor[i];
  }
  return true;
}

/**
 * Logs one error at start-up when the running Strapi is older than the floor.
 * It does not stop Strapi: the host decides, and the message says what to do.
 *
 * @param {any} strapi Strapi instance (reads `info.strapi` from its config).
 * @param {{error: Function}} log Plugin logger.
 * @returns {boolean|null} The result of {@link isSupportedStrapiVersion}.
 * @sideeffect Writes one error log line on an unsupported version.
 */
function checkStrapiVersion(strapi, log) {
  const version =
    typeof strapi?.config?.get === 'function' ? strapi.config.get('info.strapi') : undefined;
  const supported = isSupportedStrapiVersion(version);
  if (supported === false) {
    log.error(
      `Strapi ${version} is not supported: Magic Session Manager requires Strapi ${MIN_STRAPI_VERSION} or later (session-manager listSessions/revokeSessionById and admin session metadata). Upgrade Strapi; sign-in in refresh mode and the admin panel sessions view fail on this version.`
    );
  }
  return supported;
}

module.exports = { MIN_STRAPI_VERSION, isSupportedStrapiVersion, checkStrapiVersion };
