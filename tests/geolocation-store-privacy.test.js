'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createGeolocationService = require('../server/src/services/geolocation');
const {
  getPluginSettings,
  invalidateSettingsCache,
} = require('../server/src/utils/settings-loader');

test('unavailable settings store cannot override a saved geolocation opt-out', async (t) => {
  let available = false;
  let fetchCalls = 0;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    fetchCalls++;
    throw new Error('unexpected network access');
  };
  t.after(() => {
    global.fetch = originalFetch;
    invalidateSettingsCache();
  });

  const strapi = {
    config: { get: () => ({ enableGeolocation: true, geoIpProvider: 'ipapi' }) },
    store: () => ({
      get: async () => {
        if (!available) throw new Error('store unavailable');
        return { enableGeolocation: false, geoIpProvider: 'ipapi' };
      },
    }),
    log: { debug() {}, error() {}, info() {}, warn() {} },
  };
  invalidateSettingsCache();
  const service = createGeolocationService({ strapi });

  assert.equal((await service.getIpInfo('8.8.8.8'))._status, 'disabled');
  assert.equal(fetchCalls, 0);
  assert.equal((await getPluginSettings(strapi)).strictSessionEnforcement, true);

  available = true;
  invalidateSettingsCache();
  assert.equal((await service.getIpInfo('8.8.8.8'))._status, 'disabled');
  assert.equal(fetchCalls, 0);
});

test('geolocation resumes an explicitly enabled provider after store recovery', async (t) => {
  let available = false;
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls++;
    return {
      ok: true,
      json: async () => ({ ip: '1.1.1.1', country_name: 'Example', country_code: 'EX' }),
    };
  };
  t.after(() => {
    global.fetch = originalFetch;
    invalidateSettingsCache();
  });

  const strapi = {
    config: { get: () => ({ enableGeolocation: true, geoIpProvider: 'ipapi' }) },
    store: () => ({
      get: async () => {
        if (!available) throw new Error('store unavailable');
        return { enableGeolocation: true, geoIpProvider: 'ipapi' };
      },
    }),
    log: { debug() {}, error() {}, info() {}, warn() {} },
  };
  invalidateSettingsCache();
  const service = createGeolocationService({ strapi });
  assert.equal((await service.getIpInfo('1.1.1.1'))._status, 'disabled');
  assert.equal(fetchCalls, 0);

  available = true;
  invalidateSettingsCache();
  assert.equal((await service.getIpInfo('1.1.1.1'))._status, 'ok');
  assert.equal(fetchCalls, 1);
});

test('equivalent private IP literals never reach the provider', async (t) => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls++;
    return { ok: true, json: async () => ({ country_name: 'Example', country_code: 'EX' }) };
  };
  t.after(() => {
    global.fetch = originalFetch;
    invalidateSettingsCache();
  });
  const strapi = {
    config: { get: () => ({ enableGeolocation: true, geoIpProvider: 'ipapi' }) },
    store: () => ({ get: async () => ({}) }),
    log: { debug() {}, error() {}, info() {}, warn() {} },
  };
  invalidateSettingsCache();
  const service = createGeolocationService({ strapi });
  for (const address of [
    '::ffff:7f00:1',
    '0:0:0:0:0:ffff:0a00:0001',
    '::ffff:c0a8:101',
    '::0001',
    '0:0:0:0:0:0:0:0001',
    '0:0:0:0:0:0:0:0000',
  ]) {
    assert.equal((await service.getIpInfo(address))._status, 'private', address);
  }
  assert.equal(fetchCalls, 0);
  assert.equal((await service.getIpInfo('::ffff:0808:0404'))._status, 'ok');
  assert.equal(fetchCalls, 1);
});

test('automatic fallback does not log local reader error details', async (t) => {
  const fs = require('node:fs');
  const originalExists = fs.existsSync;
  const warnings = [];
  fs.existsSync = () => true;
  t.after(() => {
    fs.existsSync = originalExists;
  });
  const strapi = { log: { warn: (...args) => warnings.push(args.join(' ')) } };
  const service = createGeolocationService({ strapi });
  service.getGeoSettings = async () => ({ enableGeolocation: true, geoIpProvider: 'auto' });
  service.getLocalMmdbIpInfo = async () => ({
    _status: 'error',
    _reason: 'private-path-and-ip-marker',
  });
  service.getIpapiIpInfo = async () => ({ _status: 'ok', _source: 'fake' });
  assert.equal((await service.getIpInfo('8.8.4.4'))._source, 'fake');
  assert.equal(warnings.length, 1);
  assert.doesNotMatch(warnings[0], /private-path-and-ip-marker/);
});
