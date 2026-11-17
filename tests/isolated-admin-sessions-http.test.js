'use strict';

// Real Strapi 5 HTTP boundary for the admin panel sessions view. Admins sign in
// through POST /admin/login (synthetic accounts, random passwords), so every
// session row is created by Strapi itself. Runs on SQLite by default, and on
// PostgreSQL when SESSION_HTTP_DB=postgres and MSM_TEST_PG_URL are set (a
// throwaway schema is created and dropped).
//
//   SESSION_HTTP_STRAPI_NODE_MODULES=$PWD/node_modules SESSION_HTTP_REQUIRED=1 \
//     node --test tests/isolated-admin-sessions-http.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');

const { resolveHostDependencies, assertHostAvailable } = require('./helpers/host-dependencies');

const sourceRoot = path.resolve(__dirname, '..');
const dbKind = process.env.SESSION_HTTP_DB === 'postgres' ? 'postgres' : 'sqlite';
const host = resolveHostDependencies([
  '@strapi/strapi',
  '@strapi/plugin-users-permissions',
  dbKind === 'postgres' ? 'pg' : 'better-sqlite3',
]);
const pgUrl = process.env.MSM_TEST_PG_URL || '';
const pgMissing = dbKind === 'postgres' && !pgUrl;

const SESSION_UID = 'admin::session';

test(
  `isolated Strapi admin panel sessions over HTTP (${dbKind})`,
  {
    timeout: 240000,
    skip:
      host.skip ||
      (pgMissing && process.env.SESSION_HTTP_REQUIRED !== '1' ? 'MSM_TEST_PG_URL not set' : false),
  },
  async (t) => {
    assertHostAvailable(host);
    if (pgMissing) throw new Error('SESSION_HTTP_DB=postgres needs MSM_TEST_PG_URL');
    const hostModules = host.modules;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionmanager-admin-'));
    const plugin = path.join(root, 'plugin');
    for (const dir of ['config', 'plugin', 'src', 'public', 'public/uploads']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    fs.symlinkSync(hostModules, path.join(root, 'node_modules'), 'dir');
    const write = (filename, contents) => fs.writeFileSync(path.join(root, filename), contents);
    write(
      'package.json',
      JSON.stringify({
        name: 'isolated-sessionmanager-admin',
        version: '0.0.0',
        private: true,
        dependencies: { '@strapi/plugin-users-permissions': '*' },
      })
    );
    write(
      'plugin/package.json',
      JSON.stringify({
        name: 'isolated-sessionmanager-source',
        version: '0.0.0',
        strapi: { kind: 'plugin', name: 'magic-sessionmanager' },
      })
    );
    write(
      'plugin/strapi-server.js',
      `module.exports = require(${JSON.stringify(path.join(sourceRoot, 'server/src/index.js'))});\n`
    );

    const schema = `msm_admin_${crypto.randomBytes(4).toString('hex')}`;
    let pgAdmin = null;
    if (dbKind === 'postgres') {
      const { Client } = require(path.join(hostModules, 'pg'));
      pgAdmin = new Client({ connectionString: pgUrl });
      await pgAdmin.connect();
      await pgAdmin.query(`CREATE SCHEMA "${schema}"`);
      write(
        'config/database.js',
        `module.exports = { connection: { client: 'postgres', connection: { connectionString: ${JSON.stringify(pgUrl)}, schema: ${JSON.stringify(schema)} }, pool: { min: 0, max: 5 } } };\n`
      );
    } else {
      write(
        'config/database.js',
        `module.exports = { connection: { client: 'sqlite', connection: { filename: ${JSON.stringify(path.join(root, 'test.sqlite'))} }, useNullAsDefault: true } };\n`
      );
    }
    write(
      'config/server.js',
      `module.exports = { host: '127.0.0.1', port: 1337, app: { keys: [process.env.TEST_HTTP_SECRET_A, process.env.TEST_HTTP_SECRET_B] }, logger: { updates: { enabled: false } } };\n`
    );
    // Short access tokens are not needed: revocation is checked per request.
    write(
      'config/admin.js',
      `module.exports = { auth: { secret: process.env.TEST_HTTP_SECRET_A }, apiToken: { salt: process.env.TEST_HTTP_SECRET_B }, transfer: { token: { salt: process.env.TEST_HTTP_SECRET_A } }, rateLimit: { enabled: false } };\n`
    );
    write(
      'config/plugins.js',
      `module.exports = { 'users-permissions': { enabled: true, config: { jwtSecret: process.env.TEST_HTTP_SECRET_B, jwtManagement: 'refresh' } }, 'magic-sessionmanager': { enabled: true, resolve: ${JSON.stringify(plugin)}, config: { enableGeolocation: false, geoIpProvider: 'disabled', enableWebhooks: false, enableEmailAlerts: false } } };\n`
    );

    // Egress guard: only loopback to the test server and the local database.
    const allowedPorts = new Set();
    if (dbKind === 'postgres') allowedPorts.add(Number(new URL(pgUrl).port || 5432));
    const originalConnect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function (...args) {
      const options = Array.isArray(args[0])
        ? args[0][0]
        : typeof args[0] === 'object'
          ? args[0]
          : { port: args[0], host: args[1] };
      if (options?.path) return originalConnect.apply(this, args); // unix socket (pg)
      const target = options.host || options.hostname || 'localhost';
      if (
        !allowedPorts.has(Number(options.port)) ||
        !['127.0.0.1', '::1', 'localhost'].includes(target)
      ) {
        throw new Error('Outbound network disabled in isolated test');
      }
      return originalConnect.apply(this, args);
    };
    process.env.NODE_ENV = 'test';
    process.env.STRAPI_TELEMETRY_DISABLED = 'true';
    process.env.ENV_PATH = path.join(root, 'no-dotenv');
    process.env.TEST_HTTP_SECRET_A = crypto.randomBytes(32).toString('hex');
    process.env.TEST_HTTP_SECRET_B = crypto.randomBytes(32).toString('hex');
    process.env.SESSION_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    const originalCwd = process.cwd();
    process.chdir(root);

    let app;
    t.after(async () => {
      try {
        if (app) await app.destroy();
      } finally {
        net.Socket.prototype.connect = originalConnect;
        process.chdir(originalCwd);
        if (pgAdmin) {
          await pgAdmin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
          await pgAdmin.end().catch(() => {});
        }
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    const { createStrapi } = require(path.join(hostModules, '@strapi/strapi'));
    app = createStrapi({ appDir: root, distDir: root, serveAdminPanel: false });
    await app.load();
    const auditLines = [];
    const originalInfo = app.log.info.bind(app.log);
    app.log.info = (message, ...rest) => {
      if (typeof message === 'string' && message.includes('Admin sign-out')) {
        auditLines.push(message);
      }
      return originalInfo(message, ...rest);
    };
    app.log.level = 'error';
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const port = app.server.httpServer.address().port;
    allowedPorts.add(port);
    assert.throws(() => net.connect({ host: '192.0.2.1', port }), /Outbound network disabled/);

    /**
     * Calls the test server. Never logs tokens or cookies.
     *
     * @param {string} method HTTP method.
     * @param {string} url Path.
     * @param {{token?: string|null, cookie?: string, body?: object}} [options]
     * @returns {Promise<{status: number, body: any, cookie: string|null}>}
     */
    const request = async (method, url, { token, cookie, body } = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${url}`, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(cookie ? { cookie } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const refresh = response.headers
        .getSetCookie()
        .find((value) => value.startsWith('strapi_admin_refresh='));
      const text = await response.text();
      let parsed;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      return {
        status: response.status,
        body: parsed,
        cookie: refresh ? refresh.split(';')[0] : null,
      };
    };

    const passwords = new Map();
    // The admin panel sends a per-browser UUID as deviceId.
    const devices = new Map();
    const device = (name) => {
      if (!devices.has(name)) devices.set(name, crypto.randomUUID());
      return devices.get(name);
    };
    const newPassword = () => `Aa1!${crypto.randomBytes(12).toString('base64url')}`;

    // First Super Admin through Strapi's own registration route.
    const ownerPassword = newPassword();
    const registered = await request('POST', '/admin/register-admin', {
      body: {
        email: 'ada.owner@example.test',
        firstname: 'Ada',
        lastname: 'Owner',
        password: ownerPassword,
      },
    });
    assert.equal(registered.status, 200, 'first admin registered');
    passwords.set('ada.owner@example.test', ownerPassword);

    const roles = app.db.query('admin::role');
    const superRole = await roles.findOne({ where: { code: 'strapi-super-admin' } });
    const editorRole = await roles.findOne({ where: { code: 'strapi-editor' } });
    const createRole = async (code, actions) => {
      const role = await roles.create({ data: { name: `Synthetic ${code}`, code } });
      for (const action of actions) {
        await app.db
          .query('admin::permission')
          .create({ data: { action, conditions: [], role: role.id } });
      }
      return role;
    };
    const readerRole = await createRole('synthetic-reader', [
      'plugin::magic-sessionmanager.access',
      'plugin::magic-sessionmanager.admin-sessions.read',
    ]);
    const revokerRole = await createRole('synthetic-revoker', [
      'plugin::magic-sessionmanager.access',
      'plugin::magic-sessionmanager.admin-sessions.read',
      'plugin::magic-sessionmanager.admin-sessions.revoke',
    ]);
    const hash = (password) => app.admin.services.auth.hashPassword(password);
    const createAdmin = async (email, firstname, roleId, extra = {}) => {
      const password = newPassword();
      passwords.set(email, password);
      return app.db.query('admin::user').create({
        data: {
          email,
          firstname,
          lastname: 'Example',
          password: await hash(password),
          isActive: true,
          blocked: false,
          roles: [roleId],
          ...extra,
        },
      });
    };
    const owner = await app.db
      .query('admin::user')
      .findOne({ where: { email: 'ada.owner@example.test' } });
    const bert = await createAdmin('bert.super@example.test', 'Bert', superRole.id);
    const erin = await createAdmin('erin.editor@example.test', 'Erin', editorRole.id);
    await createAdmin('rita.reader@example.test', 'Rita', readerRole.id);
    await createAdmin('vic.revoker@example.test', 'Vic', revokerRole.id);
    await createAdmin('ina.invited@example.test', 'Ina', editorRole.id, {
      isActive: false,
      registrationToken: crypto.randomBytes(20).toString('hex'),
    });
    await createAdmin('dan.deactivated@example.test', 'Dan', editorRole.id, { isActive: false });

    /**
     * Signs in through Strapi's admin login route.
     *
     * @param {string} email Synthetic admin email.
     * @param {string} deviceId Browser id the admin panel would send.
     * @returns {Promise<{token: string, cookie: string}>}
     */
    const login = async (email, deviceId) => {
      const result = await request('POST', '/admin/login', {
        body: { email, password: passwords.get(email), deviceId, rememberMe: false },
      });
      assert.equal(
        result.status,
        200,
        `login of a synthetic admin (${result.status} ${result.body?.error?.message})`
      );
      assert.ok(result.body.data.token && result.cookie);
      return { token: result.body.data.token, cookie: result.cookie };
    };
    /** Renews like the admin panel does (rotates the refresh row). */
    const renew = async (session) => {
      const result = await request('POST', '/admin/access-token', { cookie: session.cookie });
      return result.status === 200
        ? { status: 200, token: result.body.data.token, cookie: result.cookie || session.cookie }
        : { status: result.status };
    };
    const me = async (token) => (await request('GET', '/admin/users/me', { token })).status;
    const api = (suffix) => `/magic-sessionmanager/admin-sessions${suffix}`;

    const ada1 = await login('ada.owner@example.test', device('ada-laptop'));
    const ada2 = await login('ada.owner@example.test', device('ada-tablet'));
    const bert1 = await login('bert.super@example.test', device('bert-1'));
    const erin1 = await login('erin.editor@example.test', device('erin-1'));
    const erin2 = await login('erin.editor@example.test', device('erin-2'));
    const rita1 = await login('rita.reader@example.test', device('rita-1'));
    const vic1 = await login('vic.revoker@example.test', device('vic-1'));

    await t.test(
      'Super Admin holds the new actions automatically and sees every admin',
      async () => {
        const result = await request('GET', api('/admins?pageSize=100'), { token: ada1.token });
        assert.equal(result.status, 200);
        const { data, meta } = result.body;
        assert.equal(meta.supported, true);
        assert.equal(meta.pagination.total, 7);
        // Registration signs Ada in once, plus her two logins: 8 browsers in total.
        assert.deepEqual(meta.stats, { signedInAdmins: 5, activeSessions: 8, activeAccounts: 5 });
        assert.equal(meta.policy.accessTokenLifespan, 1800);
        const byEmail = Object.fromEntries(data.map((row) => [row.email, row]));
        assert.equal(byEmail['ada.owner@example.test'].self, true);
        assert.equal(byEmail['ada.owner@example.test'].sessionCount, 3);
        assert.equal(byEmail['ina.invited@example.test'].account, 'invited');
        assert.equal(byEmail['dan.deactivated@example.test'].account, 'deactivated');
        assert.equal(byEmail['dan.deactivated@example.test'].canSignOut, false);
        assert.deepEqual(byEmail['bert.super@example.test'].roles, [
          { name: 'Super Admin', superAdmin: true },
        ]);
        const serialized = JSON.stringify(result.body);
        for (const forbidden of [
          device('ada-laptop'),
          device('ada-tablet'),
          'password',
          'registrationToken',
          'refresh',
          ada1.token,
        ]) {
          assert.ok(!serialized.includes(forbidden), `list leaks ${forbidden.slice(0, 12)}`);
        }
      }
    );

    await t.test('filters, search and pagination run on the server', async () => {
      const signedIn = await request('GET', api('/admins?filter=signed-in&pageSize=2&page=2'), {
        token: ada1.token,
      });
      assert.equal(signedIn.body.meta.pagination.total, 5);
      assert.equal(signedIn.body.data.length, 2);
      const notSignedIn = await request('GET', api('/admins?filter=not-signed-in'), {
        token: ada1.token,
      });
      assert.deepEqual(notSignedIn.body.data.map((row) => row.email).sort(), [
        'dan.deactivated@example.test',
        'ina.invited@example.test',
      ]);
      const search = await request('GET', api('/admins?search=RITA'), { token: ada1.token });
      assert.deepEqual(
        search.body.data.map((row) => row.email),
        ['rita.reader@example.test']
      );
      for (const bad of [
        '?pageSize=101',
        '?filter=everyone',
        '?unknown=1',
        `?search=${'x'.repeat(101)}`,
      ]) {
        const rejected = await request('GET', api(`/admins${bad}`), { token: ada1.token });
        assert.equal(rejected.status, 400, bad);
        assert.equal(rejected.body.error.name, 'BadRequestError');
        assert.equal(rejected.body.error.details.errors[0].name, 'ValidationError');
      }
    });

    await t.test('session list groups by browser and marks the caller', async () => {
      const result = await request('GET', api(`/admins/${owner.id}/sessions`), {
        token: ada1.token,
      });
      assert.equal(result.status, 200, JSON.stringify(result.body?.error));
      assert.equal(result.body.data.length, 3);
      const current = result.body.data.filter((row) => row.current);
      assert.equal(current.length, 1);
      for (const row of result.body.data) {
        assert.match(row.id, /^[a-f0-9]{32}$/);
        assert.deepEqual(Object.keys(row).sort(), [
          'current',
          'device',
          'endsAt',
          'id',
          'lastActiveAt',
          'rememberMe',
          'signedInAt',
        ]);
        assert.equal(row.device, 'Chrome on macOS');
      }
      assert.equal(
        (await request('GET', api('/admins/999999/sessions'), { token: ada1.token })).status,
        404
      );
      assert.equal(
        (await request('GET', api('/admins/abc/sessions'), { token: ada1.token })).status,
        400
      );
    });

    await t.test('RBAC: anonymous 401, Editor 403, read-only role cannot sign out', async () => {
      assert.equal((await request('GET', api('/admins'))).status, 401);
      assert.equal((await request('GET', api('/admins'), { token: erin1.token })).status, 403);
      assert.equal((await request('GET', api('/admins'), { token: rita1.token })).status, 200);
      const denied = await request('POST', api(`/admins/${erin.id}/sign-out-everywhere`), {
        token: rita1.token,
      });
      assert.equal(denied.status, 403);
      assert.equal(await me(erin1.token), 200, 'denied call did not sign Erin out');
    });

    await t.test(
      'a delegated role cannot sign out a Super Admin (last-Super-Admin guard)',
      async () => {
        // Vic's role may sign admins out, but not Super Admins: neither Ada nor Bert.
        for (const target of [owner, bert]) {
          const result = await request('POST', api(`/admins/${target.id}/sign-out-everywhere`), {
            token: vic1.token,
          });
          assert.equal(result.status, 403);
          assert.equal(result.body.error.details.reason, 'super-admin-protected');
        }
        assert.equal(await me(bert1.token), 200);
        assert.equal(await me(ada1.token), 200);
        const listed = await request('GET', api('/admins?search=bert'), { token: vic1.token });
        assert.equal(listed.body.data[0].canSignOut, false);
        assert.equal(listed.body.data[0].protectedReason, 'super-admin-protected');
      }
    );

    await t.test(
      'sign out one browser: next request 401, renewal 401, other browser untouched',
      async () => {
        const sessions = await request('GET', api(`/admins/${erin.id}/sessions`), {
          token: vic1.token,
        });
        assert.equal(sessions.body.data.length, 2);
        // Erin's first browser renews once, so its first access token is bound to a rotated row.
        const renewed = await renew(erin1);
        assert.equal(renewed.status, 200);
        assert.equal(await me(erin1.token), 200, 'old access token works before the sign-out');
        assert.equal(await me(renewed.token), 200);
        const rows = await app.db.query(SESSION_UID).findMany({
          where: { userId: String(erin.id), deviceId: device('erin-1'), status: 'active' },
        });
        assert.equal(rows.length, 1);
        const result = await request(
          'POST',
          api(`/admins/${erin.id}/sessions/${rows[0].sessionId}/sign-out`),
          { token: vic1.token }
        );
        assert.equal(result.status, 200);
        assert.deepEqual(result.body.data, { ended: 1, signedOutSelf: false });
        assert.equal(await me(renewed.token), 401, 'current access token rejected at once');
        assert.equal(
          await me(erin1.token),
          401,
          'access token of the rotated row rejected at once'
        );
        assert.equal((await renew(renewed)).status, 401, 'refresh cookie no longer renews');
        assert.equal(await me(erin2.token), 200, 'the other browser stays signed in');
      }
    );

    await t.test(
      'Strapi revokeSessionById alone leaves a rotated access token valid (why we delete per device)',
      async () => {
        const probe = await login('bert.super@example.test', device('bert-probe'));
        const renewed = await renew(probe);
        assert.equal(renewed.status, 200);
        const active = await app.db.query(SESSION_UID).findOne({
          where: { userId: String(bert.id), deviceId: device('bert-probe'), status: 'active' },
        });
        const revoked = await app
          .sessionManager('admin')
          .revokeSessionById(String(bert.id), active.sessionId);
        assert.equal(revoked, true);
        assert.equal(await me(renewed.token), 401);
        assert.equal(
          await me(probe.token),
          200,
          'Strapi still accepts the token of the rotated row'
        );
        await app
          .sessionManager('admin')
          .invalidateRefreshToken(String(bert.id), device('bert-probe'));
        assert.equal(await me(probe.token), 401);
      }
    );

    await t.test('a session id of another admin is 404 (no probing)', async () => {
      const bertRow = await app.db.query(SESSION_UID).findOne({
        where: { userId: String(bert.id), deviceId: device('bert-1'), status: 'active' },
      });
      const result = await request(
        'POST',
        api(`/admins/${erin.id}/sessions/${bertRow.sessionId}/sign-out`),
        { token: ada1.token }
      );
      assert.equal(result.status, 404);
      const missing = await request(
        'POST',
        api(`/admins/${erin.id}/sessions/${'0'.repeat(32)}/sign-out`),
        { token: ada1.token }
      );
      assert.equal(missing.status, 404);
      const malformed = await request(
        'POST',
        api(`/admins/${erin.id}/sessions/not-a-session/sign-out`),
        {
          token: ada1.token,
        }
      );
      assert.equal(malformed.status, 400);
      assert.equal(await me(bert1.token), 200);
    });

    await t.test('sign out everywhere ends every browser of the admin', async () => {
      const result = await request('POST', api(`/admins/${erin.id}/sign-out-everywhere`), {
        token: ada1.token,
      });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.data, { ended: 1, signedOutSelf: false });
      assert.equal(await me(erin2.token), 401);
      assert.equal(
        await app.db.query(SESSION_UID).count({ where: { userId: String(erin.id) } }),
        0
      );
    });

    await t.test('self sign-out: another own browser, then this browser', async () => {
      const own = await request('GET', api(`/admins/${owner.id}/sessions`), { token: ada1.token });
      const other = own.body.data.find((row) => !row.current);
      const current = own.body.data.find((row) => row.current);
      const first = await request(
        'POST',
        api(`/admins/${owner.id}/sessions/${other.id}/sign-out`),
        {
          token: ada1.token,
        }
      );
      assert.deepEqual(first.body.data, { ended: 1, signedOutSelf: false });
      assert.equal(await me(ada2.token), 401);
      assert.equal(await me(ada1.token), 200);
      const second = await request(
        'POST',
        api(`/admins/${owner.id}/sessions/${current.id}/sign-out`),
        {
          token: ada1.token,
        }
      );
      assert.deepEqual(second.body.data, { ended: 1, signedOutSelf: true });
      assert.equal(await me(ada1.token), 401, 'the caller is signed out too');
      const again = await login('ada.owner@example.test', device('ada-laptop'));
      assert.equal(await me(again.token), 200, 'the Super Admin can sign in again');
      ada1.token = again.token;
    });

    await t.test('every sign-out wrote one audit line with ids and counts only', () => {
      assert.ok(auditLines.length >= 4);
      for (const line of auditLines) {
        assert.match(
          line,
          /^\[magic-sessionmanager\] Admin sign-out: actor=\d+ target=\d+ scope=(one|all) ended=\d+$/
        );
      }
    });

    await t.test('admin rows never reach the app-user numbers', async () => {
      // One untracked Users & Permissions refresh session next to many admin rows.
      const role = await app.db
        .query('plugin::users-permissions.role')
        .findOne({ where: { type: 'authenticated' } });
      const user = await app.db.query('plugin::users-permissions.user').create({
        data: {
          username: 'una.user',
          email: 'una.user@example.test',
          provider: 'local',
          confirmed: true,
          blocked: false,
          role: role.id,
        },
      });
      await app
        .sessionManager('users-permissions')
        .generateRefreshToken(String(user.id), device('una'), {
          type: 'refresh',
        });
      const adminRows = await app.db.query(SESSION_UID).count({ where: { origin: 'admin' } });
      assert.ok(adminRows >= 4);
      const stats = await request('GET', '/magic-sessionmanager/sessions/stats', {
        token: ada1.token,
      });
      assert.equal(stats.status, 200);
      const counts = stats.body.data ?? stats.body;
      assert.equal(counts.total, 0);
      assert.equal(counts.active, 0);
      assert.equal(counts.usersOnline, 0);
      assert.equal(counts.nativeOnly, 1, 'only the Users & Permissions session is counted');
      const userStats = await request('GET', '/magic-sessionmanager/users/stats', {
        token: ada1.token,
      });
      assert.equal(userStats.status, 200);
      const usersBody = userStats.body.data ?? userStats.body;
      assert.equal(usersBody.totalUsers ?? usersBody.total, 1);
    });

    await t.test('sign-out is limited to 10 requests per minute per admin', async () => {
      const statuses = [];
      for (let i = 0; i < 12; i++) {
        statuses.push(
          (
            await request('POST', api(`/admins/${erin.id}/sign-out-everywhere`), {
              token: vic1.token,
            })
          ).status
        );
      }
      assert.ok(statuses.includes(429), `statuses: ${statuses.join(',')}`);
      assert.equal(statuses.filter((status) => status === 200).length <= 10, true);
      assert.equal((await request('GET', api('/admins'), { token: vic1.token })).status, 200);
    });
  }
);
