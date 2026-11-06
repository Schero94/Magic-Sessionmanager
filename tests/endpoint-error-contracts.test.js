'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const session = require('../server/src/controllers/session');
const settings = require('../server/src/controllers/settings');
const createLicense = require('../server/src/controllers/license');
const createGeoip = require('../server/src/controllers/geoip');

const privateDetail = 'synthetic-internal-detail-must-not-escape';
const fail = () => { throw new Error(privateDetail); };

function context() {
  return {
    state: { user: { id: 23, documentId: 'synthetic-owner' } },
    params: { sessionId: 'synthetic-session', userId: 'synthetic-owner', ipAddress: '192.0.2.1' },
    request: { headers: { authorization: `Bearer ${'a'.repeat(80)}` }, body: {
      email: 'owner@example.invalid', firstName: 'Test', lastName: 'Owner',
      licenseKey: 'synthetic-key', accountId: 'test-account',
    } },
    send(body) { this.body = body; },
    badRequest(message) { this.status = 400; this.body = { message }; },
    unauthorized(message) { this.status = 401; this.body = { message }; },
    forbidden(message) { this.status = 403; this.body = { message }; },
    notFound(message) { this.status = 404; this.body = { message }; },
    internalServerError(message) { this.status = 500; this.body = { message }; },
  };
}

test('session endpoint dependency failures return sanitized errors', async () => {
  const previous = global.strapi;
  global.strapi = {
    config: { get: (_key, fallback) => fallback },
    plugin: fail,
    documents: fail,
    db: { query: fail },
    log: { error() {}, warn() {}, info() {}, debug() {} },
  };
  try {
    for (const action of [
      'getUserStatsAdmin', 'getAllSessionsAdmin', 'getActiveSessions',
      'getOwnSessions', 'getUserSessions', 'logout', 'logoutAll', 'logoutOthers',
      'getCurrentSession', 'terminateOwnSession', 'terminateSingleSession',
      'terminateAllUserSessions', 'deleteSession', 'cleanInactiveSessions',
      'toggleUserBlock',
    ]) {
      const ctx = context();
      if (action === 'toggleUserBlock') ctx.request.body.blocked = true;
      await session[action](ctx);
      assert.equal(ctx.status, 500, action);
      assert.equal(JSON.stringify(ctx.body).includes(privateDetail), false, action);
    }
  } finally {
    global.strapi = previous;
  }
});

test('invalid geolocation input is rejected before dependencies are accessed', async () => {
  const previous = global.strapi;
  global.strapi = { plugin: fail, documents: fail, log: { error() {} } };
  try {
    const ctx = context();
    ctx.params.ipAddress = '999.1.1.1';
    await session.getIpGeolocation(ctx);
    assert.equal(ctx.status, 400);
  } finally {
    global.strapi = previous;
  }
});

test('settings, license and GeoIP dependency failures return sanitized errors', async () => {
  const previous = global.strapi;
  const fake = {
    config: { get: (_key, fallback) => fallback },
    plugin: fail, store: fail, documents: fail,
    log: { error() {}, warn() {}, info() {}, debug() {} },
  };
  global.strapi = fake;
  try {
    for (const [controller, actions] of [
      [settings, ['getSettings', 'updateSettings']],
      [createLicense({ strapi: fake }), ['getStatus', 'autoCreate', 'createAndActivate', 'ping', 'storeKey']],
      [createGeoip({ strapi: fake }), ['getStatus', 'storeCredentials', 'updateDatabase']],
    ]) {
      for (const action of actions) {
        const ctx = context();
        await controller[action](ctx);
        assert.equal(ctx.status, 400, action);
        assert.equal(JSON.stringify(ctx.body).includes(privateDetail), false, action);
      }
    }
  } finally {
    global.strapi = previous;
  }
});
