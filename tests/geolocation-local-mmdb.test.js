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

test('auto provider keeps local MMDB errors when fail-closed mode is configured', async () => {
  invalidateSettingsCache();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-sessionmanager-geoip-'));
  const dbPath = path.join(tmpDir, 'GeoLite2-Country.mmdb');
  fs.writeFileSync(dbPath, 'fake-mmdb');

  let fetchCalls = 0;
  const fetchBefore = global.fetch;
  global.fetch = async () => {
    fetchCalls += 1;
    return {
      ok: true,
      json: async () => ({ ip: '8.8.8.8', country_name: 'United States', country_code: 'US' }),
    };
  };

  try {
    await withFakeMaxmind({
      Reader: {
        open: async () => ({
          country() {
            throw new Error('corrupt mmdb');
          },
        }),
      },
    }, async () => {
      const service = createGeolocationService({
        strapi: createStrapi({
          geoIpProvider: 'auto',
          geoIpDatabasePath: dbPath,
          geoLookupFailureMode: 'block',
        }),
      });

      const result = await service.getIpInfo('8.8.8.8');

      assert.equal(result._status, 'error');
      assert.equal(result._source, 'local-mmdb');
      assert.match(result._reason, /corrupt mmdb/);
      assert.equal(fetchCalls, 0);
    });
  } finally {
    global.fetch = fetchBefore;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('auto provider may fall back to ipapi when local MMDB fails in allow mode', async () => {
  invalidateSettingsCache();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-sessionmanager-geoip-'));
  const dbPath = path.join(tmpDir, 'GeoLite2-Country.mmdb');
  fs.writeFileSync(dbPath, 'fake-mmdb');

  let fetchCalls = 0;
  const fetchBefore = global.fetch;
  global.fetch = async (url) => {
    fetchCalls += 1;
    assert.match(url, /^https:\/\/ipapi\.co\/8\.8\.4\.4\/json\//);
    return {
      ok: true,
      json: async () => ({
        ip: '8.8.4.4',
        country_name: 'United States',
        country_code: 'US',
      }),
    };
  };

  try {
    await withFakeMaxmind({
      Reader: {
        open: async () => ({
          country() {
            throw new Error('temporary local failure');
          },
        }),
      },
    }, async () => {
      const service = createGeolocationService({
        strapi: createStrapi({
          geoIpProvider: 'auto',
          geoIpDatabasePath: dbPath,
          geoLookupFailureMode: 'allow',
        }),
      });

      const result = await service.getIpInfo('8.8.4.4');

      assert.equal(result._status, 'ok');
      assert.equal(result._source, 'ipapi');
      assert.equal(result.country_code, 'US');
      assert.equal(fetchCalls, 1);
    });
  } finally {
    global.fetch = fetchBefore;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('private IP detection covers IPv4-mapped IPv6 and RFC 4193 variants', () => {
  const service = createGeolocationService({ strapi: createStrapi({}) });

  assert.equal(service.isPrivateIp('10.0.0.1'), true);
  assert.equal(service.isPrivateIp('172.16.0.1'), true);
  assert.equal(service.isPrivateIp('172.31.255.255'), true);
  assert.equal(service.isPrivateIp('172.15.0.1'), false);
  assert.equal(service.isPrivateIp('172.32.0.1'), false);
  assert.equal(service.isPrivateIp('::ffff:10.0.0.1'), true);
  assert.equal(service.isPrivateIp('fd12:3456::1'), true);
  assert.equal(service.isPrivateIp('FE80::1'), true);
  assert.equal(service.isPrivateIp('8.8.8.8'), false);
});

test('invalid IP strings do not trigger remote GeoIP lookups', async () => {
  invalidateSettingsCache();

  let fetchCalls = 0;
  const fetchBefore = global.fetch;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('remote lookup should not be called for invalid IPs');
  };

  try {
    const service = createGeolocationService({
      strapi: createStrapi({
        geoIpProvider: 'ipapi',
      }),
    });

    const result = await service.getIpInfo('not-an-ip');

    assert.equal(result._status, 'error');
    assert.equal(result._source, 'validation');
    assert.match(result._reason, /invalid IP/i);
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = fetchBefore;
  }
});

test('ipapi provider deduplicates 30 concurrent lookups for the same public IP', async () => {
  invalidateSettingsCache();

  let fetchCalls = 0;
  const fetchBefore = global.fetch;
  global.fetch = async (url) => {
    fetchCalls += 1;
    assert.match(url, /^https:\/\/ipapi\.co\/9\.9\.9\.9\/json\//);

    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });

    return {
      ok: true,
      json: async () => ({
        ip: '9.9.9.9',
        country_name: 'United States',
        country_code: 'US',
        city: 'Berkeley',
        region: 'California',
      }),
    };
  };

  try {
    const service = createGeolocationService({
      strapi: createStrapi({
        geoIpProvider: 'ipapi',
      }),
    });

    const results = await Promise.all(
      Array.from({ length: 30 }, () => service.getIpInfo('9.9.9.9'))
    );

    assert.equal(fetchCalls, 1);
    assert.equal(results.length, 30);
    for (const result of results) {
      assert.equal(result._status, 'ok');
      assert.equal(result._source, 'ipapi');
      assert.equal(result.country_code, 'US');
    }

    const cachedResult = await service.getIpInfo('9.9.9.9');
    assert.equal(fetchCalls, 1);
    assert.equal(cachedResult._status, 'ok');
  } finally {
    global.fetch = fetchBefore;
  }
});

test('ipapi provider backs off after HTTP 429 instead of hammering the remote API', async () => {
  invalidateSettingsCache();

  let fetchCalls = 0;
  const warnings = [];
  const fetchBefore = global.fetch;
  global.fetch = async () => {
    fetchCalls += 1;
    return {
      ok: false,
      status: 429,
      headers: {
        get(name) {
          return name.toLowerCase() === 'retry-after' ? '30' : null;
        },
      },
    };
  };

  try {
    const strapi = createStrapi({
      geoIpProvider: 'ipapi',
    });
    strapi.log.warn = (message) => warnings.push(message);
    const service = createGeolocationService({ strapi });

    const firstResult = await service.getIpInfo('9.9.9.10');
    const secondResult = await service.getIpInfo('9.9.9.11');

    assert.equal(firstResult._status, 'rate_limited');
    assert.equal(secondResult._status, 'rate_limited');
    assert.equal(fetchCalls, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /HTTP 429/);
  } finally {
    global.fetch = fetchBefore;
  }
});
