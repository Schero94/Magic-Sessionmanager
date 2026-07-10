'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const controllers = require('../server/src/controllers');
const adminRoutes = require('../server/src/routes/admin').routes;
const contentRoutes = require('../server/src/routes/content-api').routes;

function assertHandlerExists(route) {
  const [controllerName, actionName] = route.handler.split('.');
  const exportedController = controllers[controllerName];
  const controller = typeof exportedController === 'function'
    ? exportedController({ strapi: {} })
    : exportedController;
  assert.equal(
    typeof controller?.[actionName],
    'function',
    `${route.method} ${route.path} references missing handler ${route.handler}`
  );
}

test('every admin route has a real controller action and full RBAC protection', () => {
  for (const route of adminRoutes) {
    assertHandlerExists(route);
    const policies = route.config?.policies || [];
    assert.ok(policies.includes('admin::isAuthenticatedAdmin'), `${route.path} lacks admin auth`);
    assert.ok(
      policies.some((policy) =>
        policy?.name === 'admin::hasPermissions' &&
        policy.config?.actions?.includes('plugin::magic-sessionmanager.access')
      ),
      `${route.path} lacks plugin RBAC`
    );
  }
});

test('every content API route has a real controller action and JWT protection', () => {
  for (const route of contentRoutes) {
    assertHandlerExists(route);
    assert.deepEqual(route.config?.auth?.strategies, ['users-permissions']);
    assert.ok(route.config?.middlewares?.length > 0, `${route.path} lacks rate limiting`);
  }
});
