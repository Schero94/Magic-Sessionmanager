'use strict';

const { invalidateSettingsCache } = require('../utils/settings-loader');

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
 * Sanitizes country code list (only 2-letter uppercase ISO codes).
 * @param {Array} list - Array of country codes
 * @returns {Array} Sanitized country codes
 */
function sanitizeCountryList(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(code => typeof code === 'string' && /^[A-Z]{2}$/.test(code.trim().toUpperCase()))
    .map(code => code.trim().toUpperCase());
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

/**
 * Settings controller
 * Manages plugin settings stored in Strapi database
 */

module.exports = {
  /**
   * Returns the current plugin settings (user-facing units: minutes/seconds/days).
   * @route GET /magic-sessionmanager/settings
   */
  async getSettings(ctx) {
    try {
      const pluginStore = strapi.store({
        type: 'plugin',
        name: 'magic-sessionmanager',
      });

      let settings = await pluginStore.get({ key: 'settings' });

      if (!settings) {
        settings = {
          inactivityTimeout: 15,
          cleanupInterval: 30,
          lastSeenRateLimit: 30,
          retentionDays: 90,
          maxSessionAgeDays: 30,
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
          strictSessionEnforcement: false,
          trustedProxies: false,
          emailTemplates: {
            suspiciousLogin: { subject: '', html: '', text: '' },
            newLocation: { subject: '', html: '', text: '' },
            vpnProxy: { subject: '', html: '', text: '' },
          },
        };
      }

      ctx.send({
        settings,
        success: true,
      });
    } catch (error) {
      strapi.log.error('[magic-sessionmanager/settings] Error getting settings:', error);
      ctx.badRequest('Error loading settings');
    }
  },

  /**
   * Validates and persists plugin settings, then invalidates the settings cache
   * so runtime code picks up the new values on next read.
   * @route PUT /magic-sessionmanager/settings
   * @throws {ValidationError} when body is missing
   */
  async updateSettings(ctx) {
    try {
      const { body } = ctx.request;

      if (!body) {
        return ctx.badRequest('Settings data is required');
      }

      const pluginStore = strapi.store({
        type: 'plugin',
        name: 'magic-sessionmanager',
      });

      const sanitizedSettings = {
        inactivityTimeout: Math.max(1, Math.min(parseInt(body.inactivityTimeout) || 15, 1440)),
        cleanupInterval: Math.max(5, Math.min(parseInt(body.cleanupInterval) || 30, 1440)),
        lastSeenRateLimit: Math.max(5, Math.min(parseInt(body.lastSeenRateLimit) || 30, 300)),
        retentionDays: Math.max(1, Math.min(parseInt(body.retentionDays) || 90, 365)),
        maxSessionAgeDays: Math.max(1, Math.min(parseInt(body.maxSessionAgeDays) || 30, 365)),
        enableGeolocation: !!body.enableGeolocation,
        enableSecurityScoring: !!body.enableSecurityScoring,
        blockSuspiciousSessions: !!body.blockSuspiciousSessions,
        maxFailedLogins: Math.max(1, Math.min(parseInt(body.maxFailedLogins) || 5, 100)),
        enableEmailAlerts: !!body.enableEmailAlerts,
        alertOnSuspiciousLogin: !!body.alertOnSuspiciousLogin,
        alertOnNewLocation: !!body.alertOnNewLocation,
        alertOnVpnProxy: !!body.alertOnVpnProxy,
        enableWebhooks: !!body.enableWebhooks,
        discordWebhookUrl: sanitizeWebhookUrl(body.discordWebhookUrl, 'discord'),
        slackWebhookUrl: sanitizeWebhookUrl(body.slackWebhookUrl, 'slack'),
        enableGeofencing: !!body.enableGeofencing,
        allowedCountries: sanitizeCountryList(body.allowedCountries),
        blockedCountries: sanitizeCountryList(body.blockedCountries),
        strictSessionEnforcement: !!body.strictSessionEnforcement,
        trustedProxies: !!body.trustedProxies,
        emailTemplates: sanitizeEmailTemplates(body.emailTemplates),
      };

      await pluginStore.set({
        key: 'settings',
        value: sanitizedSettings,
      });

      invalidateSettingsCache();

      strapi.log.info('[magic-sessionmanager/settings] Settings updated successfully');

      ctx.send({
        settings: sanitizedSettings,
        success: true,
        message: 'Settings saved successfully!'
      });
    } catch (error) {
      strapi.log.error('[magic-sessionmanager/settings] Error updating settings:', error);
      ctx.badRequest('Error saving settings');
    }
  },
};
