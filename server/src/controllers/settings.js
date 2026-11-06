'use strict';

const {
  invalidateSettingsCache,
  normalizeGeoIpProvider,
  normalizeGeoLookupFailureMode,
} = require('../utils/settings-loader');
const { resolveDatabaseTarget } = require('../../../scripts/geoip-updater.cjs');
const { sendServerError, sendValidationError } = require('../utils/http-errors');
const path = require('node:path');

/**
 * Allowed webhook URL domains to prevent SSRF attacks
 */
const ALLOWED_WEBHOOK_DOMAINS = {
  discord: ['discord.com', 'discordapp.com'],
  slack: ['hooks.slack.com'],
};

/**
 * Validates and sanitizes a webhook URL against allowed domains.
 * @param {string} url - The webhook URL to validate
 * @param {string} type - The webhook type ('discord' or 'slack')
 * @returns {string} Sanitized URL or empty string if invalid
 */
function sanitizeWebhookUrl(url, type) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return '';

    const allowedDomains = ALLOWED_WEBHOOK_DOMAINS[type] || [];
    const isAllowed = allowedDomains.some(domain =>
      parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
    );
    if (!isAllowed) return '';

    return trimmed;
  } catch {
    return '';
  }
}

/**
 * Exposes only a supported filename for the download setting. Legacy custom
 * read paths remain usable by the GeoIP reader but are never download targets.
 *
 * @param {unknown} value Stored legacy or current GeoIP path
 * @returns {string} Supported filename, or an empty string for legacy paths
 */
function getSafeGeoIpFilename(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    return path.basename(resolveDatabaseTarget(value));
  } catch {
    return '';
  }
}

/**
 * Sanitizes email templates using a conservative allowlist strategy.
 * Strips all HTML tags except a small safe subset and removes all event handlers
 * and javascript: / data: URIs. Prefer a dedicated sanitizer (sanitize-html)
 * in environments where it is available.
 *
 * @param {object} templates - Email templates object
 * @returns {object} Sanitized templates
 */
function sanitizeEmailTemplates(templates) {
  const defaults = {
    suspiciousLogin: { subject: '', html: '', text: '' },
    newLocation: { subject: '', html: '', text: '' },
    vpnProxy: { subject: '', html: '', text: '' },
  };

  if (!templates || typeof templates !== 'object') return defaults;

  let sanitizeHtml = null;
  try {
    sanitizeHtml = require('sanitize-html');
  } catch {
    sanitizeHtml = null;
  }

  const result = {};
  for (const [key, defaultVal] of Object.entries(defaults)) {
    const tpl = templates[key];
    if (!tpl || typeof tpl !== 'object') {
      result[key] = defaultVal;
      continue;
    }

    const rawHtml = typeof tpl.html === 'string' ? tpl.html.substring(0, 10000) : '';
    const rawText = typeof tpl.text === 'string' ? tpl.text.substring(0, 5000) : '';
    const rawSubject = typeof tpl.subject === 'string' ? tpl.subject.substring(0, 200) : '';

    let cleanedHtml;
    if (sanitizeHtml) {
      cleanedHtml = sanitizeHtml(rawHtml, {
        allowedTags: [
          'html', 'body', 'head', 'title', 'meta',
          'div', 'span', 'p', 'br', 'hr',
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
          'strong', 'em', 'b', 'i', 'u',
          'ul', 'ol', 'li',
          'a', 'img',
          'table', 'thead', 'tbody', 'tr', 'td', 'th',
          'blockquote', 'code', 'pre',
        ],
        allowedAttributes: {
          '*': ['style', 'class', 'id'],
          a: ['href', 'title', 'target', 'rel'],
          img: ['src', 'alt', 'width', 'height'],
          table: ['border', 'cellspacing', 'cellpadding', 'width'],
          td: ['colspan', 'rowspan', 'align', 'valign', 'width'],
          th: ['colspan', 'rowspan', 'align', 'valign', 'width'],
        },
        allowedSchemes: ['http', 'https', 'mailto'],
        allowedSchemesAppliedToAttributes: ['href', 'src', 'cite'],
        allowProtocolRelative: false,
        disallowedTagsMode: 'discard',
        allowedStyles: {
          '*': {
            color: [/^#(0x)?[0-9a-f]+$/i, /^rgb\(\s*(\d{1,3}\s*,\s*){2}\d{1,3}\s*\)$/],
            'background-color': [/^#(0x)?[0-9a-f]+$/i, /^rgb\(\s*(\d{1,3}\s*,\s*){2}\d{1,3}\s*\)$/],
            'text-align': [/^left$/, /^right$/, /^center$/, /^justify$/],
            'font-size': [/^\d+(?:px|em|rem|%)$/],
            'font-weight': [/^(normal|bold|\d+)$/],
            'font-family': [/^[\w\s,'"-]+$/],
            padding: [/^[\d\s\w%.]+$/],
            margin: [/^[\d\s\w%.]+$/],
            border: [/^[\w\s#,()%.-]+$/],
            'border-radius': [/^[\d\s\w%.]+$/],
            width: [/^\d+(?:px|em|rem|%)$/],
            'max-width': [/^\d+(?:px|em|rem|%)$/],
            'line-height': [/^[\d.]+$/],
          },
        },
      });
    } else {
      const dangerousTags = /<\s*\/?\s*(script|iframe|object|embed|form|input|button|link|meta|base|svg|math|style)\b[^>]*>/gi;
      const dangerousAttrs = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
      const javascriptScheme = /(?:href|src)\s*=\s*["']?\s*javascript\s*:[^"'>\s]*["']?/gi;
      const dataScheme = /(?:href|src)\s*=\s*["']?\s*data\s*:[^"'>\s]*["']?/gi;
      cleanedHtml = rawHtml
        .replace(dangerousTags, '')
        .replace(dangerousAttrs, '')
        .replace(javascriptScheme, '')
        .replace(dataScheme, '');
    }

    result[key] = {
      subject: rawSubject,
      html: cleanedHtml,
      text: rawText,
    };
  }
  return result;
}

const DEFAULT_EMAIL_TEMPLATES = {
  suspiciousLogin: { subject: '', html: '', text: '' },
  newLocation: { subject: '', html: '', text: '' },
  vpnProxy: { subject: '', html: '', text: '' },
};

const DEFAULT_SETTINGS = {
  inactivityTimeout: 15,
  cleanupInterval: 30,
  lastSeenRateLimit: 30,
  retentionDays: 90,
  maxSessionAgeDays: 30,
  sessionCreationGraceMs: 5000,
  cleanupUseDbDirect: false,
  rateLimitWriteMax: 10,
  rateLimitReadMax: 120,
  rateLimitWindowSeconds: 60,
  enableGeolocation: true,
  enableSecurityScoring: true,
  blockSuspiciousSessions: false,
  maxFailedLogins: 5,
  enableGeofencing: false,
  allowedCountries: [],
  blockedCountries: [],
  geoIpProvider: 'auto',
  geoIpDatabasePath: '',
  geoLookupFailureMode: 'auto',
  enableEmailAlerts: false,
  alertOnSuspiciousLogin: true,
  alertOnNewLocation: true,
  alertOnVpnProxy: true,
  enableWebhooks: false,
  discordWebhookUrl: '',
  slackWebhookUrl: '',
  strictSessionEnforcement: false,
  trustedProxies: false,
  emailTemplates: DEFAULT_EMAIL_TEMPLATES,
};

/**
 * Merges stored settings with current defaults and exposes only a supported
 * filename for future GeoIP downloads.
 *
 * @param {object|null} stored Raw settings from the plugin store
 * @returns {object} User-facing settings with safe defaults
 */
function mergeSettingsWithDefaults(stored) {
  const safeStored = stored && typeof stored === 'object' ? stored : {};
  const storedTemplates = safeStored.emailTemplates && typeof safeStored.emailTemplates === 'object'
    ? safeStored.emailTemplates
    : {};

  return {
    ...DEFAULT_SETTINGS,
    ...safeStored,
    emailTemplates: {
      ...DEFAULT_EMAIL_TEMPLATES,
      ...storedTemplates,
    },
    geoIpDatabasePath: getSafeGeoIpFilename(safeStored.geoIpDatabasePath),
  };
}

/**
 * Inclusive bounds for integer settings, in user-facing units.
 */
const INTEGER_SETTING_RANGES = {
  inactivityTimeout: [1, 1440],
  cleanupInterval: [5, 1440],
  lastSeenRateLimit: [5, 300],
  maxSessionAgeDays: [1, 365],
  sessionCreationGraceMs: [0, 30000],
  rateLimitWriteMax: [1, 1000],
  rateLimitReadMax: [1, 10000],
  rateLimitWindowSeconds: [10, 3600],
  maxFailedLogins: [0, 100],
};

const BOOLEAN_SETTINGS = [
  'cleanupUseDbDirect',
  'enableGeolocation',
  'enableSecurityScoring',
  'blockSuspiciousSessions',
  'enableGeofencing',
  'enableEmailAlerts',
  'alertOnSuspiciousLogin',
  'alertOnNewLocation',
  'alertOnVpnProxy',
  'enableWebhooks',
  'strictSessionEnforcement',
  'trustedProxies',
];

const GEO_IP_PROVIDER_VALUES = ['auto', 'local-mmdb', 'ipapi', 'disabled'];
const GEO_LOOKUP_FAILURE_MODE_VALUES = ['auto', 'allow', 'block'];
const EMAIL_TEMPLATE_LIMITS = { subject: 200, html: 10000, text: 5000 };

/**
 * Parses an integer that the admin UI may send as a number or numeric string.
 *
 * @param {unknown} value Raw input
 * @returns {number|null} Integer, or null when the value is not an integer
 */
function parseInteger(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string' && /^\s*-?\d+\s*$/.test(value)) return Number.parseInt(value, 10);
  return null;
}

/**
 * Validates one email template update and merges it over the current value.
 *
 * @param {string} key Template key
 * @param {unknown} update Requested template fields
 * @param {object} current Current stored template
 * @param {object[]} errors Collected field errors
 * @returns {object|undefined} Merged raw template, or undefined when invalid
 */
function mergeEmailTemplate(key, update, current, errors) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) {
    errors.push({ path: ['emailTemplates', key], message: `emailTemplates.${key} must be an object` });
    return undefined;
  }
  const merged = { subject: '', html: '', text: '', ...(current && typeof current === 'object' ? current : {}) };
  for (const [field, limit] of Object.entries(EMAIL_TEMPLATE_LIMITS)) {
    if (update[field] === undefined) continue;
    if (typeof update[field] !== 'string') {
      errors.push({ path: ['emailTemplates', key, field], message: `emailTemplates.${key}.${field} must be a string` });
    } else if (update[field].length > limit) {
      errors.push({ path: ['emailTemplates', key, field], message: `emailTemplates.${key}.${field} must be at most ${limit} characters` });
    } else {
      merged[field] = update[field];
    }
  }
  return merged;
}

/**
 * Validates a (partial) settings payload and merges it over the current
 * stored settings. Fields missing from the payload keep their current value;
 * invalid fields are reported instead of being clamped or defaulted. Unknown
 * keys are ignored so a client may send back the whole GET response.
 *
 * @param {object} body Request payload
 * @param {object} current Current settings merged with defaults
 * @returns {{settings?: object, errors: {path: string[], message: string}[]}}
 */
function validateSettingsUpdate(body, current) {
  const errors = [];
  const next = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;

  for (const [key, [min, max]] of Object.entries(INTEGER_SETTING_RANGES)) {
    if (!has(key)) continue;
    const value = parseInteger(body[key]);
    if (value === null || value < min || value > max) {
      errors.push({ path: [key], message: `${key} must be an integer between ${min} and ${max}` });
    } else {
      next[key] = value;
    }
  }

  if (has('retentionDays')) {
    const value = parseInteger(body.retentionDays);
    if (value === null || (value !== -1 && (value < 1 || value > 365))) {
      errors.push({ path: ['retentionDays'], message: 'retentionDays must be -1 (forever) or an integer between 1 and 365' });
    } else {
      next.retentionDays = value;
    }
  }

  for (const key of BOOLEAN_SETTINGS) {
    if (!has(key)) continue;
    if (typeof body[key] !== 'boolean') {
      errors.push({ path: [key], message: `${key} must be a boolean` });
    } else {
      next[key] = body[key];
    }
  }

  for (const key of ['allowedCountries', 'blockedCountries']) {
    if (!has(key)) continue;
    const list = body[key];
    if (!Array.isArray(list)) {
      errors.push({ path: [key], message: `${key} must be a list of ISO 3166-1 alpha-2 country codes` });
      continue;
    }
    const normalized = list.map((code) => (typeof code === 'string' ? code.trim().toUpperCase() : ''));
    if (normalized.some((code) => !/^[A-Z]{2}$/.test(code))) {
      errors.push({ path: [key], message: `${key} must contain only ISO 3166-1 alpha-2 country codes` });
    } else {
      next[key] = [...new Set(normalized)];
    }
  }

  if (has('geoIpProvider')) {
    if (!GEO_IP_PROVIDER_VALUES.includes(body.geoIpProvider)) {
      errors.push({ path: ['geoIpProvider'], message: `geoIpProvider must be one of: ${GEO_IP_PROVIDER_VALUES.join(', ')}` });
    } else {
      next.geoIpProvider = normalizeGeoIpProvider(body.geoIpProvider);
    }
  }

  if (has('geoLookupFailureMode')) {
    if (!GEO_LOOKUP_FAILURE_MODE_VALUES.includes(body.geoLookupFailureMode)) {
      errors.push({ path: ['geoLookupFailureMode'], message: `geoLookupFailureMode must be one of: ${GEO_LOOKUP_FAILURE_MODE_VALUES.join(', ')}` });
    } else {
      next.geoLookupFailureMode = normalizeGeoLookupFailureMode(body.geoLookupFailureMode);
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'geoIpDatabasePath')) {
    if (body.geoIpDatabasePath === '') {
      next.geoIpDatabasePath = '';
    } else {
      try {
        next.geoIpDatabasePath = path.basename(resolveDatabaseTarget(body.geoIpDatabasePath));
      } catch {
        errors.push({
          path: ['geoIpDatabasePath'],
          message: 'GeoIP database path must be a supported MMDB filename in the dedicated GeoIP directory',
        });
      }
    }
  }

  for (const [key, type] of [['discordWebhookUrl', 'discord'], ['slackWebhookUrl', 'slack']]) {
    if (!has(key)) continue;
    const value = body[key];
    if (typeof value !== 'string') {
      errors.push({ path: [key], message: `${key} must be a string` });
    } else if (!value.trim()) {
      next[key] = '';
    } else {
      const sanitized = sanitizeWebhookUrl(value, type);
      if (!sanitized) {
        errors.push({ path: [key], message: `${key} must be an https URL on ${ALLOWED_WEBHOOK_DOMAINS[type].join(' or ')}` });
      } else {
        next[key] = sanitized;
      }
    }
  }

  if (has('emailTemplates')) {
    const templates = body.emailTemplates;
    if (!templates || typeof templates !== 'object' || Array.isArray(templates)) {
      errors.push({ path: ['emailTemplates'], message: 'emailTemplates must be an object' });
    } else {
      const currentTemplates = current.emailTemplates || DEFAULT_EMAIL_TEMPLATES;
      const mergedTemplates = { ...DEFAULT_EMAIL_TEMPLATES, ...currentTemplates };
      for (const key of Object.keys(DEFAULT_EMAIL_TEMPLATES)) {
        if (templates[key] === undefined) continue;
        const merged = mergeEmailTemplate(key, templates[key], mergedTemplates[key], errors);
        if (merged) mergedTemplates[key] = merged;
      }
      next.emailTemplates = sanitizeEmailTemplates(mergedTemplates);
    }
  }

  if (errors.length > 0) return { errors };

  const settings = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    settings[key] = Object.prototype.hasOwnProperty.call(next, key) ? next[key] : current[key];
  }
  return { settings, errors };
}

/**
 * Settings controller
 * Manages plugin settings stored in Strapi database
 */

module.exports = {
  /**
   * Returns current plugin settings in user-facing units. Legacy custom MMDB
   * read paths are not returned as download destinations.
   *
   * @route GET /magic-sessionmanager/settings
   * @returns {Promise<void>}
   */
  async getSettings(ctx) {
    try {
      const pluginStore = strapi.store({
        type: 'plugin',
        name: 'magic-sessionmanager',
      });

      const storedSettings = await pluginStore.get({ key: 'settings' });
      const settings = mergeSettingsWithDefaults(storedSettings);

      ctx.send({
        settings,
        success: true,
      });
    } catch (error) {
      strapi.log.error('[magic-sessionmanager/settings] Error getting settings:', error?.name || 'Error');
      return sendServerError(ctx, 500, 'Error loading settings');
    }
  },

  /**
   * Validates a full or partial settings payload, merges it over the stored
   * settings and persists the result, then invalidates the settings cache so
   * runtime code picks up the new values on next read.
   *
   * Omitted fields keep their stored value. Invalid values are rejected with
   * a 400 whose `error.details.errors` names each field; nothing is clamped
   * or written in that case. Store failures return a 500 with a safe message.
   *
   * @route PUT /magic-sessionmanager/settings
   * @returns {Promise<void>}
   */
  async updateSettings(ctx) {
    let pluginStore;
    let current;
    try {
      const { body } = ctx.request;

      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return ctx.badRequest('Settings data must be an object');
      }

      pluginStore = strapi.store({
        type: 'plugin',
        name: 'magic-sessionmanager',
      });

      // PUT merges: omitted fields keep their stored value. The stored
      // GeoIP path is kept verbatim (legacy read paths stay readable) unless
      // the payload replaces it.
      const stored = await pluginStore.get({ key: 'settings' });
      const storedObject = stored && typeof stored === 'object' ? stored : {};
      current = {
        ...mergeSettingsWithDefaults(storedObject),
        geoIpDatabasePath: typeof storedObject.geoIpDatabasePath === 'string'
          ? storedObject.geoIpDatabasePath
          : '',
      };

      const { settings: sanitizedSettings, errors } = validateSettingsUpdate(body, current);
      if (errors.length > 0) {
        return sendValidationError(ctx, 'Invalid settings', errors);
      }

      await pluginStore.set({
        key: 'settings',
        value: sanitizedSettings,
      });

      invalidateSettingsCache();

      strapi.log.info('[magic-sessionmanager/settings] Settings updated successfully');

      ctx.send({
        settings: {
          ...sanitizedSettings,
          geoIpDatabasePath: getSafeGeoIpFilename(sanitizedSettings.geoIpDatabasePath),
        },
        success: true,
        message: 'Settings saved successfully!'
      });
    } catch (error) {
      strapi.log.error('[magic-sessionmanager/settings] Error updating settings:', error?.name || 'Error');
      return sendServerError(ctx, 500, 'Error saving settings');
    }
  },
  DEFAULT_SETTINGS,
  mergeSettingsWithDefaults,
  validateSettingsUpdate,
};
