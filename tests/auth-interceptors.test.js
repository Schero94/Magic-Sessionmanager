'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.SESSION_ENCRYPTION_KEY =
  process.env.SESSION_ENCRYPTION_KEY || 'magic-sessionmanager-test-encryption-key';

const bootstrap = require('../server/src/bootstrap');
const { hashToken } = require('../server/src/utils/encryption');
const { invalidateSettingsCache } = require('../server/src/utils/settings-loader');

function createStrapi({ sessionService, findSession, settings = {}, notifications = {} } = {}) {
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

function createContext({ path, body, authorization, requestBody = {}, cookies = {} }) {
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
      this.status = 200;
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

test('built-in logout terminates the session identified by its HttpOnly refresh cookie', async () => {
  let terminatedWith;
  const sessionService = {
    terminateSessionByRefreshToken: async (token) => {
      terminatedWith = token;
      return true;
    },
  };
  const strapi = createStrapi({ sessionService });
  bootstrap.__private.mountLogoutInterceptor({ strapi, log: strapi.log, sessionService });

  const ctx = createContext({
    path: '/api/auth/logout',
    cookies: { strapi_up_refresh: 'logout-cookie-refresh' },
    body: { message: 'Logged out' },
  });
  await strapi.middleware[0](ctx, () => ctx.downstream());

  assert.equal(ctx.status, 200);
  assert.equal(terminatedWith, 'logout-cookie-refresh');
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
