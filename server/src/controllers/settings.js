'use strict';

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
        inactivityTimeout: parseInt(body.inactivityTimeout) || 15,
        cleanupInterval: parseInt(body.cleanupInterval) || 30,
        lastSeenRateLimit: parseInt(body.lastSeenRateLimit) || 30,
        retentionDays: parseInt(body.retentionDays) || 90,
        enableGeolocation: !!body.enableGeolocation,
        enableSecurityScoring: !!body.enableSecurityScoring,
        blockSuspiciousSessions: !!body.blockSuspiciousSessions,
        maxFailedLogins: parseInt(body.maxFailedLogins) || 5,
        enableEmailAlerts: !!body.enableEmailAlerts,
        alertOnSuspiciousLogin: !!body.alertOnSuspiciousLogin,
        alertOnNewLocation: !!body.alertOnNewLocation,
        alertOnVpnProxy: !!body.alertOnVpnProxy,
        enableWebhooks: !!body.enableWebhooks,
        discordWebhookUrl: String(body.discordWebhookUrl || ''),
        slackWebhookUrl: String(body.slackWebhookUrl || ''),
        enableGeofencing: !!body.enableGeofencing,
        allowedCountries: Array.isArray(body.allowedCountries) ? body.allowedCountries : [],
        blockedCountries: Array.isArray(body.blockedCountries) ? body.blockedCountries : [],
        emailTemplates: body.emailTemplates || {
          suspiciousLogin: { subject: '', html: '', text: '' },
          newLocation: { subject: '', html: '', text: '' },
          vpnProxy: { subject: '', html: '', text: '' },
        },
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

