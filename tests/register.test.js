'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const register = require('../server/src/register');

test('blocked-user lifecycle delegates unlimited termination to the session service', async () => {
  let lifecycle;
  let terminated;
  const strapi = {
    admin: {
      services: {
        permission: { actionProvider: { registerMany() {} } },
      },
    },
    contentType: () => ({ attributes: {} }),
    db: {
      lifecycles: {
        subscribe(value) {
          lifecycle = value;
        },
      },
    },
    plugin: () => ({
      service: () => ({
        terminateSession: async (args) => {
          terminated = args;
          return { terminatedCount: 1205 };
        },
      }),
    }),
    log: { debug() {}, error() {}, info() {}, warn() {} },
  };

  await register({ strapi });
  await lifecycle.afterUpdate({
    result: { documentId: 'blocked-user', blocked: true },
    params: { data: { blocked: true } },
  });

  assert.deepEqual(terminated, { userId: 'blocked-user', reason: 'blocked' });
});
