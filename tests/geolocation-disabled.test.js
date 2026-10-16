'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const geoipController = require('../server/src/controllers/session');
const createGeolocationService = require('../server/src/services/geolocation');
const { shouldResolveGeoData } = require('../server/src/utils/enhance-session');
const { invalidateSettingsCache } = require('../server/src/utils/settings-loader');

function createStrapi(settings) {
  return {
    config: { get: () => ({}) },
    store: () => ({ get: async () => settings }),
    plugin: () => ({ service: () => ({}) }),
    log: { debug() {}, error() {}, info() {}, warn() {} },
  };
}

test('disabled geolocation prevents all session enrichment lookups, including geofencing requests', () => {
  assert.equal(shouldResolveGeoData({
    enableGeolocation: false,
    enableGeofencing: true,
    blockSuspiciousSessions: true,
  }), false);
});

test('geolocation service does not call ipapi when the global setting is disabled', async (t) => {
  const previousFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls++;
    throw new Error('network must not be used in this test');
  };
  t.after(() => {
    global.fetch = previousFetch;
  });

  const strapi = createStrapi({ enableGeolocation: false, geoIpProvider: 'auto' });
  invalidateSettingsCache();
  const service = createGeolocationService({ strapi });
  const result = await service.getIpInfo('8.8.8.8');

  assert.equal(fetchCalls, 0);
  assert.equal(result._status, 'disabled');
  assert.equal(result._source, 'disabled');
});

test('geolocation detail route returns a disabled result without calling the provider', async () => {
  const previousStrapi = global.strapi;
  let lookupCalls = 0;
  global.strapi = {
    ...createStrapi({ enableGeolocation: false, geoIpProvider: 'auto' }),
    plugin: () => ({
      service: () => ({
        async getIpInfo() {
          lookupCalls++;
          return { _status: 'ok' };
        },
      }),
    }),
  };
  invalidateSettingsCache();

  const ctx = {
    params: { ipAddress: '8.8.8.8' },
    internalServerError(message) { throw new Error(message); },
    badRequest(message) { throw new Error(message); },
  };

  try {
    await geoipController.getIpGeolocation(ctx);
    assert.equal(lookupCalls, 0);
    assert.equal(ctx.body.success, true);
    assert.equal(ctx.body.data._status, 'disabled');
    assert.equal(ctx.body.data._source, 'disabled');
  } finally {
    global.strapi = previousStrapi;
    invalidateSettingsCache();
  }
});

test('invalid IP input is rejected before the geolocation provider is called', async () => {
  const previousStrapi = global.strapi;
  let lookupCalls = 0;
  global.strapi = {
    ...createStrapi({ enableGeolocation: true, geoIpProvider: 'ipapi' }),
    plugin: () => ({ service: () => ({ getIpInfo: async () => { lookupCalls++; } }) }),
  };
  invalidateSettingsCache();
  const ctx = {
    params: { ipAddress: 'not-an-ip' },
    badRequest(message) { this.error = message; return this.error; },
    internalServerError(message) { throw new Error(message); },
  };

  try {
    await geoipController.getIpGeolocation(ctx);
    assert.equal(lookupCalls, 0);
    assert.equal(ctx.error, 'Invalid IP address format');
  } finally {
    global.strapi = previousStrapi;
    invalidateSettingsCache();
  }
});
