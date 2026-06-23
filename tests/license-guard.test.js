'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const createLicenseGuard = require('../server/src/services/license-guard');

function createStrapi(logs) {
  const stored = {};

  return {
    config: {
      get(key) {
        if (key === 'plugin::magic-sessionmanager') {
          return { debug: true };
        }
        if (key === 'info.strapi') {
          return '5.0.0';
        }
        return {};
      },
    },
    store: () => ({
      get: async ({ key }) => stored[key] || null,
      set: async ({ key, value }) => {
        stored[key] = value;
      },
    }),
    log: {
      info(message) {
        logs.push(['info', message]);
      },
      warn(message) {
        logs.push(['warn', message]);
      },
      error(message) {
        logs.push(['error', message]);
      },
      debug(message) {
        logs.push(['debug', message]);
      },
    },
  };
}

test('createLicense does not write the generated license key to logs', async () => {
  const previousFetch = global.fetch;
  const logs = [];
  const secretLicenseKey = 'sk_live_secret_license_key';

  global.fetch = async () => ({
    json: async () => ({
      success: true,
      data: {
        licenseKey: secretLicenseKey,
        email: 'admin@example.com',
      },
    }),
  });

  try {
    const service = createLicenseGuard({ strapi: createStrapi(logs) });
    const license = await service.createLicense({
      email: 'admin@example.com',
      firstName: 'Admin',
      lastName: 'User',
    });

    assert.equal(license.licenseKey, secretLicenseKey);
    assert.equal(JSON.stringify(logs).includes(secretLicenseKey), false);
  } finally {
    global.fetch = previousFetch;
  }
});
