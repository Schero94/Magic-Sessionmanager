'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  fileExists,
  readMetadata,
  resolveConfig,
  updateGeoIpDatabase,
} = require('../../../scripts/geoip-updater.cjs');
const {
  getPluginSettings,
  invalidateSettingsCache,
  normalizeGeoIpDatabasePath,
} = require('../utils/settings-loader');

const CREDENTIALS_KEY = 'geoipCredentials';
const DEFAULT_CITY_DATABASE_PATH = path.resolve(process.cwd(), 'data', 'GeoLite2-City.mmdb');
const DEFAULT_COUNTRY_DATABASE_PATH = path.resolve(process.cwd(), 'data', 'GeoLite2-Country.mmdb');

function getGeoIpStore(strapi) {
  return strapi.store({
    type: 'plugin',
    name: 'magic-sessionmanager',
  });
}

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

async function setStoredCredentials(strapi, credentials) {
  const store = getGeoIpStore(strapi);
  await store.set({
    key: CREDENTIALS_KEY,
    value: credentials,
  });
}

function getCredentialSource(storedCredentials) {
  if (process.env.MAXMIND_ACCOUNT_ID && process.env.MAXMIND_LICENSE_KEY) {
    return 'env';
  }
  if (storedCredentials.accountId && storedCredentials.licenseKey) {
    return 'store';
  }
  return 'missing';
}

function buildUpdaterConfig(settings, storedCredentials, force = false) {
  const outputPath = normalizeGeoIpDatabasePath(settings.geoIpDatabasePath);
  const existingDefaultPath = !outputPath && fs.existsSync(DEFAULT_CITY_DATABASE_PATH)
    ? DEFAULT_CITY_DATABASE_PATH
    : !outputPath && fs.existsSync(DEFAULT_COUNTRY_DATABASE_PATH)
      ? DEFAULT_COUNTRY_DATABASE_PATH
      : '';

  return resolveConfig(process.env, force ? ['--force'] : [], {
    accountId: process.env.MAXMIND_ACCOUNT_ID || storedCredentials.accountId || '',
    licenseKey: process.env.MAXMIND_LICENSE_KEY || storedCredentials.licenseKey || '',
    outputPath: outputPath || existingDefaultPath || undefined,
    force,
  });
}

function sanitizeCredentialInput(value, maxLength = 256) {
  if (typeof value !== 'string') return '';
  return value.replace(/\0/g, '').trim().slice(0, maxLength);
}

module.exports = {
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
          databasePath: config.outputPath,
          databaseDirectory: path.dirname(config.outputPath),
          exists,
          metadata,
          hasCredentials: credentialSource !== 'missing',
          credentialSource,
          accountId: process.env.MAXMIND_ACCOUNT_ID || storedCredentials.accountId || '',
        },
      });
    } catch (error) {
      strapi.log.error('[magic-sessionmanager/geoip] Error getting status:', error);
      return ctx.badRequest('Error getting GeoIP status');
    }
  },

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
      strapi.log.error('[magic-sessionmanager/geoip] Error storing credentials:', error);
      return ctx.badRequest('Error storing GeoIP credentials');
    }
  },

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

      const result = await updateGeoIpDatabase(config);
      invalidateSettingsCache();

      ctx.send({
        success: true,
        result,
      });
    } catch (error) {
      strapi.log.error('[magic-sessionmanager/geoip] Error updating database:', error);
      return ctx.badRequest(error.message || 'Error updating GeoIP database');
    }
  },

  __private: {
    buildUpdaterConfig,
    getCredentialSource,
    getStoredCredentials,
    sanitizeCredentialInput,
  },
};
