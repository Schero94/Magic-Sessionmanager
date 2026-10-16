'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const createGeoIpController = require('../server/src/controllers/geoip');
const { invalidateSettingsCache } = require('../server/src/utils/settings-loader');

function createCtx(body = {}) {
  return {
    request: { body },
    sent: null,
    error: null,
    send(payload) {
      this.sent = payload;
    },
    badRequest(message) {
      this.error = message;
      return message;
    },
  };
}

function createStrapi({ settings = {}, credentials = {} } = {}) {
  const stored = {
    settings,
    geoipCredentials: credentials,
  };

  return {
    config: {
      get(key) {
        return key === 'plugin::magic-sessionmanager' ? {} : {};
      },
    },
    store: () => ({
      get: async ({ key }) => stored[key] || null,
      set: async ({ key, value }) => {
        stored[key] = value;
      },
    }),
    log: {
      debug() {},
      error() {},
      info() {},
      warn() {},
    },
    __stored: stored,
  };
}

test('geoip status reports stored credentials without leaking license key', async () => {
  invalidateSettingsCache();
  const previousAccount = process.env.MAXMIND_ACCOUNT_ID;
  const previousLicense = process.env.MAXMIND_LICENSE_KEY;
  delete process.env.MAXMIND_ACCOUNT_ID;
  delete process.env.MAXMIND_LICENSE_KEY;

  try {
    const strapi = createStrapi({
      settings: { geoIpDatabasePath: 'GeoLite2-Country.mmdb' },
      credentials: { accountId: '12345', licenseKey: 'very-secret' },
    });

    const geoipController = createGeoIpController({ strapi });
    const ctx = createCtx();
    await geoipController.getStatus(ctx);

    assert.equal(ctx.sent.success, true);
    assert.equal(ctx.sent.status.hasCredentials, true);
    assert.equal(ctx.sent.status.credentialSource, 'store');
    assert.equal(ctx.sent.status.accountId, '12345');
    assert.equal(ctx.sent.status.editionId, 'GeoLite2-Country');
    assert.equal(ctx.sent.status.databaseDirectory, 'data/magic-sessionmanager/geoip');
    assert.equal(ctx.sent.status.databasePath, 'data/magic-sessionmanager/geoip/GeoLite2-Country.mmdb');
    assert.doesNotMatch(ctx.sent.status.databasePath, /^\//);
    assert.equal(ctx.sent.status.licenseKey, undefined);
    assert.equal(JSON.stringify(ctx.sent).includes('very-secret'), false);
  } finally {
    if (previousAccount === undefined) delete process.env.MAXMIND_ACCOUNT_ID;
    else process.env.MAXMIND_ACCOUNT_ID = previousAccount;
    if (previousLicense === undefined) delete process.env.MAXMIND_LICENSE_KEY;
    else process.env.MAXMIND_LICENSE_KEY = previousLicense;
  }
});

test('geoip credentials are stored separately from plugin settings', async () => {
  invalidateSettingsCache();
  const strapi = createStrapi({
    settings: { geoIpProvider: 'local-mmdb' },
  });
  const geoipController = createGeoIpController({ strapi });

  const ctx = createCtx({
    accountId: ' 12345 ',
    licenseKey: ' license-key ',
  });

  await geoipController.storeCredentials(ctx);

  assert.equal(ctx.sent.success, true);
  assert.equal(ctx.sent.hasCredentials, true);
  assert.equal(ctx.sent.accountId, '12345');
  assert.deepEqual(strapi.__stored.settings, { geoIpProvider: 'local-mmdb' });
  assert.deepEqual(strapi.__stored.geoipCredentials, {
    accountId: '12345',
    licenseKey: 'license-key',
  });
});

test('geoip update refuses missing credentials without invoking the updater', async () => {
  invalidateSettingsCache();
  const strapi = createStrapi();
  let updaterCalls = 0;
  const geoipController = createGeoIpController({
    strapi,
    updateGeoIpDatabase: async () => {
      updaterCalls += 1;
      return { changed: true };
    },
  });
  const ctx = createCtx({ force: true });

  await geoipController.updateDatabase(ctx);

  assert.equal(ctx.error, 'MaxMind credentials are required before downloading GeoIP data');
  assert.equal(updaterCalls, 0);
});

test('geoip update passes a validated local config to its updater and returns the result', async () => {
  invalidateSettingsCache();
  const previousAccount = process.env.MAXMIND_ACCOUNT_ID;
  const previousLicense = process.env.MAXMIND_LICENSE_KEY;
  delete process.env.MAXMIND_ACCOUNT_ID;
  delete process.env.MAXMIND_LICENSE_KEY;

  try {
    const strapi = createStrapi({
      settings: { geoIpDatabasePath: 'GeoLite2-Country.mmdb' },
      credentials: { accountId: 'synthetic-account', licenseKey: 'synthetic-license-key' },
    });
    let receivedConfig;
    const geoipController = createGeoIpController({
      strapi,
      updateGeoIpDatabase: async (config) => {
        receivedConfig = config;
        return { changed: true, bytes: 16 };
      },
    });
    const ctx = createCtx({ force: true });

    await geoipController.updateDatabase(ctx);

    assert.equal(receivedConfig.force, true);
    assert.equal(receivedConfig.accountId, 'synthetic-account');
    assert.equal(receivedConfig.licenseKey, 'synthetic-license-key');
    assert.match(receivedConfig.outputPath, /GeoLite2-Country\.mmdb$/);
    assert.deepEqual(ctx.sent, { success: true, result: { changed: true, bytes: 16 } });
  } finally {
    if (previousAccount === undefined) delete process.env.MAXMIND_ACCOUNT_ID;
    else process.env.MAXMIND_ACCOUNT_ID = previousAccount;
    if (previousLicense === undefined) delete process.env.MAXMIND_LICENSE_KEY;
    else process.env.MAXMIND_LICENSE_KEY = previousLicense;
  }
});
