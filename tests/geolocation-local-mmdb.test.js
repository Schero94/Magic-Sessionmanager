'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');

const createGeolocationService = require('../server/src/services/geolocation');
const { invalidateSettingsCache } = require('../server/src/utils/settings-loader');

function createStrapi(config) {
  return {
    config: {
      get(key) {
        return key === 'plugin::magic-sessionmanager' ? config : {};
      },
    },
    store: () => ({
      get: async () => null,
    }),
    log: {
      debug() {},
      error() {},
      info() {},
      warn() {},
    },
  };
}

async function withFakeMaxmind(fakeModule, fn) {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '@maxmind/geoip2-node') {
      return fakeModule;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    await fn();
  } finally {
    Module._load = originalLoad;
  }
}

test('local-mmdb provider returns normalized country data without remote fetch', async () => {
  invalidateSettingsCache();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-sessionmanager-geoip-'));
  const dbPath = path.join(tmpDir, 'GeoLite2-Country.mmdb');
  fs.writeFileSync(dbPath, 'fake-mmdb');

  const openCalls = [];
  const fetchBefore = global.fetch;
  global.fetch = async () => {
    throw new Error('remote lookup should not be used for local-mmdb provider');
  };

  try {
    await withFakeMaxmind({
      Reader: {
        open: async (openedPath) => {
          openCalls.push(openedPath);
          return {
            country(ip) {
              assert.equal(ip, '8.8.8.8');
              return {
                country: {
                  isoCode: 'DE',
                  names: { en: 'Germany', de: 'Deutschland' },
                },
                traits: { network: '8.8.8.0/24' },
              };
            },
          };
        },
      },
    }, async () => {
      const service = createGeolocationService({
        strapi: createStrapi({
          geoIpProvider: 'local-mmdb',
          geoIpDatabasePath: dbPath,
        }),
      });

      const result = await service.getIpInfo('8.8.8.8');

      assert.equal(result._status, 'ok');
      assert.equal(result._source, 'local-mmdb');
      assert.equal(result.country_code, 'DE');
      assert.equal(result.country, 'Germany');
      assert.equal(result.isVpn, false);
      assert.equal(result.isProxy, false);
      assert.equal(result.securityScore, 100);
      assert.deepEqual(openCalls, [dbPath]);
    });
  } finally {
    global.fetch = fetchBefore;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('local-mmdb provider fails locally when configured database is missing', async () => {
  invalidateSettingsCache();

  const missingPath = path.join(os.tmpdir(), `missing-${Date.now()}.mmdb`);
  const openCalls = [];
  const service = createGeolocationService({
    strapi: createStrapi({
      geoIpProvider: 'local-mmdb',
      geoIpDatabasePath: missingPath,
    }),
  });

  await withFakeMaxmind({
    Reader: {
      open: async (openedPath) => {
        openCalls.push(openedPath);
        throw new Error('should not open a missing file');
      },
    },
  }, async () => {
    const result = await service.getIpInfo('8.8.4.4');

    assert.equal(result._status, 'error');
    assert.equal(result._source, 'local-mmdb');
    assert.match(result._reason, /not found|missing/i);
    assert.deepEqual(openCalls, []);
  });
});
