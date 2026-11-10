'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const session = require('../server/src/controllers/session');

function context(query = {}) {
  return {
    query,
    status: 200,
    body: undefined,
    send(body) {
      this.status = 200;
      this.body = body;
    },
    badRequest(message, details) {
      this.status = 400;
      this.body = { message, details };
    },
    internalServerError(message) {
      this.status = 500;
      this.body = { message };
    },
  };
}

function withStrapi(service, fn) {
  const previous = global.strapi;
  const errors = [];
  global.strapi = {
    plugin: () => ({ service: () => service }),
    log: { error: (...args) => errors.push(args.join(' ')) },
  };
  return Promise.resolve(fn(errors)).finally(() => {
    global.strapi = previous;
  });
}

test('invalid list, stats and export queries are rejected with 400 before any service call', async () => {
  const service = new Proxy(
    {},
    {
      get() {
        throw new Error('service must not be reached');
      },
    }
  );
  await withStrapi(service, async () => {
    for (const [action, query] of [
      ['getAllSessionsAdmin', { page: '1', sort: 'tokenHash:desc' }],
      ['getAllSessionsAdmin', { page: '1', pageSize: '5000' }],
      ['getAllSessionsAdmin', { pageSize: '25', search: 'x'.repeat(500) }],
      ['getActiveSessions', { page: '-1' }],
      ['getSessionStatsAdmin', { where: 'x' }],
      ['exportSessionsAdmin', { limit: '100000' }],
      ['exportSessionsAdmin', { cursor: 'not a cursor' }],
      ['exportSessionsAdmin', { cursor: Buffer.from('["bad",1]').toString('base64url') }],
    ]) {
      const ctx = context(query);
      await session[action](ctx);
      assert.equal(ctx.status, 400, `${action} ${JSON.stringify(query)}`);
      assert.equal(ctx.body.message, 'Invalid query');
      assert.doesNotMatch(JSON.stringify(ctx.body), /xxxxxxxxxx/, 'input is not echoed');
    }
  });
});

test('paginated list returns rows, exact pagination and never the native session id', async () => {
  const calls = [];
  const service = {
    async listSessionPage(query) {
      calls.push(query);
      return {
        rows: [{ id: 'doc', documentId: 'doc', sessionId: 'internal', nativeSessionId: 'n1' }],
        pagination: { page: 2, pageSize: 10, total: 1234, pageCount: 124 },
      };
    },
  };
  await withStrapi(service, async () => {
    const ctx = context({ page: '2', pageSize: '10', status: 'ended', reason: 'idle' });
    await session.getAllSessionsAdmin(ctx);
    assert.equal(ctx.status, 200);
    assert.deepEqual(ctx.body.meta, {
      pagination: { page: 2, pageSize: 10, total: 1234, pageCount: 124 },
    });
    assert.deepEqual(ctx.body.data, [{ id: 'doc', documentId: 'doc' }]);
    assert.equal(calls[0].status, 'ended');

    const active = context({ page: '1', status: 'ended' });
    await session.getActiveSessions(active);
    assert.equal(calls[1].status, 'active', '/sessions/active always filters active sessions');
  });
});

test('without paging parameters the 4.x list response is kept for existing callers', async () => {
  const sessions = [
    { id: 'a', isTrulyActive: true },
    { id: 'b', isTrulyActive: false },
  ];
  const service = {
    async getAllSessions() {
      return sessions;
    },
    listSessionPage() {
      throw new Error('legacy callers must not get the paginated shape');
    },
  };
  await withStrapi(service, async () => {
    const ctx = context({});
    await session.getAllSessionsAdmin(ctx);
    assert.deepEqual(ctx.body.meta, { count: 2, active: 1, inactive: 1 });
    assert.equal(ctx.body.data.length, 2);
  });
});

test('stats and export responses carry counts or safe rows only', async () => {
  const service = {
    async getSessionStats() {
      return { total: 5, active: 2 };
    },
    async exportSessionBatch() {
      return {
        rows: [{ id: 'x', documentId: 'x', tokenHash: 'h', refreshToken: 'r' }],
        nextCursor: null,
      };
    },
  };
  await withStrapi(service, async () => {
    const stats = context({});
    await session.getSessionStatsAdmin(stats);
    assert.deepEqual(stats.body, { data: { total: 5, active: 2 } });

    const exported = context({ status: 'all' });
    await session.exportSessionsAdmin(exported);
    assert.deepEqual(exported.body, {
      data: [{ id: 'x', documentId: 'x' }],
      meta: { count: 1, nextCursor: null },
    });
  });
});

test('service failures return a generic 500 and log only the error name', async () => {
  const service = {
    async listSessionPage() {
      throw new Error('user@example.test 203.0.113.9 secret-token');
    },
    async getSessionStats() {
      throw new Error('user@example.test');
    },
    async exportSessionBatch() {
      throw new Error('203.0.113.9');
    },
  };
  await withStrapi(service, async (errors) => {
    for (const [action, query] of [
      ['getAllSessionsAdmin', { page: '1' }],
      ['getSessionStatsAdmin', {}],
      ['exportSessionsAdmin', {}],
    ]) {
      const ctx = context(query);
      await session[action](ctx);
      assert.equal(ctx.status, 500, action);
      assert.doesNotMatch(JSON.stringify(ctx.body), /example\.test|203\.0\.113|secret/);
    }
    assert.doesNotMatch(errors.join('\n'), /example\.test|203\.0\.113|secret/);
  });
});
