import { areSettingsEqual } from './settingsEquality.mjs';
import { TEMPLATE_KEYS, TEMPLATE_LIMITS, fillMissingTemplates } from './emailTemplateDraft.mjs';

/**
 * Client defaults. They mirror DEFAULT_SETTINGS in
 * server/src/controllers/settings.js and only fill keys that an older stored
 * settings blob does not have yet.
 */
export const SETTINGS_DEFAULTS = Object.freeze({
  inactivityTimeout: 15,
  cleanupInterval: 30,
  lastSeenRateLimit: 30,
  retentionDays: 90,
  maxSessionAgeDays: 30,
  sessionCreationGraceMs: 5000,
  cleanupUseDbDirect: false,
  strictSessionEnforcement: false,
  trustedProxies: false,
  enableGeolocation: true,
  enableSecurityScoring: true,
  blockSuspiciousSessions: false,
  maxFailedLogins: 5,
  enableEmailAlerts: false,
  alertOnSuspiciousLogin: true,
  alertOnNewLocation: true,
  alertOnVpnProxy: true,
  enableWebhooks: false,
  discordWebhookUrl: '',
  slackWebhookUrl: '',
  enableGeofencing: false,
  allowedCountries: [],
  blockedCountries: [],
  geoIpProvider: 'auto',
  geoIpDatabasePath: '',
  geoLookupFailureMode: 'auto',
});

/** Bounds enforced by the server (it clamps; the form reports instead). */
export const MAX_FAILED_LOGINS_RANGE = Object.freeze({ min: 0, max: 100 });

/** Webhook hosts accepted by the server (sanitizeWebhookUrl). */
const WEBHOOK_HOSTS = Object.freeze({
  discordWebhookUrl: ['discord.com', 'discordapp.com'],
  slackWebhookUrl: ['hooks.slack.com'],
});

/** MMDB filenames accepted by scripts/geoip-updater.cjs. */
const GEOIP_DATABASE_FILENAMES = Object.freeze([
  'GeoLite2-City.mmdb',
  'GeoLite2-Country.mmdb',
  'GeoIP2-City.mmdb',
  'GeoIP2-Country.mmdb',
]);

/**
 * Merges loaded settings over the client defaults and fills empty e-mail
 * templates. Used for the initial load AND for the PUT response, so the
 * saved baseline is exactly what the server stored (SET-01 browser).
 *
 * @param {unknown} loaded Settings object from the API.
 * @returns {object} Complete settings draft.
 * @throws {Error} When the payload is not a settings object.
 */
export function normalizeSettings(loaded) {
  if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
    throw new Error('Invalid settings response');
  }
  return {
    ...SETTINGS_DEFAULTS,
    ...loaded,
    allowedCountries: Array.isArray(loaded.allowedCountries) ? loaded.allowedCountries : [],
    blockedCountries: Array.isArray(loaded.blockedCountries) ? loaded.blockedCountries : [],
    emailTemplates: fillMissingTemplates(loaded.emailTemplates),
  };
}

const message = (messageId, defaultMessage, values) => ({ messageId, defaultMessage, values });

/**
 * @param {unknown} value Raw URL.
 * @param {string[]} hosts Allowed host names (subdomains included).
 * @returns {boolean} Whether the server would keep the URL.
 */
function isAllowedWebhookUrl(value, hosts) {
  if (typeof value !== 'string' || !value.trim()) return true;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== 'https:') return false;
    return hosts.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

/**
 * Validates a max-failed-logins draft value without clamping it (SET-03).
 *
 * @param {unknown} value Draft value from NumberInput (number or undefined).
 * @returns {null|{messageId: string, defaultMessage: string, values?: object}} Error or null.
 */
function validateMaxFailedLogins(value) {
  const { min, max } = MAX_FAILED_LOGINS_RANGE;
  if (value === undefined || value === null || value === '') {
    return message('settings.validation.required', 'Enter a value.');
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    return message('settings.validation.range', 'Enter a whole number from {min} to {max}.', {
      min,
      max,
    });
  }
  return null;
}

/**
 * Validates a two-letter country code typed by the admin.
 *
 * @param {string} code Typed code.
 * @param {string[]} list Current list.
 * @returns {null|{messageId: string, defaultMessage: string, values?: object}} Error or null.
 */
export function validateCountryCode(code, list = []) {
  const value = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (!value) return null;
  if (!/^[A-Z]{2}$/.test(value)) {
    return message(
      'settings.validation.countryCode',
      'Enter a two-letter ISO code, for example JP.'
    );
  }
  if (list.includes(value)) {
    return message('settings.validation.countryDuplicate', '{country} is already in the list.', {
      country: value,
    });
  }
  return null;
}

/**
 * Validates the settings draft. Errors are message descriptors so the page
 * translates them; nothing is clamped or rewritten here.
 *
 * @param {object} settings Settings draft.
 * @returns {Record<string, {messageId: string, defaultMessage: string, values?: object}>}
 *   Errors by field path (e.g. `emailTemplates.vpnProxy.html`).
 */
export function validateSettings(settings) {
  const errors = {};
  const source = settings || {};

  const maxFailed = validateMaxFailedLogins(source.maxFailedLogins);
  if (maxFailed) errors.maxFailedLogins = maxFailed;

  if (!isAllowedWebhookUrl(source.discordWebhookUrl, WEBHOOK_HOSTS.discordWebhookUrl)) {
    errors.discordWebhookUrl = message(
      'settings.validation.webhookDiscord',
      'Enter an https address on discord.com or discordapp.com.'
    );
  }
  if (!isAllowedWebhookUrl(source.slackWebhookUrl, WEBHOOK_HOSTS.slackWebhookUrl)) {
    errors.slackWebhookUrl = message(
      'settings.validation.webhookSlack',
      'Enter an https address on hooks.slack.com.'
    );
  }

  const filename =
    typeof source.geoIpDatabasePath === 'string' ? source.geoIpDatabasePath.trim() : '';
  if (filename && !GEOIP_DATABASE_FILENAMES.includes(filename)) {
    errors.geoIpDatabasePath = message(
      'settings.validation.geoIpFilename',
      'Use one of these filenames: {names}.',
      {
        names: GEOIP_DATABASE_FILENAMES.join(', '),
      }
    );
  }

  const templates = source.emailTemplates || {};
  for (const key of TEMPLATE_KEYS) {
    for (const [field, max] of Object.entries(TEMPLATE_LIMITS)) {
      const value = templates[key]?.[field];
      if (typeof value === 'string' && value.length > max) {
        errors[`emailTemplates.${key}.${field}`] = message(
          'settings.validation.maxLength',
          'Use at most {max} characters (currently {count}).',
          { max, count: value.length }
        );
      }
    }
  }

  return errors;
}

/**
 * Lists top-level fields the admin edited whose stored value differs from
 * what was submitted, e.g. a webhook URL the server rejected and blanked.
 * Fields the admin did not touch are ignored, so server-side normalisation
 * of an unchanged value (such as HTML sanitising) does not raise a warning.
 *
 * @param {object} submitted Draft sent with PUT.
 * @param {object} stored Normalized settings from the PUT response.
 * @param {object} [previous] Saved baseline before this save.
 * @returns {string[]} Changed field names.
 */
export function getAdjustedFields(submitted, stored, previous) {
  const source = submitted || {};
  return Object.keys(source).filter(
    (key) =>
      !areSettingsEqual(source[key], stored?.[key]) &&
      (previous === undefined || !areSettingsEqual(source[key], previous?.[key]))
  );
}
