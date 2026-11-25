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

/**
 * Reviewed exceptions (4.23, Sign in as this admin): the self routes answer only an impersonation session recognised by the
 * admin impersonation guard; the target may not have plugin access.
 */
const IMPERSONATION_TAB_ROUTES = Object.freeze([
  '/admin-impersonation/self',
  '/admin-impersonation/self/end',
]);

test('the impersonation tab routes are the only reviewed exceptions', () => {
  const find = (path) => adminRoutes.find((route) => route.path === path);
  const exchange = find('/admin-impersonation/exchange').config.policies;
  assert.deepEqual(
    exchange.find((policy) => policy?.name === 'admin::hasPermissions').config.actions,
    [
      'plugin::magic-sessionmanager.access',
      'plugin::magic-sessionmanager.impersonate.admins.sign-in',
    ]
  );
  for (const path of ['/admin-impersonation/self', '/admin-impersonation/self/end']) {
    assertHandlerExists(find(path));
    assert.equal(find(path).config.auth, false);
    assert.equal(find(path).config.middlewares[0].name, 'plugin::magic-sessionmanager.rate-limit');
  }
});

test('every admin route has a real controller action and full RBAC protection', () => {
  for (const route of adminRoutes) {
    assertHandlerExists(route);
    if (IMPERSONATION_TAB_ROUTES.includes(route.path)) continue;
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
    ['GET', '/user-activity', 'user-activity.list'],
    ['GET', '/user-activity/export', 'user-activity.export'],
    ['GET', '/lockouts', 'lockouts.list'],
    ['POST', '/lockouts/unlock', 'lockouts.unlock'],
    ['GET', '/roles', 'lockouts.roles'],
    ['POST', '/webhook/test', 'webhooks.sendTest'],
    ['GET', '/geolocation/:ipAddress', 'session.getIpGeolocation'],
    ['GET', '/geoip/status', 'geoip.getStatus'],
    ['PUT', '/geoip/credentials', 'geoip.storeCredentials'],
    ['POST', '/geoip/update', 'geoip.updateDatabase'],
    ['GET', '/impersonation/status', 'impersonation.status'],
    ['POST', '/impersonation/users/:userId', 'impersonation.startUser'],
    ['POST', '/impersonation/admins/:adminId/preview', 'impersonation.previewAdmin'],
    ['POST', '/impersonation/admins/:adminId/sign-in', 'impersonation.signInAdmin'],
    ['POST', '/admin-impersonation/exchange', 'impersonation.exchangeAdmin'],
    ['GET', '/admin-impersonation/self', 'impersonation.adminSelf'],
    ['POST', '/admin-impersonation/self/end', 'impersonation.endAdminSelf'],
    ['GET', '/impersonation/previews/:id', 'impersonation.getPreview'],
    ['GET', '/impersonation/active', 'impersonation.listActive'],
    ['POST', '/impersonation/:id/end', 'impersonation.end'],
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

test('app-user activity routes need access and user-activity.read only, read limited', () => {
  const routes = adminRoutes.filter(({ path }) => path.startsWith('/user-activity'));
  assert.deepEqual(
    routes.map(({ method, path }) => [method, path]),
    [
      ['GET', '/user-activity'],
      ['GET', '/user-activity/export'],
    ]
  );
  for (const route of routes) {
    assert.equal(route.config.policies[0], 'admin::isAuthenticatedAdmin');
    const actions = route.config.policies.find((policy) => policy?.name === 'admin::hasPermissions')
      .config.actions;
    // Not admin-sessions.read: app users are not the admin panel view.
    assert.deepEqual(actions, [
      'plugin::magic-sessionmanager.access',
      'plugin::magic-sessionmanager.user-activity.read',
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
    ({ path }) =>
      !path.startsWith('/admin-sessions/') &&
      !path.startsWith('/admin-activity/') &&
      !path.startsWith('/user-activity') &&
      path !== '/lockouts/unlock' &&
      path !== '/webhook/test' &&
      !IMPERSONATION_TAB_ROUTES.includes(path) &&
      path !== '/admin-impersonation/exchange' &&
      !(
        path.startsWith('/impersonation/') &&
        !['/impersonation/status', '/impersonation/active', '/impersonation/:id/end'].includes(path)
      )
  )) {
    assert.deepEqual(actionsOf(route), ['plugin::magic-sessionmanager.access']);
  }
});

test('impersonation routes need their impersonate action; starts are rate limited per admin', () => {
  const actionsOf = (route) =>
    route.config.policies.find((policy) => policy?.name === 'admin::hasPermissions').config.actions;
  const find = (path) => adminRoutes.find((route) => route.path === path);
  const access = 'plugin::magic-sessionmanager.access';
  const users = 'plugin::magic-sessionmanager.impersonate.users';
  const admins = 'plugin::magic-sessionmanager.impersonate.admins';
  for (const route of adminRoutes.filter(({ path }) => path.startsWith('/impersonation/'))) {
    assert.equal(route.config.policies[0], 'admin::isAuthenticatedAdmin');
    assert.equal(route.config.middlewares[0].name, 'plugin::magic-sessionmanager.rate-limit');
  }
  assert.deepEqual(actionsOf(find('/impersonation/status')), [access]);
  assert.deepEqual(actionsOf(find('/impersonation/users/:userId')), [access, users]);
  assert.deepEqual(actionsOf(find('/impersonation/admins/:adminId/preview')), [access, admins]);
  assert.deepEqual(actionsOf(find('/impersonation/previews/:id')), [access, admins]);
  assert.deepEqual(actionsOf(find('/impersonation/admins/:adminId/sign-in')), [
    access,
    'plugin::magic-sessionmanager.impersonate.admins.sign-in',
  ]);
  // Listing and ending serve both kinds: access plus either action.
  for (const path of ['/impersonation/active', '/impersonation/:id/end']) {
    const route = find(path);
    assert.deepEqual(actionsOf(route), [access]);
    assert.ok(route.config.policies.includes('plugin::magic-sessionmanager.can-impersonate'));
  }
  for (const path of [
    '/impersonation/users/:userId',
    '/impersonation/admins/:adminId/preview',
    '/impersonation/admins/:adminId/sign-in',
  ]) {
    assert.deepEqual(find(path).config.middlewares[0].config, { max: 10, window: 10 * 60 * 1000 });
  }
});

test('the signed webhook test needs settings.update and is write rate limited', () => {
  const route = adminRoutes.find(({ path }) => path === '/webhook/test');
  assert.equal(route.method, 'POST');
  assert.equal(route.config.policies[0], 'admin::isAuthenticatedAdmin');
  assert.deepEqual(
    route.config.policies.find((policy) => policy?.name === 'admin::hasPermissions').config.actions,
    ['plugin::magic-sessionmanager.access', 'plugin::magic-sessionmanager.settings.update']
  );
  assert.deepEqual(route.config.middlewares[0].config, {
    profile: 'write',
    max: 5,
    window: 60_000,
  });
});

test('lifting a sign-in lock needs lockouts.unlock and is write rate limited', () => {
  const unlock = adminRoutes.find(({ path }) => path === '/lockouts/unlock');
  assert.equal(unlock.method, 'POST');
  assert.equal(unlock.config.policies[0], 'admin::isAuthenticatedAdmin');
  assert.deepEqual(
    unlock.config.policies.find((policy) => policy?.name === 'admin::hasPermissions').config
      .actions,
    ['plugin::magic-sessionmanager.access', 'plugin::magic-sessionmanager.lockouts.unlock']
  );
  assert.deepEqual(unlock.config.middlewares[0].config, {
    profile: 'write',
    max: 10,
    window: 60_000,
  });
  for (const path of ['/lockouts', '/roles']) {
    const route = adminRoutes.find((candidate) => candidate.path === path);
    assert.equal(route.method, 'GET');
    assert.equal(route.config.middlewares[0].config.profile, 'read');
  }
});

/** Public on purpose (4.17): the "This wasn't me" email link; a signed single-use token authorises. */
const PUBLIC_CONTENT_ROUTES = new Set([
  'GET /not-me',
  'POST /not-me',
  // The one-time impersonation code is the credential (4.20).
  'POST /impersonation/exchange',
]);

test('every content API route has a real controller action and JWT protection', () => {
  for (const route of contentRoutes) {
    assertHandlerExists(route);
    if (PUBLIC_CONTENT_ROUTES.has(`${route.method} ${route.path}`)) {
      assert.equal(route.config?.auth, false);
    } else {
      assert.deepEqual(route.config?.auth?.strategies, ['users-permissions']);
    }
    assert.ok(route.config?.middlewares?.length > 0, `${route.path} lacks rate limiting`);
  }
});

test('the public "This wasn\'t me" routes and the own-data export are rate limited per caller', () => {
  const find = (method, path) =>
    contentRoutes.find((route) => route.method === method && route.path === path);
  assert.deepEqual(find('GET', '/not-me').config.middlewares[0].config, {
    max: 30,
    window: 60_000,
  });
  assert.deepEqual(find('POST', '/not-me').config.middlewares[0].config, {
    max: 10,
    window: 60_000,
  });
  assert.deepEqual(find('GET', '/my-data').config.middlewares[0].config, {
    max: 3,
    window: 60 * 60 * 1000,
  });
  assert.equal(find('GET', '/my-data').handler, 'self-service.exportOwnData');
});

test('content API session routes retain their paths, methods, handlers and rate-limit profiles', () => {
  const sessionRoutes = contentRoutes
    .filter(({ handler }) => handler.startsWith('session.'))
    .map(({ method, path, handler, config }) => ({
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
