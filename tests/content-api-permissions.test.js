'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const bootstrap = require('../server/src/bootstrap');
const {
  CONTENT_API_PERMISSIONS_VERSION,
  createContentApiPermissionsLifecycle,
} = require('../server/src/utils/content-api-permissions');

const ROLE_UID = 'plugin::users-permissions.role';
const PERMISSION_UID = 'plugin::users-permissions.permission';
const REQUIRED_ACTIONS = [
  'plugin::magic-sessionmanager.session.logout',
  'plugin::magic-sessionmanager.session.logoutAll',
  'plugin::magic-sessionmanager.session.logoutOthers',
  'plugin::magic-sessionmanager.session.getOwnSessions',
  'plugin::magic-sessionmanager.session.getUserSessions',
  'plugin::magic-sessionmanager.session.getCurrentSession',
  'plugin::magic-sessionmanager.session.terminateOwnSession',
];

function createHarness({ authenticatedRole = null, failRoleReads = 0 } = {}) {
  const middleware = [];
  const roleQueries = [];
  const permissionQueries = [];
  const permissionWrites = [];
  const storeWrites = [];
  let role = authenticatedRole;
  let remainingRoleReadFailures = failRoleReads;
  const publicRole = { id: 23, type: 'public' };
  let permissionVersion;
  let legacyInitialized;
  const permissions = [];
  const log = { debug() {}, info() {}, warn() {}, error() {} };
  const pluginStore = {
    async get({ key }) {
      if (key === 'contentApiPermissionsVersion') return permissionVersion;
      if (key === 'contentApiPermissionsInitialized') return legacyInitialized;
      return undefined;
    },
    async set({ key, value }) {
      storeWrites.push({ key, value });
      if (key === 'contentApiPermissionsVersion') permissionVersion = value;
      if (key === 'contentApiPermissionsInitialized') legacyInitialized = value;
    },
  };

  const strapi = {
    server: {
      use(fn) {
        middleware.push(fn);
      },
    },
    config: {
      get(key, fallback) {
        if (key === 'api.rest.prefix') return '/api';
        return fallback;
      },
    },
    store() {
      return pluginStore;
    },
    documents(uid) {
      if (uid === ROLE_UID) {
        return {
          async findMany(query) {
            roleQueries.push(query);
            if (remainingRoleReadFailures > 0) {
              remainingRoleReadFailures--;
              throw new Error('temporary role lookup failure');
            }
            return [role, publicRole].filter((candidate) => candidate?.type === query.filters.type);
          },
        };
      }
      if (uid === PERMISSION_UID) {
        return {
          async findMany(query) {
            permissionQueries.push(query);
            return permissions
              .filter(
                (permission) =>
                  permission.role === query.filters.role &&
                  query.filters.action.$in.includes(permission.action)
              )
              .map(({ action }) => ({ action }));
          },
          async create({ data }) {
            permissionWrites.push(data);
            permissions.push(data);
            return data;
          },
        };
      }
      throw new Error(`Unexpected document type ${uid}`);
    },
    log,
  };

  return {
    strapi,
    log,
    middleware,
    roleQueries,
    permissionQueries,
    permissionWrites,
    storeWrites,
    permissions,
    publicRole,
    setAuthenticatedRole(value) {
      role = value;
    },
    get permissionVersion() {
      return permissionVersion;
    },
  };
}

test('Content API permission retry waits for the authenticated role and completes before route auth', async () => {
  const harness = createHarness();
  const initialSetupComplete = await bootstrap.__private.ensureContentApiPermissions(
    harness.strapi,
    harness.log
  );

  assert.equal(initialSetupComplete, false);
  assert.equal(harness.permissionWrites.length, 0);
  assert.equal(harness.permissionVersion, undefined);

  harness.setAuthenticatedRole({ id: 17, type: 'authenticated' });
  bootstrap.__private.mountDeferredContentApiPermissionRetry({
    strapi: harness.strapi,
    log: harness.log,
    initiallyReady: initialSetupComplete,
  });

  let nextCalls = 0;
  const routeContext = { method: 'GET', path: '/api/magic-sessionmanager/my-sessions' };
  await harness.middleware[0](routeContext, async () => {
    nextCalls++;
    assert.deepEqual(
      harness.permissions.map(({ action }) => action),
      REQUIRED_ACTIONS,
      'the permission grant must finish before downstream route authentication runs'
    );
  });

  assert.equal(nextCalls, 1);
  assert.equal(harness.permissionVersion, 2);
  assert.deepEqual(
    harness.permissionWrites,
    REQUIRED_ACTIONS.map((action) => ({ action, role: 17 }))
  );

  const writeCountAfterFirstRequest = harness.permissionWrites.length;
  const markerWriteCountAfterFirstRequest = harness.storeWrites.length;
  await harness.middleware[0](routeContext, async () => {
    nextCalls++;
  });

  assert.equal(nextCalls, 2);
  assert.equal(harness.permissionWrites.length, writeCountAfterFirstRequest);
  assert.equal(harness.storeWrites.length, markerWriteCountAfterFirstRequest);
});

test('deferred permission retry ignores unrelated routes and never grants the Public role', async () => {
  const harness = createHarness({ authenticatedRole: { id: 17, type: 'authenticated' } });
  bootstrap.__private.mountDeferredContentApiPermissionRetry({
    strapi: harness.strapi,
    log: harness.log,
    initiallyReady: false,
  });

  let nextCalls = 0;
  await harness.middleware[0]({ method: 'GET', path: '/api/auth/sessions' }, async () => {
    nextCalls++;
  });

  assert.equal(nextCalls, 1);
  assert.equal(harness.roleQueries.length, 0);
  assert.equal(harness.permissionWrites.length, 0);
  assert.equal(harness.permissionVersion, undefined);

  await harness.middleware[0](
    { method: 'GET', path: '/api/magic-sessionmanager/my-sessions' },
    async () => {
      nextCalls++;
    }
  );

  assert.deepEqual(
    harness.roleQueries.map(({ filters }) => filters),
    [{ type: 'authenticated' }]
  );
  assert.ok(harness.permissionWrites.every(({ role }) => role === 17));
  assert.equal(
    harness.permissionWrites.some(({ action }) =>
      action.startsWith('plugin::magic-sessionmanager.')
    ),
    true
  );
  assert.equal(
    harness.permissionWrites.some(({ role }) => role === harness.publicRole.id),
    false
  );
  assert.equal(
    harness.permissions.some(({ role }) => role === harness.publicRole.id),
    false
  );
  assert.equal(harness.permissionVersion, 2);
});

test('a failed deferred setup can retry after its cooldown without weakening route auth', async () => {
  const harness = createHarness({
    authenticatedRole: { id: 17, type: 'authenticated' },
    failRoleReads: 1,
  });
  bootstrap.__private.mountDeferredContentApiPermissionRetry({
    strapi: harness.strapi,
    log: harness.log,
    initiallyReady: false,
    retryCooldownMs: 0,
  });

  const routeContext = { method: 'GET', path: '/api/magic-sessionmanager/my-sessions' };
  let nextCalls = 0;
  await harness.middleware[0](routeContext, async () => {
    nextCalls++;
    assert.equal(harness.permissionWrites.length, 0);
  });

  await harness.middleware[0](routeContext, async () => {
    nextCalls++;
    assert.deepEqual(
      harness.permissions.map(({ action }) => action),
      REQUIRED_ACTIONS,
      'the retry must finish before downstream route authorization'
    );
  });

  assert.equal(nextCalls, 2);
  assert.equal(harness.roleQueries.length, 2);
  assert.equal(harness.permissionWrites.length, REQUIRED_ACTIONS.length);
  assert.equal(harness.permissionVersion, 2);
});

test('concurrent first Magic requests share one permission setup attempt', async () => {
  const harness = createHarness({ authenticatedRole: { id: 17, type: 'authenticated' } });
  bootstrap.__private.mountDeferredContentApiPermissionRetry({
    strapi: harness.strapi,
    log: harness.log,
    initiallyReady: false,
  });

  const routeContext = { method: 'GET', path: '/api/magic-sessionmanager/my-sessions' };
  const nextCalls = [];
  await Promise.all(
    Array.from({ length: 4 }, () =>
      harness.middleware[0](routeContext, async () => {
        nextCalls.push(true);
        assert.deepEqual(
          harness.permissions.map(({ action }) => action),
          REQUIRED_ACTIONS,
          'all concurrent requests must wait until setup is complete'
        );
      })
    )
  );

  assert.equal(nextCalls.length, 4);
  assert.equal(harness.roleQueries.length, 1);
  assert.equal(harness.permissionWrites.length, REQUIRED_ACTIONS.length);
});

test('saving the Authenticated role before the first API request preserves its permission choices', async () => {
  const harness = createHarness({ authenticatedRole: { id: 17, type: 'authenticated' } });
  const lifecycle = createContentApiPermissionsLifecycle(harness.strapi);

  await lifecycle.afterUpdate({
    result: { id: 17, type: 'authenticated' },
    params: { data: { name: 'Authenticated', description: 'Configured by an administrator' } },
  });

  assert.equal(harness.permissionVersion, CONTENT_API_PERMISSIONS_VERSION);
  bootstrap.__private.mountDeferredContentApiPermissionRetry({
    strapi: harness.strapi,
    log: harness.log,
    initiallyReady: false,
  });

  let nextCalls = 0;
  await harness.middleware[0](
    { method: 'GET', path: '/api/magic-sessionmanager/my-sessions' },
    async () => {
      nextCalls++;
      assert.equal(harness.permissionWrites.length, 0);
    }
  );

  assert.equal(nextCalls, 1);
  assert.equal(harness.permissionWrites.length, 0);
  assert.equal(harness.permissions.some(({ role }) => role === harness.publicRole.id), false);
});

test('saving the Public role does not suppress Authenticated permission initialization', async () => {
  const harness = createHarness({ authenticatedRole: { id: 17, type: 'authenticated' } });
  const lifecycle = createContentApiPermissionsLifecycle(harness.strapi);

  await lifecycle.afterUpdate({
    result: { id: harness.publicRole.id, type: 'public' },
    params: { data: { name: 'Public', description: 'Configured by an administrator' } },
  });

  assert.equal(harness.permissionVersion, undefined);
  const ready = await bootstrap.__private.ensureContentApiPermissions(harness.strapi, harness.log);
  assert.equal(ready, true);
  assert.equal(harness.permissionWrites.length, REQUIRED_ACTIONS.length);
  assert.ok(harness.permissionWrites.every(({ role }) => role === 17));
});
