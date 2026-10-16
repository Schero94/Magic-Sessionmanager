'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_GEOIP_DIRECTORY,
  fileExists,
  readMetadata,
  resolveDatabaseTarget,
  resolveConfig,
  updateGeoIpDatabase,
} = require('../../../scripts/geoip-updater.cjs');
const {
  getPluginSettings,
  invalidateSettingsCache,
  normalizeGeoIpDatabasePath,
} = require('../utils/settings-loader');

const CREDENTIALS_KEY = 'geoipCredentials';
const SAFE_GEOIP_DIRECTORY_LABEL = 'data/magic-sessionmanager/geoip';
const DEFAULT_CITY_DATABASE_PATH = resolveDatabaseTarget('GeoLite2-City.mmdb');
const DEFAULT_COUNTRY_DATABASE_PATH = resolveDatabaseTarget('GeoLite2-Country.mmdb');

/**
 * Returns the plugin store used for MaxMind credentials.
 *
 * @param {object} strapi Strapi instance
 * @returns {object} Plugin store interface
 */
function getGeoIpStore(strapi) {
  return strapi.store({
    type: 'plugin',
    name: 'magic-sessionmanager',
  });
}

/**
 * Reads MaxMind credentials from the plugin store for the authenticated admin
 * operation that requires them.
 *
 * @param {object} strapi Strapi instance
 * @returns {Promise<{accountId: string, licenseKey: string}>}
 */
async function getStoredCredentials(strapi) {
  const store = getGeoIpStore(strapi);
  const credentials = await store.get({ key: CREDENTIALS_KEY });
  if (!credentials || typeof credentials !== 'object') {
    return {};
  }
  return {
    accountId: typeof credentials.accountId === 'string' ? credentials.accountId : '',
    licenseKey: typeof credentials.licenseKey === 'string' ? credentials.licenseKey : '',
  };
}

/**
 * Stores or clears MaxMind credentials separately from public plugin settings.
 *
 * @param {object} strapi Strapi instance
 * @param {{accountId: string, licenseKey: string}} credentials
 * @returns {Promise<void>}
 * @sideeffect Writes credential values to the plugin store
 */
async function setStoredCredentials(strapi, credentials) {
  const store = getGeoIpStore(strapi);
  await store.set({
    key: CREDENTIALS_KEY,
    value: credentials,
  });
}

/**
 * Identifies whether a complete MaxMind credential pair comes from the
 * environment or the plugin store without returning the license key.
 *
 * @param {{accountId?: string, licenseKey?: string}} storedCredentials
 * @returns {'env'|'store'|'missing'} Credential source state
 */
function getCredentialSource(storedCredentials) {
  if (process.env.MAXMIND_ACCOUNT_ID && process.env.MAXMIND_LICENSE_KEY) {
    return 'env';
  }
  if (storedCredentials.accountId && storedCredentials.licenseKey) {
    return 'store';
  }
  return 'missing';
}

/**
 * Builds a MaxMind updater configuration with a destination confined to the
 * dedicated GeoIP directory. Stored settings contribute a filename, never an
 * arbitrary filesystem path.
 *
 * @param {object} settings Normalized plugin settings
 * @param {object} storedCredentials MaxMind credentials from the plugin store
 * @param {boolean} [force=false] Whether to bypass the Last-Modified check
 * @returns {object} Safe updater configuration
 */
function buildUpdaterConfig(settings, storedCredentials, force = false) {
  const configuredPath = normalizeGeoIpDatabasePath(settings.geoIpDatabasePath);
  let configuredFilename = '';
  if (configuredPath) {
    try {
      configuredFilename = path.basename(resolveDatabaseTarget(configuredPath));
    } catch {
      configuredFilename = '';
    }
  }
  const existingDefaultPath = !configuredFilename && fs.existsSync(DEFAULT_CITY_DATABASE_PATH)
    ? DEFAULT_CITY_DATABASE_PATH
    : !configuredFilename && fs.existsSync(DEFAULT_COUNTRY_DATABASE_PATH)
      ? DEFAULT_COUNTRY_DATABASE_PATH
      : '';
  const outputPath = resolveDatabaseTarget(
    configuredFilename || (existingDefaultPath ? path.basename(existingDefaultPath) : undefined),
    DEFAULT_GEOIP_DIRECTORY
  );

  return resolveConfig(process.env, force ? ['--force'] : [], {
    accountId: process.env.MAXMIND_ACCOUNT_ID || storedCredentials.accountId || '',
    licenseKey: process.env.MAXMIND_LICENSE_KEY || storedCredentials.licenseKey || '',
    outputPath,
    databaseDirectory: DEFAULT_GEOIP_DIRECTORY,
    force,
  });
}

/**
 * Bounds credential input and removes NUL bytes before storage.
 *
 * @param {unknown} value Raw form value
 * @param {number} [maxLength=256] Maximum accepted string length
 * @returns {string} Sanitized value
 */
function sanitizeCredentialInput(value, maxLength = 256) {
  if (typeof value !== 'string') return '';
  return value.replace(/\0/g, '').trim().slice(0, maxLength);
}

/**
 * Creates the protected GeoIP controller with explicit Strapi and updater
 * dependencies. The updater can be replaced by a local fake in tests so an
 * API contract check never needs to contact MaxMind or write a database file.
 *
 * @param {{strapi: object, updateGeoIpDatabase?: (config: object) => Promise<object>}} dependencies
 * @returns {object} GeoIP controller actions
 */
module.exports = ({ strapi, updateGeoIpDatabase: updateDatabase = updateGeoIpDatabase } = {}) => ({
  /**
   * Reports local GeoIP database state without returning the stored license key.
   *
   * @route GET /magic-sessionmanager/geoip/status
   * @returns {Promise<void>}
   */
  async getStatus(ctx) {
    try {
      const settings = await getPluginSettings(strapi);
      const storedCredentials = await getStoredCredentials(strapi);
      const config = buildUpdaterConfig(settings, storedCredentials, false);
      const metadataPath = `${config.outputPath}.metadata.json`;
      const [exists, metadata] = await Promise.all([
        fileExists(config.outputPath),
        readMetadata(metadataPath),
      ]);
      const credentialSource = getCredentialSource(storedCredentials);

      ctx.send({
        success: true,
        status: {
          provider: settings.geoIpProvider || 'auto',
          editionId: config.editionId,
          databasePath: `${SAFE_GEOIP_DIRECTORY_LABEL}/${path.basename(config.outputPath)}`,
          databaseDirectory: SAFE_GEOIP_DIRECTORY_LABEL,
          exists,
          metadata,
          hasCredentials: credentialSource !== 'missing',
          credentialSource,
          accountId: process.env.MAXMIND_ACCOUNT_ID || storedCredentials.accountId || '',
        },
      });
    } catch (error) {
      strapi.log.error('[magic-sessionmanager/geoip] Error getting status:', error?.name || 'Error');
      return ctx.badRequest('Error getting GeoIP status');
    }
  },

  /**
   * Stores or clears MaxMind credentials for an administrator-triggered update.
   *
   * @route PUT /magic-sessionmanager/geoip/credentials
   * @returns {Promise<void>}
   * @sideeffect Writes the plugin credential store
   */
  async storeCredentials(ctx) {
    try {
      const body = ctx.request.body || {};

      if (body.clear === true) {
        await setStoredCredentials(strapi, {});
        return ctx.send({ success: true, hasCredentials: false });
      }

      const accountId = sanitizeCredentialInput(body.accountId, 64);
      const licenseKey = sanitizeCredentialInput(body.licenseKey, 256);

      if (!accountId || !licenseKey) {
        return ctx.badRequest('MaxMind account ID and license key are required');
      }

      await setStoredCredentials(strapi, { accountId, licenseKey });

      ctx.send({
        success: true,
        hasCredentials: true,
        accountId,
      });
    } catch (error) {
      strapi.log.error('[magic-sessionmanager/geoip] Error storing credentials:', error?.name || 'Error');
      return ctx.badRequest('Error storing GeoIP credentials');
    }
  },

  /**
   * Downloads a database only after validating the canonical destination.
   *
   * @route POST /magic-sessionmanager/geoip/update
   * @returns {Promise<void>}
   * @sideeffect Contacts MaxMind and writes files inside the dedicated GeoIP directory
   */
  async updateDatabase(ctx) {
    try {
      const body = ctx.request.body || {};
      const force = body.force === true;
      const settings = await getPluginSettings(strapi);
      const storedCredentials = await getStoredCredentials(strapi);
      const config = buildUpdaterConfig(settings, storedCredentials, force);

      if (!config.accountId || !config.licenseKey) {
        return ctx.badRequest('MaxMind credentials are required before downloading GeoIP data');
      }

      const result = await updateDatabase(config);
      invalidateSettingsCache();

      ctx.send({
        success: true,
        result,
      });
    } catch (error) {
      strapi.log.error('[magic-sessionmanager/geoip] Error updating database:', error?.name || 'Error');
      return ctx.badRequest('Error updating GeoIP database');
    }
  },

  __private: {
    buildUpdaterConfig,
    getCredentialSource,
    getStoredCredentials,
    sanitizeCredentialInput,
  },
});
