'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const controllers = require('../server/src/controllers');
const adminRoutes = require('../server/src/routes/admin').routes;
const contentRoutes = require('../server/src/routes/content-api').routes;

function assertHandlerExists(route) {
  const [controllerName, actionName] = route.handler.split('.');
  const exportedController = controllers[controllerName];
  const controller =
    typeof exportedController === 'function'
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
      policies.some(
        (policy) =>
          policy?.name === 'admin::hasPermissions' &&
          policy.config?.actions?.includes('plugin::magic-sessionmanager.access')
      ),
      `${route.path} lacks plugin RBAC`
    );
  }
});

test('all Session Manager admin API paths and handlers stay in the reviewed inventory', () => {
  const expected = [
    ['GET', '/sessions', 'session.getAllSessionsAdmin'],
    ['GET', '/sessions/active', 'session.getActiveSessions'],
    ['GET', '/user/:userId/sessions', 'session.getUserSessions'],
    ['POST', '/sessions/:sessionId/terminate', 'session.terminateSingleSession'],
    ['DELETE', '/sessions/:sessionId', 'session.deleteSession'],
    ['POST', '/sessions/clean-inactive', 'session.cleanInactiveSessions'],
    ['POST', '/user/:userId/terminate-all', 'session.terminateAllUserSessions'],
    ['POST', '/user/:userId/toggle-block', 'session.toggleUserBlock'],
    ['GET', '/users/stats', 'session.getUserStatsAdmin'],
    ['GET', '/license/status', 'license.getStatus'],
    ['POST', '/license/auto-create', 'license.autoCreate'],
    ['POST', '/license/create', 'license.createAndActivate'],
    ['POST', '/license/ping', 'license.ping'],
    ['POST', '/license/store-key', 'license.storeKey'],
    ['GET', '/geolocation/:ipAddress', 'session.getIpGeolocation'],
    ['GET', '/geoip/status', 'geoip.getStatus'],
    ['PUT', '/geoip/credentials', 'geoip.storeCredentials'],
    ['POST', '/geoip/update', 'geoip.updateDatabase'],
    ['GET', '/settings', 'settings.getSettings'],
    ['PUT', '/settings', 'settings.updateSettings'],
  ];

  if (adminRoutes.some(({ path }) => path === '/sessions/:sessionId/simulate-timeout')) {
    expected.push(['POST', '/sessions/:sessionId/simulate-timeout', 'session.simulateTimeout']);
  }

  assert.deepEqual(adminRoutes.map(({ method, path, handler }) => [method, path, handler]), expected);
});

test('every content API route has a real controller action and JWT protection', () => {
  for (const route of contentRoutes) {
    assertHandlerExists(route);
    assert.deepEqual(route.config?.auth?.strategies, ['users-permissions']);
    assert.ok(route.config?.middlewares?.length > 0, `${route.path} lacks rate limiting`);
  }
});

test('content API session routes retain their paths, methods, handlers and rate-limit profiles', () => {
  const sessionRoutes = contentRoutes.map(({ method, path, handler, config }) => ({
    method,
    path,
    handler,
    strategies: config?.auth?.strategies,
    rateLimit: config?.middlewares?.[0]?.config?.profile,
  }));

  assert.deepEqual(sessionRoutes, [
    {
      method: 'POST',
      path: '/logout',
      handler: 'session.logout',
      strategies: ['users-permissions'],
      rateLimit: 'write',
    },
    {
      method: 'POST',
      path: '/logout-all',
      handler: 'session.logoutAll',
      strategies: ['users-permissions'],
      rateLimit: 'write',
    },
    {
      method: 'POST',
      path: '/logout-others',
      handler: 'session.logoutOthers',
      strategies: ['users-permissions'],
      rateLimit: 'write',
    },
    {
      method: 'GET',
      path: '/my-sessions',
      handler: 'session.getOwnSessions',
      strategies: ['users-permissions'],
      rateLimit: 'read',
    },
    {
      method: 'GET',
      path: '/current-session',
      handler: 'session.getCurrentSession',
      strategies: ['users-permissions'],
      rateLimit: 'read',
    },
    {
      method: 'GET',
      path: '/user/:userId/sessions',
      handler: 'session.getUserSessions',
      strategies: ['users-permissions'],
      rateLimit: 'read',
    },
    {
      method: 'DELETE',
      path: '/my-sessions/:sessionId',
      handler: 'session.terminateOwnSession',
      strategies: ['users-permissions'],
      rateLimit: 'write',
    },
  ]);
});

test('admin session routes retain their paths, methods, handlers and Magic permission policy', () => {
  const expected = [
    ['GET', '/sessions', 'session.getAllSessionsAdmin'],
    ['GET', '/sessions/active', 'session.getActiveSessions'],
    ['GET', '/user/:userId/sessions', 'session.getUserSessions'],
    ['POST', '/sessions/:sessionId/terminate', 'session.terminateSingleSession'],
    ['DELETE', '/sessions/:sessionId', 'session.deleteSession'],
    ['POST', '/sessions/clean-inactive', 'session.cleanInactiveSessions'],
    ['POST', '/user/:userId/terminate-all', 'session.terminateAllUserSessions'],
    ['POST', '/user/:userId/toggle-block', 'session.toggleUserBlock'],
    ['GET', '/users/stats', 'session.getUserStatsAdmin'],
    ['GET', '/geolocation/:ipAddress', 'session.getIpGeolocation'],
  ];
  if (adminRoutes.some(({ path }) => path === '/sessions/:sessionId/simulate-timeout')) {
    expected.push(['POST', '/sessions/:sessionId/simulate-timeout', 'session.simulateTimeout']);
  }

  const sessionRoutes = adminRoutes
    .filter(({ handler }) => handler.startsWith('session.'))
    .map(({ method, path, handler, config }) => ({
      method,
      path,
      handler,
      policies: config?.policies,
    }));

  assert.deepEqual(
    sessionRoutes.map(({ method, path, handler }) => [method, path, handler]),
    expected
  );
  for (const route of sessionRoutes) {
    assert.deepEqual(route.policies, [
      'admin::isAuthenticatedAdmin',
      {
        name: 'admin::hasPermissions',
        config: { actions: ['plugin::magic-sessionmanager.access'] },
      },
    ]);
  }
});
