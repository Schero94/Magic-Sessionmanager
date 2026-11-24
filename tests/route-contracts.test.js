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
    ['GET', '/sessions/stats', 'session.getSessionStatsAdmin'],
    ['GET', '/sessions/native-only/summary', 'session.getNativeOnlySummaryAdmin'],
    ['POST', '/sessions/native-only/end', 'session.endNativeOnlySessionsAdmin'],
    ['GET', '/sessions/analytics', 'session.getSessionAnalyticsAdmin'],
    ['GET', '/sessions/export', 'session.exportSessionsAdmin'],
    ['GET', '/user/:userId/sessions', 'session.getUserSessions'],
    ['POST', '/sessions/:sessionId/terminate', 'session.terminateSingleSession'],
    ['DELETE', '/sessions/:sessionId', 'session.deleteSession'],
    ['POST', '/sessions/clean-inactive', 'session.cleanInactiveSessions'],
    ['POST', '/user/:userId/terminate-all', 'session.terminateAllUserSessions'],
    ['POST', '/user/:userId/toggle-block', 'session.toggleUserBlock'],
    ['GET', '/users/stats', 'session.getUserStatsAdmin'],
    ['GET', '/admin-sessions/admins', 'admin-sessions.listAdmins'],
    ['GET', '/admin-sessions/admins/:adminId/sessions', 'admin-sessions.listAdminSessions'],
    [
      'POST',
      '/admin-sessions/admins/:adminId/sessions/:sessionId/sign-out',
      'admin-sessions.signOutSession',
    ],
    [
      'POST',
      '/admin-sessions/admins/:adminId/sign-out-everywhere',
      'admin-sessions.signOutEverywhere',
    ],
    ['GET', '/admin-activity/sign-ins', 'admin-activity.listSignIns'],
    ['GET', '/admin-activity/sign-ins/export', 'admin-activity.exportSignIns'],
    ['GET', '/admin-activity/content', 'admin-activity.listContentActivity'],
    ['GET', '/admin-activity/content/export', 'admin-activity.exportContentActivity'],
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

  assert.deepEqual(
    adminRoutes.map(({ method, path, handler }) => [method, path, handler]),
    expected
  );
});

test('admin activity routes need access, admin-sessions.read and admin-activity.read, read limited', () => {
  const routes = adminRoutes.filter(({ path }) => path.startsWith('/admin-activity/'));
  assert.equal(routes.length, 4);
  for (const route of routes) {
    assert.equal(route.method, 'GET');
    assert.equal(route.config.policies[0], 'admin::isAuthenticatedAdmin');
    const actions = route.config.policies.find((policy) => policy?.name === 'admin::hasPermissions')
      .config.actions;
    assert.deepEqual(actions, [
      'plugin::magic-sessionmanager.access',
      'plugin::magic-sessionmanager.admin-sessions.read',
      'plugin::magic-sessionmanager.admin-activity.read',
    ]);
    assert.equal(route.config.middlewares[0].name, 'plugin::magic-sessionmanager.rate-limit');
    assert.equal(route.config.middlewares[0].config.profile, 'read');
  }
});

test('admin panel session routes need their own actions, and sign-out is write rate limited', () => {
  const actionsOf = (route) =>
    route.config.policies.find((policy) => policy?.name === 'admin::hasPermissions').config.actions;
  const adminSessionRoutes = adminRoutes.filter(({ path }) => path.startsWith('/admin-sessions/'));
  assert.equal(adminSessionRoutes.length, 4);
  for (const route of adminSessionRoutes) {
    const actions = actionsOf(route);
    assert.ok(actions.includes('plugin::magic-sessionmanager.access'));
    assert.ok(actions.includes('plugin::magic-sessionmanager.admin-sessions.read'));
    const limit = route.config.middlewares[0];
    assert.equal(limit.name, 'plugin::magic-sessionmanager.rate-limit');
    if (route.method === 'GET') {
      assert.ok(!actions.includes('plugin::magic-sessionmanager.admin-sessions.revoke'));
      assert.equal(limit.config.profile, 'read');
    } else {
      assert.ok(actions.includes('plugin::magic-sessionmanager.admin-sessions.revoke'));
      assert.deepEqual(limit.config, { profile: 'write', max: 10, window: 60_000 });
    }
  }
  // Existing routes keep the plugin action only; the new actions are not required there.
  for (const route of adminRoutes.filter(
    ({ path }) => !path.startsWith('/admin-sessions/') && !path.startsWith('/admin-activity/')
  )) {
    assert.deepEqual(actionsOf(route), ['plugin::magic-sessionmanager.access']);
  }
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
    ['GET', '/sessions/stats', 'session.getSessionStatsAdmin'],
    ['GET', '/sessions/native-only/summary', 'session.getNativeOnlySummaryAdmin'],
    ['POST', '/sessions/native-only/end', 'session.endNativeOnlySessionsAdmin'],
    ['GET', '/sessions/analytics', 'session.getSessionAnalyticsAdmin'],
    ['GET', '/sessions/export', 'session.exportSessionsAdmin'],
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

test('admin session list, statistics, export and user totals are read-rate-limited', () => {
  const limited = [
    '/sessions',
    '/sessions/active',
    '/sessions/stats',
    '/sessions/native-only/summary',
    '/sessions/analytics',
    '/sessions/export',
    '/users/stats',
  ];
  for (const path of limited) {
    const route = adminRoutes.find(
      (candidate) => candidate.method === 'GET' && candidate.path === path
    );
    assert.ok(route, path);
    assert.deepEqual(
      route.config.middlewares,
      [
        {
          name: 'plugin::magic-sessionmanager.rate-limit',
          config: { profile: 'read', max: 120, window: 60_000 },
        },
      ],
      `${path} uses the read rate limit`
    );
  }
});

test('ending untracked sessions is write-rate-limited to five requests a minute', () => {
  const route = adminRoutes.find(
    (candidate) => candidate.method === 'POST' && candidate.path === '/sessions/native-only/end'
  );
  assert.ok(route);
  assert.deepEqual(route.config.middlewares, [
    {
      name: 'plugin::magic-sessionmanager.rate-limit',
      config: { profile: 'write', max: 5, window: 60_000 },
    },
  ]);
});
