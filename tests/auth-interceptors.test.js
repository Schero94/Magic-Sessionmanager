'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SESSION_ENCRYPTION_KEY =
  process.env.SESSION_ENCRYPTION_KEY || 'magic-sessionmanager-test-encryption-key';

const bootstrap = require('../server/src/bootstrap');
const { hashToken } = require('../server/src/utils/encryption');
const { invalidateSettingsCache } = require('../server/src/utils/settings-loader');

const LOGOUT_ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.logout-access-signature';
const BEARER_ONLY_ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLWJlYXJlciJ9.bearer-only-signature';
const LEGACY_ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLWxlZ2FjeSJ9.legacy-access-signature';
const UNRELATED_ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLXVucmVsYXRlZCJ9.unrelated-signature';
const MALFORMED_SHORT_ACCESS_TOKEN = 'invalid-access';
const BUILT_IN_LOGOUT_ROUTE = {
  handler: 'auth.logout',
  info: { pluginName: 'users-permissions' },
};

function createStrapi({
  sessionService,
  findSession,
  settings = {},
  notifications = {},
  jwtManagement = 'refresh',
} = {}) {
  invalidateSettingsCache();
  const middleware = [];
  const log = { debug() {}, error() {}, info() {}, warn() {} };

  return {
    middleware,
    server: {
      use(fn) {
        middleware.push(fn);
      },
      routes() {},
      listRoutes() {
        return [];
      },
    },
    config: {
      get(key, fallback) {
        if (key === 'plugin::users-permissions.sessions.cookie.name') {
          return 'strapi_up_refresh';
        }
        if (key === 'plugin::users-permissions.jwtManagement') return jwtManagement;
        if (key === 'plugin::magic-sessionmanager') return settings;
        return fallback;
      },
    },
    store: () => ({ get: async () => null }),
    plugin(name) {
      if (name === 'magic-sessionmanager') {
        return {
          service(serviceName) {
            if (serviceName === 'session') return sessionService;
            if (serviceName === 'notifications') return notifications;
            throw new Error(`Unexpected service ${serviceName}`);
          },
        };
      }
      throw new Error(`Unexpected plugin ${name}`);
    },
    documents: () => ({
      findFirst: async (query) => findSession?.(query) || null,
    }),
    log,
  };
}

function createContext({
  path,
  body,
  authorization,
  requestBody = {},
  cookies = {},
  authenticatedUser,
  downstreamStatus = 200,
  downstreamRoute,
  events,
}) {
  const headers = {};
  return {
    path,
    method: 'POST',
    status: 404,
    body: null,
    state: {},
    request: {
      body: requestBody,
      headers: {
        ...(authorization ? { authorization } : {}),
        'user-agent': 'TestBrowser/1.0',
      },
    },
    cookies: {
      get(name) {
        return cookies[name];
      },
    },
    response: { headers },
    remove(name) {
      delete headers[name.toLowerCase()];
    },
    append(name, value) {
      const key = name.toLowerCase();
      headers[key] = headers[key] ? [].concat(headers[key], value) : value;
    },
    set(name, value) {
      headers[name.toLowerCase()] = value;
    },
    async downstream() {
      if (authenticatedUser) {
        this.state.user = authenticatedUser;
        events?.push('authenticated');
      }
      if (downstreamRoute) this.state.route = downstreamRoute;
      this.status = downstreamStatus;
      this.body = body;
    },
  };
}

test('login fails closed and strips issued tokens when session creation fails', async () => {
  const sessionService = {
    createSession: async () => {
      throw new Error('database unavailable');
    },
  };
  const strapi = createStrapi({ sessionService });
  bootstrap.__private.mountLoginInterceptor({ strapi, log: strapi.log, sessionService });

  const ctx = createContext({
    path: '/api/auth/local',
    body: { jwt: 'issued-access', refreshToken: 'issued-refresh', user: { documentId: 'user-1' } },
  });
  await strapi.middleware[0](ctx, () => ctx.downstream());

  assert.equal(ctx.status, 503);
  assert.equal(ctx.body?.jwt, undefined);
  assert.equal(ctx.body?.refreshToken, undefined);
});

test('change-password fails closed when the current session cannot be rotated', async () => {
  const sessionService = { rotateSessionTokens: async () => false };
  const strapi = createStrapi({
    sessionService,
    findSession(query) {
      assert.equal(query.filters.tokenHash, hashToken('old-access'));
      return { documentId: 'session-1' };
    },
  });
  bootstrap.__private.mountLoginInterceptor({ strapi, log: strapi.log, sessionService });

  const ctx = createContext({
    path: '/api/auth/change-password',
    authorization: 'Bearer old-access',
    body: { jwt: 'new-access', refreshToken: 'new-refresh', user: { documentId: 'user-1' } },
  });
  await strapi.middleware[0](ctx, () => ctx.downstream());

  assert.equal(ctx.status, 503);
  assert.equal(ctx.body?.jwt, undefined);
  assert.equal(ctx.body?.refreshToken, undefined);
});

test('refresh fails closed when a concurrent rotation already consumed the body token', async () => {
  const sessionService = { rotateSessionTokens: async () => false };
  const strapi = createStrapi({
    sessionService,
    findSession: () => ({ documentId: 'session-1' }),
  });
  bootstrap.__private.mountRefreshTokenInterceptor({ strapi, log: strapi.log, sessionService });

  const ctx = createContext({
    path: '/api/auth/refresh',
    requestBody: { refreshToken: 'old-refresh' },
    body: { jwt: 'new-access', refreshToken: 'new-refresh' },
  });
  await strapi.middleware[0](ctx, () => ctx.downstream());

  assert.equal(ctx.status, 503);
  assert.equal(ctx.body?.jwt, undefined);
  assert.equal(ctx.body?.refreshToken, undefined);
});

test('refresh rotates tokens supplied through HttpOnly cookies', async () => {
  let rotation;
  const sessionService = {
    rotateSessionTokens: async (args) => {
      rotation = args;
      return true;
    },
  };
  const strapi = createStrapi({
    sessionService,
    findSession: () => ({ documentId: 'session-cookie' }),
  });
  bootstrap.__private.mountRefreshTokenInterceptor({ strapi, log: strapi.log, sessionService });

  const ctx = createContext({
    path: '/api/auth/refresh',
    cookies: { strapi_up_refresh: 'old-cookie-refresh' },
    body: { jwt: 'new-access' },
  });
  await strapi.middleware[0](ctx, async () => {
    await ctx.downstream();
    ctx.response.headers['set-cookie'] =
      'strapi_up_refresh=new-cookie-refresh; Path=/; HttpOnly; SameSite=Lax';
  });

  assert.equal(ctx.status, 200);
  assert.equal(rotation.expectedRefreshToken, 'old-cookie-refresh');
  assert.equal(rotation.refreshToken, 'new-cookie-refresh');
});

test('built-in logout authenticates downstream before terminating the plugin session', async () => {
  const events = [];
  const sessionService = {
    terminateSessionByRefreshToken: async () => {
      events.push('terminated');
      return true;
    },
    terminateAuthenticatedSession: async () => {
      events.push('terminated');
      return true;
    },
  };
  const strapi = createStrapi({ sessionService });
  bootstrap.__private.mountLogoutInterceptor({ strapi, log: strapi.log, sessionService });

  const ctx = createContext({
    path: '/api/auth/logout',
    cookies: { strapi_up_refresh: 'logout-cookie-refresh' },
    body: { ok: true },
    authenticatedUser: { documentId: 'user-1' },
    downstreamRoute: BUILT_IN_LOGOUT_ROUTE,
    events,
  });
  await strapi.middleware[0](ctx, () => ctx.downstream());

  assert.deepEqual(events, ['authenticated', 'terminated']);
});

test('built-in logout adds the stable success message to a successful downstream body', async () => {
  const sessionService = {
    terminateAuthenticatedSession: async () => true,
  };
  const strapi = createStrapi({ sessionService });
  bootstrap.__private.mountLogoutInterceptor({ strapi, log: strapi.log, sessionService });

  const ctx = createContext({
    path: '/api/auth/logout',
    authorization: `Bearer ${LOGOUT_ACCESS_TOKEN}`,
    body: { ok: true },
    authenticatedUser: { documentId: 'user-1' },
    downstreamRoute: BUILT_IN_LOGOUT_ROUTE,
  });
  await strapi.middleware[0](ctx, () => ctx.downstream());

  assert.deepEqual(ctx.body, { ok: true, message: 'Logged out successfully' });
});

test('successful refresh-cookie logout terminates the authenticated session with both tokens', async () => {
  let termination;
  const sessionService = {
    terminateSessionByRefreshToken: async () => true,
    terminateAuthenticatedSession: async (args) => {
      termination = args;
      return true;
    },
  };
  const strapi = createStrapi({ sessionService });
  bootstrap.__private.mountLogoutInterceptor({ strapi, log: strapi.log, sessionService });

  const ctx = createContext({
    path: '/api/auth/logout',
    authorization: `Bearer ${LOGOUT_ACCESS_TOKEN}`,
    cookies: { strapi_up_refresh: 'logout-cookie-refresh' },
    body: { ok: true },
    authenticatedUser: { documentId: 'user-1' },
    downstreamRoute: BUILT_IN_LOGOUT_ROUTE,
  });
  await strapi.middleware[0](ctx, () => ctx.downstream());

  assert.deepEqual(termination, {
    userDocumentId: 'user-1',
    refreshToken: 'logout-cookie-refresh',
    accessToken: LOGOUT_ACCESS_TOKEN,
  });
});

test('Bearer-only logout terminates the authenticated current session', async () => {
  let termination;
  const sessionService = {
    terminateAuthenticatedSession: async (args) => {
      termination = args;
      return true;
    },
  };
  const strapi = createStrapi({ sessionService });
  bootstrap.__private.mountLogoutInterceptor({ strapi, log: strapi.log, sessionService });

  const ctx = createContext({
    path: '/api/auth/logout',
    authorization: `Bearer ${BEARER_ONLY_ACCESS_TOKEN}`,
    body: { ok: true },
    authenticatedUser: { documentId: 'user-bearer' },
    downstreamRoute: BUILT_IN_LOGOUT_ROUTE,
  });
  await strapi.middleware[0](ctx, () => ctx.downstream());

  assert.deepEqual(termination, {
    userDocumentId: 'user-bearer',
    refreshToken: null,
    accessToken: BEARER_ONLY_ACCESS_TOKEN,
  });
});

test('authenticated logout preserves a successful response from a different route', async () => {
  let terminationCalls = 0;
  const sessionService = {
    terminateAuthenticatedSession: async () => {
      terminationCalls++;
      return true;
    },
  };
  const strapi = createStrapi({ sessionService });
  bootstrap.__private.mountLogoutInterceptor({ strapi, log: strapi.log, sessionService });
  const customBody = { ok: true, source: 'custom-route' };

  const ctx = createContext({
    path: '/api/auth/logout',
    authorization: `Bearer ${LOGOUT_ACCESS_TOKEN}`,
    body: customBody,
    authenticatedUser: { documentId: 'user-1' },
    downstreamStatus: 200,
    downstreamRoute: {
      handler: 'custom.logout',
      info: { pluginName: 'custom-auth' },
    },
  });
  await strapi.middleware[0](ctx, () => ctx.downstream());

  assert.equal(terminationCalls, 0);
  assert.equal(ctx.status, 200);
  assert.deepEqual(ctx.body, customBody);
});

test('logout downstream 401 without an authenticated user preserves the response and performs no termination', async () => {
  let terminationCalls = 0;
  const sessionService = {
    terminateSessionByRefreshToken: async () => {
      terminationCalls++;
      return true;
    },
    terminateAuthenticatedSession: async () => {
      terminationCalls++;
      return true;
    },
  };
  const strapi = createStrapi({ sessionService });
  bootstrap.__private.mountLogoutInterceptor({ strapi, log: strapi.log, sessionService });
  const unauthorizedBody = {
    error: { status: 401, name: 'UnauthorizedError', message: 'Invalid token' },
  };

  const ctx = createContext({
    path: '/api/auth/logout',
    authorization: `Bearer ${MALFORMED_SHORT_ACCESS_TOKEN}`,
    cookies: { strapi_up_refresh: 'untrusted-refresh' },
    body: unauthorizedBody,
    downstreamStatus: 401,
  });
  await strapi.middleware[0](ctx, () => ctx.downstream());

  assert.equal(terminationCalls, 0);
  assert.equal(ctx.status, 401);
  assert.deepEqual(ctx.body, unauthorizedBody);
});

test('authenticated legacy-support logout converts the missing downstream route to stable success', async () => {
  const terminations = [];
  const sessionService = {
    terminateAuthenticatedSession: async (args) => {
      terminations.push(args);
      return true;
    },
  };
  const strapi = createStrapi({ sessionService, jwtManagement: 'legacy-support' });
  bootstrap.__private.mountLogoutInterceptor({ strapi, log: strapi.log, sessionService });

  const ctx = createContext({
    path: '/api/auth/logout',
    authorization: `Bearer ${LEGACY_ACCESS_TOKEN}`,
    body: { error: { status: 404, name: 'NotFoundError', message: 'Not Found' } },
    authenticatedUser: { documentId: 'user-legacy' },
    downstreamStatus: 404,
    downstreamRoute: BUILT_IN_LOGOUT_ROUTE,
  });
  await strapi.middleware[0](ctx, () => ctx.downstream());

  assert.deepEqual(terminations, [{
    userDocumentId: 'user-legacy',
    refreshToken: null,
    accessToken: LEGACY_ACCESS_TOKEN,
  }]);
  assert.equal(ctx.status, 200);
  assert.deepEqual(ctx.body, { ok: true, message: 'Logged out successfully' });
});

test('authenticated legacy-support logout preserves a 404 from a different route', async () => {
  let terminationCalls = 0;
  const sessionService = {
    terminateAuthenticatedSession: async () => {
      terminationCalls++;
      return true;
    },
  };
  const strapi = createStrapi({ sessionService, jwtManagement: 'legacy-support' });
  bootstrap.__private.mountLogoutInterceptor({ strapi, log: strapi.log, sessionService });
  const notFoundBody = {
    error: { status: 404, name: 'NotFoundError', message: 'Custom route not found' },
  };

  const ctx = createContext({
    path: '/api/auth/logout',
    authorization: `Bearer ${LEGACY_ACCESS_TOKEN}`,
    body: notFoundBody,
    authenticatedUser: { documentId: 'user-legacy' },
    downstreamStatus: 404,
    downstreamRoute: {
      handler: 'custom.logout',
      info: { pluginName: 'custom-auth' },
    },
  });
  await strapi.middleware[0](ctx, () => ctx.downstream());

  assert.equal(terminationCalls, 0);
  assert.equal(ctx.status, 404);
  assert.deepEqual(ctx.body, notFoundBody);
});

test('unauthenticated legacy-support logout preserves an unrelated downstream 404', async () => {
  let terminationCalls = 0;
  const sessionService = {
    terminateAuthenticatedSession: async () => {
      terminationCalls++;
      return true;
    },
  };
  const strapi = createStrapi({ sessionService, jwtManagement: 'legacy-support' });
  bootstrap.__private.mountLogoutInterceptor({ strapi, log: strapi.log, sessionService });
  const notFoundBody = {
    error: { status: 404, name: 'NotFoundError', message: 'Not Found' },
  };

  const ctx = createContext({
    path: '/api/auth/logout',
    authorization: `Bearer ${UNRELATED_ACCESS_TOKEN}`,
    body: notFoundBody,
    downstreamStatus: 404,
  });
  await strapi.middleware[0](ctx, () => ctx.downstream());

  assert.equal(terminationCalls, 0);
  assert.equal(ctx.status, 404);
  assert.deepEqual(ctx.body, notFoundBody);
});

test('does not register a compatibility logout route when Strapi already provides one', () => {
  let registered = false;
  const strapi = {
    server: {
      listRoutes: () => [],
      api: () => ({
        listRoutes: () => [{ path: '/auth/logout', methods: ['POST'] }],
      }),
      routes: () => {
        registered = true;
      },
    },
    config: { get: (_key, fallback) => fallback },
  };

  bootstrap.__private.mountLogoutRoute({
    strapi,
    log: { debug() {}, info() {} },
    sessionService: {},
  });

  assert.equal(registered, false);
});

test('fallback logout route delegates termination through authenticated ownership', async () => {
  const terminations = [];
  let rawTerminationCalls = 0;
  let sessionLookupCalls = 0;
  let registeredRoute;
  const sessionService = {
    terminateAuthenticatedSession: async (args) => {
      terminations.push(args);
      return true;
    },
    terminateSession: async () => {
      rawTerminationCalls++;
      return true;
    },
  };
  const strapi = {
    server: {
      listRoutes: () => [],
      api: () => ({ listRoutes: () => [] }),
      routes(routes) {
        [registeredRoute] = routes;
      },
    },
    config: { get: (_key, fallback) => fallback },
    plugin(name) {
      assert.equal(name, 'users-permissions');
      return {
        service(serviceName) {
          assert.equal(serviceName, 'jwt');
          return {
            async verify(token) {
              assert.equal(token, LOGOUT_ACCESS_TOKEN);
              return { id: 42001 };
            },
          };
        },
      };
    },
    entityService: {
      async findOne(uid, id) {
        assert.equal(uid, 'plugin::users-permissions.user');
        assert.equal(id, 42001);
        return { documentId: 'user-fallback' };
      },
    },
    documents(uid) {
      assert.equal(uid, 'plugin::magic-sessionmanager.session');
      return {
        async findFirst() {
          sessionLookupCalls++;
          return { documentId: 'session-fallback', isActive: true };
        },
      };
    },
    log: { debug() {}, error() {}, info() {}, warn() {} },
  };
  bootstrap.__private.mountLogoutRoute({ strapi, log: strapi.log, sessionService });

  const ctx = createContext({
    path: '/api/auth/logout',
    authorization: `Bearer ${LOGOUT_ACCESS_TOKEN}`,
  });
  await registeredRoute.handler(ctx);

  assert.deepEqual(terminations, [{
    userDocumentId: 'user-fallback',
    refreshToken: null,
    accessToken: LOGOUT_ACCESS_TOKEN,
  }]);
  assert.equal(sessionLookupCalls, 0);
  assert.equal(rawTerminationCalls, 0);
  assert.equal(ctx.status, 200);
  assert.deepEqual(ctx.body, { ok: true, message: 'Logged out successfully' });
});

test('fallback logout route cannot terminate when user ownership is unresolved', async () => {
  let terminationCalls = 0;
  let registeredRoute;
  const sessionService = {
    terminateAuthenticatedSession: async () => {
      terminationCalls++;
      return true;
    },
    terminateSession: async () => {
      terminationCalls++;
      return true;
    },
  };
  const strapi = {
    server: {
      listRoutes: () => [],
      api: () => ({ listRoutes: () => [] }),
      routes(routes) {
        [registeredRoute] = routes;
      },
    },
    config: { get: (_key, fallback) => fallback },
    plugin: () => ({
      service: () => ({
        verify: async (token) => {
          assert.equal(token, LOGOUT_ACCESS_TOKEN);
          return { id: 42002 };
        },
      }),
    }),
    entityService: {
      async findOne(uid, id) {
        assert.equal(uid, 'plugin::users-permissions.user');
        assert.equal(id, 42002);
        return null;
      },
    },
    documents: () => ({
      findFirst: async () => ({ documentId: 'unowned-session', isActive: true }),
    }),
    log: { debug() {}, error() {}, info() {}, warn() {} },
  };
  bootstrap.__private.mountLogoutRoute({ strapi, log: strapi.log, sessionService });

  const ctx = createContext({
    path: '/api/auth/logout',
    authorization: `Bearer ${LOGOUT_ACCESS_TOKEN}`,
  });
  await registeredRoute.handler(ctx);

  assert.equal(terminationCalls, 0);
});

test('login sends the dedicated VPN alert when enabled', async () => {
  let vpnAlerts = 0;
  const sessionService = {
    createSession: async (data) => ({ documentId: 'session-vpn', ...data }),
  };
  const notifications = {
    sendVpnProxyAlert: async () => {
      vpnAlerts++;
      return true;
    },
  };
  const strapi = createStrapi({
    sessionService,
    notifications,
    settings: {
      enableEmailAlerts: true,
      alertOnSuspiciousLogin: false,
      alertOnNewLocation: false,
      alertOnVpnProxy: true,
    },
  });
  bootstrap.__private.mountLoginInterceptor({ strapi, log: strapi.log, sessionService });

  const ctx = createContext({
    path: '/api/auth/local',
    body: { jwt: 'vpn-access', user: { documentId: 'user-vpn', email: 'user@example.com' } },
  });
  ctx.state.__magicSessionGeoData = {
    _status: 'ok',
    isVpn: true,
    isProxy: false,
    isThreat: false,
    securityScore: 80,
  };
  await strapi.middleware[0](ctx, () => ctx.downstream());

  assert.equal(ctx.status, 200);
  assert.equal(vpnAlerts, 1);
});

test('pre-login GeoIP guard fails closed when lookup throws in block mode', async () => {
  let reachedAuth = false;
  const strapi = createStrapi({
    settings: {
      blockSuspiciousSessions: true,
      geoLookupFailureMode: 'block',
    },
  });
  const originalPlugin = strapi.plugin;
  strapi.plugin = (name) => {
    if (name === 'magic-sessionmanager') {
      return {
        service(serviceName) {
          if (serviceName === 'geolocation') {
            return { getIpInfo: async () => { throw new Error('lookup unavailable'); } };
          }
          return originalPlugin(name).service(serviceName);
        },
      };
    }
    return originalPlugin(name);
  };
  bootstrap.__private.mountPreLoginGeoGuard({ strapi, log: strapi.log });

  const ctx = createContext({ path: '/api/auth/local', body: {} });
  ctx.request.ip = '203.0.113.25';
  ctx.ip = '203.0.113.25';
  await strapi.middleware[0](ctx, async () => {
    reachedAuth = true;
  });

  assert.equal(ctx.status, 403);
  assert.equal(reachedAuth, false);
});
