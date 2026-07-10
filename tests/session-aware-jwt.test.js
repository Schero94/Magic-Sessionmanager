'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SESSION_ENCRYPTION_KEY =
  process.env.SESSION_ENCRYPTION_KEY || 'magic-sessionmanager-test-encryption-key';

const bootstrap = require('../server/src/bootstrap');
const { invalidateSettingsCache } = require('../server/src/utils/settings-loader');

function createHarness(session) {
  invalidateSettingsCache();

  const updates = [];
  const jwtService = {
    verify: async () => ({ id: 7, iat: Math.floor(Date.now() / 1000) - 120 }),
  };
  const strapi = {
    plugin(name) {
      if (name === 'users-permissions') return { service: () => jwtService };
      throw new Error(`Unexpected plugin ${name}`);
    },
    entityService: {
      findOne: async () => ({ documentId: 'user-doc-id' }),
    },
    documents(uid) {
      if (uid === 'plugin::users-permissions.user') {
        return {
          findOne: async () => ({ documentId: 'user-doc-id', blocked: false }),
        };
      }

      return {
        findFirst: async () => session,
        update: async (payload) => {
          updates.push(payload);
          return payload;
        },
      };
    },
    config: {
      get() {
        return {};
      },
    },
    store: () => ({
      get: async () => ({
        inactivityTimeout: 1,
        maxSessionAgeDays: 30,
        strictSessionEnforcement: true,
      }),
    }),
    log: {
      debug() {},
      error() {},
      info() {},
      warn() {},
    },
  };

  return { jwtService, strapi, updates };
}

test('JWT verification terminates an active row that exceeded inactivity timeout', async () => {
  const { jwtService, strapi, updates } = createHarness({
    documentId: 'session-idle',
    isActive: true,
    terminatedManually: false,
    terminationReason: null,
    lastActive: new Date(Date.now() - 2 * 60 * 1000),
    loginTime: new Date(Date.now() - 60 * 60 * 1000),
  });

  await bootstrap.__private.registerSessionAwareAuthStrategy(strapi, strapi.log);
  const result = await jwtService.verify('x'.repeat(80));

  assert.equal(result, null);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].data.isActive, false);
  assert.equal(updates[0].data.terminationReason, 'idle');
});

test('JWT verification accepts a recently active session', async () => {
  const { jwtService, strapi, updates } = createHarness({
    documentId: 'session-active',
    isActive: true,
    terminatedManually: false,
    terminationReason: null,
    lastActive: new Date(Date.now() - 10 * 1000),
    loginTime: new Date(Date.now() - 60 * 60 * 1000),
  });

  await bootstrap.__private.registerSessionAwareAuthStrategy(strapi, strapi.log);
  const result = await jwtService.verify('x'.repeat(80));

  assert.equal(result.id, 7);
  assert.equal(updates.length, 0);
});

test('JWT verification preserves an existing manual termination reason', async () => {
  const { jwtService, strapi, updates } = createHarness({
    documentId: 'session-manual',
    isActive: false,
    terminatedManually: true,
    terminationReason: 'manual',
    lastActive: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
    loginTime: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
  });

  await bootstrap.__private.registerSessionAwareAuthStrategy(strapi, strapi.log);
  const result = await jwtService.verify('x'.repeat(80));

  assert.equal(result, null);
  assert.equal(updates.length, 0);
});
