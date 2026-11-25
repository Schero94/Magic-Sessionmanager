'use strict';

// @ts-check

/**
 * The `trustedProxies` setting (security review 2, H2).
 *
 * Up to 4.22 `trustedProxies: true` made the plugin read the client address
 * from `CF-Connecting-IP`, `True-Client-IP`, `X-Real-IP` or the left-most
 * `X-Forwarded-For` entry, which every client can set. Since then:
 *
 * - `false`, `null` or an empty list: the client address is Koa's
 *   `ctx.request.ip`, which follows Strapi's `server.proxy` settings
 *   (`koa`, `ipHeader`, `maxIpsCount`).
 * - `true` (legacy): treated like an empty list, with a warning at start-up.
 *   The stored value is migrated to `[]` once.
 * - a list of IP addresses or CIDR ranges: when the TCP peer (the socket
 *   address) is on the list, the client address is the right-most
 *   `X-Forwarded-For` entry that is not on the list; otherwise it is the
 *   socket address. Headers are never read from a peer that is not listed.
 */

const { parseTrustedAddress } = require('./policy-settings');

/** Most entries the list may hold. */
const MAX_TRUSTED_PROXIES = 50;

/**
 * Normalises a stored or configured `trustedProxies` value to a list of
 * validated address or CIDR texts. Booleans, `null` and anything invalid
 * give an empty list.
 *
 * @param {unknown} value Stored or configured value.
 * @returns {string[]} Address and CIDR texts.
 */
function normalizeTrustedProxies(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value.slice(0, MAX_TRUSTED_PROXIES)) {
    const parsed = parseTrustedAddress(entry);
    if (parsed && !out.includes(parsed.text)) out.push(parsed.text);
  }
  return out;
}

/**
 * Whether a value is the legacy "trust every proxy header" switch.
 *
 * @param {unknown} value Stored or configured value.
 * @returns {boolean}
 */
function isLegacyTrustAll(value) {
  return value === true;
}

/**
 * Validates `trustedProxies` in a settings PUT. Accepts the legacy booleans
 * (both stored as an empty list: Strapi's proxy settings decide) and a list
 * of IP addresses or CIDR ranges.
 *
 * @param {unknown} value Request value.
 * @returns {{value: string[]|null, error: {path: Array<string|number>, message: string}|null,
 *   legacyTrue: boolean}} Accepted list or an error.
 */
function validateTrustedProxies(value) {
  if (typeof value === 'boolean') return { value: [], error: null, legacyTrue: value };
  if (!Array.isArray(value) || value.length > MAX_TRUSTED_PROXIES) {
    return {
      value: null,
      legacyTrue: false,
      error: {
        path: ['trustedProxies'],
        message: `trustedProxies must be a list of at most ${MAX_TRUSTED_PROXIES} IP addresses or CIDR ranges`,
      },
    };
  }
  const parsed = value.map(parseTrustedAddress);
  const invalid = parsed.findIndex((entry) => entry === null);
  if (invalid !== -1) {
    return {
      value: null,
      legacyTrue: false,
      error: {
        path: ['trustedProxies', invalid],
        message: 'Each trusted proxy must be an IP address or a CIDR range such as 10.0.0.0/8',
      },
    };
  }
  return {
    value: [...new Set(parsed.map((entry) => /** @type {any} */ (entry).text))],
    error: null,
    legacyTrue: false,
  };
}

/** Warning logged when the legacy switch is found (no values). */
const LEGACY_WARNING =
  "[CONFIG] trustedProxies: true no longer makes the plugin read CF-Connecting-IP, True-Client-IP, X-Real-IP or the left-most X-Forwarded-For entry (a client can set them). The client IP now comes from Strapi's server.proxy settings (koa, ipHeader, maxIpsCount). To trust specific proxies instead, set trustedProxies to a list of their IP addresses or CIDR ranges.";

/**
 * Start-up migration of the legacy `trustedProxies: true` (security review 2,
 * H2): a stored `true` becomes `[]` (Strapi's server.proxy settings decide,
 * which is what `true` now means), and a configured `true` is reported. Logs
 * one warning in either case. Idempotent.
 *
 * @param {any} strapi Strapi instance.
 * @param {{warn: Function}} log Plugin logger.
 * @returns {Promise<{stored: boolean, config: boolean}>} Where the legacy value was found.
 * @sideeffect May rewrite the stored settings.
 */
async function migrateLegacyProxyTrust(strapi, log) {
  const { withPluginStoreKey } = require('./plugin-store');
  const { notifySettingsChanged } = require('./settings-loader');
  const config = isLegacyTrustAll(
    strapi.config.get('plugin::magic-sessionmanager')?.trustedProxies
  );
  const store = strapi.store({ type: 'plugin', name: 'magic-sessionmanager' });
  let stored = isLegacyTrustAll((await store.get({ key: 'settings' }))?.trustedProxies);
  if (stored) {
    stored = await withPluginStoreKey(strapi, 'settings', async (scoped) => {
      const value = await scoped.get({ key: 'settings' });
      if (!value || !isLegacyTrustAll(value.trustedProxies)) return false;
      await scoped.set({ key: 'settings', value: { ...value, trustedProxies: [] } });
      return true;
    });
    if (stored) await notifySettingsChanged(strapi);
  }
  if (stored || config) log.warn(LEGACY_WARNING);
  return { stored, config };
}

module.exports = {
  LEGACY_WARNING,
  MAX_TRUSTED_PROXIES,
  isLegacyTrustAll,
  migrateLegacyProxyTrust,
  normalizeTrustedProxies,
  validateTrustedProxies,
};
