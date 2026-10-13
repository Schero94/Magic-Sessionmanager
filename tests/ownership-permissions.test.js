'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const sessionController = require('../server/src/controllers/session');
const adminRoutes = require('../server/src/routes/admin').routes;
const contentApiRoutes = require('../server/src/routes/content-api').routes;

function createCtx({ user = null, userId = 'user-doc-other' } = {}) {
  return {
    state: { user },
    params: { userId },
    status: null,
    body: null,
    forbidden(message) {
      this.status = 403;
      this.body = { message };
      return this.body;
    },
    unauthorized(message) {
      this.status = 401;
      this.body = { message };
      return this.body;
    },
    internalServerError(message) {
      this.status = 500;
      this.body = { message };
      return this.body;
    },
  };
}

test('content API session listing returns only the authenticated owner’s sessions', async () => {
  let requestedUserId;
  const previousStrapi = global.strapi;
  global.strapi = {
    plugin() {
      return {
        service() {
          return {
            getUserSessions: async (userId) => {
              requestedUserId = userId;
              return [{ documentId: 'owned-session' }];
            },
          };
        },
      };
    },
    log: { error() {}, warn() {} },
  };

  try {
    const ctx = createCtx({
      user: { documentId: 'user-doc-owner' },
      userId: 'user-doc-owner',
    });

    await sessionController.getUserSessions(ctx);

    assert.equal(requestedUserId, 'user-doc-owner');
    assert.deepEqual(ctx.body.data, [{ documentId: 'owned-session' }]);
    assert.equal(ctx.status, null);
  } finally {
    global.strapi = previousStrapi;
  }
});

test('content API denies attempts to list another user’s sessions before service access', async () => {
  let serviceCalled = false;
  const previousStrapi = global.strapi;
  global.strapi = {
    plugin() {
      return {
        service() {
          return {
            getUserSessions: async () => {
              serviceCalled = true;
              return [];
            },
          };
        },
      };
    },
    log: { error() {}, warn() {} },
  };

  try {
    const ctx = createCtx({
      user: { documentId: 'user-doc-owner' },
      userId: 'user-doc-other',
    });

    await sessionController.getUserSessions(ctx);

    assert.equal(ctx.status, 403);
    assert.equal(serviceCalled, false);
  } finally {
    global.strapi = previousStrapi;
  }
});

test('content API denies session listing when the authenticated user has no document identity', async () => {
  let serviceCalled = false;
  const previousStrapi = global.strapi;
  global.strapi = {
    plugin() {
      return {
        service() {
          return {
            getUserSessions: async () => {
              serviceCalled = true;
              return [];
            },
          };
        },
      };
    },
    entityService: { findOne: async () => null },
    log: { error() {}, warn() {} },
  };

  try {
    const ctx = createCtx({ user: {} });

    await sessionController.getUserSessions(ctx);

    assert.equal(ctx.status, 403);
    assert.equal(serviceCalled, false);
  } finally {
    global.strapi = previousStrapi;
  }
});

test('admin session routes require both an admin identity and the plugin access action', () => {
  const sensitiveRoutes = adminRoutes.filter((route) =>
    /sessions|user\/:userId/.test(route.path)
  );

  assert.ok(sensitiveRoutes.length > 0);
  for (const route of sensitiveRoutes) {
    const policies = route.config?.policies || [];
    assert.ok(policies.includes('admin::isAuthenticatedAdmin'), `${route.path} must require an admin`);
    assert.ok(
      policies.some((policy) =>
        policy?.name === 'admin::hasPermissions' &&
        policy.config?.actions?.includes('plugin::magic-sessionmanager.access')
      ),
      `${route.path} must require the Sessionmanager access permission`
    );
  }
});

test('content API session routes require users-permissions authentication and rate limits', () => {
  const sessionRoutes = contentApiRoutes.filter((route) => /session/.test(route.path));

  assert.ok(sessionRoutes.length > 0);
  for (const route of sessionRoutes) {
    assert.deepEqual(route.config?.auth?.strategies, ['users-permissions'], `${route.path} must require user JWT auth`);
    assert.ok(route.config?.middlewares?.length > 0, `${route.path} must be rate limited`);
  }
});
