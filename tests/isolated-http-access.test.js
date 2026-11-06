'use strict';

// Real Strapi HTTP boundary on a disposable SQLite database. Run in its own
// Node test process: node --test tests/isolated-http-access.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');

const { resolveHostDependencies, assertHostAvailable } = require('./helpers/host-dependencies');

const sourceRoot = path.resolve(__dirname, '..');
const host = resolveHostDependencies(['@strapi/strapi', '@strapi/plugin-users-permissions', 'better-sqlite3', 'jsonwebtoken']);
const hostDependencies = host.modules;

const mode = process.env.SESSION_HTTP_MODE || 'legacy-support';
const fallbackHost = process.env.SESSION_HTTP_FALLBACK === '1';
if (!['legacy-support', 'refresh'].includes(mode)) throw new Error('Invalid isolated HTTP test mode');
test(`isolated Strapi HTTP authentication and ownership (${mode})`, { timeout: 120000, skip: host.skip }, async (t) => {
  assertHostAvailable(host);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionmanager-http-'));
  const config = path.join(root, 'config');
  const plugin = path.join(root, 'plugin');
  fs.mkdirSync(config);
  fs.mkdirSync(plugin);
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, 'public'));
  fs.mkdirSync(path.join(root, 'public', 'uploads'));
  fs.symlinkSync(hostDependencies, path.join(root, 'node_modules'), 'dir');
  const write = (filename, contents) => fs.writeFileSync(path.join(root, filename), contents);
  write('package.json', JSON.stringify({ name: 'isolated-sessionmanager-http', version: '0.0.0', private: true, dependencies: { '@strapi/plugin-users-permissions': '*' } }));
  write('plugin/package.json', JSON.stringify({ name: 'isolated-sessionmanager-source', version: '0.0.0', strapi: { kind: 'plugin', name: 'magic-sessionmanager' } }));
  write('plugin/strapi-server.js', `module.exports = require(${JSON.stringify(path.join(sourceRoot, 'server/src/index.js'))});\n`);
  write('config/database.js', `module.exports = { connection: { client: 'sqlite', connection: { filename: ${JSON.stringify(path.join(root, 'test.sqlite'))} }, useNullAsDefault: true } };\n`);
  write('config/server.js', `module.exports = { host: '127.0.0.1', port: 1337, app: { keys: [process.env.TEST_HTTP_SECRET_A, process.env.TEST_HTTP_SECRET_B] } };\n`);
  write('config/admin.js', `module.exports = { auth: { secret: process.env.TEST_HTTP_SECRET_A }, apiToken: { salt: process.env.TEST_HTTP_SECRET_B }, transfer: { token: { salt: process.env.TEST_HTTP_SECRET_A } } };\n`);
  write('config/plugins.js', `module.exports = { 'users-permissions': { enabled: true, config: { jwtSecret: process.env.TEST_HTTP_SECRET_B, jwtManagement: ${JSON.stringify(mode)} } }, 'magic-sessionmanager': { enabled: true, resolve: ${JSON.stringify(plugin)}, config: { enableGeolocation: false, geoIpProvider: 'disabled', enableWebhooks: false, enableEmailAlerts: false } } };\n`);
  if (fallbackHost) {
    fs.mkdirSync(path.join(root, 'src', 'extensions', 'users-permissions'), { recursive: true });
    write('src/extensions/users-permissions/strapi-server.js', `module.exports = (plugin) => { const routes = plugin.routes['content-api']; routes.routes = routes.routes.filter((route) => !(route.method === 'POST' && route.path === '/auth/logout')); return plugin; };\n`);
  }

  let allowedPort = null;
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const options = Array.isArray(args[0]) ? args[0][0] : typeof args[0] === 'object' ? args[0] : { port: args[0], host: args[1] };
    if (allowedPort === null || Number(options.port) !== allowedPort || !['127.0.0.1', '::1'].includes(options.host || options.hostname)) {
      throw new Error('Outbound network disabled in isolated test');
    }
    return originalConnect.apply(this, args);
  };
  process.env.NODE_ENV = 'test';
  process.env.STRAPI_TELEMETRY_DISABLED = 'true';
  process.env.ENV_PATH = path.join(root, 'no-dotenv');
  for (const name of ['MAXMIND_ACCOUNT_ID', 'MAXMIND_LICENSE_KEY', 'MAGIC_SESSIONMANAGER_GEOIP_DATABASE', 'GEOIP_DATABASE_PATH', 'GEOIP_CITY_DATABASE_PATH', 'GEOIP_COUNTRY_DATABASE_PATH', 'GEOLITE2_CITY_MMDB', 'GEOLITE2_COUNTRY_MMDB', 'MAGIC_LICENSE_SERVER_URL', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[name];
  process.env.TEST_HTTP_SECRET_A = crypto.randomBytes(32).toString('hex');
  process.env.TEST_HTTP_SECRET_B = crypto.randomBytes(32).toString('hex');
  process.env.SESSION_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  const originalCwd = process.cwd();
  process.chdir(root);
  let app;
  const geoControllerPath = require.resolve('../server/src/controllers/geoip');
  const originalGeoController = require(geoControllerPath);
  let fakeUpdaterFails = false;
  let fakeUpdaterCalls = 0;
  require.cache[geoControllerPath].exports = ({ strapi }) => originalGeoController({
    strapi,
    updateGeoIpDatabase: async () => {
      fakeUpdaterCalls++;
      if (fakeUpdaterFails) throw new Error('synthetic-updater-private-detail');
      return { updated: false, reason: 'synthetic' };
    },
  });
  t.after(async () => {
    try {
      if (app) await app.destroy();
    } finally {
      net.Socket.prototype.connect = originalConnect;
      require.cache[geoControllerPath].exports = originalGeoController;
      process.chdir(originalCwd);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  const { createStrapi } = require(path.join(hostDependencies, '@strapi/strapi'));
  app = createStrapi({ appDir: root, distDir: root, serveAdminPanel: false });
  await app.load();
  if (fallbackHost) {
    const builtIn = app.server.api('content-api').listRoutes().filter((route) => route.path === '/auth/logout' || route.path === '/api/auth/logout');
    assert.equal(builtIn.length, 0, 'temporary extension removes only the built-in logout route');
    const fallbackRoutes = app.server.listRoutes().filter((route) => route.path === '/api/auth/logout');
    assert.equal(fallbackRoutes.length, 1, 'the real bootstrap registered exactly one fallback logout route');
  }
  app.log.level = 'error';
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.httpServer.address().port;
  allowedPort = port;
  assert.throws(() => net.connect({ host: '192.0.2.1', port }), /Outbound network disabled/);
  assert.throws(() => net.connect({ host: '127.0.0.1', port: port === 1 ? 2 : 1 }), /Outbound network disabled/);
  const request = async (method, url, token, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  const role = await app.db.query('plugin::users-permissions.role').findOne({ where: { type: 'authenticated' } });
  assert.ok(role, 'isolated authenticated role exists');
  const createUser = async (suffix) => app.db.query('plugin::users-permissions.user').create({ data: {
    username: `synthetic-${suffix}`, email: `${suffix}@example.invalid`, provider: 'local', confirmed: true, blocked: false, role: role.id,
  } });
  const owner = await createUser('owner');
  const other = await createUser('other');
  const jwt = app.plugin('users-permissions').service('jwt');
  const ownerToken = await jwt.issue({ id: owner.id });
  const otherToken = await jwt.issue({ id: other.id });
  const { hashToken } = require('../server/src/utils/encryption');
  const createSession = async (user, suffix, token) => {
    const validation = mode === 'refresh' ? app.sessionManager('users-permissions').validateAccessToken(token) : null;
    return app.documents('plugin::magic-sessionmanager.session').create({ data: {
      sessionId: `synthetic-${suffix}`, user: user.documentId, ipAddress: '192.0.2.1',
      loginTime: new Date(), lastActive: new Date(), isActive: true, tokenHash: hashToken(token),
      ...(validation?.isValid ? { nativeSessionId: validation.payload.sessionId } : {}),
    } });
  };
  const ownerCurrent = await createSession(owner, 'owner-current', ownerToken);
  const otherSession = await createSession(other, 'other-current', otherToken);
  const superRole = await app.db.query('admin::role').findOne({ where: { code: 'strapi-super-admin' } });
  const editorRole = await app.db.query('admin::role').findOne({ where: { code: 'strapi-editor' } });
  assert.ok(superRole && editorRole, 'isolated admin roles exist');
  const createAdminToken = async (roleId, suffix) => {
    const admin = await app.db.query('admin::user').create({ data: {
      email: `${suffix}@example.invalid`, firstname: 'Synthetic', lastname: 'Admin', isActive: true, roles: [roleId],
    } });
    const refresh = await app.sessionManager('admin').generateRefreshToken(String(admin.id), undefined, { type: 'session' });
    const access = await app.sessionManager('admin').generateAccessToken(refresh.token);
    assert.ok(access.token);
    return access.token;
  };
  const adminToken = await createAdminToken(superRole.id, 'super');
  const editorToken = await createAdminToken(editorRole.id, 'editor');
  await t.test('every registered admin route denies anonymous, editor and content-user principals', async () => {
    const routes = require('../server/src/routes/admin').routes;
    assert.equal(routes.length, 21);
    for (const route of routes) {
      const pathname = route.path.replace(':sessionId', otherSession.documentId).replace(':userId', other.documentId).replace(':ipAddress', '192.0.2.1');
      for (const [kind, token] of [['anonymous', null], ['editor', editorToken], ['content-user', ownerToken]]) {
        const result = await request(route.method, `/magic-sessionmanager${pathname}`, token);
        assert.ok([401, 403].includes(result.status), `${route.method} ${route.path}: ${kind} received ${result.status}`);
      }
    }
    const untouched = await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: otherSession.documentId });
    assert.equal(untouched.isActive, true, 'denied calls cannot terminate the synthetic session');
  });
  await t.test('a non-super administrator can access the API when explicitly granted the plugin action', async () => {
    const permitted = await app.db.query('admin::role').create({ data: { name: 'Synthetic permitted', code: 'synthetic-permitted' } });
    await app.db.query('admin::permission').create({ data: { action: 'plugin::magic-sessionmanager.access', conditions: [], role: permitted.id } });
    const token = await createAdminToken(permitted.id, 'permitted');
    const result = await request('GET', '/magic-sessionmanager/sessions', token);
    assert.equal(result.status, 200);
  });
  await t.test('every content route denies anonymous, admin and ungranted users', async () => {
    const customRole = await app.db.query('plugin::users-permissions.role').create({ data: { name: 'Synthetic restricted', type: 'synthetic-restricted', description: 'No permissions' } });
    const restricted = await app.db.query('plugin::users-permissions.user').create({ data: {
      username: 'synthetic-restricted', email: 'restricted@example.invalid', provider: 'local', confirmed: true, blocked: false, role: customRole.id,
    } });
    const restrictedToken = await jwt.issue({ id: restricted.id });
    const routes = require('../server/src/routes/content-api').routes;
    assert.equal(routes.length, 7);
    for (const route of routes) {
      const pathname = route.path.replace(':sessionId', otherSession.documentId).replace(':userId', other.documentId);
      for (const [kind, token] of [['anonymous', null], ['admin', adminToken], ['ungranted-user', restrictedToken]]) {
        const result = await request(route.method, `/api/magic-sessionmanager${pathname}`, token);
        assert.ok([401, 403].includes(result.status), `${route.method} ${route.path}: ${kind} received ${result.status}`);
      }
    }
  });
  await t.test('all seven content routes accept an authorized owner with disposable sessions', async () => {
    const routes = require('../server/src/routes/content-api').routes;
    for (const [index, route] of routes.entries()) {
      const user = await createUser(`case-${index}`);
      const token = await jwt.issue({ id: user.id });
      await createSession(user, `case-current-${index}`, token);
      const otherOwn = await createSession(user, `case-other-${index}`, `${token}-other`);
      const pathname = route.path.replace(':sessionId', otherOwn.documentId).replace(':userId', user.documentId);
      const result = await request(route.method, `/api/magic-sessionmanager${pathname}`, token);
      assert.equal(result.status, 200, `${route.method} ${route.path}: authorized owner received ${result.status}`);
      if (route.handler === 'session.terminateOwnSession') {
        const terminated = await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: otherOwn.documentId });
        assert.equal(terminated.isActive, false);
      }
    }
  });
  await t.test('HTTP input failures keep stable client errors without leaking details', async () => {
    for (const [method, url, body] of [
      ['POST', '/magic-sessionmanager/license/create', { email: {}, firstName: 'Test', lastName: 'Owner' }],
      ['POST', '/magic-sessionmanager/license/store-key', { licenseKey: '' }],
      ['POST', '/magic-sessionmanager/license/store-key', { licenseKey: 12345 }],
      ['POST', '/magic-sessionmanager/license/store-key', { licenseKey: 'synthetic-key', email: 42 }],
      ['PUT', '/magic-sessionmanager/settings', { inactivityTimeout: 0 }],
      ['PUT', '/magic-sessionmanager/settings', { enableGeolocation: 'true' }],
      ['PUT', '/magic-sessionmanager/geoip/credentials', {}],
      ['PUT', '/magic-sessionmanager/settings', []],
      ['GET', '/magic-sessionmanager/geolocation/999.1.1.1', undefined],
    ]) {
      const result = await request(method, url, adminToken, body);
      assert.equal(result.status, 400, `${method} ${url}`);
      assert.equal(result.body.error?.status, 400);
      assert.equal(JSON.stringify(result.body).includes('stack'), false);
    }
  });
  await t.test('license ping without a stored key stops before provider verification', async () => {
    const store = app.store({ type: 'plugin', name: 'magic-sessionmanager' });
    assert.equal(await store.get({ key: 'licenseKey' }), null, 'fresh isolated host has no license key');
    const guard = app.plugin('magic-sessionmanager').service('license-guard');
    const originalVerify = guard.verifyLicense;
    let calls = 0;
    guard.verifyLicense = async () => { calls += 1; throw new Error('unexpected provider call'); };
    try {
      const result = await request('POST', '/magic-sessionmanager/license/ping', adminToken);
      assert.equal(result.status, 400);
      assert.equal(result.body.error?.message, 'No license key found');
      assert.equal(calls, 0, 'missing credentials must not trigger provider verification');
      assert.equal(await store.get({ key: 'licenseKey' }), null);
    } finally {
      guard.verifyLicense = originalVerify;
    }
  });
  await t.test('a successful password reset ends every older session of the user (GA-04)', async () => {
    const user = await createUser('reset-session-review');
    // A distinct claim keeps the earlier login token different from the reset
    // token even when both are issued within the same second.
    const oldToken = await jwt.issue({ id: user.id, n: 'before-reset' });
    const session = await createSession(user, 'reset-session-review', oldToken);
    const bystander = await createUser('reset-bystander');
    const bystanderToken = await jwt.issue({ id: bystander.id });
    const bystanderSession = await createSession(bystander, 'reset-bystander', bystanderToken);
    const code = crypto.randomBytes(32).toString('hex');
    const password = `${crypto.randomBytes(24).toString('hex')}Aa1!`;
    await app.db.query('plugin::users-permissions.user').update({ where: { id: user.id }, data: { resetPasswordToken: code } });
    const result = await request('POST', '/api/auth/reset-password', null, { code, password, passwordConfirmation: password });
    assert.equal(result.status, 200, 'the synthetic password reset succeeds');
    assert.ok(result.body.jwt, 'the host issues a new access token');
    const oldSidecar = await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: session.documentId });
    assert.equal(oldSidecar.isActive, false, 'the prior Magic sidecar is ended by the reset');
    const oldAccess = await request('GET', '/api/magic-sessionmanager/my-sessions', oldToken);
    assert.ok([401, 403].includes(oldAccess.status), `old token must be denied after reset, got ${oldAccess.status}`);
    const newAccess = await request('GET', '/api/magic-sessionmanager/my-sessions', result.body.jwt);
    assert.equal(newAccess.status, 200, 'the new reset session is usable');
    const activeAfterReset = newAccess.body.data.filter((row) => row.isActive !== false);
    assert.equal(activeAfterReset.length, 1, 'only the reset session remains active');
    if (mode === 'refresh') {
      const nativeId = app.sessionManager('users-permissions').validateAccessToken(oldToken).payload.sessionId;
      assert.equal(await app.sessionManager('users-permissions').isSessionActive(nativeId), false);
    }
    const untouched = await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: bystanderSession.documentId });
    assert.equal(untouched.isActive, true, 'other users keep their sessions');
  });
  await t.test('missing and malformed resource IDs cannot mutate other sessions', async () => {
    const absent = 'synthetic-missing-id';
    for (const [method, url, token, expected, body] of [
      ['DELETE', `/magic-sessionmanager/sessions/${absent}`, adminToken, 404],
      ['POST', `/magic-sessionmanager/sessions/${absent}/simulate-timeout`, adminToken, 404],
      ['POST', `/magic-sessionmanager/user/${absent}/toggle-block`, adminToken, 404, { blocked: true }],
      ['GET', `/api/magic-sessionmanager/user/${absent}/sessions`, ownerToken, 403],
      ['DELETE', `/api/magic-sessionmanager/my-sessions/${absent}`, ownerToken, 404],
      ...(mode === 'refresh' ? [['DELETE', '/api/magic-sessionmanager/my-sessions/native_not-valid', ownerToken, 404]] : []),
    ]) {
      const result = await request(method, url, token, body);
      assert.equal(result.status, expected, `${method} ${url}`);
      assert.equal(result.body.error?.status, expected);
    }
    const listing = await request('GET', `/magic-sessionmanager/user/${absent}/sessions`, adminToken);
    assert.equal(listing.status, 200);
    const session = await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: otherSession.documentId });
    assert.equal(session.isActive, true);
  });
  for (const [label, url] of [
    ['session', '/magic-sessionmanager/sessions/synthetic-absent-session/terminate'],
    ['user document', '/magic-sessionmanager/user/synthetic-absent-user/terminate-all'],
    ['numeric user', '/magic-sessionmanager/user/999999999/terminate-all'],
    ...(mode === 'refresh' ? [['native session', `/magic-sessionmanager/sessions/native_${Buffer.from(JSON.stringify([other.documentId, 'synthetic-absent-native'])).toString('base64url')}/terminate`]] : []),
  ]) await t.test(`missing admin ${label} returns 404 without side effects`, async () => {
    const before = await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: otherSession.documentId });
    const nativeId = mode === 'refresh' ? app.sessionManager('users-permissions').validateAccessToken(otherToken).payload.sessionId : null;
    const result = await request('POST', url, adminToken);
    assert.equal(result.status, 404);
    assert.equal(result.body.error?.status, 404);
    const after = await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: otherSession.documentId });
    assert.equal(after.isActive, before.isActive);
    assert.equal(after.terminationReason, before.terminationReason);
    if (nativeId) assert.equal(await app.sessionManager('users-permissions').isSessionActive(nativeId), true);
  });
  await t.test('admin terminate-all succeeds for an existing user with no active sessions by both identifiers', async () => {
    const user = await createUser('empty-admin-target');
    for (const id of [user.documentId, String(user.id)]) {
      const result = await request('POST', `/magic-sessionmanager/user/${id}/terminate-all`, adminToken);
      assert.equal(result.status, 200);
      assert.equal(result.body.success, true);
    }
  });
  await t.test('admin terminates a real sidecar and a user with active sessions', async () => {
    const user = await createUser('active-admin-target');
    const token = await jwt.issue({ id: user.id });
    const sidecar = await createSession(user, 'active-admin-target', token);
    const single = await request('POST', `/magic-sessionmanager/sessions/${sidecar.documentId}/terminate`, adminToken);
    assert.equal(single.status, 200);
    assert.equal(single.body.success, true);
    assert.equal((await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: sidecar.documentId })).isActive, false);
    const nextToken = await jwt.issue({ id: user.id });
    const second = await createSession(user, 'active-admin-target-2', nextToken);
    const all = await request('POST', `/magic-sessionmanager/user/${user.id}/terminate-all`, adminToken);
    assert.equal(all.status, 200);
    assert.equal(all.body.success, true);
    assert.equal((await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: second.documentId })).isActive, false);
    assert.equal((await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: otherSession.documentId })).isActive, true);
  });
  await t.test('partial user-wide termination does not claim success when a session write fails', async () => {
    const user = await createUser('partial-batch');
    const token = await jwt.issue({ id: user.id });
    const first = await createSession(user, 'partial-first', token);
    const second = await createSession(user, 'partial-second', `${token}-other`);
    const originalDocuments = app.documents;
    Object.defineProperty(app, 'documents', { configurable: true, value: (uid) => {
      const repository = originalDocuments(uid);
      if (uid !== 'plugin::magic-sessionmanager.session') return repository;
      return new Proxy(repository, { get(obj, key, receiver) {
        if (key !== 'update') return Reflect.get(obj, key, receiver);
        return async (query) => {
          if (query.documentId === second.documentId && query.data?.terminationReason === 'manual') throw new Error('synthetic-partial-failure');
          return obj.update(query);
        };
      } });
    } });
    try {
      const result = await request('POST', `/magic-sessionmanager/user/${user.documentId}/terminate-all`, adminToken);
      assert.equal(result.status, 500, 'partial failure must not be reported as success');
      assert.equal(JSON.stringify(result.body).includes('synthetic-partial-failure'), false);
    } finally { delete app.documents; }
    assert.equal((await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: first.documentId })).isActive, false);
    assert.equal((await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: second.documentId })).isActive, true);
    assert.equal((await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: otherSession.documentId })).isActive, true);
  });
  await t.test('cleanup partial deletion failure is not reported as complete success', async () => {
    const user = await createUser('partial-cleanup');
    const token = await jwt.issue({ id: user.id });
    const first = await createSession(user, 'cleanup-first', token);
    const second = await createSession(user, 'cleanup-second', `${token}-other`);
    for (const row of [first, second]) await app.documents('plugin::magic-sessionmanager.session').update({ documentId: row.documentId, data: { isActive: false } });
    const originalDocuments = app.documents;
    Object.defineProperty(app, 'documents', { configurable: true, value: (uid) => {
      const repository = originalDocuments(uid);
      if (uid !== 'plugin::magic-sessionmanager.session') return repository;
      return new Proxy(repository, { get(obj, key, receiver) {
        if (key !== 'delete') return Reflect.get(obj, key, receiver);
        return async (query) => {
          if (query.documentId === second.documentId) throw new Error('synthetic-cleanup-failure');
          return obj.delete(query);
        };
      } });
    } });
    try {
      const result = await request('POST', '/magic-sessionmanager/sessions/clean-inactive', adminToken);
      assert.equal(result.status, 500, 'partial cleanup must not be reported as complete');
      assert.equal(JSON.stringify(result.body).includes('synthetic-cleanup-failure'), false);
    } finally { delete app.documents; }
    assert.equal(await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: first.documentId }), null);
    assert.ok(await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: second.documentId }));
    assert.equal((await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: otherSession.documentId })).isActive, true);
  });
  await t.test('a failed token-deny write prevents session deletion over HTTP', async () => {
    const user = await createUser('deny-write-failure');
    const token = await jwt.issue({ id: user.id });
    const target = await createSession(user, 'deny-write-failure', token);
    const originalDocuments = app.documents;
    Object.defineProperty(app, 'documents', { configurable: true, value: (uid) => {
      const repository = originalDocuments(uid);
      if (uid !== 'plugin::magic-sessionmanager.revoked-token') return repository;
      return new Proxy(repository, { get(obj, key, receiver) {
        if (key === 'create') return async () => { throw new Error('synthetic-revocation-write-failure'); };
        return Reflect.get(obj, key, receiver);
      } });
    } });
    try {
      const result = await request('DELETE', `/magic-sessionmanager/sessions/${target.documentId}`, adminToken);
      assert.equal(result.status, 500);
      assert.equal(JSON.stringify(result.body).includes('synthetic-revocation-write-failure'), false);
    } finally { delete app.documents; }
    assert.ok(await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: target.documentId }));
    assert.equal((await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: otherSession.documentId })).isActive, true);
  });
  await t.test('concurrent own-session termination requests leave the other owner untouched', async () => {
    const user = await createUser('concurrent-own');
    const token = await jwt.issue({ id: user.id });
    await createSession(user, 'concurrent-current', token);
    const target = await createSession(user, 'concurrent-target', `${token}-other`);
    const service = app.plugin('magic-sessionmanager').service('session');
    const original = service.terminateSession;
    let arrivals = 0;
    let release;
    const barrier = new Promise((resolve) => { release = resolve; });
    service.terminateSession = async function (params) {
      if (params.sessionId === target.documentId) {
        arrivals++;
        if (arrivals === 2) release();
        await barrier;
      }
      return original.call(this, params);
    };
    try {
      const url = `/api/magic-sessionmanager/my-sessions/${target.documentId}`;
      const results = await Promise.all([request('DELETE', url, token), request('DELETE', url, token)]);
      assert.equal(arrivals, 2);
      assert.deepEqual(results.map((result) => result.status), [200, 200]);
      assert.ok(results.every((result) => result.body.success === true));
    } finally { service.terminateSession = original; }
    assert.equal((await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: target.documentId })).isActive, false);
    assert.equal((await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: otherSession.documentId })).isActive, true);
  });
  await t.test('user-block reports failure when session termination fails after blocking', async () => {
    const user = await createUser('partial-block');
    const token = await jwt.issue({ id: user.id });
    const target = await createSession(user, 'partial-block', token);
    const service = app.plugin('magic-sessionmanager').service('session');
    const original = service.terminateSession;
    let attempts = 0;
    service.terminateSession = async () => { attempts++; throw new Error('synthetic-block-revocation-failure'); };
    try {
      const result = await request('POST', `/magic-sessionmanager/user/${user.documentId}/toggle-block`, adminToken, { blocked: true });
      assert.equal(result.status, 500);
      assert.equal(JSON.stringify(result.body).includes('synthetic-block-revocation-failure'), false);
    } finally { service.terminateSession = original; }
    assert.equal(attempts, 1, 'only the controller revokes, so its failure surfaces once (API-12)');
    const storedUser = await app.documents('plugin::users-permissions.user').findOne({ documentId: user.documentId });
    const storedSession = await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: target.documentId });
    assert.equal(storedUser.blocked, true, 'user remains blocked after later failure');
    assert.equal(storedSession.isActive, true, 'failed revocation remains visible for retry');
    const afterBlock = await request('GET', '/api/magic-sessionmanager/my-sessions', token);
    assert.ok([401, 403].includes(afterBlock.status), 'blocked user cannot continue using the token');
    const retry = await request('POST', `/magic-sessionmanager/user/${user.documentId}/toggle-block`, adminToken, { blocked: true });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.blocked, true, 'retry preserves block and completes revocation');
    assert.equal((await app.documents('plugin::users-permissions.user').findOne({ documentId: user.documentId })).blocked, true);
    assert.equal((await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: target.documentId })).isActive, false);
    if (mode === 'refresh') {
      const nativeId = app.sessionManager('users-permissions').validateAccessToken(token).payload.sessionId;
      assert.equal(await app.sessionManager('users-permissions').isSessionActive(nativeId), false);
    }
  });
  await t.test('explicit unblock unblocks a previously blocked user', async () => {
    const user = await app.db.query('plugin::users-permissions.user').create({ data: {
      username: 'synthetic-explicit-unblock', email: 'explicit-unblock@example.invalid',
      provider: 'local', confirmed: true, blocked: true, role: role.id,
    } });
    const token = await jwt.issue({ id: user.id });
    const session = await createSession(user, 'explicit-unblock', token);
    const result = await request('POST', `/magic-sessionmanager/user/${user.documentId}/toggle-block`, adminToken, { blocked: false });
    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.blocked, false);
    assert.equal((await app.documents('plugin::users-permissions.user').findOne({ documentId: user.documentId })).blocked, false);
    assert.equal((await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: session.documentId })).isActive, true);
  });
  await t.test('a repeated block after a lost successful response remains blocked', async () => {
    const user = await createUser('lost-block-response');
    const token = await jwt.issue({ id: user.id });
    const session = await createSession(user, 'lost-block-response', token);
    const url = `/magic-sessionmanager/user/${user.documentId}/toggle-block`;
    // The client receives no result in the simulated retry scenario; the test
    // inspects it to prove the server committed the first operation.
    const committed = await request('POST', url, adminToken, { blocked: true });
    assert.equal(committed.status, 200);
    assert.equal(committed.body.blocked, true);
    assert.equal((await app.documents('plugin::users-permissions.user').findOne({ documentId: user.documentId })).blocked, true);
    assert.equal((await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: session.documentId })).isActive, false);
    if (mode === 'refresh') {
      const nativeId = app.sessionManager('users-permissions').validateAccessToken(token).payload.sessionId;
      assert.equal(await app.sessionManager('users-permissions').isSessionActive(nativeId), false);
    }
    const repeated = await request('POST', url, adminToken, { blocked: true });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.blocked, true);
    assert.equal((await app.documents('plugin::users-permissions.user').findOne({ documentId: user.documentId })).blocked, true);
  });
  await t.test('invalid desired states never change a user', async () => {
    const user = await createUser('invalid-block-state');
    const url = `/magic-sessionmanager/user/${user.documentId}/toggle-block`;
    for (const body of [{ blocked: 'false' }, { blocked: 'true' }, { blocked: null }, { blocked: 0 }]) {
      const result = await request('POST', url, adminToken, body);
      assert.equal(result.status, 400);
      assert.equal((await app.documents('plugin::users-permissions.user').findOne({ documentId: user.documentId })).blocked, false);
    }
  });
  await t.test('a bodyless toggle-block keeps the legacy toggle contract (GA-09/API-4)', async () => {
    const user = await createUser('legacy-toggle');
    const token = await jwt.issue({ id: user.id });
    const session = await createSession(user, 'legacy-toggle', token);
    const url = `/magic-sessionmanager/user/${user.documentId}/toggle-block`;
    const blocked = await request('POST', url, adminToken);
    assert.equal(blocked.status, 200);
    assert.equal(blocked.body.success, true);
    assert.equal(blocked.body.blocked, true);
    assert.equal(blocked.body.message, 'User blocked successfully');
    assert.equal(blocked.body.mode, 'toggle');
    assert.equal((await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: session.documentId })).isActive, false);
    const unblocked = await request('POST', url, adminToken, {});
    assert.equal(unblocked.status, 200);
    assert.equal(unblocked.body.blocked, false);
    assert.equal((await app.documents('plugin::users-permissions.user').findOne({ documentId: user.documentId })).blocked, false);
  });
  await t.test('characterizes overlapping block and unblock responses', async () => {
    const user = await createUser('overlapping-access-state');
    const token = await jwt.issue({ id: user.id });
    const session = await createSession(user, 'overlapping-access-state', token);
    const service = app.plugin('magic-sessionmanager').service('session');
    const original = service.terminateSession;
    let arrivals = 0;
    let reachedBarrier;
    let releaseBarrier;
    const reached = new Promise((resolve) => { reachedBarrier = resolve; });
    const release = new Promise((resolve) => { releaseBarrier = resolve; });
    service.terminateSession = async function (params) {
      // The controller is the single revocation path (API-12), so the block
      // request is held at its first and only revocation call.
      if (params.userId === user.documentId && params.reason === 'blocked' && ++arrivals === 1) {
        reachedBarrier();
        await release;
      }
      return original.call(this, params);
    };
    const url = `/magic-sessionmanager/user/${user.documentId}/toggle-block`;
    let block;
    try {
      block = request('POST', url, adminToken, { blocked: true });
      await reached;
      assert.equal((await app.documents('plugin::users-permissions.user').findOne({ documentId: user.documentId })).blocked, true);
      const unblock = await request('POST', url, adminToken, { blocked: false });
      assert.equal(unblock.status, 200);
      assert.equal(unblock.body.blocked, false);
    } finally {
      releaseBarrier();
      if (block) await block.catch(() => {});
      service.terminateSession = original;
    }
    const result = await block;
    assert.equal(result.status, 200);
    assert.equal(result.body.blocked, true, 'block response reports its requested state');
    assert.equal((await app.documents('plugin::users-permissions.user').findOne({ documentId: user.documentId })).blocked, false, 'later unblock committed before the block response');
    assert.equal((await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: session.documentId })).isActive, false);
  });
  await t.test('core store get-then-create does not serialize competing marker writes', async () => {
    const originalQuery = app.db.query;
    const markerKey = 'synthetic-pending-race';
    let arrivals = 0;
    let release;
    const barrier = new Promise((resolve) => { release = resolve; });
    app.db.query = function (uid, ...args) {
      const query = originalQuery.call(this, uid, ...args);
      if (uid !== 'strapi::core-store') return query;
      return new Proxy(query, { get(target, property) {
        if (property !== 'findOne') return Reflect.get(target, property);
        return async (params) => {
          const result = await target.findOne(params);
          if (params.where?.key?.endsWith(markerKey) && !result) {
            arrivals++;
            if (arrivals === 2) release();
            await barrier;
          }
          return result;
        };
      } });
    };
    try {
      const store = app.store({ type: 'plugin', name: 'magic-sessionmanager' });
      await Promise.all([
        store.set({ key: markerKey, value: { generation: 1 } }),
        store.set({ key: markerKey, value: { generation: 2 } }),
      ]);
    } finally { app.db.query = originalQuery; }
    assert.equal(arrivals, 2);
    const rows = await app.db.query('strapi::core-store').findMany({ where: { key: `plugin_magic-sessionmanager_${markerKey}` } });
    assert.equal(rows.length, 2, 'concurrent writes created duplicate records in this SQLite host');
  });
  if (mode === 'refresh') await t.test('admin terminates a real native-only session with its public view key', async () => {
    const user = await createUser('native-only-admin-target');
    const token = await jwt.issue({ id: user.id });
    const nativeId = app.sessionManager('users-permissions').validateAccessToken(token).payload.sessionId;
    const key = `native_${Buffer.from(JSON.stringify([user.documentId, nativeId])).toString('base64url')}`;
    const result = await request('POST', `/magic-sessionmanager/sessions/${key}/terminate`, adminToken);
    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(await app.sessionManager('users-permissions').isSessionActive(nativeId), false);
  });
  await t.test('HTTP returns sanitized errors for injected database and service failures', async () => {
    const marker = 'synthetic-db-private-detail';
    const originalQuery = app.db.query;
    app.db.query = function (uid, ...args) {
      if (uid === 'plugin::users-permissions.user') throw new Error(marker);
      return originalQuery.call(this, uid, ...args);
    };
    try {
      const result = await request('GET', '/magic-sessionmanager/users/stats', adminToken);
      assert.equal(result.status, 500);
      assert.equal(result.body.error?.status, 500);
      assert.equal(JSON.stringify(result.body).includes(marker), false);
      const termination = await request('POST', `/magic-sessionmanager/user/${other.documentId}/terminate-all`, adminToken);
      assert.equal(termination.status, 500);
      assert.equal(JSON.stringify(termination.body).includes(marker), false);
    } finally {
      app.db.query = originalQuery;
    }
    const service = app.plugin('magic-sessionmanager').service('session');
    for (const [operation, method, url] of [
      ['getAllSessions', 'GET', '/magic-sessionmanager/sessions'],
      ['deleteSession', 'DELETE', `/magic-sessionmanager/sessions/${otherSession.documentId}`],
      ['terminateSession', 'POST', `/magic-sessionmanager/sessions/${otherSession.documentId}/terminate`],
      ['deleteInactiveSessions', 'POST', '/magic-sessionmanager/sessions/clean-inactive'],
    ]) {
      const original = service[operation];
      service[operation] = async () => { throw new Error(marker); };
      try {
        const result = await request(method, url, adminToken);
        assert.equal(result.status, 500, operation);
        assert.equal(JSON.stringify(result.body).includes(marker), false, operation);
      } finally {
        service[operation] = original;
      }
    }
    const session = await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: otherSession.documentId });
    assert.equal(session.isActive, true);
  });
  await t.test('settings and GeoIP store errors are sanitized over HTTP', async () => {
    const marker = 'synthetic-store-private-detail';
    const originalStore = app.store;
    Object.defineProperty(app, 'store', { configurable: true, value: (...args) => {
      const store = originalStore(...args);
      return { ...store, get: async () => { throw new Error(marker); }, set: async () => { throw new Error(marker); } };
    } });
    try {
      for (const [method, url, body] of [
        ['GET', '/magic-sessionmanager/settings'],
        ['PUT', '/magic-sessionmanager/settings', { enableGeolocation: false }],
        ['GET', '/magic-sessionmanager/geoip/status'],
        ['PUT', '/magic-sessionmanager/geoip/credentials', { accountId: 'synthetic', licenseKey: 'synthetic' }],
      ]) {
        const result = await request(method, url, adminToken, body);
        assert.equal(result.status, 500, `${method} ${url}: store failures are server errors (API-7)`);
        assert.equal(JSON.stringify(result.body).includes(marker), false);
      }
    } finally {
      delete app.store;
    }
  });
  await t.test('all admin routes reach their handler with the plugin-access permission', async () => {
    const license = app.plugin('magic-sessionmanager').service('license-guard');
    license.createLicense = async () => ({ licenseKey: 'synthetic-key', email: 'fixture@example.invalid' });
    license.getLicenseByKey = async () => ({ email: 'fixture@example.invalid' });
    license.verifyLicense = async () => ({ valid: true, data: {} });
    license.storeLicenseKey = async (key) => app.store({ type: 'plugin', name: 'magic-sessionmanager' }).set({ key: 'licenseKey', value: key });
    app.plugin('magic-sessionmanager').service('geolocation').getIpInfo = async () => ({ country: 'Synthetic' });
    const testUser = await createUser('admin-target');
    const sessionToken = await jwt.issue({ id: testUser.id });
    const target = await createSession(testUser, 'admin-target-session', sessionToken);
    const targets = {
      'POST /sessions/:sessionId/terminate': target.documentId,
      'DELETE /sessions/:sessionId': target.documentId,
      'POST /sessions/:sessionId/simulate-timeout': target.documentId,
    };
    const bodies = {
      'POST /user/:userId/toggle-block': { blocked: true },
      'POST /license/create': { email: 'fixture@example.invalid', firstName: 'Test', lastName: 'Owner' },
      'POST /license/store-key': { licenseKey: 'synthetic-key', email: 'fixture@example.invalid' },
      'PUT /geoip/credentials': { accountId: 'synthetic-account', licenseKey: 'synthetic-key' },
      'PUT /settings': { enableGeolocation: false, geoIpProvider: 'disabled' },
    };
    const routes = require('../server/src/routes/admin').routes;
    // Missing credentials prove the protected updater is reached without any download.
    const updater = await request('POST', '/magic-sessionmanager/geoip/update', adminToken);
    assert.equal(updater.status, 400);
    for (const route of routes) {
      const key = `${route.method} ${route.path}`;
      if (key === 'POST /geoip/update') continue;
      // Simulate timeout before delete; each request uses only fixture records.
      if (key === 'POST /sessions/:sessionId/simulate-timeout') continue;
      const pathname = route.path.replace(':sessionId', targets[key] || target.documentId).replace(':userId', testUser.documentId).replace(':ipAddress', '192.0.2.1');
      const result = await request(route.method, `/magic-sessionmanager${pathname}`, adminToken, bodies[key]);
      assert.equal(result.status, 200, `${key}: authorized admin received ${result.status}`);
    }
    const timeoutTarget = await createSession(testUser, 'timeout-target', `${sessionToken}-timeout`);
    const timeout = await request('POST', `/magic-sessionmanager/sessions/${timeoutTarget.documentId}/simulate-timeout`, adminToken);
    assert.equal(timeout.status, 200);
  });
  await t.test('HTTP handler failures are sanitized when fake providers fail', async () => {
    const guard = app.plugin('magic-sessionmanager').service('license-guard');
    guard.createLicense = async () => { throw new Error('synthetic-provider-private-detail'); };
    const result = await request('POST', '/magic-sessionmanager/license/create', adminToken, {
      email: 'fixture@example.invalid', firstName: 'Test', lastName: 'Owner',
    });
    assert.equal(result.status, 500, 'a provider exception is a server error (API-7)');
    assert.equal(JSON.stringify(result.body).includes('synthetic-provider-private-detail'), false);
    const settings = await request('PUT', '/magic-sessionmanager/settings', adminToken, { enableGeolocation: true, geoIpProvider: 'ipapi' });
    assert.equal(settings.status, 200);
    const geo = app.plugin('magic-sessionmanager').service('geolocation');
    const original = geo.getIpInfo;
    geo.getIpInfo = async () => { throw new Error('synthetic-provider-private-detail'); };
    try {
      const lookup = await request('GET', '/magic-sessionmanager/geolocation/192.0.2.1', adminToken);
      assert.equal(lookup.status, 500);
      assert.equal(JSON.stringify(lookup.body).includes('synthetic-provider-private-detail'), false);
    } finally {
      geo.getIpInfo = original;
      await request('PUT', '/magic-sessionmanager/settings', adminToken, { enableGeolocation: false, geoIpProvider: 'disabled' });
    }
  });
  await t.test('additional admin and owner service failures return redacted HTTP errors', async () => {
    const user = await createUser('failure-owner');
    const token = await jwt.issue({ id: user.id });
    await createSession(user, 'failure-current', token);
    const ownOther = await createSession(user, 'failure-other', `${token}-other`);
    const service = app.plugin('magic-sessionmanager').service('session');
    const marker = 'synthetic-service-private-detail';
    const cases = [
      ['getActiveSessions', 'GET', '/magic-sessionmanager/sessions/active', adminToken],
      ['getUserSessions', 'GET', `/magic-sessionmanager/user/${user.documentId}/sessions`, adminToken],
      ['getUserSessions', 'GET', `/api/magic-sessionmanager/user/${user.documentId}/sessions`, token],
      ['terminateSession', 'POST', '/api/magic-sessionmanager/logout', token],
      ['terminateSession', 'POST', '/api/magic-sessionmanager/logout-all', token],
      ['terminateSession', 'POST', '/api/magic-sessionmanager/logout-others', token],
      ['terminateSession', 'DELETE', `/api/magic-sessionmanager/my-sessions/${ownOther.documentId}`, token],
      ...(mode === 'refresh' ? [
        ['getUserSessions', 'GET', '/api/magic-sessionmanager/my-sessions', token],
        ['getUserSessions', 'GET', '/api/magic-sessionmanager/current-session', token],
      ] : []),
    ];
    for (const [operation, method, url, auth] of cases) {
      const original = service[operation];
      service[operation] = async () => { throw new Error(marker); };
      try {
        const result = await request(method, url, auth);
        assert.equal(result.status, 500, `${method} ${url}`);
        assert.equal(result.body.error?.status, 500);
        assert.equal(JSON.stringify(result.body).includes(marker), false);
      } finally { service[operation] = original; }
    }
    assert.equal((await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: ownOther.documentId })).isActive, true);
  });
  await t.test('remaining license provider failures and mismatch are redacted over HTTP', async () => {
    const guard = app.plugin('magic-sessionmanager').service('license-guard');
    const marker = 'synthetic-license-provider-private-detail';
    for (const [operation, method, url, body] of [
      ['getLicenseByKey', 'GET', '/magic-sessionmanager/license/status'],
      ['createLicense', 'POST', '/magic-sessionmanager/license/auto-create'],
      ['verifyLicense', 'POST', '/magic-sessionmanager/license/ping'],
      ['verifyLicense', 'POST', '/magic-sessionmanager/license/store-key', { licenseKey: 'synthetic-key' }],
    ]) {
      const original = guard[operation];
      guard[operation] = async () => { throw new Error(marker); };
      try {
        const result = await request(method, url, adminToken, body);
        assert.equal(result.status, 500, `${method} ${url}: provider exceptions are server errors (API-7)`);
        assert.equal(JSON.stringify(result.body).includes(marker), false);
      } finally { guard[operation] = original; }
    }
    const oldVerify = guard.verifyLicense;
    const oldLookup = guard.getLicenseByKey;
    guard.verifyLicense = async () => ({ valid: true });
    guard.getLicenseByKey = async () => ({ email: 'other@example.invalid' });
    try {
      const result = await request('POST', '/magic-sessionmanager/license/store-key', adminToken, { licenseKey: 'synthetic-key', email: 'owner@example.invalid' });
      assert.equal(result.status, 400);
      assert.equal(result.body.error?.message, 'Email address does not match this license key');
    } finally { guard.verifyLicense = oldVerify; guard.getLicenseByKey = oldLookup; }
  });
  await t.test('GeoIP update uses only a fake updater and redacts its failure', async () => {
    const credentials = await request('PUT', '/magic-sessionmanager/geoip/credentials', adminToken, { accountId: 'synthetic', licenseKey: 'synthetic' });
    assert.equal(credentials.status, 200);
    try {
      const callsBefore = fakeUpdaterCalls;
      const success = await request('POST', '/magic-sessionmanager/geoip/update', adminToken, { force: true });
      assert.equal(success.status, 200);
      assert.equal(fakeUpdaterCalls, callsBefore + 1);
      fakeUpdaterFails = true;
      const failure = await request('POST', '/magic-sessionmanager/geoip/update', adminToken);
      assert.equal(failure.status, 502, 'an updater (provider) failure is an upstream error (API-7)');
      assert.equal(JSON.stringify(failure.body).includes('synthetic-updater-private-detail'), false);
      assert.equal(fakeUpdaterCalls, callsBefore + 2);
    } finally {
      fakeUpdaterFails = false;
      await request('PUT', '/magic-sessionmanager/geoip/credentials', adminToken, { clear: true });
    }
  });
  await t.test('document lookup failures remain sanitized after route authentication', async () => {
    const marker = 'synthetic-document-private-detail';
    const originalDocuments = app.documents;
    const scenarios = [
      ['plugin::users-permissions.user', 'findOne', () => true, 'POST', `/magic-sessionmanager/user/${other.documentId}/toggle-block`, adminToken, { blocked: true }],
      ['plugin::magic-sessionmanager.session', 'findOne', () => true, 'POST', `/magic-sessionmanager/sessions/${otherSession.documentId}/simulate-timeout`, adminToken],
      ...(mode === 'legacy-support' ? [
        ['plugin::magic-sessionmanager.session', 'findMany', (query) => query?.limit === 201, 'GET', '/api/magic-sessionmanager/my-sessions', ownerToken],
        ['plugin::magic-sessionmanager.session', 'findFirst', (query) => query?.filters?.isActive === true && !query?.fields, 'GET', '/api/magic-sessionmanager/current-session', ownerToken],
      ] : []),
    ];
    for (const [target, operation, matches, method, url, token, body] of scenarios) {
      Object.defineProperty(app, 'documents', { configurable: true, value: (uid) => {
        const repository = originalDocuments(uid);
        if (uid !== target) return repository;
        return new Proxy(repository, { get(obj, key, receiver) {
          if (key !== operation) return Reflect.get(obj, key, receiver);
          return async (query) => {
            if (matches(query)) throw new Error(marker);
            return obj[operation](query);
          };
        } });
      } });
      try {
        const result = await request(method, url, token, body);
        assert.equal(result.status, 500, `${method} ${url}`);
        assert.equal(JSON.stringify(result.body).includes(marker), false);
      } finally { delete app.documents; }
    }
    assert.equal((await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: otherSession.documentId })).isActive, true);
  });
  const anonymous = await request('GET', '/api/magic-sessionmanager/my-sessions');
  assert.equal(anonymous.status, 403);
  const own = await request('GET', '/api/magic-sessionmanager/my-sessions', ownerToken);
  assert.equal(own.status, 200, 'authenticated own session list');
  assert.ok(own.body.data.length > 0, 'owner has a visible synthetic session');
  assert.equal(own.body.data.some((item) => item.documentId === otherSession.documentId), false, 'foreign session is not listed');
  const currentDelete = await request('DELETE', `/api/magic-sessionmanager/my-sessions/${ownerCurrent.documentId}`, ownerToken);
  assert.equal(currentDelete.status, 400, 'current session requires logout');
  const foreign = await request('GET', `/api/magic-sessionmanager/user/${other.documentId}/sessions`, ownerToken);
  assert.equal(foreign.status, 403, 'cross-user listing');
  const deniedDelete = await request('DELETE', `/api/magic-sessionmanager/my-sessions/${otherSession.documentId}`, ownerToken);
  assert.equal(deniedDelete.status, 404, 'cross-user termination answers like an absent session (API-10)');
  const absentDelete = await request('DELETE', '/api/magic-sessionmanager/my-sessions/synthetic-absent-session', ownerToken);
  assert.deepEqual(deniedDelete.body, absentDelete.body, 'foreign and absent session ids are indistinguishable');
  const stillActive = await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: otherSession.documentId });
  assert.equal(stillActive.isActive, true, 'denied foreign session remains active');
  if (mode === 'refresh') {
    const nativeId = app.sessionManager('users-permissions').validateAccessToken(otherToken).payload.sessionId;
    const foreignKey = `native_${Buffer.from(JSON.stringify([other.documentId, nativeId])).toString('base64url')}`;
    const deniedNative = await request('DELETE', `/api/magic-sessionmanager/my-sessions/${foreignKey}`, ownerToken);
    assert.equal(deniedNative.status, 404, 'foreign native session key is not found');
    assert.equal(await app.sessionManager('users-permissions').isSessionActive(nativeId), true);
  }
  await t.test('compatibility logout rejects missing and invalid credentials', async () => {
    for (const token of [null, 'synthetic-invalid']) {
      const result = await request('POST', '/api/auth/logout', token);
      assert.ok([401, 403].includes(result.status), `unauthorized compatibility logout received ${result.status}`);
    }
  });
  await t.test('compatibility logout accepts a synthetic owner', async () => {
    const user = await createUser('compat-logout');
    const token = await jwt.issue({ id: user.id });
    const sidecar = await createSession(user, 'compat-logout', token);
    const result = await request('POST', '/api/auth/logout', token);
    assert.equal(result.status, 200);
    const ended = await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: sidecar.documentId });
    assert.equal(ended.isActive, false);
  });
  if (fallbackHost) await t.test('real-host fallback rejects forged tokens and redacts revocation failure', async () => {
    const user = await createUser('fallback-failure');
    const token = await jwt.issue({ id: user.id });
    const session = await createSession(user, 'fallback-failure', token);
    const forged = require(path.join(hostDependencies, 'jsonwebtoken')).sign({ id: user.id }, crypto.randomBytes(32).toString('hex'));
    assert.equal((await request('POST', '/api/auth/logout', forged)).status, 401);
    const service = app.plugin('magic-sessionmanager').service('session');
    const original = service.terminateAuthenticatedSession;
    service.terminateAuthenticatedSession = async () => { throw new Error('synthetic-fallback-secret'); };
    try {
      const failure = await request('POST', '/api/auth/logout', token);
      assert.equal(failure.status, 500);
      assert.equal(JSON.stringify(failure.body).includes('synthetic-fallback-secret'), false);
    } finally { service.terminateAuthenticatedSession = original; }
    assert.equal((await app.documents('plugin::magic-sessionmanager.session').findOne({ documentId: session.documentId })).isActive, true);
  });
  await t.test('admin session lists expose no raw session identifiers or token material (F12)', async () => {
    for (const url of ['/magic-sessionmanager/sessions', '/magic-sessionmanager/sessions/active', `/magic-sessionmanager/user/${owner.documentId}/sessions`]) {
      const result = await request('GET', url, adminToken);
      assert.equal(result.status, 200, url);
      assert.ok(result.body.data.length > 0, `${url} returns synthetic rows`);
      for (const row of result.body.data) {
        assert.ok(row.documentId, `${url} keeps the action identifier`);
        for (const field of ['sessionId', 'nativeSessionId', 'tokenHash', 'token', 'refreshToken', 'refreshTokenHash']) {
          assert.equal(Object.hasOwn(row, field), false, `${url} must not expose ${field}`);
        }
      }
    }
  });
  await t.test('a partial settings PUT keeps every omitted field (API-6)', async () => {
    const before = await request('GET', '/magic-sessionmanager/settings', adminToken);
    assert.equal(before.status, 200);
    const toggled = !before.body.settings.alertOnVpnProxy;
    const seeded = await request('PUT', '/magic-sessionmanager/settings', adminToken, { alertOnVpnProxy: toggled, blockedCountries: ['RU'] });
    assert.equal(seeded.status, 200);
    const partial = await request('PUT', '/magic-sessionmanager/settings', adminToken, { inactivityTimeout: 25 });
    assert.equal(partial.status, 200);
    const after = await request('GET', '/magic-sessionmanager/settings', adminToken);
    assert.equal(after.body.settings.inactivityTimeout, 25);
    assert.equal(after.body.settings.alertOnVpnProxy, toggled);
    assert.deepEqual(after.body.settings.blockedCountries, ['RU']);
    const invalid = await request('PUT', '/magic-sessionmanager/settings', adminToken, { inactivityTimeout: 0 });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.details.errors[0].path[0], 'inactivityTimeout');
    assert.equal((await request('GET', '/magic-sessionmanager/settings', adminToken)).body.settings.inactivityTimeout, 25);
    await request('PUT', '/magic-sessionmanager/settings', adminToken, { ...before.body.settings, geoIpDatabasePath: '' });
  });
  await t.test('every content route answers 429 once its per-caller budget is spent (API-1/API-2)', { timeout: 60000 }, async () => {
    const issue = async (user, index) => jwt.issue({ id: user.id, n: `${index}-${crypto.randomBytes(4).toString('hex')}` });
    const routes = require('../server/src/routes/content-api').routes;
    for (const [index, route] of routes.entries()) {
      const max = route.config.middlewares[0].config.max;
      const user = await createUser(`limit-${index}`);
      const keepToken = await issue(user, 'keep');
      await createSession(user, `limit-keep-${index}`, keepToken);
      const statuses = [];
      for (let attempt = 0; attempt <= max; attempt++) {
        // Logout routes end the calling session, so each attempt uses its own
        // session of the same user; the budget is per user and route.
        const ownsToken = route.handler === 'session.logout' || route.handler === 'session.logoutAll';
        const token = ownsToken ? await issue(user, attempt) : keepToken;
        if (ownsToken) await createSession(user, `limit-${index}-${attempt}`, token);
        // Vary letter case, trailing slash and the path parameter on purpose.
        let pathname = route.path
          .replace(':sessionId', `synthetic-absent-${attempt}`)
          .replace(':userId', user.documentId);
        if (attempt % 3 === 1) pathname = pathname.toUpperCase().replace(user.documentId.toUpperCase(), user.documentId);
        if (attempt % 3 === 2) pathname = `${pathname}/`;
        const result = await request(route.method, `/api/magic-sessionmanager${pathname}`, token);
        statuses.push(result.status);
      }
      assert.ok(statuses.slice(0, max).every((status) => status !== 429), `${route.method} ${route.path}: no 429 within budget (${statuses.slice(0, max).join(',')})`);
      assert.equal(statuses[max], 429, `${route.method} ${route.path}: request ${max + 1} must be limited (${statuses.join(',')})`);
    }
  });
  const adminList = await request('GET', '/magic-sessionmanager/sessions', adminToken);
  assert.equal(adminList.status, 200, 'authorized admin');
  const editorList = await request('GET', '/magic-sessionmanager/sessions', editorToken);
  assert.equal(editorList.status, 403, 'admin without plugin permission');
});
