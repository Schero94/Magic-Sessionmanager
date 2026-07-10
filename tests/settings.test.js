'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeStoredSettings,
  getSessionCreationGraceMs,
} = require('../server/src/utils/settings-loader');

const settingsController = require('../server/src/controllers/settings');

function createSettingsCtx(body) {
  return {
    request: { body },
    sent: null,
    send(payload) {
      this.sent = payload;
    },
    badRequest(message) {
      throw new Error(message);
    },
  };
}

test('normalizeStoredSettings preserves retentionDays=-1 as forever', () => {
  const settings = normalizeStoredSettings({ retentionDays: -1 });

  assert.equal(settings.retentionDays, -1);
});

test('updateSettings stores retentionDays=-1 from the admin UI', async () => {
  let storedSettings = null;
  global.strapi = {
    store: () => ({
      set: async ({ value }) => {
        storedSettings = value;
      },
    }),
    log: {
      info() {},
      error() {},
    },
  };

  const ctx = createSettingsCtx({
    inactivityTimeout: 15,
    cleanupInterval: 30,
    lastSeenRateLimit: 30,
    retentionDays: -1,
    maxSessionAgeDays: 30,
    sessionCreationGraceMs: 5000,
    maxFailedLogins: 5,
    allowedCountries: [],
    blockedCountries: [],
    emailTemplates: {},
  });

  await settingsController.updateSettings(ctx);

  assert.equal(storedSettings.retentionDays, -1);
  assert.equal(ctx.sent.settings.retentionDays, -1);
});

test('getSessionCreationGraceMs treats 0 as an explicit off value', () => {
  assert.equal(typeof getSessionCreationGraceMs, 'function');
  assert.equal(getSessionCreationGraceMs({ sessionCreationGraceMs: 0 }), 0);
  assert.equal(getSessionCreationGraceMs({ sessionCreationGraceMs: 2000 }), 2000);
  assert.equal(getSessionCreationGraceMs({}), 5000);
});

test('normalizeStoredSettings sanitizes local GEOIP provider settings', () => {
  const settings = normalizeStoredSettings({
    geoIpProvider: 'local-mmdb',
    geoIpDatabasePath: ' /var/lib/GeoLite2-Country.mmdb ',
    geoLookupFailureMode: 'block',
  });

  assert.equal(settings.geoIpProvider, 'local-mmdb');
  assert.equal(settings.geoIpDatabasePath, '/var/lib/GeoLite2-Country.mmdb');
  assert.equal(settings.geoLookupFailureMode, 'block');

  const invalid = normalizeStoredSettings({
    geoIpProvider: 'mystery-provider',
    geoLookupFailureMode: 'panic',
  });

  assert.equal(invalid.geoIpProvider, 'auto');
  assert.equal(invalid.geoLookupFailureMode, 'auto');
});

test('updateSettings stores local GEOIP firewall settings', async () => {
  let storedSettings = null;
  global.strapi = {
    store: () => ({
      set: async ({ value }) => {
        storedSettings = value;
      },
    }),
    log: {
      info() {},
      error() {},
    },
  };

  const ctx = createSettingsCtx({
    inactivityTimeout: 15,
    cleanupInterval: 30,
    lastSeenRateLimit: 30,
    retentionDays: 90,
    maxSessionAgeDays: 30,
    sessionCreationGraceMs: 5000,
    maxFailedLogins: 5,
    allowedCountries: [],
    blockedCountries: ['RU'],
    emailTemplates: {},
    enableGeofencing: true,
    geoIpProvider: 'local-mmdb',
    geoIpDatabasePath: '/var/lib/GeoLite2-Country.mmdb',
    geoLookupFailureMode: 'block',
  });

  await settingsController.updateSettings(ctx);

  assert.equal(storedSettings.geoIpProvider, 'local-mmdb');
  assert.equal(storedSettings.geoIpDatabasePath, '/var/lib/GeoLite2-Country.mmdb');
  assert.equal(storedSettings.geoLookupFailureMode, 'block');
  assert.deepEqual(storedSettings.blockedCountries, ['RU']);
});

test('getSettings merges old partial settings with every current default', async () => {
  let response;
  global.strapi = {
    store: () => ({
      get: async () => ({ enableGeolocation: false }),
    }),
    log: { error() {} },
  };
  const ctx = {
    send(payload) {
      response = payload;
    },
    badRequest(message) {
      throw new Error(message);
    },
  };

  await settingsController.getSettings(ctx);

  assert.equal(response.settings.enableGeolocation, false);
  assert.equal(response.settings.inactivityTimeout, 15);
  assert.equal(response.settings.maxFailedLogins, 5);
  assert.equal(response.settings.sessionCreationGraceMs, 5000);
  assert.equal(response.settings.cleanupUseDbDirect, false);
});
