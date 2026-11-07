'use strict';

/**
 * The license feature is removed (no license page, no license routes, no
 * calls to a license or telemetry server). These tests guard that removal
 * and the start-up cleanup of the rows the feature used to store.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  LEGACY_LICENSE_STORE_KEYS,
  coreStoreKey,
  removeLegacyLicenseData,
} = require('../server/src/utils/plugin-store');
const adminRoutes = require('../server/src/routes/admin').routes;
const services = require('../server/src/services');
const controllers = require('../server/src/controllers');

const root = path.join(__dirname, '..');

/**
 * Lists every source file below a directory.
 *
 * @param {string} directory
 * @returns {string[]}
 */
function listFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath));
    else if (/\.(?:c?js|mjs|jsx|json)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

test('no license route, controller or service is registered', () => {
  assert.deepEqual(
    adminRoutes.filter((route) => route.path.startsWith('/license')),
    [],
    'admin routes'
  );
  assert.equal(controllers.license, undefined);
  assert.equal(services['license-guard'], undefined);
});

test('plugin sources contain no license server, telemetry endpoint or license page', () => {
  const forbidden = [
    /magicapi/i,
    /fitlex/i,
    /\/api\/licenses/,
    /MAGIC_LICENSE_/,
    /license-guard/,
    /LicenseGuard/,
    /pages\/License/,
    /settings\.link\.license/,
    /getLicenseTierInfo/,
  ];
  const files = [
    ...listFiles(path.join(root, 'server', 'src')),
    ...listFiles(path.join(root, 'admin', 'src')),
  ];
  assert.ok(files.length > 50, `scanned ${files.length} files`);
  const hits = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      if (pattern.test(source)) hits.push(`${path.relative(root, file)}: ${pattern}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('legacy license cleanup deletes exactly the three former keys in one statement', async () => {
  const calls = [];
  const strapi = {
    db: {
      query: (uid) => ({
        deleteMany: async (params) => {
          calls.push([uid, params]);
          return { count: 3 };
        },
      }),
    },
  };
  assert.deepEqual([...LEGACY_LICENSE_STORE_KEYS], ['licenseKey', 'lastValidated', 'deviceId']);
  assert.equal(await removeLegacyLicenseData(strapi), 3);
  assert.deepEqual(calls, [
    [
      'strapi::core-store',
      {
        where: {
          key: {
            $in: [
              coreStoreKey('licenseKey'),
              coreStoreKey('lastValidated'),
              coreStoreKey('deviceId'),
            ],
          },
        },
      },
    ],
  ]);
  assert.equal(coreStoreKey('licenseKey'), 'plugin_magic-sessionmanager_licenseKey');
});

test('legacy license cleanup is a no-op without a database query API', async () => {
  assert.equal(await removeLegacyLicenseData({}), 0);
  assert.equal(await removeLegacyLicenseData({ db: { query: () => ({}) } }), 0);
});

test('bootstrap runs the cleanup and logs no failure details', () => {
  const bootstrap = fs.readFileSync(path.join(root, 'server', 'src', 'bootstrap.js'), 'utf8');
  assert.match(bootstrap, /await removeLegacyLicenseRows\(strapi, log\);/);
  assert.match(
    bootstrap,
    /log\.warn\('\[CLEANUP\] Could not remove former license data:', err\?\.name \|\| 'Error'\)/
  );
});
