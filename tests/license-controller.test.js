'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createLicenseController = require('../server/src/controllers/license');

const SECRET_LICENSE_KEY = 'sk_live_secret_license_key';
const ATTEMPTED_EMAIL = 'attempted@example.invalid';

function createContext({ verification, license } = {}) {
  const logs = [];
  const licenseGuard = {
    verifyLicense: async () => verification,
    getLicenseByKey: async () => license,
    storeLicenseKey: async () => true,
  };
  const strapi = {
    plugin: () => ({ service: () => licenseGuard }),
    log: {
      warn: (message) => logs.push(message),
      error: (message) => logs.push(message),
      info: () => {},
      debug: () => {},
    },
  };
  const ctx = {
    request: { body: { licenseKey: SECRET_LICENSE_KEY, email: ATTEMPTED_EMAIL } },
    badRequest(message) {
      this.status = 400;
      this.message = message;
      return message;
    },
    send(body) {
      this.status = 200;
      this.body = body;
      return body;
    },
  };

  return { controller: createLicenseController({ strapi }), ctx, logs };
}

function createEndpointHarness({
  initialLicenseKey = null,
  adminUser = { email: 'admin@example.invalid', firstname: 'Local', lastname: 'Tester' },
  createLicenseResult = { licenseKey: 'synthetic-license-key', email: 'admin@example.invalid' },
  verification = { valid: true, networkError: false, data: { isActive: true } },
  license = { email: 'admin@example.invalid', isActive: true },
} = {}) {
  const stored = { licenseKey: initialLicenseKey };
  const calls = [];
  const licenseGuard = {
    createLicense: async (payload) => {
      calls.push(['createLicense', payload]);
      return createLicenseResult;
    },
    verifyLicense: async (key) => {
      calls.push(['verifyLicense', key]);
      return verification;
    },
    getLicenseByKey: async (key) => {
      calls.push(['getLicenseByKey', key]);
      return license;
    },
    storeLicenseKey: async (key) => {
      calls.push(['storeLicenseKey', key]);
      stored.licenseKey = key;
      return true;
    },
  };
  const strapi = {
    plugin: () => ({ service: () => licenseGuard }),
    store: () => ({
      get: async ({ key }) => stored[key] || null,
      set: async ({ key, value }) => { stored[key] = value; },
    }),
    log: { warn() {}, error() {}, info() {}, debug() {} },
  };
  const ctx = {
    state: { user: adminUser },
    request: { body: {} },
    send(body) { this.status = 200; this.body = body; return body; },
    badRequest(message) { this.status = 400; this.message = message; return message; },
    unauthorized(message) { this.status = 401; this.message = message; return message; },
  };

  return {
    controller: createLicenseController({ strapi }),
    ctx,
    calls,
    stored,
  };
}

test('invalid license key warnings do not include the key or its prefix', async () => {
  const { controller, ctx, logs } = createContext({
    verification: { valid: false, networkError: false },
  });

  await controller.storeKey(ctx);

  assert.equal(ctx.status, 400);
  assert.equal(JSON.stringify(logs).includes(SECRET_LICENSE_KEY), false);
  assert.equal(JSON.stringify(logs).includes(SECRET_LICENSE_KEY.substring(0, 8)), false);
});

test('license email mismatch warnings omit both the key and attempted email', async () => {
  const { controller, ctx, logs } = createContext({
    verification: { valid: true, networkError: false, data: {} },
    license: { email: 'holder@example.invalid' },
  });

  await controller.storeKey(ctx);

  assert.equal(ctx.status, 400);
  assert.equal(JSON.stringify(logs).includes(SECRET_LICENSE_KEY), false);
  assert.equal(JSON.stringify(logs).includes(SECRET_LICENSE_KEY.substring(0, 8)), false);
  assert.equal(JSON.stringify(logs).includes(ATTEMPTED_EMAIL), false);
});

test('license status succeeds without a key and does not contact the provider', async () => {
  const { controller, ctx, calls } = createEndpointHarness({ initialLicenseKey: null });

  await controller.getStatus(ctx);

  assert.equal(ctx.status, 200);
  assert.equal(ctx.body.success, true);
  assert.equal(ctx.body.hasKey, false);
  assert.deepEqual(calls, []);
});

test('license status returns verified metadata for a stored synthetic key', async () => {
  const { controller, ctx, calls } = createEndpointHarness({
    initialLicenseKey: 'synthetic-license-key',
    license: { email: 'admin@example.invalid', isActive: true, firstName: 'Local', lastName: 'Tester' },
  });

  await controller.getStatus(ctx);

  assert.equal(ctx.status, 200);
  assert.equal(ctx.body.hasKey, true);
  assert.equal(ctx.body.data.licenseKey, 'synthetic-license-key');
  assert.deepEqual(calls, [['getLicenseByKey', 'synthetic-license-key']]);
});

test('auto-create requires an administrator and stores only a successful synthetic result', async () => {
  const denied = createEndpointHarness({ adminUser: null });
  await denied.controller.autoCreate(denied.ctx);
  assert.equal(denied.ctx.status, 401);
  assert.equal(denied.calls.length, 0);

  const allowed = createEndpointHarness();
  await allowed.controller.autoCreate(allowed.ctx);
  assert.equal(allowed.ctx.status, 200);
  assert.equal(allowed.stored.licenseKey, 'synthetic-license-key');
  assert.equal(allowed.calls[0][0], 'createLicense');
  assert.deepEqual(allowed.calls[0][1], {
    email: 'admin@example.invalid',
    firstName: 'Local',
    lastName: 'Tester',
  });
});

test('manual license creation validates fields and stores the fake-provider result', async () => {
  const { controller, ctx, stored, calls } = createEndpointHarness();

  await controller.createAndActivate(ctx);
  assert.equal(ctx.status, 400);
  assert.equal(calls.length, 0);

  ctx.status = undefined;
  ctx.message = undefined;
  ctx.request.body = { email: 'owner@example.invalid', firstName: 'Test', lastName: 'Owner' };
  await controller.createAndActivate(ctx);
  assert.equal(ctx.status, 200);
  assert.equal(stored.licenseKey, 'synthetic-license-key');
  assert.equal(calls[0][0], 'createLicense');
});

test('license ping and store-key endpoints use the fake provider and preserve the response contract', async () => {
  const { controller, ctx, calls, stored } = createEndpointHarness({
    initialLicenseKey: 'synthetic-license-key',
    verification: { valid: true, networkError: false, data: { isActive: true } },
    license: { email: 'owner@example.invalid', isActive: true },
  });

  await controller.ping(ctx);
  assert.equal(ctx.status, 200);
  assert.equal(ctx.body.success, true);
  assert.equal(calls[0][0], 'verifyLicense');

  ctx.status = undefined;
  ctx.body = undefined;
  ctx.request.body = { licenseKey: 'new-synthetic-key', email: 'owner@example.invalid' };
  await controller.storeKey(ctx);
  assert.equal(ctx.status, 200);
  assert.equal(stored.licenseKey, 'new-synthetic-key');
  assert.deepEqual(calls.slice(-3).map(([method]) => method), [
    'verifyLicense',
    'getLicenseByKey',
    'storeLicenseKey',
  ]);
});
