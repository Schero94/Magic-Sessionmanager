'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const sessionController = require('../server/src/controllers/session');

function createCtx(sessionService) {
  return {
    params: { sessionId: 'session-doc-id' },
    body: null,
    error: null,
    notFound(message) {
      this.error = { status: 404, message };
      return this.error;
    },
    internalServerError(message) {
      throw new Error(message);
    },
    getService: () => sessionService,
  };
}

function installStrapi(sessionService) {
  const previous = global.strapi;
  global.strapi = {
    plugin: () => ({ service: () => sessionService }),
    log: { error() {} },
  };
  return () => {
    global.strapi = previous;
  };
}

test('deleteSession returns 404 when the requested session does not exist', async () => {
  const restore = installStrapi({ deleteSession: async () => false });
  const ctx = createCtx();
  try {
    await sessionController.deleteSession(ctx);
    assert.equal(ctx.error.status, 404);
  } finally {
    restore();
  }
});

test('deleteSession reports that token revocation remains after session details are removed', async () => {
  let deletedId;
  const restore = installStrapi({
    deleteSession: async (sessionId) => {
      deletedId = sessionId;
      return true;
    },
  });
  const ctx = createCtx();
  try {
    await sessionController.deleteSession(ctx);
    assert.equal(deletedId, 'session-doc-id');
    assert.match(ctx.body.message, /revocation.*preserved/i);
  } finally {
    restore();
  }
});
