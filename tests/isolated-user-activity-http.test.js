'use strict';

// Real Strapi 5 HTTP boundary of the app-user security activity (4.22):
// GET /magic-sessionmanager/user-activity and /user-activity/export. App users
// sign in through POST /api/auth/local (synthetic accounts, random passwords),
// so the failed sign-ins are produced by Strapi and the plugin; the other
// event types are seeded with synthetic rows. Covers RBAC (Super Admin
// automatically, 403 without the action, 200 when granted), email masking
// through the Content Manager permission on users, admin names, the
// impersonation reason, the export audit (admin panel and admin API token),
// filters and paging, and the read-time privacy rules (retention, anonymise,
// IP storage off, deletion with the user). SQLite by default.
//
//   SESSION_HTTP_STRAPI_NODE_MODULES=$PWD/node_modules SESSION_HTTP_REQUIRED=1 \
//     node --test tests/isolated-user-activity-http.test.js
//
// SESSION_HTTP_DB=postgres with MSM_TEST_PG_URL runs on PostgreSQL (a throwaway
// schema is created and dropped).
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

const EVENT_UID = 'plugin::magic-sessionmanager.security-event';
const USER_UID = 'plugin::users-permissions.user';
const PLUGIN = 'plugin::magic-sessionmanager';
const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0';
const DAY = 24 * 60 * 60 * 1000;

test(
  `isolated Strapi app-user security activity over HTTP (${dbKind})`,
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionmanager-useractivity-'));
    const plugin = path.join(root, 'plugin');
    for (const dir of ['config', 'plugin', 'src', 'public', 'public/uploads']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    fs.symlinkSync(hostModules, path.join(root, 'node_modules'), 'dir');
    const write = (filename, contents) => fs.writeFileSync(path.join(root, filename), contents);
    write(
      'package.json',
      JSON.stringify({
        name: 'isolated-sessionmanager-useractivity',
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
    const schema = `msm_useractivity_${crypto.randomBytes(4).toString('hex')}`;
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
      `module.exports = { auth: { secret: process.env.TEST_HTTP_SECRET_A }, apiToken: { salt: process.env.TEST_HTTP_SECRET_B }, transfer: { token: { salt: process.env.TEST_HTTP_SECRET_A } }, secrets: { encryptionKey: process.env.TEST_HTTP_SECRET_B }, rateLimit: { enabled: false } };\n`
    );
    write(
      'config/plugins.js',
      `module.exports = { 'users-permissions': { enabled: true, config: { jwtSecret: process.env.TEST_HTTP_SECRET_B, ratelimit: { enabled: false } } }, 'magic-sessionmanager': { enabled: true, resolve: ${JSON.stringify(plugin)}, config: { enableGeolocation: false, geoIpProvider: 'disabled', enableWebhooks: false, enableEmailAlerts: false } } };\n`
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
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const port = app.server.httpServer.address().port;
    allowedPorts.add(port);

    /**
     * Calls the test server. Never logs tokens, cookies or passwords.
     *
     * @param {string} method HTTP method.
     * @param {string} url Path.
     * @param {{token?: string|null, body?: object}} [options]
     * @returns {Promise<{status: number, body: any}>}
     */
    const request = async (method, url, { token, body } = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${url}`, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
          'user-agent': UA,
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
      return { status: response.status, body: parsed };
    };

    const service = () => app.plugin('magic-sessionmanager').service('security-log');
    const flush = () => service().flush();
    const store = app.store({ type: 'plugin', name: 'magic-sessionmanager' });
    const setSettings = async (values) => {
      const current = (await store.get({ key: 'settings' })) || {};
      await store.set({ key: 'settings', value: { ...current, ...values } });
      const { notifySettingsChanged } = require(
        path.join(sourceRoot, 'server/src/utils/settings-loader')
      );
      await notifySettingsChanged(app);
    };
    const events = () => app.db.query(EVENT_UID);
    const meta = (row) => (typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta || {});

    // Admins with Strapi's own session tokens.
    const adminRoles = app.db.query('admin::role');
    const superRole = await adminRoles.findOne({ where: { code: 'strapi-super-admin' } });
    const editorRole = await adminRoles.findOne({ where: { code: 'strapi-editor' } });
    const createAdminRole = async (code, actions) => {
      const role = await adminRoles.create({ data: { name: `Synthetic ${code}`, code } });
      for (const action of actions) {
        await app.db
          .query('admin::permission')
          .create({ data: { action, conditions: [], role: role.id } });
      }
      return role;
    };
    const grant = async (roleId, action, subject = null, properties = {}) =>
      app.db
        .query('admin::permission')
        .create({ data: { action, subject, properties, conditions: [], role: roleId } });
    const revoke = async (roleId, action) =>
      app.db.query('admin::permission').deleteMany({ where: { role: roleId, action } });
    const createAdmin = async (roleId, suffix, firstname) => {
      const admin = await app.db.query('admin::user').create({
        data: {
          email: `${suffix}@example.test`,
          firstname,
          lastname: 'Example',
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
    const owner = await createAdmin(superRole.id, 'ada.owner', 'Ada');
    const editor = await createAdmin(editorRole.id, 'erin.editor', 'Erin');
    const accessOnlyRole = await createAdminRole('synthetic-access-only', [`${PLUGIN}.access`]);
    const accessOnly = await createAdmin(accessOnlyRole.id, 'rita.reader', 'Rita');
    const auditorRole = await createAdminRole('synthetic-user-auditor', [
      `${PLUGIN}.access`,
      `${PLUGIN}.user-activity.read`,
    ]);
    const auditor = await createAdmin(auditorRole.id, 'otto.auditor', 'Otto');

    // App users with real passwords.
    const upRoles = app.db.query('plugin::users-permissions.role');
    const authenticated = await upRoles.findOne({ where: { type: 'authenticated' } });
    const passwords = new Map();
    const createUser = async (name) => {
      const password = `Aa1!${crypto.randomBytes(12).toString('base64url')}`;
      const user = await app
        .plugin('users-permissions')
        .service('user')
        .add({
          username: `synthetic-${name}`,
          email: `${name}@example.test`,
          password,
          provider: 'local',
          confirmed: true,
          blocked: false,
          role: authenticated.id,
        });
      passwords.set(name, password);
      return user;
    };
    const ann = await createUser('ann.beispiel');
    const ben = await createUser('ben.muster');

    const api = (suffix = '') => `/magic-sessionmanager/user-activity${suffix}`;
    const list = (query, token = owner.token) => request('GET', api(query), { token });

    await t.test(
      'RBAC: anonymous 401, Editor and access-only 403, Super Admin automatically 200',
      async () => {
        for (const suffix of ['', '/export']) {
          assert.equal((await request('GET', api(suffix))).status, 401, `anonymous ${suffix}`);
          assert.equal((await list(suffix, editor.token)).status, 403, `editor ${suffix}`);
          assert.equal((await list(suffix, accessOnly.token)).status, 403, `access only ${suffix}`);
          // Nobody granted the Super Admin role the new action: Strapi gives it every plugin action.
          assert.equal((await list(suffix, owner.token)).status, 200, `super admin ${suffix}`);
          assert.equal((await list(suffix, auditor.token)).status, 200, `granted ${suffix}`);
        }
        const superPermission = await app.db.query('admin::permission').findOne({
          where: { role: superRole.id, action: `${PLUGIN}.user-activity.read` },
        });
        assert.ok(superPermission, 'Strapi synced the action to the Super Admin role at start');
        // Granting it later works the same as at creation.
        await grant(accessOnlyRole.id, `${PLUGIN}.user-activity.read`);
        assert.equal((await list('', accessOnly.token)).status, 200, 'granted later');
        await revoke(accessOnlyRole.id, `${PLUGIN}.user-activity.read`);
        assert.equal((await list('', accessOnly.token)).status, 403, 'revoked again');
      }
    );

    await t.test(
      'a real failed sign-in is listed with the user; nothing typed is stored',
      async () => {
        await flush();
        await events().deleteMany({});
        const wrong = await request('POST', '/api/auth/local', {
          body: { identifier: 'ann.beispiel@example.test', password: 'Wrong-password-1' },
        });
        assert.equal(wrong.status, 400);
        const unknown = await request('POST', '/api/auth/local', {
          body: { identifier: 'nobody.unknown@example.test', password: 'Wrong-password-1' },
        });
        assert.equal(unknown.status, 400);
        await flush();
        const result = await list('?event=failed');
        assert.equal(result.status, 200);
        const rows = result.body.data;
        assert.equal(rows.length, 2);
        const known = rows.find((row) => row.user);
        assert.equal(known.event, 'user.sign-in.failed');
        assert.equal(known.user.documentId, ann.documentId);
        assert.equal(known.user.email, 'ann.beispiel@example.test', 'Super Admin may read users');
        assert.equal(known.ipAddress, '127.0.0.1');
        assert.match(known.browser, /^Firefox/);
        const stranger = rows.find((row) => !row.user);
        assert.equal(stranger.details.unknownAccount, true);
        const raw = JSON.stringify(await events().findMany({}));
        assert.ok(!raw.includes('nobody.unknown'), 'a typed identifier is never stored');
        assert.ok(!raw.includes('Wrong-password-1'));
      }
    );

    // Synthetic rows of every other type, newest last.
    const now = Date.now();
    const at = (minutes) => new Date(now - minutes * 60_000);
    const aboutAnn = { targetType: 'user', targetId: ann.documentId };
    const aboutBen = { targetType: 'user', targetId: ben.documentId };
    const seed = async () => {
      await events().deleteMany({});
      await events().createMany({
        data: [
          {
            event: 'user.sign-in.refused',
            actorType: 'user',
            ...aboutAnn,
            ip: '203.0.113.42',
            userAgent: UA,
            meta: { reason: 'session-limit', limit: 3 },
            createdAt: at(30),
          },
          {
            event: 'user.lockout',
            actorType: 'user',
            ...aboutAnn,
            ip: '203.0.113.42',
            meta: { kind: 'account', failures: 5, minutes: 15 },
            createdAt: at(29),
          },
          {
            event: 'user.lockout.lifted',
            actorType: 'admin',
            actorId: String(owner.id),
            ...aboutAnn,
            meta: { kind: 'account' },
            createdAt: at(28),
          },
          {
            event: 'user.session.limit',
            actorType: 'system',
            ...aboutBen,
            meta: { ended: 1, limit: 2 },
            createdAt: at(27),
          },
          {
            event: 'user.password-change.ended-others',
            actorType: 'user',
            actorId: ben.documentId,
            ...aboutBen,
            meta: { ended: 2 },
            createdAt: at(26),
          },
          {
            event: 'user.sign-in.new-device',
            actorType: 'user',
            actorId: ann.documentId,
            ...aboutAnn,
            ip: '2001:db8:1:2::42',
            userAgent: UA,
            meta: { browser: 'Firefox', os: 'Linux', deviceType: 'desktop' },
            createdAt: at(25),
          },
          {
            event: 'user.sign-in.impossible-travel',
            actorType: 'user',
            actorId: ann.documentId,
            ...aboutAnn,
            ip: '198.51.100.7',
            geo: { country: 'Exampleland', city: 'Sample City' },
            meta: { distanceKm: 9100, speedKmh: 4550, from: 'DE', to: 'US', action: 'alert' },
            createdAt: at(24),
          },
          {
            event: 'user.not-me',
            actorType: 'user',
            actorId: ann.documentId,
            ...aboutAnn,
            meta: { scope: 'all', ended: 2 },
            createdAt: at(23),
          },
          {
            event: 'user.data.exported',
            actorType: 'user',
            actorId: ben.documentId,
            ...aboutBen,
            meta: { sessions: 4, events: 12 },
            createdAt: at(22),
          },
          {
            event: 'impersonation.started',
            actorType: 'admin',
            actorId: String(owner.id),
            ...aboutBen,
            meta: { reason: 'Ticket 4711: checkout fails', durationMinutes: 30, handoff: 'token' },
            createdAt: at(21),
          },
          {
            event: 'impersonation.ended',
            actorType: 'admin',
            actorId: String(owner.id),
            ...aboutBen,
            meta: { startedBy: String(owner.id), endReason: 'ended' },
            createdAt: at(20),
          },
          // Admin events: never part of the app-user view.
          {
            event: 'impersonation.started',
            actorType: 'admin',
            actorId: String(owner.id),
            targetType: 'admin',
            targetId: String(auditor.id),
            meta: { reason: 'Preview', durationMinutes: 15, handoff: 'preview' },
            createdAt: at(19),
          },
          {
            event: 'admin.sign-in',
            actorType: 'admin',
            actorId: String(owner.id),
            targetType: 'admin',
            targetId: String(owner.id),
            createdAt: at(18),
          },
          {
            event: 'settings.updated',
            actorType: 'admin',
            actorId: String(owner.id),
            targetType: 'settings',
            meta: { keys: 'maxFailedLogins' },
            createdAt: at(17),
          },
        ],
      });
    };

    await t.test('every app-user event type is listed, admin events never', async () => {
      await seed();
      const result = await list('?pageSize=100');
      assert.equal(result.status, 200);
      const names = result.body.data.map((row) => row.event);
      assert.deepEqual(names, [
        'impersonation.ended',
        'impersonation.started',
        'user.data.exported',
        'user.not-me',
        'user.sign-in.impossible-travel',
        'user.sign-in.new-device',
        'user.password-change.ended-others',
        'user.session.limit',
        'user.lockout.lifted',
        'user.lockout',
        'user.sign-in.refused',
      ]);
      assert.equal(result.body.meta.pagination.total, 11);
      const travel = result.body.data.find((row) => row.event === 'user.sign-in.impossible-travel');
      assert.deepEqual(travel.details, {
        distanceKm: 9100,
        speedKmh: 4550,
        from: 'DE',
        to: 'US',
        action: 'alert',
      });
      assert.equal(travel.location.city, 'Sample City');
      const limit = result.body.data.find((row) => row.event === 'user.session.limit');
      assert.deepEqual(limit.actor, { type: 'system', id: null, name: '' });
      const raw = JSON.stringify(result.body);
      assert.ok(!raw.includes('deviceHash') && !raw.includes('socketIp'));
      assert.ok(!raw.includes('"Preview"'), 'the admin preview stays out');
    });

    await t.test('email masking: only readers who may read users see emails', async () => {
      const masked = await list('?pageSize=100', auditor.token);
      assert.equal(masked.status, 200);
      assert.equal(masked.body.meta.identity.users, false);
      for (const row of masked.body.data) {
        if (!row.user) continue;
        assert.deepEqual([row.user.email, row.user.username], ['', ''], row.event);
        assert.ok(Number.isInteger(row.user.id), 'User #id stays possible');
      }
      assert.ok(!JSON.stringify(masked.body).includes('@example.test'), 'no email anywhere');
      const exported = await list('/export', auditor.token);
      assert.ok(!JSON.stringify(exported.body).includes('@example.test'), 'the export as well');

      // Field level: users readable, but only the username.
      await grant(auditorRole.id, 'plugin::content-manager.explorer.read', USER_UID, {
        fields: ['username'],
      });
      const usernameOnly = await list('?pageSize=100', auditor.token);
      assert.equal(usernameOnly.body.meta.identity.users, true);
      const annRow = usernameOnly.body.data.find((row) => row.user?.documentId === ann.documentId);
      assert.deepEqual([annRow.user.email, annRow.user.username], ['', 'synthetic-ann.beispiel']);

      await revoke(auditorRole.id, 'plugin::content-manager.explorer.read');
      await grant(auditorRole.id, 'plugin::content-manager.explorer.read', USER_UID, {
        fields: ['username', 'email'],
      });
      const full = await list('?pageSize=100', auditor.token);
      const annFull = full.body.data.find((row) => row.user?.documentId === ann.documentId);
      assert.equal(annFull.user.email, 'ann.beispiel@example.test');
      await revoke(auditorRole.id, 'plugin::content-manager.explorer.read');
    });

    await t.test(
      'admin names need admin::users.read; the reason needs impersonate.users',
      async () => {
        const plain = await list('?event=impersonation', auditor.token);
        const started = plain.body.data.find((row) => row.event === 'impersonation.started');
        assert.deepEqual(started.actor, { type: 'admin', id: owner.id, name: '' });
        assert.equal(started.details.reason, null);
        assert.equal(started.details.durationMinutes, 30);
        assert.deepEqual(plain.body.meta.identity, {
          users: false,
          names: false,
          impersonationReasons: false,
        });
        await grant(auditorRole.id, 'admin::users.read');
        await grant(auditorRole.id, `${PLUGIN}.impersonate.users`);
        const full = await list('?event=impersonation', auditor.token);
        const named = full.body.data.find((row) => row.event === 'impersonation.started');
        assert.equal(named.actor.name, 'Ada Example');
        assert.equal(named.details.reason, 'Ticket 4711: checkout fails');
        await revoke(auditorRole.id, 'admin::users.read');
        await revoke(auditorRole.id, `${PLUGIN}.impersonate.users`);
      }
    );

    await t.test('filters and paging', async () => {
      const count = async (query) => (await list(query)).body.meta.pagination.total;
      assert.equal(await count('?event=failed'), 1);
      assert.equal(await count('?event=lockouts'), 2);
      assert.equal(await count('?event=suspicious'), 3);
      assert.equal(await count('?event=sessions'), 2);
      assert.equal(await count('?event=privacy'), 1);
      assert.equal(await count('?event=impersonation'), 2);
      assert.equal(await count(`?userId=${ann.documentId}`), 6);
      assert.equal(await count(`?userId=${ben.documentId}&event=impersonation`), 2);
      const from = encodeURIComponent(at(25.5).toISOString());
      const to = encodeURIComponent(at(22.5).toISOString());
      assert.equal(await count(`?from=${from}&to=${to}`), 3);
      const paged = await list('?pageSize=4&page=3');
      assert.equal(paged.body.meta.pagination.pageCount, 3);
      assert.equal(paged.body.data.length, 3);
      assert.equal(paged.body.data.at(-1).event, 'user.sign-in.refused');
      for (const bad of [
        '?event=everything',
        '?pageSize=101',
        '?page=0',
        '?userId=a%20b',
        '?userId[$ne]=x',
        '?from=yesterday',
        `?from=${to}&to=${from}`,
        '?unknown=1',
        '/export?cursor=-1',
      ]) {
        const result = await list(bad);
        assert.equal(result.status, 400, bad);
        assert.equal(result.body.error.name, 'BadRequestError', bad);
      }
    });

    await t.test(
      'export: keyset batches; each export start is audited, its next batches not',
      async () => {
        await flush();
        await events().deleteMany({ where: { event: 'security-log.read' } });
        await events().createMany({
          data: Array.from({ length: 510 }, (_, i) => ({
            event: 'user.sign-in.failed',
            actorType: 'user',
            ...aboutBen,
            meta: { status: 400 },
            createdAt: at(10 - i / 100),
          })),
        });
        const first = await list('/export', auditor.token);
        assert.equal(first.status, 200);
        assert.equal(first.body.data.length, 500);
        assert.match(first.body.meta.nextCursor, /^[1-9][0-9]*$/);
        const second = await list(`/export?cursor=${first.body.meta.nextCursor}`, auditor.token);
        assert.equal(second.body.data.length, 21);
        assert.equal(second.body.meta.nextCursor, null);
        await list('', auditor.token);
        await flush();
        const audits = await events().findMany({ where: { event: 'security-log.read' } });
        assert.equal(audits.length, 1, 'one export, one audit; a panel list read is not audited');
        assert.equal(audits[0].actorId, String(auditor.id));
        assert.deepEqual(
          [meta(audits[0]).list, meta(audits[0]).exported, meta(audits[0]).via],
          ['user-activity', true, 'admin-panel']
        );
        // The admin log names it.
        const log = await request(
          'GET',
          '/magic-sessionmanager/admin-activity/sign-ins?event=changes',
          {
            token: owner.token,
          }
        );
        const read = log.body.data.find((row) => row.event === 'security-log.read');
        assert.deepEqual(read.read, { list: 'user-activity', exported: true, via: 'admin-panel' });
        await events().deleteMany({
          where: { event: 'user.sign-in.failed', targetId: ben.documentId },
        });
      }
    );

    await t.test(
      'admin API token: list reads and exports are audited like 4.17 token reads',
      async () => {
        const created = await request('POST', '/admin/admin-tokens', {
          token: owner.token,
          body: {
            name: 'Synthetic user activity token',
            adminPermissions: [
              { action: `${PLUGIN}.access` },
              { action: `${PLUGIN}.user-activity.read` },
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
        await events().deleteMany({ where: { event: 'security-log.read' } });
        assert.equal((await list('', accessKey)).status, 200);
        assert.equal((await list('', accessKey)).status, 200);
        assert.equal((await list('/export', accessKey)).status, 200);
        await flush();
        const audits = await events().findMany({
          where: { event: 'security-log.read' },
          orderBy: [{ id: 'asc' }],
        });
        assert.deepEqual(
          audits.map((row) => [meta(row).list, meta(row).exported, meta(row).via]),
          [
            ['user-activity', false, 'admin-token'],
            ['user-activity', true, 'admin-token'],
          ],
          'one list read per 5 minutes, plus the export'
        );
        assert.ok(audits.every((row) => typeof meta(row).tokenId === 'string'));
      }
    );

    await t.test('privacy: anonymise and IP storage apply at read time', async () => {
      await setSettings({ securityLogAnonymizeIp: true });
      const anonymised = await list('?event=suspicious');
      const travel = anonymised.body.data.find(
        (row) => row.event === 'user.sign-in.impossible-travel'
      );
      assert.equal(travel.ipAddress, '198.51.100.0');
      assert.equal(travel.ipAnonymized, true);
      const device = anonymised.body.data.find((row) => row.event === 'user.sign-in.new-device');
      assert.equal(device.ipAddress, '2001:db8:1::');
      await setSettings({ securityLogAnonymizeIp: false, securityLogStoreIp: false });
      const off = await list('?event=suspicious');
      assert.ok(off.body.data.every((row) => row.ipAddress === null && row.location === null));
      assert.equal(off.body.meta.recording.ipAddresses, false);
      await setSettings({ securityLogStoreIp: true });
    });

    await t.test(
      'retention: older rows are hidden at once and deleted by the next run',
      async () => {
        await events().create({
          data: {
            event: 'user.lockout',
            actorType: 'user',
            ...aboutAnn,
            meta: { kind: 'account', failures: 5, minutes: 15 },
            createdAt: new Date(now - 40 * DAY),
            updatedAt: new Date(now - 40 * DAY),
          },
        });
        assert.equal((await list('?event=lockouts')).body.meta.pagination.total, 3);
        await setSettings({ securityLogRetentionDays: 30 });
        const listed = await list('?event=lockouts');
        assert.equal(listed.body.meta.pagination.total, 2, 'hidden before the retention run');
        assert.equal(listed.body.meta.recording.retentionDays, 30);
        const early = encodeURIComponent(new Date(now - 400 * DAY).toISOString());
        assert.equal((await list(`?event=lockouts&from=${early}`)).body.meta.pagination.total, 2);
        const removed = await service().cleanup();
        assert.ok(removed.expired >= 1);
        await setSettings({ securityLogRetentionDays: 90 });
      }
    );

    await t.test('deleting a user deletes their events from the view', async () => {
      assert.ok((await list(`?userId=${ben.documentId}`)).body.meta.pagination.total > 0);
      await app.documents(USER_UID).delete({ documentId: ben.documentId });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal((await list(`?userId=${ben.documentId}`)).body.meta.pagination.total, 0);
      const left = await events().findMany({ where: { targetId: ben.documentId } });
      assert.equal(left.length, 0);
    });
  }
);
