'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const createSessionService = require('../server/src/services/session');

function createLogger() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
}

test('deleteOldSessions stops after repeated no-progress delete batches', async () => {
  let findManyCalls = 0;
  let deleteCalls = 0;
  const batch = Array.from({ length: 200 }, (_, index) => ({
    documentId: `session-${index}`,
  }));

  const strapi = {
    config: {
      get() {
        return { retentionDays: 1 };
      },
    },
    store: () => ({
      get: async () => null,
    }),
    documents: () => ({
      findMany: async () => {
        findManyCalls++;
        if (findManyCalls > 3) {
          throw new Error('retention loop should have stopped after repeated no-progress batches');
        }
        return batch;
      },
      delete: async () => {
        deleteCalls++;
        throw new Error('delete failed');
      },
    }),
    db: { connection: {} },
    plugin: () => ({
      service: () => ({}),
    }),
    log: createLogger(),
  };

  const service = createSessionService({ strapi });
  const deleted = await service.deleteOldSessions();

  assert.equal(deleted, 0);
  assert.equal(findManyCalls, 3);
  assert.equal(deleteCalls, 600);
});
