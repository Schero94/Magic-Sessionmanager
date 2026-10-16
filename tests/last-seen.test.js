'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const createLastSeenMiddleware = require('../server/src/middlewares/last-seen');
const { invalidateSettingsCache } = require('../server/src/utils/settings-loader');

const token = 'a'.repeat(80);

function createStrapi(session, queries = []) {
  return {
    config: {
      get(key, fallback) {
        if (key === 'plugin::users-permissions.jwtManagement') return 'refresh';
        return fallback;
      },
    },
    store: () => ({
      get: async () => null,
    }),
    documents: () => ({
      findFirst: async (query) => {
        queries.push(query);
        return session;
      },
    }),
    log: {
      debug() {},
      info() {},
      warn() {},
    },
  };
}

function createCtx(path) {
  return {
    path,
    state: { user: { documentId: 'user-doc-id' } },
    request: {
      headers: { authorization: `Bearer ${token}` },
    },
    unauthorized(message) {
      this.status = 401;
      this.body = { error: { message } };
    },
  };
}

test('last-seen does not touch a session after self-terminating logout routes', async () => {
  for (const path of ['/api/magic-sessionmanager/logout', '/api/magic-sessionmanager/logout-all']) {
    invalidateSettingsCache();

    let touchCalls = 0;
    const middleware = createLastSeenMiddleware({
      strapi: createStrapi({ documentId: 'session-doc-id', isActive: true }),
      sessionService: {
        touch: async () => {
          touchCalls++;
        },
      },
    });

    const ctx = createCtx(path);
    await middleware(ctx, async () => {
      ctx.body = { terminated: true };
    });

    assert.equal(touchCalls, 0, path);
  }
});

test('last-seen still touches sessions after ordinary authenticated requests', async () => {
  invalidateSettingsCache();

  const touched = [];
  const middleware = createLastSeenMiddleware({
    strapi: createStrapi({ documentId: 'session-doc-id', isActive: true }),
    sessionService: {
      touch: async (payload) => {
        touched.push(payload);
      },
    },
  });

  const ctx = createCtx('/api/articles');
  await middleware(ctx, async () => {
    ctx.body = { ok: true };
  });

  assert.deepEqual(touched, [
    { userId: 'user-doc-id', sessionId: 'session-doc-id' },
  ]);
});

test('last-seen waits for Strapi route authentication before resolving the session', async () => {
  invalidateSettingsCache();

  const touched = [];
  const middleware = createLastSeenMiddleware({
    strapi: createStrapi({ documentId: 'session-doc-id', isActive: true }),
    sessionService: {
      touch: async (payload) => {
        touched.push(payload);
      },
    },
  });

  const ctx = createCtx('/api/articles');
  ctx.state = {};

  await middleware(ctx, async () => {
    ctx.state.user = { documentId: 'user-doc-id' };
    ctx.status = 200;
    ctx.body = { ok: true };
  });

  assert.deepEqual(touched, [
    { userId: 'user-doc-id', sessionId: 'session-doc-id' },
  ]);
});

test('last-seen does not touch sessions after failed authenticated requests', async () => {
  invalidateSettingsCache();

  let touchCalls = 0;
  const middleware = createLastSeenMiddleware({
    strapi: createStrapi({ documentId: 'session-doc-id', isActive: true }),
    sessionService: {
      touch: async () => {
        touchCalls++;
      },
    },
  });

  const ctx = createCtx('/api/articles');
  ctx.state = {};

  await middleware(ctx, async () => {
    ctx.state.user = { documentId: 'user-doc-id' };
    ctx.status = 500;
  });

  assert.equal(touchCalls, 0);
});

test('last-seen matches the native session identity to its Magic sidecar', async () => {
  invalidateSettingsCache();

  const queries = [];
  const touched = [];
  const middleware = createLastSeenMiddleware({
    strapi: createStrapi({
      documentId: 'magic-sidecar-1',
      nativeSessionId: 'native-session-1',
      isActive: true,
    }, queries),
    sessionService: {
      touch: async (payload) => touched.push(payload),
    },
  });
  const ctx = createCtx('/api/articles');
  ctx.state.session = { id: 'native-session-1' };

  await middleware(ctx, async () => {
    ctx.body = { ok: true };
  });

  assert.deepEqual(queries[0].filters, {
    user: { documentId: 'user-doc-id' },
    nativeSessionId: 'native-session-1',
  });
  assert.deepEqual(touched, [{ userId: 'user-doc-id', sessionId: 'magic-sidecar-1' }]);
});

test('last-seen does not fabricate a Magic session for a native-only session', async () => {
  invalidateSettingsCache();

  let touchCalls = 0;
  const queries = [];
  const middleware = createLastSeenMiddleware({
    strapi: createStrapi(null, queries),
    sessionService: { touch: async () => { touchCalls++; } },
  });
  const ctx = createCtx('/api/articles');
  ctx.state.session = { id: 'native-only-session' };

  await middleware(ctx, async () => {
    ctx.body = { ok: true };
  });

  assert.deepEqual(queries[0].filters, {
    user: { documentId: 'user-doc-id' },
    nativeSessionId: 'native-only-session',
  });
  assert.equal(touchCalls, 0);
});
