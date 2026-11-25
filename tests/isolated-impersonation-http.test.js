'use strict';

// Real Strapi 5 HTTP boundary for impersonating app users (4.20): the RBAC
// action (Super Admin automatically, other roles only when granted), the
// feature switch, admin API tokens refused, the token hand-off and the
// one-time code exchange (single use, 60 seconds), what an impersonation may
// not do (credentials, account, sessions, data export), the response header,
// ending, expiry and the security log. Synthetic accounts and random
// secrets; outbound network blocked; the email plugin is an in-memory fake.
//
// Runs on SQLite by default, on PostgreSQL with SESSION_HTTP_DB=postgres and
// MSM_TEST_PG_URL (a throwaway schema), in legacy mode by default and in
// refresh mode with SESSION_HTTP_MODE=refresh.
//
//   SESSION_HTTP_STRAPI_NODE_MODULES=$PWD/node_modules SESSION_HTTP_REQUIRED=1 \
//     node --test tests/isolated-impersonation-http.test.js
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
const mode = process.env.SESSION_HTTP_MODE === 'refresh' ? 'refresh' : 'legacy-support';
const host = resolveHostDependencies([
  '@strapi/strapi',
  '@strapi/plugin-users-permissions',
  dbKind === 'postgres' ? 'pg' : 'better-sqlite3',
]);
const pgUrl = process.env.MSM_TEST_PG_URL || '';
const pgMissing = dbKind === 'postgres' && !pgUrl;

const EVENT_UID = 'plugin::magic-sessionmanager.security-event';
const IMPERSONATION_UID = 'plugin::magic-sessionmanager.impersonation';

test(
  `isolated Strapi impersonation of app users over HTTP (${dbKind}, ${mode})`,
  {
    timeout: 300000,
    skip:
      host.skip ||
      (pgMissing && process.env.SESSION_HTTP_REQUIRED !== '1' ? 'MSM_TEST_PG_URL not set' : false),
  },
  async (t) => {
    assertHostAvailable(host);
    if (pgMissing) throw new Error('SESSION_HTTP_DB=postgres needs MSM_TEST_PG_URL');
    const hostModules = host.modules;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionmanager-impersonation-'));
    const plugin = path.join(root, 'plugin');
    for (const dir of ['config', 'plugin', 'src', 'public', 'public/uploads']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    fs.symlinkSync(hostModules, path.join(root, 'node_modules'), 'dir');
    const write = (filename, contents) => fs.writeFileSync(path.join(root, filename), contents);
    write(
      'package.json',
      JSON.stringify({
        name: 'isolated-sessionmanager-impersonation',
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

    const schema = `msm_imp_${crypto.randomBytes(4).toString('hex')}`;
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
    write(
      'config/admin.js',
      `module.exports = { auth: { secret: process.env.TEST_HTTP_SECRET_A }, apiToken: { salt: process.env.TEST_HTTP_SECRET_B }, secrets: { encryptionKey: process.env.TEST_HTTP_SECRET_B }, transfer: { token: { salt: process.env.TEST_HTTP_SECRET_A } }, rateLimit: { enabled: false } };\n`
    );
    // Users & Permissions' own auth rate limit is off so the plugin's
    // lockout is what the test observes.
    write(
      'config/plugins.js',
      `module.exports = { 'users-permissions': { enabled: true, config: { jwtSecret: process.env.TEST_HTTP_SECRET_B, jwtManagement: ${JSON.stringify(mode)}, ratelimit: { enabled: false } } }, 'magic-sessionmanager': { enabled: true, resolve: ${JSON.stringify(plugin)}, config: { enableGeolocation: false, geoIpProvider: 'disabled', enableWebhooks: false, enableEmailAlerts: false } } };\n`
    );

    const allowedPorts = new Set();
    if (dbKind === 'postgres') allowedPorts.add(Number(new URL(pgUrl).port || 5432));
    const originalConnect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function (...args) {
      const options = Array.isArray(args[0])
        ? args[0][0]
        : typeof args[0] === 'object'
          ? args[0]
          : { port: args[0], host: args[1] };
      if (options?.path) return originalConnect.apply(this, args);
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
    app.log.level = 'error';
    const sentMail = [];
    app.plugin('email').service('email').send = async (mail) => {
      sentMail.push(mail);
    };
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const port = app.server.httpServer.address().port;
    allowedPorts.add(port);

    /**
     * Calls the test server from a synthetic client address.
     *
     * @param {string} method HTTP method.
     * @param {string} url Path.
     * @param {{token?: string|null, body?: object, ip?: string}} [options]
     * @returns {Promise<{status: number, body: any, headers: Headers}>}
     */
    const request = async (method, url, { token, body, ip } = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${url}`, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(ip ? { 'x-forwarded-for': ip } : {}),
          'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Firefox/133.0',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await response.text();
      let parsed;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      return { status: response.status, body: parsed, headers: response.headers };
    };

    // Admins with Strapi's own session tokens.
    const adminRoles = app.db.query('admin::role');
    const superRole = await adminRoles.findOne({ where: { code: 'strapi-super-admin' } });
    const createAdminRole = async (code, actions) => {
      const role = await adminRoles.create({ data: { name: `Synthetic ${code}`, code } });
      for (const action of actions) {
        await app.db
          .query('admin::permission')
          .create({ data: { action, conditions: [], role: role.id } });
      }
      return role;
    };
    const createAdmin = async (roleId, suffix) => {
      const admin = await app.db.query('admin::user').create({
        data: {
          email: `${suffix}@example.invalid`,
          firstname: 'Synthetic',
          lastname: suffix,
          isActive: true,
          roles: [roleId],
        },
      });
      const refresh = await app
        .sessionManager('admin')
        .generateRefreshToken(String(admin.id), undefined, { type: 'session' });
      const access = await app.sessionManager('admin').generateAccessToken(refresh.token);
      return { id: admin.id, token: access.token };
    };
    const superAdmin = await createAdmin(superRole.id, 'imp-super');
    const viewerRole = await createAdminRole('imp-viewer', ['plugin::magic-sessionmanager.access']);
    const viewer = await createAdmin(viewerRole.id, 'imp-viewer');
    const outsiderRole = await createAdminRole('imp-outsider', []);
    const outsider = await createAdmin(outsiderRole.id, 'imp-outsider');

    const grantedRole = await createAdminRole('imp-granted', [
      'plugin::magic-sessionmanager.access',
      'plugin::magic-sessionmanager.impersonate.users',
    ]);
    const granted = await createAdmin(grantedRole.id, 'imp-granted');
    // Starts are rate limited per admin (10 per 10 minutes); the steps below
    // use separate synthetic Super Admins so they stay under the limit.
    const superB = await createAdmin(superRole.id, 'imp-super-b');
    const superC = await createAdmin(superRole.id, 'imp-super-c');

    // App users.
    const upRoles = app.db.query('plugin::users-permissions.role');
    const authenticated = await upRoles.findOne({ where: { type: 'authenticated' } });
    for (const action of [
      'plugin::users-permissions.user.me',
      'plugin::users-permissions.auth.changePassword',
      'plugin::users-permissions.user.update',
    ]) {
      const exists = await app.db
        .query('plugin::users-permissions.permission')
        .findOne({ where: { action, role: authenticated.id } });
      if (!exists) {
        await app.db
          .query('plugin::users-permissions.permission')
          .create({ data: { action, role: authenticated.id } });
      }
    }
    const createUser = async (name, extra = {}) =>
      app
        .plugin('users-permissions')
        .service('user')
        .add({
          username: `synthetic-${name}`,
          email: `${name}@example.test`,
          password: `Aa1!${crypto.randomBytes(12).toString('base64url')}`,
          provider: 'local',
          confirmed: true,
          blocked: false,
          role: authenticated.id,
          ...extra,
        });
    const settings = (body, token = superAdmin.token) =>
      request('PUT', '/magic-sessionmanager/settings', { token, body });
    const flushedEvents = async (where = {}) => {
      await app.plugin('magic-sessionmanager').service('security-log').flush();
      return app.db.query(EVENT_UID).findMany({ where, orderBy: { id: 'asc' } });
    };
    const start = (user, body, token = superAdmin.token) =>
      request('POST', `/magic-sessionmanager/impersonation/users/${user.documentId}`, {
        token,
        body: { reason: 'Ticket 4711: checkout fails', durationMinutes: 15, ...body },
      });
    const impersonationRow = (documentId) =>
      app.db.query(IMPERSONATION_UID).findOne({ where: { documentId } });
    const setFrontend = (value) =>
      app.config.set('plugin::magic-sessionmanager.impersonation', value);

    const anna = await createUser('anna');
    const ben = await createUser('ben');
    const clara = await createUser('clara');
    const dora = await createUser('dora');
    const emil = await createUser('emil');
    const blocked = await createUser('blocked', { blocked: true });

    await t.test('the switch is off by default and refuses every start', async () => {
      const current = await request('GET', '/magic-sessionmanager/settings', {
        token: superAdmin.token,
      });
      assert.equal(current.body.settings.impersonationEnabled, false);
      const status = await request('GET', '/magic-sessionmanager/impersonation/status', {
        token: superAdmin.token,
      });
      assert.equal(status.status, 200);
      assert.equal(status.body.data.enabled, false);
      assert.equal(status.body.data.handoff, 'token');
      const refused = await start(anna);
      assert.equal(refused.status, 403);
      assert.equal(refused.body.error.details.reason, 'disabled');
      const events = await flushedEvents({ event: 'impersonation.refused' });
      assert.equal(events.at(-1).meta.refusal, 'disabled');
      assert.equal(events.at(-1).actorId, String(superAdmin.id));
    });

    await t.test('only settings.update can turn impersonation on', async () => {
      const denied = await settings({ impersonationEnabled: true }, granted.token);
      assert.equal(denied.status, 403);
      const invalid = await settings({ impersonationEnabled: 'yes' });
      assert.equal(invalid.status, 400);
      const enabled = await settings({ impersonationEnabled: true });
      assert.equal(enabled.status, 200);
      assert.equal(enabled.body.settings.impersonationEnabled, true);
    });

    await t.test('RBAC: Super Admin automatically, granted role yes, others 403', async () => {
      const noAction = await start(anna, {}, viewer.token);
      assert.equal(noAction.status, 403);
      const noAccess = await start(anna, {}, outsider.token);
      assert.equal(noAccess.status, 403);
      const listDenied = await request('GET', '/magic-sessionmanager/impersonation/active', {
        token: viewer.token,
      });
      assert.equal(listDenied.status, 403);
      const byGranted = await start(ben, {}, granted.token);
      assert.equal(byGranted.status, 201, JSON.stringify(byGranted.body?.error));
      const bySuper = await start(anna);
      assert.equal(bySuper.status, 201);
      assert.equal(bySuper.headers.get('cache-control'), 'no-store');
      for (const result of [byGranted, bySuper]) {
        await request(
          'POST',
          `/magic-sessionmanager/impersonation/${result.body.data.impersonation.id}/end`,
          { token: superAdmin.token }
        );
      }
    });

    await t.test('invalid requests are refused per field without side effects', async () => {
      const before = await app.db.query(IMPERSONATION_UID).count();
      const cases = [
        { reason: 'no' },
        { reason: 'x'.repeat(256) },
        { durationMinutes: 45 },
        { notifyUser: 'yes' },
        { extra: true },
      ];
      for (const body of cases) {
        const result = await start(anna, body, superB.token);
        assert.equal(result.status, 400, JSON.stringify(body));
        assert.ok(Array.isArray(result.body.error.details.errors));
      }
      const unknown = await request(
        'POST',
        '/magic-sessionmanager/impersonation/users/doesnotexist0000000000000',
        { token: superB.token, body: { reason: 'Ticket 1', durationMinutes: 15 } }
      );
      assert.equal(unknown.status, 404);
      const blockedResult = await start(blocked, {}, superB.token);
      assert.equal(blockedResult.status, 400);
      assert.equal(blockedResult.body.error.details.reason, 'blocked');
      assert.equal(await app.db.query(IMPERSONATION_UID).count(), before);
    });

    let tokenHandoff;
    await t.test('token hand-off: a short-lived credential for the user, shown once', async () => {
      const started = await start(clara, { notifyUser: true, reason: 'Ticket <b>42</b>' });
      assert.equal(started.status, 201);
      const { impersonation, handoff } = started.body.data;
      assert.equal(handoff.type, 'token');
      assert.equal(typeof handoff.jwt, 'string');
      assert.equal(impersonation.targetId, clara.documentId);
      assert.equal(impersonation.durationMinutes, 15);
      assert.equal(impersonation.startedByYou, true);
      const minutes = (Date.parse(handoff.expiresAt) - Date.now()) / 60000;
      assert.ok(minutes > 14 && minutes <= 15);
      if (mode === 'refresh') {
        assert.equal(typeof handoff.refreshToken, 'string');
      } else {
        const payload = JSON.parse(Buffer.from(handoff.jwt.split('.')[1], 'base64url'));
        assert.ok(payload.exp - payload.iat <= 15 * 60);
        assert.equal(payload.id, clara.id);
      }
      const me = await request('GET', '/api/users/me', { token: handoff.jwt });
      assert.equal(me.status, 200);
      assert.equal(me.body.id, clara.id);
      assert.equal(me.headers.get('x-magic-impersonation'), 'true');
      assert.equal(JSON.stringify(me.body).includes('password'), false);
      // The row never returns secrets.
      const list = await request('GET', '/magic-sessionmanager/impersonation/active', {
        token: superAdmin.token,
      });
      assert.equal(list.status, 200);
      const listed = list.body.data.find((row) => row.id === impersonation.id);
      assert.equal(listed.targetLabel, 'synthetic-clara');
      for (const key of ['codeHash', 'tokenHash', 'nativeDeviceId', 'sessionDocumentId']) {
        assert.equal(key in listed, false);
      }
      // The user was told, with the reason escaped in the HTML part.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const mail = sentMail.find((item) => item.to === 'clara@example.test');
      assert.ok(mail);
      assert.ok(mail.html.includes('&lt;b&gt;42&lt;/b&gt;') || mail.html.includes('&#60;b&#62;'));
      assert.equal(mail.html.includes('<b>42</b>'), false);
      // A second impersonation of the same user waits for the first.
      const again = await start(clara);
      assert.equal(again.status, 403);
      assert.equal(again.body.error.details.reason, 'already-active');
      tokenHandoff = { impersonation, handoff };
    });

    await t.test('restricted calls are refused while impersonating', async () => {
      const token = tokenHandoff.handoff.jwt;
      const expectRefused = async (method, url, body, reason) => {
        const result = await request(method, url, { token, body });
        assert.equal(result.status, 403, `${method} ${url}`);
        assert.equal(result.body.error.details.reason, `impersonation-${reason}`, url);
        assert.equal(result.headers.get('x-magic-impersonation'), 'true');
      };
      await expectRefused(
        'POST',
        '/api/auth/change-password',
        { currentPassword: 'x', password: 'Aa1!aaaaaaaa', passwordConfirmation: 'Aa1!aaaaaaaa' },
        'credentials'
      );
      await expectRefused(
        'POST',
        '/api/auth/forgot-password',
        { email: 'x@example.test' },
        'credentials'
      );
      await expectRefused(
        'POST',
        '/api/auth/local',
        { identifier: 'clara@example.test', password: 'x' },
        'credentials'
      );
      await expectRefused(
        'PUT',
        `/api/users/${clara.id}`,
        { email: 'new@example.test' },
        'account'
      );
      await expectRefused('DELETE', `/api/users/${clara.id}`, null, 'account');
      await expectRefused('POST', '/api/auth/logout', {}, 'sessions');
      await expectRefused('DELETE', '/api/auth/sessions/abc', null, 'sessions');
      await expectRefused('POST', '/api/magic-sessionmanager/logout', {}, 'sessions');
      await expectRefused('POST', '/api/magic-sessionmanager/logout-all', {}, 'sessions');
      await expectRefused('POST', '/api/magic-sessionmanager/logout-others', {}, 'sessions');
      await expectRefused('DELETE', '/api/magic-sessionmanager/my-sessions/abc', null, 'sessions');
      await expectRefused('GET', '/api/magic-sessionmanager/my-data', null, 'account');
      await expectRefused('POST', '/api/magic-sessionmanager/not-me', { token: 'x' }, 'account');
      await expectRefused(
        'POST',
        '/api/magic-sessionmanager/impersonation/exchange',
        { code: 'x' },
        'sessions'
      );
      // Letter case, double slashes and a trailing slash do not bypass it.
      await expectRefused('POST', '/API//auth/Change-Password/', {}, 'credentials');
      // Reads stay possible.
      const own = await request('GET', '/api/magic-sessionmanager/my-sessions', { token });
      assert.equal(own.status, 200);
      const events = await flushedEvents({ event: 'impersonation.refused' });
      const calls = events.filter((event) => String(event.meta?.refusal).startsWith('call-'));
      assert.ok(calls.length >= 3);
      assert.ok(calls.every((event) => event.meta.impersonation === tokenHandoff.impersonation.id));
    });

    await t.test('ending revokes the credential at once and is logged', async () => {
      const { impersonation, handoff } = tokenHandoff;
      const ended = await request(
        'POST',
        `/magic-sessionmanager/impersonation/${impersonation.id}/end`,
        { token: granted.token }
      );
      assert.equal(ended.status, 200);
      assert.equal(ended.body.data.ended, true);
      const me = await request('GET', '/api/users/me', { token: handoff.jwt });
      assert.ok([401, 403].includes(me.status));
      if (handoff.refreshToken) {
        const refreshed = await request('POST', '/api/auth/refresh', {
          body: { refreshToken: handoff.refreshToken },
        });
        assert.ok([400, 401, 403].includes(refreshed.status));
      }
      const twice = await request(
        'POST',
        `/magic-sessionmanager/impersonation/${impersonation.id}/end`,
        { token: superAdmin.token }
      );
      assert.equal(twice.body.data.ended, false);
      const started = await flushedEvents({
        event: 'impersonation.started',
        targetId: clara.documentId,
      });
      assert.equal(started.length, 1);
      assert.equal(started[0].actorId, String(superAdmin.id));
      assert.equal(started[0].targetType, 'user');
      assert.equal(started[0].meta.reason, 'Ticket <b>42</b>');
      assert.equal(started[0].meta.durationMinutes, 15);
      const endedEvents = await flushedEvents({
        event: 'impersonation.ended',
        targetId: clara.documentId,
      });
      assert.equal(endedEvents.length, 1);
      assert.equal(endedEvents[0].actorId, String(granted.id));
      assert.equal(endedEvents[0].meta.startedBy, String(superAdmin.id));
      // No credential or code in any impersonation event.
      const all = await flushedEvents({ event: { $startsWith: 'impersonation.' } });
      const text = JSON.stringify(all);
      assert.equal(text.includes(handoff.jwt), false);
      assert.equal(/"(code|token|jwt|refreshToken|codeHash|tokenHash)":/.test(text), false);
    });

    if (mode === 'refresh') {
      await t.test(
        'refresh mode: the refresh token rotates and stays an impersonation',
        async () => {
          const started = await start(dora, {}, superC.token);
          const { handoff, impersonation } = started.body.data;
          const refreshed = await request('POST', '/api/auth/refresh', {
            body: { refreshToken: handoff.refreshToken },
          });
          assert.equal(refreshed.status, 200);
          assert.equal(refreshed.headers.get('x-magic-impersonation'), 'true');
          const me = await request('GET', '/api/users/me', { token: refreshed.body.jwt });
          assert.equal(me.status, 200);
          assert.equal(me.headers.get('x-magic-impersonation'), 'true');
          const refused = await request('POST', '/api/auth/logout', { token: refreshed.body.jwt });
          assert.equal(refused.status, 403);
          await request('POST', `/magic-sessionmanager/impersonation/${impersonation.id}/end`, {
            token: superAdmin.token,
          });
          const after = await request('GET', '/api/users/me', { token: refreshed.body.jwt });
          assert.ok([401, 403].includes(after.status));
        }
      );
    }

    await t.test('expiry ends the impersonation and refuses the credential', async () => {
      const started = await start(dora, {}, superC.token);
      assert.equal(started.status, 201);
      const { impersonation, handoff } = started.body.data;
      assert.equal((await request('GET', '/api/users/me', { token: handoff.jwt })).status, 200);
      await app.db.query(IMPERSONATION_UID).update({
        where: { documentId: impersonation.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      // The guard caches a row for 5 seconds; wait it out.
      await new Promise((resolve) => setTimeout(resolve, 5200));
      const me = await request('GET', '/api/users/me', { token: handoff.jwt });
      assert.equal(me.status, 401);
      assert.equal(me.body.error.details.reason, 'impersonation-expired');
      assert.equal((await impersonationRow(impersonation.id)).state, 'expired');
      const expired = await flushedEvents({
        event: 'impersonation.expired',
        targetId: dora.documentId,
      });
      assert.equal(expired.length, 1);
      assert.equal(expired[0].actorType, 'system');
      // The sweep ends an expired one nobody uses.
      const second = await start(emil, {}, superC.token);
      await app.db.query(IMPERSONATION_UID).update({
        where: { documentId: second.body.data.impersonation.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const swept = await app.plugin('magic-sessionmanager').service('impersonation').sweep();
      assert.ok(swept >= 1);
      assert.equal((await impersonationRow(second.body.data.impersonation.id)).state, 'expired');
      const after = await request('GET', '/api/users/me', {
        token: second.body.data.handoff.jwt,
      });
      assert.ok([401, 403].includes(after.status));
    });

    await t.test('frontend hand-off: one-time code, single use, 60 seconds', async () => {
      setFrontend({ frontendUrl: 'https://app.example.test/impersonate' });
      const status = await request('GET', '/magic-sessionmanager/impersonation/status', {
        token: superAdmin.token,
      });
      assert.equal(status.body.data.handoff, 'frontend');
      assert.equal(status.body.data.frontendOrigin, 'https://app.example.test');

      const started = await start(anna, {}, superC.token);
      assert.equal(started.status, 201);
      const { handoff, impersonation } = started.body.data;
      assert.equal(handoff.type, 'frontend');
      assert.equal(handoff.url, 'https://app.example.test/impersonate');
      assert.equal(handoff.field, 'code');
      assert.equal('jwt' in handoff, false);
      assert.match(handoff.code, /^[A-Za-z0-9_-]{43}$/);
      const row = await impersonationRow(impersonation.id);
      assert.notEqual(row.codeHash, handoff.code);
      assert.equal(row.credentialIssuedAt, null);

      const exchange = (code) =>
        request('POST', '/api/magic-sessionmanager/impersonation/exchange', { body: { code } });
      // Two exchanges at once: exactly one gets the credential.
      const [first, second] = await Promise.all([exchange(handoff.code), exchange(handoff.code)]);
      const statuses = [first.status, second.status].sort();
      assert.deepEqual(statuses, [200, 400]);
      const winner = first.status === 200 ? first : second;
      assert.equal(winner.headers.get('cache-control'), 'no-store');
      assert.equal(winner.body.data.user.documentId, anna.documentId);
      assert.equal(winner.body.data.impersonation.id, impersonation.id);
      const me = await request('GET', '/api/users/me', { token: winner.body.data.jwt });
      assert.equal(me.status, 200);
      assert.equal(me.headers.get('x-magic-impersonation'), 'true');
      // Used codes and made-up codes answer the same.
      const reused = await exchange(handoff.code);
      const madeUp = await exchange(crypto.randomBytes(32).toString('base64url'));
      const malformed = await exchange('short');
      for (const result of [reused, madeUp, malformed]) {
        assert.equal(result.status, 400);
        assert.equal(result.body.error.message, 'Invalid or expired code');
      }
      await request('POST', `/magic-sessionmanager/impersonation/${impersonation.id}/end`, {
        token: superAdmin.token,
      });

      // An expired code cannot be exchanged.
      const late = await start(ben, {}, superC.token);
      await app.db.query(IMPERSONATION_UID).update({
        where: { documentId: late.body.data.impersonation.id },
        data: { codeExpiresAt: new Date(Date.now() - 1000) },
      });
      assert.equal((await exchange(late.body.data.handoff.code)).status, 400);
      await request(
        'POST',
        `/magic-sessionmanager/impersonation/${late.body.data.impersonation.id}/end`,
        { token: superAdmin.token }
      );
      setFrontend(undefined);
    });

    await t.test('admin API tokens cannot impersonate', async () => {
      const created = await request('POST', '/admin/admin-tokens', {
        token: superAdmin.token,
        body: {
          name: 'Synthetic impersonation token',
          adminPermissions: [
            { action: 'plugin::magic-sessionmanager.access' },
            { action: 'plugin::magic-sessionmanager.impersonate.users' },
          ],
        },
      });
      if (created.status === 404 || created.status === 405) {
        // Strapi before admin API tokens (the 5.50 floor): no such strategy exists.
        assert.ok(true, 'admin API tokens are not available on this Strapi version');
        return;
      }
      assert.ok([200, 201].includes(created.status), JSON.stringify(created.body?.error));
      const accessKey = created.body.data.accessKey;
      assert.equal(typeof accessKey, 'string');
      const result = await start(ben, {}, accessKey);
      assert.equal(result.status, 403);
      assert.equal(result.body.error.details.reason, 'api-token');
      const events = await flushedEvents({ event: 'impersonation.refused' });
      assert.equal(events.at(-1).meta.refusal, 'api-token');
    });

    await t.test('starting is rate limited per admin', async () => {
      // superB used 7 of its 10 starts on invalid requests above.
      for (let i = 0; i < 3; i += 1) {
        assert.equal((await start(anna, { durationMinutes: 1 }, superB.token)).status, 400);
      }
      const limited = await start(anna, {}, superB.token);
      assert.equal(limited.status, 429);
      assert.equal(typeof limited.headers.get('retry-after'), 'string');
    });

    await t.test('turning the switch off ends every active impersonation', async () => {
      const started = await start(ben, {}, superC.token);
      assert.equal(started.status, 201);
      const { handoff, impersonation } = started.body.data;
      assert.equal((await settings({ impersonationEnabled: false })).status, 200);
      await app.plugin('magic-sessionmanager').service('impersonation').sweep();
      assert.notEqual((await impersonationRow(impersonation.id)).state, 'active');
      const me = await request('GET', '/api/users/me', { token: handoff.jwt });
      assert.ok([401, 403].includes(me.status));
      const exchange = await request('POST', '/api/magic-sessionmanager/impersonation/exchange', {
        body: { code: crypto.randomBytes(32).toString('base64url') },
      });
      assert.equal(exchange.status, 400);
    });
  }
);
