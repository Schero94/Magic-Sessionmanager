'use strict';

/**
 * Allowed webhook URL domains to prevent SSRF attacks
 */
const ALLOWED_WEBHOOK_DOMAINS = {
  discord: ['discord.com', 'discordapp.com'],
  slack: ['hooks.slack.com'],
};

/**
 * Validates and sanitizes a webhook URL against allowed domains
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
    
    // Must be HTTPS
    if (parsed.protocol !== 'https:') return '';
    
    // Check against allowed domains
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
 * Sanitizes country code list (only 2-letter uppercase ISO codes)
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
 * Sanitizes email templates by stripping dangerous HTML tags
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
  
  const dangerousTags = /<\s*\/?\s*(script|iframe|object|embed|form|input|button|link|meta|base)\b[^>]*>/gi;
  const dangerousAttrs = /\s(on\w+|javascript\s*:)[^=]*=/gi;
  
  const result = {};
  for (const [key, defaultVal] of Object.entries(defaults)) {
    const tpl = templates[key];
    if (!tpl || typeof tpl !== 'object') {
      result[key] = defaultVal;
      continue;
    }
    result[key] = {
      subject: typeof tpl.subject === 'string' ? tpl.subject.substring(0, 200) : '',
      html: typeof tpl.html === 'string' 
        ? tpl.html.replace(dangerousTags, '').replace(dangerousAttrs, ' ').substring(0, 10000)
        : '',
      text: typeof tpl.text === 'string' ? tpl.text.substring(0, 5000) : '',
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
   * Get plugin settings
   */
  async getSettings(ctx) {
    try {
      const pluginStore = strapi.store({
        type: 'plugin',
        name: 'magic-sessionmanager',
      });
      
      let settings = await pluginStore.get({ key: 'settings' });
      
      // If no settings exist, return defaults
      if (!settings) {
        settings = {
          inactivityTimeout: 15,
          cleanupInterval: 30,
          lastSeenRateLimit: 30,
          retentionDays: 90,
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
          emailTemplates: {
            suspiciousLogin: { subject: '', html: '', text: '' },
            newLocation: { subject: '', html: '', text: '' },
            vpnProxy: { subject: '', html: '', text: '' },
          },
        };
      }
      
      ctx.send({ 
        settings,
        success: true 
      });
    } catch (error) {
      strapi.log.error('[magic-sessionmanager/settings] Error getting settings:', error);
      ctx.badRequest('Error loading settings');
    }
  },

  /**
   * Update plugin settings
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
      
      // Validate and sanitize settings
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
        emailTemplates: sanitizeEmailTemplates(body.emailTemplates),
      };
      
      // Save to database
      await pluginStore.set({ 
        key: 'settings', 
        value: sanitizedSettings 
      });
      
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

