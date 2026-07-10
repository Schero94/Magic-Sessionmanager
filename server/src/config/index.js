'use strict';

/**
 * Default plugin configuration.
 *
 * All time-based values are stored in MILLISECONDS at runtime.
 * Admin-UI settings (stored in plugin store) use user-facing units
 * (minutes, seconds, days) and are converted by `utils/settings-loader.js`.
 */
module.exports = {
  default: {
    debug: false,

    lastSeenRateLimit: 30 * 1000,
    inactivityTimeout: 15 * 60 * 1000,
    cleanupInterval: 30 * 60 * 1000,
    retentionDays: 90,
    maxSessionAgeDays: 30,
    maxFailedLogins: 5,
    sessionCreationGraceMs: 5000,
    cleanupUseDbDirect: false,
    rateLimitWriteMax: 10,
    rateLimitReadMax: 120,
    rateLimitWindowSeconds: 60,

    strictSessionEnforcement: false,

    enableGeolocation: true,
    enableSecurityScoring: true,
    blockSuspiciousSessions: false,
    enableGeofencing: false,
    allowedCountries: [],
    blockedCountries: [],
    geoIpProvider: 'auto',
    geoIpDatabasePath: process.env.MAGIC_SESSIONMANAGER_GEOIP_DATABASE || '',
    geoLookupFailureMode: 'auto',

    enableEmailAlerts: false,
    alertOnSuspiciousLogin: true,
    alertOnNewLocation: true,
    alertOnVpnProxy: true,

    enableWebhooks: false,
    discordWebhookUrl: '',
    slackWebhookUrl: '',

    trustedProxies: null,
  },
  validator: (config) => {
    if (config.lastSeenRateLimit !== undefined && typeof config.lastSeenRateLimit !== 'number') {
      throw new Error('lastSeenRateLimit must be a number (milliseconds)');
    }
    if (config.inactivityTimeout !== undefined && typeof config.inactivityTimeout !== 'number') {
      throw new Error('inactivityTimeout must be a number (milliseconds)');
    }
    if (config.cleanupInterval !== undefined && typeof config.cleanupInterval !== 'number') {
      throw new Error('cleanupInterval must be a number (milliseconds)');
    }
    if (config.maxSessionAgeDays !== undefined && typeof config.maxSessionAgeDays !== 'number') {
      throw new Error('maxSessionAgeDays must be a number (days)');
    }
    if (config.retentionDays !== undefined && typeof config.retentionDays !== 'number') {
      throw new Error('retentionDays must be a number (days)');
    }
    if (config.strictSessionEnforcement !== undefined && typeof config.strictSessionEnforcement !== 'boolean') {
      throw new Error('strictSessionEnforcement must be a boolean');
    }
    if (
      config.geoIpProvider !== undefined &&
      !['auto', 'local-mmdb', 'ipapi', 'disabled'].includes(config.geoIpProvider)
    ) {
      throw new Error('geoIpProvider must be one of: auto, local-mmdb, ipapi, disabled');
    }
    if (config.geoIpDatabasePath !== undefined && typeof config.geoIpDatabasePath !== 'string') {
      throw new Error('geoIpDatabasePath must be a string');
    }
    if (
      config.geoLookupFailureMode !== undefined &&
      !['auto', 'allow', 'block'].includes(config.geoLookupFailureMode)
    ) {
      throw new Error('geoLookupFailureMode must be one of: auto, allow, block');
    }
  },
};
