'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const sessionRequiredPolicy = require('../server/src/policies/session-required');
const { invalidateSettingsCache } = require('../server/src/utils/settings-loader');

const longToken = 'a'.repeat(80);

function createPolicyStrapi(session) {
  return {
    config: {
      get() {
        return { strictSessionEnforcement: false };
      },
    },
    store: () => ({
      get: async () => null,
    }),
    documents: () => ({
      findFirst: async () => session,
    }),
    log: {
      info() {},
      warn() {},
      debug() {},
    },
  };
}

test('session-required rejects inactive sessions regardless of termination reason', async () => {
  const policyContext = {
    state: { user: { documentId: 'user-doc-id' } },
    request: {
      headers: { authorization: `Bearer ${longToken}` },
    },
  };

  await assert.rejects(
    () => sessionRequiredPolicy(
      policyContext,
      {},
      {
        strapi: createPolicyStrapi({
          documentId: 'session-doc-id',
          isActive: false,
          terminatedManually: false,
          terminationReason: 'idle',
        }),
      }
    ),
    /Session terminated|No valid session/
  );
});

test('strict session policy rejects unresolved identity and session lookup failures', async (t) => {
  for (const scenario of ['unresolved identity', 'session lookup failure']) {
    await t.test(scenario, async () => {
    invalidateSettingsCache();
    const strapi = createPolicyStrapi(null);
    strapi.config.get = () => ({ strictSessionEnforcement: true });
    strapi.entityService = { findOne: async () => null };
    if (scenario === 'session lookup failure') strapi.documents = () => ({ findFirst: async () => { throw new Error('synthetic internal detail'); } });
    const context = {
      state: { user: scenario === 'unresolved identity' ? { id: 7654 } : { documentId: 'synthetic-owner' } },
      request: { headers: { authorization: `Bearer ${longToken}` } },
    };
    await assert.rejects(() => sessionRequiredPolicy(context, {}, { strapi }), /No valid session/);
    });
  }
  invalidateSettingsCache();
});

test('relaxed session policy retains fail-open compatibility on lookup failure', async () => {
  invalidateSettingsCache();
  const strapi = createPolicyStrapi(null);
  strapi.documents = () => ({ findFirst: async () => { throw new Error('synthetic internal detail'); } });
  const context = {
    state: { user: { documentId: 'synthetic-owner' } },
    request: { headers: { authorization: `Bearer ${longToken}` } },
  };
  try {
    assert.equal(await sessionRequiredPolicy(context, {}, { strapi }), true);
  } finally {
    invalidateSettingsCache();
  }
});
