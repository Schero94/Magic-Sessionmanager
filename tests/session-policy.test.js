'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const sessionRequiredPolicy = require('../server/src/policies/session-required');

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
