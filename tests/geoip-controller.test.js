'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const geoipController = require('../server/src/controllers/geoip');
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
      throw new Error(message);
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
    global.strapi = createStrapi({
      settings: { geoIpDatabasePath: '/tmp/GeoLite2-Country.mmdb' },
      credentials: { accountId: '12345', licenseKey: 'very-secret' },
    });

    const ctx = createCtx();
    await geoipController.getStatus(ctx);

    assert.equal(ctx.sent.success, true);
    assert.equal(ctx.sent.status.hasCredentials, true);
    assert.equal(ctx.sent.status.credentialSource, 'store');
    assert.equal(ctx.sent.status.accountId, '12345');
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
  global.strapi = createStrapi({
    settings: { geoIpProvider: 'local-mmdb' },
  });

  const ctx = createCtx({
    accountId: ' 12345 ',
    licenseKey: ' license-key ',
  });

  await geoipController.storeCredentials(ctx);

  assert.equal(ctx.sent.success, true);
  assert.equal(ctx.sent.hasCredentials, true);
  assert.equal(ctx.sent.accountId, '12345');
  assert.deepEqual(global.strapi.__stored.settings, { geoIpProvider: 'local-mmdb' });
  assert.deepEqual(global.strapi.__stored.geoipCredentials, {
    accountId: '12345',
    licenseKey: 'license-key',
  });
});
