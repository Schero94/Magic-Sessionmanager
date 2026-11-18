'use strict';

// Strapi peer floor. The real-HTTP suites fail below Strapi 5.50.0: the
// plugin calls `listSessions` / `revokeSessionById` on Strapi's session
// manager and reads the `metadata` column of `admin::session`, all added in
// Strapi 5.50.0 ("active devices session management", strapi/strapi#26628).
// The peer range, the start-up check and the CI floor job must agree.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const register = require('../server/src/register');
const {
  MIN_STRAPI_VERSION,
  isSupportedStrapiVersion,
} = require('../server/src/utils/strapi-version');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/**
 * Minimal Strapi double for the register hook, with a given runtime version.
 *
 * @param {string|undefined} version Value of `info.strapi`.
 * @returns {{strapi: object, errors: string[]}} The double and the error lines it received.
 */
function fakeStrapi(version) {
  const errors = [];
  const strapi = {
    admin: { services: { permission: { actionProvider: { registerMany() {} } } } },
    config: { get: (key, fallback) => (key === 'info.strapi' ? version : fallback) },
    contentType: () => ({ attributes: {} }),
    db: { lifecycles: { subscribe() {} } },
    plugin: () => ({ service: () => ({}) }),
    log: {
      debug() {},
      info() {},
      warn() {},
      error: (message) => errors.push(String(message)),
    },
  };
  return { strapi, errors };
}

test('the floor is Strapi 5.50.0', () => {
  assert.equal(MIN_STRAPI_VERSION, '5.50.0');
});

test('versions below the floor are unsupported, the floor and later 5.x are supported', () => {
  for (const version of ['5.0.0', '5.13.0', '5.24.0', '5.49.0', '5.49.9'])
    assert.equal(isSupportedStrapiVersion(version), false, version);
  for (const version of ['5.50.0', '5.50.1', '5.62.0', '5.100.0'])
    assert.equal(isSupportedStrapiVersion(version), true, version);
  assert.equal(isSupportedStrapiVersion('6.0.0'), false, 'Strapi 6 is not a tested peer');
});

test('an unknown or malformed version is not judged', () => {
  for (const version of [undefined, null, '', 'latest', 5])
    assert.equal(isSupportedStrapiVersion(version), null, String(version));
});

test('register logs one clear error on a Strapi version below the floor', async () => {
  const { strapi, errors } = fakeStrapi('5.49.0');
  await register({ strapi });
  const floorErrors = errors.filter((line) => line.includes('5.50.0'));
  assert.equal(floorErrors.length, 1, errors.join('\n'));
  assert.match(floorErrors[0], /Strapi 5\.49\.0/);
  assert.match(floorErrors[0], /requires Strapi 5\.50\.0 or later/);
});

test('register logs no floor error on a supported or unknown Strapi version', async () => {
  for (const version of ['5.50.0', '5.62.0', undefined]) {
    const { strapi, errors } = fakeStrapi(version);
    await register({ strapi });
    assert.deepEqual(
      errors.filter((line) => line.includes('5.50.0')),
      [],
      String(version)
    );
  }
});

test('the Strapi peers declare the same floor', () => {
  assert.equal(pkg.peerDependencies['@strapi/strapi'], `^${MIN_STRAPI_VERSION}`);
  assert.equal(pkg.peerDependencies['@strapi/plugin-users-permissions'], `^${MIN_STRAPI_VERSION}`);
});

test('CI installs and tests the floor', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/test.yml'), 'utf8');
  assert.match(workflow, new RegExp(`@strapi/strapi@${MIN_STRAPI_VERSION.replace(/\./g, '\\.')}`));
  assert.match(
    workflow,
    new RegExp(`@strapi/plugin-users-permissions@${MIN_STRAPI_VERSION.replace(/\./g, '\\.')}`)
  );
});
