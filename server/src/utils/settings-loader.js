'use strict';

/**
 * Centralized settings loader for magic-sessionmanager.
 *
 * Merges static plugin config (from `config/plugins.js`) with dynamic settings
 * stored via the admin UI (in the plugin store). Handles unit conversion
 * between user-facing values (minutes/seconds/days) and runtime values
 * (milliseconds).
 *
 * The merged settings are cached in-memory for a short TTL to avoid DB reads
 * on every request. Admin-side updates call `invalidateSettingsCache()` to
 * force an immediate reload.
 */

const PLUGIN_ID = 'magic-sessionmanager';
const SETTINGS_KEY = 'settings';
const CACHE_TTL_MS = 30 * 1000;

let cached = null;
let cachedAt = 0;

/**
 * Safely coerces a value to a positive integer within bounds.
 * Returns `fallback` when the value is non-numeric or outside bounds.
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function toIntInRange(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(n, max));
}

/**
 * Converts user-facing UI settings to runtime shape (with correct units).
 * @param {object} stored - Raw settings from pluginStore
 * @returns {object} Runtime-shaped settings
 */
function normalizeStoredSettings(stored) {
  if (!stored || typeof stored !== 'object') return {};
  const out = {};

  if (stored.inactivityTimeout !== undefined) {
    const minutes = toIntInRange(stored.inactivityTimeout, 15, 1, 1440);
    out.inactivityTimeout = minutes * 60 * 1000;
  }
  if (stored.cleanupInterval !== undefined) {
    const minutes = toIntInRange(stored.cleanupInterval, 30, 5, 1440);
    out.cleanupInterval = minutes * 60 * 1000;
  }
  if (stored.lastSeenRateLimit !== undefined) {
    const seconds = toIntInRange(stored.lastSeenRateLimit, 30, 5, 300);
    out.lastSeenRateLimit = seconds * 1000;
  }
  if (stored.retentionDays !== undefined) {
    out.retentionDays = toIntInRange(stored.retentionDays, 90, 1, 365);
  }
  if (stored.maxSessionAgeDays !== undefined) {
    out.maxSessionAgeDays = toIntInRange(stored.maxSessionAgeDays, 30, 1, 365);
  }
  if (stored.maxFailedLogins !== undefined) {
    out.maxFailedLogins = toIntInRange(stored.maxFailedLogins, 5, 1, 100);
  }

  const passthroughBooleans = [
    'enableGeolocation',
    'enableSecurityScoring',
    'blockSuspiciousSessions',
    'enableEmailAlerts',
    'alertOnSuspiciousLogin',
    'alertOnNewLocation',
    'alertOnVpnProxy',
    'enableWebhooks',
    'enableGeofencing',
    'strictSessionEnforcement',
  ];
  for (const key of passthroughBooleans) {
    if (stored[key] !== undefined) out[key] = !!stored[key];
  }

  if (typeof stored.discordWebhookUrl === 'string') {
    out.discordWebhookUrl = stored.discordWebhookUrl;
  }
  if (typeof stored.slackWebhookUrl === 'string') {
    out.slackWebhookUrl = stored.slackWebhookUrl;
  }
  if (Array.isArray(stored.allowedCountries)) {
    out.allowedCountries = stored.allowedCountries;
  }
  if (Array.isArray(stored.blockedCountries)) {
    out.blockedCountries = stored.blockedCountries;
  }
  if (stored.emailTemplates && typeof stored.emailTemplates === 'object') {
    out.emailTemplates = stored.emailTemplates;
  }
  if (stored.trustedProxies !== undefined) {
    out.trustedProxies = stored.trustedProxies;
  }

  return out;
}

/**
 * Returns the effective runtime settings (merged static config + stored UI settings).
 * Cached for CACHE_TTL_MS to avoid excessive DB reads.
 *
 * @param {object} strapi - Strapi instance
 * @returns {Promise<object>} Merged settings
 */
async function getPluginSettings(strapi) {
  const now = Date.now();
  if (cached && (now - cachedAt) < CACHE_TTL_MS) {
    return cached;
  }

  const staticConfig = strapi.config.get(`plugin::${PLUGIN_ID}`) || {};
  let storedSettings = {};

  try {
    const pluginStore = strapi.store({ type: 'plugin', name: PLUGIN_ID });
    const raw = await pluginStore.get({ key: SETTINGS_KEY });
    storedSettings = normalizeStoredSettings(raw);
  } catch (err) {
    strapi.log.debug(`[${PLUGIN_ID}] settings-loader: store read failed, using static config only:`, err.message);
  }

  const merged = { ...staticConfig, ...storedSettings };

  cached = merged;
  cachedAt = now;
  return merged;
}

/**
 * Synchronous fallback for hot paths that cannot await (e.g. Koa middleware startup).
 * Returns the last cached value, or the static config if no cache yet.
 * @param {object} strapi
 * @returns {object}
 */
function getPluginSettingsSync(strapi) {
  if (cached) return cached;
  return strapi.config.get(`plugin::${PLUGIN_ID}`) || {};
}

/**
 * Invalidate the cache so next call re-reads from store.
 * Called by settings controller after updates.
 */
function invalidateSettingsCache() {
  cached = null;
  cachedAt = 0;
}

module.exports = {
  getPluginSettings,
  getPluginSettingsSync,
  invalidateSettingsCache,
  normalizeStoredSettings,
};
