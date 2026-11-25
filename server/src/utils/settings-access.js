'use strict';

// @ts-check

/**
 * Who may change which settings, and what a settings response may show
 * (4.17, security review F1, F5, F6).
 *
 * `PUT /settings` stays on `plugin::magic-sessionmanager.access`, so roles
 * that save the session, login-protection, alert-email and retention options
 * today keep working. Protected keys additionally need the new action
 * `plugin::magic-sessionmanager.settings.update` (Super Admin by default):
 * - IP location lookup: whether and where admin and user IP addresses are
 *   sent (`enableGeolocation`, `geoIpProvider`, `geoLookupFailureMode`,
 *   `geoIpDatabasePath`);
 * - team notification webhooks (`enableWebhooks`, `discordWebhookUrl`,
 *   `slackWebhookUrl`): the URLs carry their own secret;
 * - every key of the security log (`adminSignInHistory`, ...), which also
 *   keeps needing `admin-activity.read` as in 4.15;
 * - since 4.22.1 also `trustedProxies`, `maxFailedLogins` and
 *   `emailTemplates`.
 * Sending a protected key back with its stored value is not a change, so a
 * role without the action can still save the whole form.
 *
 * Webhook URLs are never returned (F6): a response carries `hasDiscordWebhook`
 * / `hasSlackWebhook` / `hasGenericWebhook` and a hint without any secret part
 * (`https://discord.com/…`). The signed webhook secret is never returned
 * either, not even as a hint: only `hasGenericWebhookSecret`.
 */

const { SECURITY_LOG_KEYS } = require('./security-log-settings');
const { POLICY_KEYS } = require('./policy-settings');
const { PROTECTED_DETECTION_KEYS } = require('./detection-settings');
const { IMPERSONATION_KEYS } = require('./impersonation-rules');

const SETTINGS_UPDATE_ACTION = 'plugin::magic-sessionmanager.settings.update';
const ADMIN_ACTIVITY_READ_ACTION = 'plugin::magic-sessionmanager.admin-activity.read';

/** Keys that decide whether and where IP addresses are looked up. */
const GEO_SETTINGS_KEYS = Object.freeze([
  'enableGeolocation',
  'geoIpProvider',
  'geoLookupFailureMode',
  'geoIpDatabasePath',
]);

/** Webhook keys; the URLs are secrets. */
const WEBHOOK_SETTINGS_KEYS = Object.freeze([
  'enableWebhooks',
  'discordWebhookUrl',
  'slackWebhookUrl',
]);

/** Keys that need `settings.update` to change. */
const PROTECTED_SETTINGS_KEYS = Object.freeze([
  ...GEO_SETTINGS_KEYS,
  ...WEBHOOK_SETTINGS_KEYS,
  ...SECURITY_LOG_KEYS,
  // Sign-in and session policies (lockout, trusted addresses, session
  // limit, password-change sign-out, recording switch, per-role rules).
  ...POLICY_KEYS,
  // Signed webhook, event selection, impossible travel and shortened IPs.
  ...PROTECTED_DETECTION_KEYS,
  // Impersonation switch (4.20): whether admins can act as app users.
  ...IMPERSONATION_KEYS,
  // Security review 2 (4.22.1): which proxies may name the client address
  // (H2), the IP lockout threshold (H2) and the alert email texts, which go
  // to app users from the site's own address (hardening 6).
  'trustedProxies',
  'maxFailedLogins',
  'emailTemplates',
]);

/** Secret webhook URL keys and the flag/hint keys returned instead. */
const WEBHOOK_SECRETS = Object.freeze([
  { key: 'discordWebhookUrl', has: 'hasDiscordWebhook', hint: 'discordWebhookHint' },
  { key: 'slackWebhookUrl', has: 'hasSlackWebhook', hint: 'slackWebhookHint' },
  { key: 'genericWebhookUrl', has: 'hasGenericWebhook', hint: 'genericWebhookHint' },
]);

/** Write-only secrets without a hint, and the flag returned instead. */
const WRITE_ONLY_SECRETS = Object.freeze([
  { key: 'genericWebhookSecret', has: 'hasGenericWebhookSecret' },
]);

/**
 * Whether two stored setting values are the same (deep, for arrays and
 * template objects).
 *
 * @param {unknown} a First value.
 * @param {unknown} b Second value.
 * @returns {boolean}
 */
function sameValue(a, b) {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Names of the keys whose value differs between two settings objects.
 *
 * @param {Record<string, unknown>} next Settings about to be stored.
 * @param {Record<string, unknown>} current Settings stored now.
 * @param {readonly string[]} keys Keys to compare.
 * @returns {string[]} Changed key names, in `keys` order.
 */
function changedKeys(next, current, keys) {
  return keys.filter((key) => !sameValue(next?.[key], current?.[key]));
}

/**
 * Whether the caller's ability (the one `admin::hasPermissions` uses) holds
 * an action.
 *
 * @param {any} ctx Koa context.
 * @param {string} action Action id.
 * @returns {boolean}
 */
function callerCan(ctx, action) {
  try {
    return ctx?.state?.userAbility?.can?.(action) === true;
  } catch {
    return false;
  }
}

/**
 * The permission a settings change is missing, or null when it is allowed.
 * The `admin-activity.read` rule of 4.15 is checked first, so its 403 reason
 * stays the same for existing clients.
 *
 * @param {any} ctx Koa context.
 * @param {string[]} changed Changed key names.
 * @returns {null|'admin-activity-permission'|'settings-update-permission'} Missing permission.
 */
function missingSettingsPermission(ctx, changed) {
  const touchesLog = changed.some((key) => SECURITY_LOG_KEYS.includes(key));
  if (touchesLog && !callerCan(ctx, ADMIN_ACTIVITY_READ_ACTION)) {
    return 'admin-activity-permission';
  }
  const touchesProtected = changed.some((key) => PROTECTED_SETTINGS_KEYS.includes(key));
  if (touchesProtected && !callerCan(ctx, SETTINGS_UPDATE_ACTION)) {
    return 'settings-update-permission';
  }
  return null;
}

/**
 * Hint for a stored webhook URL without any secret part: scheme and host only.
 *
 * @param {unknown} url Stored URL.
 * @returns {string|null} `https://host/…`, or null when nothing is stored.
 */
function webhookHint(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    return `${parsed.protocol}//${parsed.hostname}/…`;
  } catch {
    return null;
  }
}

/**
 * Settings as an API response: webhook URLs replaced by whether one is
 * stored and a hint, the webhook secret by whether one is stored. Never
 * returns a URL, any part of its path, or the secret.
 *
 * @param {Record<string, any>} settings Merged settings.
 * @returns {Record<string, any>} Response settings.
 */
function toPublicSettings(settings) {
  const out = { ...(settings || {}) };
  for (const { key, has, hint } of WEBHOOK_SECRETS) {
    const value = out[key];
    delete out[key];
    out[has] = typeof value === 'string' && value.trim().length > 0;
    out[hint] = webhookHint(value);
  }
  for (const { key, has } of WRITE_ONLY_SECRETS) {
    const value = out[key];
    delete out[key];
    out[has] = typeof value === 'string' && value.length > 0;
  }
  return out;
}

module.exports = {
  ADMIN_ACTIVITY_READ_ACTION,
  GEO_SETTINGS_KEYS,
  PROTECTED_SETTINGS_KEYS,
  SETTINGS_UPDATE_ACTION,
  WEBHOOK_SECRETS,
  WEBHOOK_SETTINGS_KEYS,
  WRITE_ONLY_SECRETS,
  callerCan,
  changedKeys,
  missingSettingsPermission,
  toPublicSettings,
  webhookHint,
};
