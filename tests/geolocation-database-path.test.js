'use strict';

/**
 * Regression: a custom "Database file name" (geoIpDatabasePath) must be read
 * from the plugin's GeoIP folder, where the admin and CLI downloads write it.
 * Up to 4.14 the reader resolved it against the Strapi folder, so a
 * downloaded database with a custom name was never found.
 *
 * The test runs in its own temporary Strapi folder (process.cwd()) before the
 * plugin modules compute their default paths. Databases are synthetic MMDB
 * files read by the real @maxmind/geoip2-node reader.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'msm-dbpath-')));
const originalCwd = process.cwd();
process.chdir(projectRoot);

const { buildMmdb } = require('./helpers/mmdb-writer');
const createGeolocationService = require('../server/src/services/geolocation');
const settingsController = require('../server/src/controllers/settings');
const { invalidateSettingsCache } = require('../server/src/utils/settings-loader');
const { DEFAULT_GEOIP_DIRECTORY } = require('../scripts/geoip-updater.cjs');

const ENV_KEYS = [
  'MAGIC_SESSIONMANAGER_GEOIP_DATABASE',
  'GEOIP_DATABASE_PATH',
  'MAGIC_SESSIONMANAGER_ANONYMOUS_IP_DATABASE',
  'MAGIC_SESSIONMANAGER_ASN_DATABASE',
];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
for (const key of ENV_KEYS) delete process.env[key];

test.after(() => {
  process.chdir(originalCwd);
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

/**
 * Writes a synthetic Country database whose only record names the given
 * country, so each test can tell which file was read.
 *
 * @param {string} filePath Destination.
 * @param {string} isoCode Country code stored for 25.0.0.0/16.
 * @returns {void}
 */
function writeCountryDb(filePath, isoCode) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    buildMmdb({
      databaseType: 'GeoLite2-Country',
      records: [
        {
          network: '25.0.0.0/16',
          data: { country: { iso_code: isoCode, names: { en: isoCode } } },
        },
      ],
    })
  );
}

function createStrapi(config) {
  return {
    config: { get: (key) => (key === 'plugin::magic-sessionmanager' ? config : {}) },
    store: () => ({ get: async () => null, set: async () => {} }),
    log: { debug() {}, error() {}, info() {}, warn() {} },
  };
}

/**
 * Looks up a synthetic address with a custom database file name.
 *
 * @param {string} geoIpDatabasePath Configured value.
 * @returns {Promise<object>} Lookup result.
 */
async function lookUp(geoIpDatabasePath) {
  invalidateSettingsCache();
  const service = createGeolocationService({
    strapi: createStrapi({ geoIpProvider: 'local-mmdb', geoIpDatabasePath }),
  });
  return service.getIpInfo('25.0.0.10');
}

test('the GeoIP folder is the dedicated folder inside the Strapi project', () => {
  assert.equal(DEFAULT_GEOIP_DIRECTORY, path.join(projectRoot, 'data/magic-sessionmanager/geoip'));
});

test('a custom file name is read from the plugin GeoIP folder, where downloads write it', async () => {
  const name = 'GeoIP2-Country.mmdb';
  writeCountryDb(path.join(DEFAULT_GEOIP_DIRECTORY, name), 'DE');
  try {
    const result = await lookUp(name);
    assert.equal(
      result._status,
      'ok',
      'fails before the fix: the file was looked up in the Strapi folder'
    );
    assert.equal(result.country_code, 'DE');
  } finally {
    fs.rmSync(path.join(DEFAULT_GEOIP_DIRECTORY, name), { force: true });
  }
});

test('a file left in the Strapi folder by an older setup is still found', async () => {
  const name = 'GeoLite2-Country.mmdb';
  writeCountryDb(path.join(projectRoot, name), 'FR');
  try {
    const result = await lookUp(name);
    assert.equal(result._status, 'ok');
    assert.equal(result.country_code, 'FR');
  } finally {
    fs.rmSync(path.join(projectRoot, name), { force: true });
  }
});

test('with both copies, the GeoIP folder wins', async () => {
  const name = 'GeoLite2-Country.mmdb';
  writeCountryDb(path.join(DEFAULT_GEOIP_DIRECTORY, name), 'DE');
  writeCountryDb(path.join(projectRoot, name), 'FR');
  try {
    assert.equal((await lookUp(name)).country_code, 'DE');
  } finally {
    fs.rmSync(path.join(DEFAULT_GEOIP_DIRECTORY, name), { force: true });
    fs.rmSync(path.join(projectRoot, name), { force: true });
  }
});

test('an absolute path is used as it is', async () => {
  const absolute = path.join(projectRoot, 'elsewhere', 'GeoLite2-Country.mmdb');
  writeCountryDb(absolute, 'ES');
  const result = await lookUp(absolute);
  assert.equal(result._status, 'ok');
  assert.equal(result.country_code, 'ES');
});

test('a missing file is reported for the GeoIP folder, not the Strapi folder', async () => {
  const result = await lookUp('GeoIP2-City.mmdb');
  assert.equal(result._status, 'error');
  assert.equal(
    result._reason,
    `GeoIP database not found: ${path.join(DEFAULT_GEOIP_DIRECTORY, 'GeoIP2-City.mmdb')}`
  );
});

test('settings refuse path traversal and folders in the file name with a field error', async () => {
  for (const value of [
    '../GeoLite2-City.mmdb',
    '..',
    'sub/GeoLite2-City.mmdb',
    'sub\\GeoLite2-City.mmdb',
    '../../etc/GeoLite2-City.mmdb',
    '/tmp/GeoLite2-City.mmdb',
  ]) {
    let stored = null;
    global.strapi = {
      store: () => ({
        get: async () => null,
        set: async ({ value: next }) => {
          stored = next;
        },
      }),
      log: { info() {}, error() {}, warn() {}, debug() {} },
    };
    const ctx = {
      request: { body: { geoIpDatabasePath: value } },
      send(payload) {
        this.sent = payload;
      },
      badRequest(message, details) {
        this.error = { status: 400, message, details };
        return this.error;
      },
    };
    await settingsController.updateSettings(ctx);
    assert.equal(ctx.error?.status, 400, value);
    assert.deepEqual(
      ctx.error.details.errors.map((error) => error.path),
      [['geoIpDatabasePath']],
      `${value}: one field error on geoIpDatabasePath`
    );
    assert.equal(stored, null, `${value}: nothing is saved`);
  }
  delete global.strapi;
});
