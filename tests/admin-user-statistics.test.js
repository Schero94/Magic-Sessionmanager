'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const sessionController = require('../server/src/controllers/session');

function createContext() {
  return {
    status: null,
    body: null,
    errorMessage: null,
    send(body) {
      this.status = 200;
      this.body = body;
      return body;
    },
    internalServerError(message) {
      this.status = 500;
      this.errorMessage = message;
      return message;
    },
  };
}

test('admin user summary returns aggregate counts only', async () => {
  const previousStrapi = global.strapi;
  const countQueries = [];
  global.strapi = {
    db: {
      query(uid) {
        assert.equal(uid, 'plugin::users-permissions.user');
        return {
          count: async ({ where } = {}) => {
            countQueries.push(where || {});
            return where?.blocked === true ? 2 : 7;
          },
        };
      },
    },
    log: { error() {} },
  };

  try {
    const ctx = createContext();
    await sessionController.getUserStatsAdmin(ctx);

    assert.equal(ctx.status, 200);
    assert.deepEqual(ctx.body, { success: true, data: { totalUsers: 7, blockedUsers: 2 } });
    assert.deepEqual(countQueries, [{}, { blocked: true }]);
    assert.doesNotMatch(JSON.stringify(ctx.body), /email|username|userId|documentId|session/i);
  } finally {
    if (previousStrapi === undefined) delete global.strapi;
    else global.strapi = previousStrapi;
  }
});

test('admin user summary returns a stable internal error without raw database details', async () => {
  const previousStrapi = global.strapi;
  const logged = [];
  global.strapi = {
    db: { query: () => ({ count: async () => { throw new Error('database-secret-example.invalid'); } }) },
    log: { error: (...args) => logged.push(args.map((arg) => String(arg)).join(' ')) },
  };

  try {
    const ctx = createContext();
    await sessionController.getUserStatsAdmin(ctx);
    assert.equal(ctx.status, 500);
    assert.equal(ctx.errorMessage, 'Unable to load end-user counts');
    assert.equal(logged.join('\n').includes('database-secret-example.invalid'), false);
  } finally {
    if (previousStrapi === undefined) delete global.strapi;
    else global.strapi = previousStrapi;
  }
});
