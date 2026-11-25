'use strict';

// Real Strapi 5 HTTP boundary of the admin sign-in history and Content
// Manager activity. Admins sign in through POST /admin/login and work through
// the Content Manager admin API (synthetic accounts, random passwords), so
// every event is produced by Strapi itself. SQLite by default.
//
//   SESSION_HTTP_STRAPI_NODE_MODULES=$PWD/node_modules SESSION_HTTP_REQUIRED=1 \
//     node --test tests/isolated-admin-activity-http.test.js
//
// ADMIN_ACTIVITY_PROXY=1 boots the host behind a trusted proxy
// (`server.proxy: { koa: true, maxIpsCount: 1 }`): the stored address is then
// the last X-Forwarded-For hop. Without it, X-Forwarded-For is ignored.
// SESSION_HTTP_DB=postgres with MSM_TEST_PG_URL runs on PostgreSQL (a
// throwaway schema is created and dropped).
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
const behindProxy = process.env.ADMIN_ACTIVITY_PROXY === '1';

const EVENT_UID = 'plugin::magic-sessionmanager.security-event';
const ARTICLE = 'api::article.article';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

test(
  `isolated Strapi admin sign-in history and activity over HTTP (${dbKind}, ${behindProxy ? 'trusted proxy' : 'no proxy'})`,
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionmanager-activity-'));
    const plugin = path.join(root, 'plugin');
    for (const dir of [
      'config',
      'plugin',
      'src/api/article/content-types/article',
      'public/uploads',
    ]) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    fs.symlinkSync(hostModules, path.join(root, 'node_modules'), 'dir');
    const write = (filename, contents) => fs.writeFileSync(path.join(root, filename), contents);
    write(
      'package.json',
      JSON.stringify({
        name: 'isolated-sessionmanager-activity',
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
    write(
      'src/api/article/content-types/article/schema.json',
      JSON.stringify({
        kind: 'collectionType',
        collectionName: 'articles',
        info: { singularName: 'article', pluralName: 'articles', displayName: 'Article' },
        options: { draftAndPublish: true },
        attributes: { title: { type: 'string' }, body: { type: 'text' } },
      })
    );
    const schema = `msm_activity_${crypto.randomBytes(4).toString('hex')}`;
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
    const proxy = behindProxy ? `proxy: { koa: true, maxIpsCount: 1 }, ` : '';
    write(
      'config/server.js',
      `module.exports = { host: '127.0.0.1', port: 1337, ${proxy}app: { keys: [process.env.TEST_HTTP_SECRET_A, process.env.TEST_HTTP_SECRET_B] }, logger: { updates: { enabled: false } } };\n`
    );
    // Strapi's login rate limit stays on (8 requests per email and address)
    // so a lockout is produced by Strapi itself.
    write(
      'config/admin.js',
      `module.exports = { auth: { secret: process.env.TEST_HTTP_SECRET_A }, apiToken: { salt: process.env.TEST_HTTP_SECRET_B }, transfer: { token: { salt: process.env.TEST_HTTP_SECRET_A } }, rateLimit: { enabled: true, max: 8, interval: { min: 5 } } };\n`
    );
    write(
      'config/plugins.js',
      `module.exports = { 'users-permissions': { enabled: true, config: { jwtSecret: process.env.TEST_HTTP_SECRET_B } }, 'magic-sessionmanager': { enabled: true, resolve: ${JSON.stringify(plugin)}, config: { enableGeolocation: false, geoIpProvider: 'disabled', enableWebhooks: false, enableEmailAlerts: false } } };\n`
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
     * @param {{token?: string|null, body?: object, forwardedFor?: string}} [options]
     * @returns {Promise<{status: number, body: any}>}
     */
    const request = async (method, url, { token, body, forwardedFor } = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${url}`, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
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
    const allRows = () => app.db.query(EVENT_UID).findMany({ orderBy: [{ id: 'asc' }] });
    const signInRows = async () =>
      (await allRows()).filter((row) => !row.event.startsWith('admin.content.'));
    const activityRows = async () =>
      (await allRows()).filter((row) => row.event.startsWith('admin.content.'));
    const meta = (row) => (typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta || {});
    const clearLog = () => app.db.query(EVENT_UID).deleteMany({});

    const passwords = new Map();
    const newPassword = () => `Aa1!${crypto.randomBytes(12).toString('base64url')}`;
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
    const readerRole = await createRole('synthetic-session-reader', [
      'plugin::magic-sessionmanager.access',
      'plugin::magic-sessionmanager.admin-sessions.read',
    ]);
    const auditorRole = await createRole('synthetic-auditor', [
      'plugin::magic-sessionmanager.access',
      'plugin::magic-sessionmanager.admin-sessions.read',
      'plugin::magic-sessionmanager.admin-activity.read',
    ]);
    const hash = (password) => app.admin.services.auth.hashPassword(password);
    const createAdmin = async (email, firstname, roleId) => {
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
        },
      });
    };
    const owner = await app.db
      .query('admin::user')
      .findOne({ where: { email: 'ada.owner@example.test' } });
    const erin = await createAdmin('erin.editor@example.test', 'Erin', editorRole.id);
    const rita = await createAdmin('rita.reader@example.test', 'Rita', readerRole.id);
    const otto = await createAdmin('otto.auditor@example.test', 'Otto', auditorRole.id);
    const lena = await createAdmin('lena.locked@example.test', 'Lena', editorRole.id);

    const login = async (email, { deviceId = crypto.randomUUID(), forwardedFor } = {}) => {
      const result = await request('POST', '/admin/login', {
        body: { email, password: passwords.get(email), deviceId, rememberMe: false },
        forwardedFor,
      });
      assert.equal(result.status, 200, `login of a synthetic admin (${result.status})`);
      return { token: result.body.data.token, deviceId };
    };
    const api = (suffix) => `/magic-sessionmanager/admin-activity${suffix}`;
    // Without a trusted proxy Koa ignores X-Forwarded-For: the socket address is stored.
    const expectedIp = (forwarded) => (behindProxy ? forwarded : '127.0.0.1');

    await t.test('the defaults: history and IP on, Content Manager activity off', async () => {
      const result = await request('GET', '/magic-sessionmanager/settings', {
        token: (await login('ada.owner@example.test')).token,
      });
      assert.equal(result.status, 200);
      const { settings } = result.body;
      assert.equal(settings.adminSignInHistory, true);
      assert.equal(settings.adminContentActivity, false);
      assert.equal(settings.securityLogStoreIp, true);
      assert.equal(settings.securityLogAnonymizeIp, false);
      assert.equal(settings.securityLogRetentionDays, 90);
      assert.equal(settings.securityLogGeoLookup, false, 'F1: no location lookup by default');
    });

    let ada;
    await t.test('a sign-in is recorded with address, browser, OS and provider', async () => {
      await flush();
      await clearLog();
      ada = await login('ada.owner@example.test', { forwardedFor: '203.0.113.10, 198.51.100.7' });
      await flush();
      const rows = await signInRows();
      assert.equal(rows.length, 1);
      const [row] = rows;
      assert.equal(row.event, 'admin.sign-in');
      assert.deepEqual([row.actorType, row.actorId], ['admin', String(owner.id)]);
      assert.deepEqual([row.targetType, row.targetId], ['admin', String(owner.id)]);
      assert.equal(meta(row).provider, 'local');
      // maxIpsCount 1: Koa reads only the hop the trusted proxy added.
      assert.equal(row.ip, expectedIp('198.51.100.7'));
      assert.equal(meta(row).ipAnonymized, undefined);
      // F7: behind the proxy the TCP peer (the proxy) is kept, anonymised.
      assert.equal(meta(row).socketIp, behindProxy ? '127.0.0.0' : undefined);
      assert.equal(row.geo, null, 'F1: no lookup by default');
      assert.equal(row.userAgent, UA);
      assert.match(meta(row).deviceHash, /^[a-f0-9]{64}$/);
      assert.notEqual(meta(row).deviceHash, ada.deviceId);
      assert.ok(row.createdAt);
      const listed = await request('GET', api(`/sign-ins?adminId=${owner.id}`), {
        token: ada.token,
      });
      assert.match(listed.body.data[0].browser, /^Chrome/);
      assert.match(listed.body.data[0].os, /^macOS/);
      assert.equal(listed.body.data[0].deviceType, 'desktop');
    });

    await t.test(
      'failed sign-ins: an existing admin is linked, a typed unknown email is not stored',
      async () => {
        const wrong = await request('POST', '/admin/login', {
          body: { email: 'erin.editor@example.test', password: 'Wrong-password-1' },
        });
        assert.equal(wrong.status, 400);
        const unknown = await request('POST', '/admin/login', {
          body: { email: 'nobody.unknown@example.test', password: 'Wrong-password-1' },
        });
        assert.equal(unknown.status, 400);
        // Strapi emits admin.auth.error after its own lookup; give it a moment.
        await new Promise((resolve) => setTimeout(resolve, 200));
        await flush();
        const failed = (await signInRows()).filter((row) => row.event === 'admin.sign-in.failed');
        assert.equal(failed.length, 2);
        assert.deepEqual(
          failed.map((row) => [row.targetId, meta(row).reason]),
          [
            [String(erin.id), 'invalid_credentials'],
            [null, 'invalid_credentials'],
          ]
        );
        assert.equal(meta(failed[1]).count, 1, 'F2: an unknown account is a counted row');
        assert.equal(meta(failed[1]).aggregated, true);
        const raw = JSON.stringify(await signInRows());
        for (const forbidden of ['nobody.unknown', 'erin.editor@', 'Wrong-password-1']) {
          assert.ok(!raw.includes(forbidden), `stored ${forbidden}`);
        }
      }
    );

    await t.test("Strapi's login rate limit is recorded once as a lockout", async () => {
      const attempt = () =>
        request('POST', '/admin/login', {
          body: { email: 'lena.locked@example.test', password: 'Wrong-password-1' },
        });
      const statuses = [];
      for (let i = 0; i < 10; i += 1) statuses.push((await attempt()).status);
      assert.deepEqual(statuses.slice(-2), [429, 429]);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await flush();
      const locked = (await signInRows()).filter((row) => row.event === 'admin.lockout');
      assert.equal(locked.length, 1, 'repeated 429s within 5 minutes are one lockout');
      assert.equal(locked[0].targetId, String(lena.id));
      assert.equal(meta(locked[0]).reason, 'rate_limited');
      assert.ok(!JSON.stringify(locked[0]).includes('lena.locked@'), 'typed email not stored');
    });

    let erinSession;
    await t.test('sign-out and sign-out by another admin, with session states', async () => {
      erinSession = await login('erin.editor@example.test');
      const second = await login('erin.editor@example.test');
      const logout = await request('POST', '/admin/logout', {
        token: second.token,
        body: { deviceId: second.deviceId },
      });
      assert.equal(logout.status, 200);
      const signOut = await request(
        'POST',
        `/magic-sessionmanager/admin-sessions/admins/${erin.id}/sign-out-everywhere`,
        { token: ada.token }
      );
      assert.equal(signOut.status, 200);
      await flush();
      const list = await request('GET', api(`/sign-ins?adminId=${erin.id}&pageSize=50`), {
        token: ada.token,
      });
      assert.equal(list.status, 200);
      const events = list.body.data.map((row) => row.event);
      assert.deepEqual(events.slice(0, 4), [
        'admin.session.revoked',
        'admin.sign-out',
        'admin.sign-in',
        'admin.sign-in',
      ]);
      const [byAdmin, own, secondIn, firstIn] = list.body.data;
      assert.deepEqual(byAdmin.actor, { id: owner.id, name: 'Ada Owner' });
      assert.equal(byAdmin.scope, 'everywhere');
      assert.equal(own.actor, null);
      assert.equal(secondIn.session.state, 'signed-out', 'own sign-out of that browser');
      assert.equal(secondIn.session.endedAt, own.at);
      assert.equal(firstIn.session.state, 'signed-out', 'signed out everywhere');
      assert.equal(firstIn.session.endedAt, byAdmin.at);
      for (const row of list.body.data) {
        assert.deepEqual(Object.keys(row).sort(), [
          'actor',
          'admin',
          'at',
          'attempts',
          'browser',
          'deviceType',
          'event',
          'id',
          'ipAddress',
          'ipAnonymized',
          'location',
          'os',
          'provider',
          'reason',
          'scope',
          'session',
        ]);
      }
      const serialized = JSON.stringify(list.body);
      assert.ok(!serialized.includes(erinSession.deviceId));
      assert.ok(!serialized.includes('deviceHash'));
      const revokedRow = (await allRows()).find((row) => row.event === 'admin.session.revoked');
      assert.deepEqual(
        [revokedRow.actorType, revokedRow.actorId, revokedRow.targetType, revokedRow.targetId],
        ['admin', String(owner.id), 'admin', String(erin.id)]
      );
      const current = await request('GET', api(`/sign-ins?adminId=${owner.id}&event=succeeded`), {
        token: ada.token,
      });
      assert.equal(current.body.data[0].session.state, 'active');
    });

    await t.test(
      'RBAC: anonymous 401, Editor and session-only roles 403, auditor 200',
      async () => {
        const rita1 = await login('rita.reader@example.test');
        const otto1 = await login('otto.auditor@example.test');
        const erin1 = await login('erin.editor@example.test');
        for (const suffix of ['/sign-ins', '/content', '/sign-ins/export', '/content/export']) {
          assert.equal((await request('GET', api(suffix))).status, 401, suffix);
          assert.equal((await request('GET', api(suffix), { token: erin1.token })).status, 403);
          assert.equal((await request('GET', api(suffix), { token: rita1.token })).status, 403);
          assert.equal((await request('GET', api(suffix), { token: otto1.token })).status, 200);
        }
        // Rita can save the settings form, but not change what is recorded.
        const settings = (
          await request('GET', '/magic-sessionmanager/settings', { token: rita1.token })
        ).body.settings;
        const unchanged = await request('PUT', '/magic-sessionmanager/settings', {
          token: rita1.token,
          body: settings,
        });
        assert.equal(unchanged.status, 200);
        const changed = await request('PUT', '/magic-sessionmanager/settings', {
          token: rita1.token,
          body: { ...settings, adminSignInHistory: false },
        });
        assert.equal(changed.status, 403);
        assert.equal(changed.body.error.details.reason, 'admin-activity-permission');
        const stored = await store.get({ key: 'settings' });
        assert.notEqual(stored.adminSignInHistory, false);
        const invalid = await request('PUT', '/magic-sessionmanager/settings', {
          token: otto1.token,
          body: { securityLogRetentionDays: 0, adminContentActivity: 'yes' },
        });
        assert.equal(invalid.status, 400);
        assert.deepEqual(invalid.body.error.details.errors.map((error) => error.path[0]).sort(), [
          'adminContentActivity',
          'securityLogRetentionDays',
        ]);
      }
    );

    await t.test('list validation rejects bad filters with 400', async () => {
      for (const bad of [
        '/sign-ins?event=everything',
        '/sign-ins?pageSize=101',
        '/sign-ins?from=yesterday',
        '/sign-ins?from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z',
        '/sign-ins?adminId=abc',
        '/sign-ins?unknown=1',
        '/content?action=read',
        '/content?contentType=articles',
      ]) {
        assert.equal((await request('GET', api(bad), { token: ada.token })).status, 400, bad);
      }
    });

    await t.test('Content Manager activity is off by default: nothing is recorded', async () => {
      const created = await request('POST', `/content-manager/collection-types/${ARTICLE}`, {
        token: ada.token,
        body: { title: 'Off by default' },
      });
      assert.equal(created.status, 201);
      await flush();
      assert.equal((await activityRows()).length, 0);
    });

    await t.test('when on: opens (deduplicated) and every write are recorded', async () => {
      await setSettings({ adminContentActivity: true });
      const cm = `/content-manager/collection-types/${ARTICLE}`;
      const created = await request('POST', cm, {
        token: ada.token,
        body: { title: 'Synthetic launch note' },
      });
      assert.equal(created.status, 201);
      const documentId = created.body.data.documentId;
      // The edit view opens right after creating: not a separate "view".
      for (let i = 0; i < 3; i += 1) {
        assert.equal(
          (await request('GET', `${cm}/${documentId}`, { token: ada.token })).status,
          200
        );
      }
      // List views and counts are not activity.
      assert.equal((await request('GET', cm, { token: ada.token })).status, 200);
      const erin1 = await login('erin.editor@example.test');
      assert.equal(
        (await request('GET', `${cm}/${documentId}`, { token: erin1.token })).status,
        200
      );
      assert.equal(
        (await request('GET', `${cm}/${documentId}`, { token: erin1.token })).status,
        200
      );
      const updated = await request('PUT', `${cm}/${documentId}`, {
        token: ada.token,
        body: { title: 'Synthetic launch note (edited)' },
      });
      assert.equal(updated.status, 200);
      const published = await request('POST', `${cm}/${documentId}/actions/publish`, {
        token: ada.token,
        body: {},
      });
      assert.equal(published.status, 200);
      const unpublished = await request('POST', `${cm}/${documentId}/actions/unpublish`, {
        token: ada.token,
        body: {},
      });
      assert.equal(unpublished.status, 200);
      const removed = await request('DELETE', `${cm}/${documentId}`, { token: ada.token });
      assert.equal(removed.status, 200);
      const missing = await request('GET', `${cm}/${documentId}`, { token: ada.token });
      assert.equal(missing.status, 404, 'a failed request is not activity');
      await flush();
      const rows = await activityRows();
      assert.deepEqual(
        rows.map((row) => [row.actorId, row.event]),
        [
          [String(owner.id), 'admin.content.create'],
          [String(erin.id), 'admin.content.view'],
          [String(owner.id), 'admin.content.update'],
          [String(owner.id), 'admin.content.publish'],
          [String(owner.id), 'admin.content.unpublish'],
          [String(owner.id), 'admin.content.delete'],
        ]
      );
      for (const row of rows) {
        assert.equal(row.actorType, 'admin');
        assert.equal(row.targetType, ARTICLE);
        assert.equal(row.targetId, documentId);
        assert.equal(meta(row).kind, 'collection');
        assert.ok(JSON.stringify(row.meta).length <= 2048);
      }
      // F3: no title is stored; it is resolved when the list is read.
      for (const row of rows) assert.equal(meta(row).title, undefined);
      assert.ok(!JSON.stringify(rows).includes('Synthetic launch note'));

      const list = await request('GET', api(`/content?adminId=${owner.id}&action=publish`), {
        token: ada.token,
      });
      assert.equal(list.status, 200);
      assert.equal(list.body.data.length, 1);
      assert.deepEqual(list.body.data[0].contentType, {
        uid: ARTICLE,
        name: 'Article',
        kind: 'collection',
        exists: true,
      });
      assert.equal(list.body.meta.contentManagerAccess, true);
      assert.deepEqual(list.body.meta.contentTypes, [
        { uid: ARTICLE, name: 'Article', kind: 'collection' },
      ]);
      const ritaAccess = await request('GET', api(`/content?adminId=${rita.id}`), {
        token: ada.token,
      });
      assert.equal(ritaAccess.body.meta.contentManagerAccess, false);
      const byType = await request('GET', api(`/content?contentType=${ARTICLE}&pageSize=2`), {
        token: ada.token,
      });
      assert.equal(byType.body.meta.pagination.total, 6);
      assert.equal(byType.body.meta.pagination.pageCount, 3);
    });

    await t.test('export batches page with a keyset cursor', async () => {
      const first = await request('GET', api('/content/export'), { token: ada.token });
      assert.equal(first.status, 200);
      assert.equal(first.body.data.length, 6);
      assert.equal(first.body.meta.nextCursor, null);
      const signIns = await request('GET', api(`/sign-ins/export?adminId=${erin.id}`), {
        token: ada.token,
      });
      assert.ok(signIns.body.data.length >= 4);
    });

    // ---------------------------------------------------- 4.17 security review

    const grant = async (roleId, action, subject = null, properties = {}) =>
      app.db
        .query('admin::permission')
        .create({ data: { action, subject, properties, conditions: [], role: roleId } });
    // One sign-in each: Strapi's login rate limit (8 per email and address) stays on.
    const review = {
      otto: await login('otto.auditor@example.test'),
      rita: await login('rita.reader@example.test'),
    };

    await t.test(
      'F3: titles are resolved when read, with the reader’s Content Manager rights',
      async () => {
        await setSettings({ adminContentActivity: true });
        await clearLog();
        const cm = `/content-manager/collection-types/${ARTICLE}`;
        const title = `SYNTHETIC-CONFIDENTIAL-${crypto.randomBytes(3).toString('hex')}`;
        const created = await request('POST', cm, { token: ada.token, body: { title } });
        assert.equal(created.status, 201);
        const documentId = created.body.data.documentId;
        await flush();
        assert.ok(!JSON.stringify(await activityRows()).includes(title), 'nothing stored');

        const otto1 = review.otto;
        assert.equal(
          (await request('GET', `${cm}/${documentId}`, { token: otto1.token })).status,
          403
        );
        const asAuditor = await request('GET', api(`/content?contentType=${ARTICLE}`), {
          token: otto1.token,
        });
        assert.equal(asAuditor.status, 200);
        assert.equal(asAuditor.body.data[0].entry.documentId, documentId);
        assert.equal(
          asAuditor.body.data[0].entry.title,
          null,
          'no Content Manager access, no title'
        );
        const exported = await request('GET', api(`/content/export?contentType=${ARTICLE}`), {
          token: otto1.token,
        });
        assert.ok(!JSON.stringify(exported.body).includes(title), 'the export follows the rule');

        const asOwner = await request('GET', api(`/content?contentType=${ARTICLE}`), {
          token: ada.token,
        });
        assert.equal(asOwner.body.data[0].entry.title, title, 'readable entry: title shown');

        // Field level: read on the type, but not on the main field.
        await grant(auditorRole.id, 'plugin::content-manager.explorer.read', ARTICLE, {
          fields: ['body'],
        });
        const fieldLevel = await request('GET', api(`/content?contentType=${ARTICLE}`), {
          token: otto1.token,
        });
        assert.equal(fieldLevel.body.data[0].entry.title, null, 'main field not readable');

        assert.equal(
          (await request('DELETE', `${cm}/${documentId}`, { token: ada.token })).status,
          200
        );
        await flush();
        const afterDelete = await request('GET', api(`/content?contentType=${ARTICLE}`), {
          token: ada.token,
        });
        assert.ok(!JSON.stringify(afterDelete.body).includes(title), 'deleted: the title is gone');

        // Rows stored by 4.15/4.16 lose their title in the one-time migration.
        await app.db.query(EVENT_UID).create({
          data: {
            event: 'admin.content.view',
            actorType: 'admin',
            actorId: String(owner.id),
            targetType: ARTICLE,
            targetId: 'legacyrow1',
            meta: { kind: 'collection', title: 'Legacy synthetic title' },
          },
        });
        await store.set({ key: 'migrations', value: {} });
        const { migrateSecurityLog } = require(
          path.join(sourceRoot, 'server/src/utils/security-log-hardening')
        );
        const migrated = await migrateSecurityLog(app, { info() {}, warn() {} });
        assert.ok(migrated.titlesRemoved >= 1);
        assert.ok(!JSON.stringify(await activityRows()).includes('Legacy synthetic title'));
      }
    );

    await t.test(
      'F2: a flood of unknown accounts stores one counted row; a sign-in still lands',
      async () => {
        await clearLog();
        const statuses = [];
        const attempt = (i) =>
          request('POST', '/admin/login', {
            body: { email: `ghost-${i}@example.test`, password: 'Wrong-password-1' },
            forwardedFor: '198.51.100.44',
          }).then((result) => statuses.push(result.status));
        for (let i = 0; i < 150; i += 25) {
          await Promise.all(Array.from({ length: 25 }, (_, k) => attempt(i + k)));
          if (i === 75) await login('erin.editor@example.test');
        }
        assert.ok(statuses.every((status) => status === 400));
        await new Promise((resolve) => setTimeout(resolve, 300));
        await flush();
        const rows = await signInRows();
        const unknown = rows.filter((row) => row.event === 'admin.sign-in.failed' && !row.targetId);
        assert.ok(
          unknown.length >= 1 && unknown.length <= 2,
          `${unknown.length} rows (one per 5 min)`
        );
        assert.equal(
          unknown.reduce((sum, row) => sum + meta(row).count, 0),
          150,
          'every attempt is counted'
        );
        assert.ok(
          rows.some((row) => row.event === 'admin.sign-in' && row.targetId === String(erin.id))
        );
        assert.ok(!JSON.stringify(rows).includes('ghost-'), 'typed emails are never stored');
      }
    );

    await t.test(
      'F4: names, emails and roles need admin::users.read / admin::roles.read',
      async () => {
        const rita1 = review.rita;
        const list = await request(
          'GET',
          '/magic-sessionmanager/admin-sessions/admins?pageSize=100',
          {
            token: rita1.token,
          }
        );
        assert.equal(list.status, 200);
        assert.deepEqual(list.body.meta.identity, { names: false, emails: false, roles: false });
        const others = list.body.data.filter((row) => !row.self);
        assert.ok(others.length >= 3);
        for (const row of others) {
          assert.deepEqual([row.name, row.email, row.roles], ['', '', []]);
        }
        assert.ok(!JSON.stringify(list.body).includes('ada.owner@'));
        const search = await request(
          'GET',
          '/magic-sessionmanager/admin-sessions/admins?search=Ada',
          {
            token: rita1.token,
          }
        );
        assert.equal(search.body.data.length, 0, 'no name or email oracle through search');
        const byId = await request(
          'GET',
          `/magic-sessionmanager/admin-sessions/admins?search=${owner.id}`,
          { token: rita1.token }
        );
        assert.deepEqual(
          byId.body.data.map((row) => row.id),
          [owner.id]
        );
        const one = await request(
          'GET',
          `/magic-sessionmanager/admin-sessions/admins/${owner.id}/sessions`,
          { token: rita1.token }
        );
        assert.equal(one.body.meta.admin.email, '');

        // Item 5: session ids are opaque handles, not Strapi's sessionId.
        const raw = (
          await app.db.query('admin::session').findMany({ where: { userId: String(owner.id) } })
        ).map((row) => row.sessionId);
        assert.ok(one.body.data.length >= 1);
        for (const session of one.body.data) {
          assert.match(session.id, /^[a-f0-9]{32}$/);
          assert.ok(!raw.includes(session.id));
        }

        await grant(readerRole.id, 'admin::roles.read');
        const roles = await request(
          'GET',
          '/magic-sessionmanager/admin-sessions/admins?pageSize=100',
          {
            token: rita1.token,
          }
        );
        const ownerRow = roles.body.data.find((row) => row.id === owner.id);
        assert.equal(ownerRow.email, '');
        assert.equal(ownerRow.roles[0].superAdmin, true);
        await grant(readerRole.id, 'admin::users.read');
        const full = await request(
          'GET',
          '/magic-sessionmanager/admin-sessions/admins?pageSize=100',
          {
            token: rita1.token,
          }
        );
        assert.equal(
          full.body.data.find((row) => row.id === owner.id).email,
          'ada.owner@example.test'
        );

        // The same rule for names in the history.
        const otto1 = review.otto;
        const history = await request('GET', api(`/sign-ins?adminId=${erin.id}`), {
          token: otto1.token,
        });
        assert.equal(history.body.meta.identity.names, false);
        assert.ok(history.body.data.every((row) => !row.admin || row.admin.name === ''));
      }
    );

    await t.test(
      'F5/F6: protected settings, the settings event, retention minimum, no webhook URL',
      async () => {
        await clearLog();
        const hook = 'https://discord.com/api/webhooks/123456789012345678/SYNTHETICsecretTOKEN_abc';
        const saved = await request('PUT', '/magic-sessionmanager/settings', {
          token: ada.token,
          body: { discordWebhookUrl: hook, enableGeolocation: false },
        });
        assert.equal(saved.status, 200, 'the Super Admin holds settings.update');
        assert.ok(!JSON.stringify(saved.body).includes('SYNTHETICsecret'));
        assert.equal(saved.body.settings.hasDiscordWebhook, true);

        const rita1 = review.rita;
        const read = await request('GET', '/magic-sessionmanager/settings', { token: rita1.token });
        assert.ok(!JSON.stringify(read.body).includes('SYNTHETICsecret'));
        assert.equal(read.body.settings.discordWebhookHint, 'https://discord.com/…');
        const resent = await request('PUT', '/magic-sessionmanager/settings', {
          token: rita1.token,
          body: { ...read.body.settings, inactivityTimeout: 25 },
        });
        assert.equal(resent.status, 200, 'the GET response sent back keeps working');
        assert.equal((await store.get({ key: 'settings' })).discordWebhookUrl, hook);
        for (const body of [
          { enableGeolocation: true },
          { geoIpProvider: 'ipapi' },
          { discordWebhookUrl: '' },
        ]) {
          const denied = await request('PUT', '/magic-sessionmanager/settings', {
            token: rita1.token,
            body,
          });
          assert.equal(denied.status, 403, JSON.stringify(body));
          assert.equal(denied.body.error.details.reason, 'settings-update-permission');
        }
        const otto1 = review.otto;
        const blind = await request('PUT', '/magic-sessionmanager/settings', {
          token: otto1.token,
          body: { adminSignInHistory: false },
        });
        assert.equal(blind.status, 403, 'a reader cannot blind the log');
        assert.equal(blind.body.error.details.reason, 'settings-update-permission');
        const short = await request('PUT', '/magic-sessionmanager/settings', {
          token: ada.token,
          body: { securityLogRetentionDays: 3 },
        });
        assert.equal(short.status, 400, 'retention below 7 days is rejected');
        const cleared = await request('PUT', '/magic-sessionmanager/settings', {
          token: ada.token,
          body: { discordWebhookUrl: '', enableGeolocation: true },
        });
        assert.equal(cleared.body.settings.hasDiscordWebhook, false);

        await flush();
        const changes = (await allRows()).filter((row) => row.event === 'settings.updated');
        assert.equal(changes.length, 3);
        assert.deepEqual(
          changes.map((row) => [row.actorType, row.actorId, meta(row).keys]),
          [
            ['admin', String(owner.id), 'enableGeolocation,discordWebhookUrl'],
            ['admin', String(rita.id), 'inactivityTimeout'],
            ['admin', String(owner.id), 'enableGeolocation,discordWebhookUrl'],
          ]
        );
        assert.ok(!JSON.stringify(changes).includes('SYNTHETICsecret'), 'never the values');

        // 4.16 allowed 1 day: the start-up migration raises it to 7.
        await setSettings({ securityLogRetentionDays: 2 });
        const { raiseLegacyRetention } = require(
          path.join(sourceRoot, 'server/src/utils/security-log-hardening')
        );
        assert.equal(await raiseLegacyRetention(app, { info() {} }), 2);
        assert.equal((await store.get({ key: 'settings' })).securityLogRetentionDays, 7);
        await setSettings({ securityLogRetentionDays: 90, inactivityTimeout: 15 });
      }
    );

    await t.test(
      'F8: the plugin types are not reachable through the Content Manager API',
      async () => {
        const cm = (uid) => `/content-manager/collection-types/${uid}`;
        assert.equal((await request('GET', cm(EVENT_UID), { token: ada.token })).status, 404);
        assert.equal(
          (await request('GET', cm(encodeURIComponent(EVENT_UID)), { token: ada.token })).status,
          404
        );
        assert.equal(
          (
            await request('POST', cm(EVENT_UID), {
              token: ada.token,
              body: { event: 'admin.sign-in', actorType: 'admin', ip: '198.51.100.77' },
            })
          ).status,
          404,
          'no forged events'
        );
        assert.equal(
          (await request('GET', cm('plugin::magic-sessionmanager.session'), { token: ada.token }))
            .status,
          404
        );
        await grant(readerRole.id, 'plugin::content-manager.explorer.read', EVENT_UID);
        const rita1 = review.rita;
        assert.equal((await request('GET', cm(EVENT_UID), { token: rita1.token })).status, 404);
        assert.equal((await request('GET', cm(ARTICLE), { token: ada.token })).status, 200);
      }
    );

    await t.test('anonymise last octet, IP storage off, history off', async () => {
      await setSettings({ securityLogAnonymizeIp: true });
      await clearLog();
      await login('otto.auditor@example.test', { forwardedFor: '198.51.100.77' });
      await flush();
      let [row] = await signInRows();
      assert.equal(row.ip, behindProxy ? '198.51.100.0' : '127.0.0.0');
      assert.equal(meta(row).ipAnonymized, true);

      await setSettings({ securityLogAnonymizeIp: false, securityLogStoreIp: false });
      await clearLog();
      await login('otto.auditor@example.test', { forwardedFor: '198.51.100.77' });
      await flush();
      [row] = await signInRows();
      assert.equal(row.ip, null);
      assert.equal(row.geo, null);

      await setSettings({ securityLogStoreIp: true, adminSignInHistory: false });
      await clearLog();
      await login('otto.auditor@example.test');
      await request('POST', '/admin/login', {
        body: { email: 'otto.auditor@example.test', password: 'Wrong-password-1' },
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      await flush();
      assert.equal((await signInRows()).length, 0, 'history off: nothing recorded');

      await setSettings({ adminSignInHistory: true, adminContentActivity: false });
      await clearLog();
      await request('POST', `/content-manager/collection-types/${ARTICLE}`, {
        token: ada.token,
        body: { title: 'Not recorded' },
      });
      await flush();
      assert.equal((await activityRows()).length, 0, 'activity off: nothing recorded');
    });

    await t.test(
      'retention applies to the whole log; deleting an admin deletes their rows',
      async () => {
        const day = 24 * 60 * 60 * 1000;
        const old = new Date(Date.now() - 120 * day);
        const recent = new Date(Date.now() - 10 * day);
        await clearLog();
        const owned = { actorType: 'admin', actorId: String(owner.id) };
        const aboutOwner = { targetType: 'admin', targetId: String(owner.id) };
        await app.db.query(EVENT_UID).createMany({
          data: [
            { event: 'admin.sign-in', ...owned, ...aboutOwner, createdAt: old },
            { event: 'admin.sign-in', ...owned, ...aboutOwner, createdAt: recent },
            {
              event: 'admin.sign-in.failed',
              actorType: 'admin',
              targetType: 'admin',
              createdAt: old,
            },
            { event: 'admin.content.view', ...owned, targetType: ARTICLE, createdAt: old },
            { event: 'admin.content.view', ...owned, targetType: ARTICLE, createdAt: recent },
            // A future event family: the same retention applies.
            { event: 'user.sign-in.failed', actorType: 'user', createdAt: old },
          ],
        });
        await setSettings({ securityLogRetentionDays: 90 });
        const removed = await service().cleanup();
        assert.equal(removed.expired, 4);
        assert.equal(await app.db.query(EVENT_UID).count({}), 2);
        // F5: the purge itself is recorded (always on), with the count.
        await flush();
        const purged = (await allRows()).filter(
          (row) => row.event === 'security-log.retention.purged'
        );
        assert.equal(purged.length, 1);
        assert.equal(purged[0].actorType, 'system');
        assert.equal(meta(purged[0]).count, 4);

        // Otto acted and was acted on; Otto also signed Rita out (actor reference).
        await login('otto.auditor@example.test');
        await flush();
        await app.db.query(EVENT_UID).createMany({
          data: [
            {
              event: 'admin.content.view',
              actorType: 'admin',
              actorId: String(otto.id),
              targetType: ARTICLE,
            },
            {
              event: 'admin.session.revoked',
              actorType: 'admin',
              actorId: String(otto.id),
              targetType: 'admin',
              targetId: String(rita.id),
            },
          ],
        });
        const deleted = await request('DELETE', `/admin/users/${otto.id}`, { token: ada.token });
        assert.equal(deleted.status, 200);
        await new Promise((resolve) => setTimeout(resolve, 100));
        const left = await allRows();
        assert.equal(
          left.filter((row) => row.actorId === String(otto.id) || row.targetId === String(otto.id))
            .length,
          0,
          'nothing about the deleted admin is left'
        );
        const revoked = left.find((row) => row.event === 'admin.session.revoked');
        assert.equal(revoked.targetId, String(rita.id), 'the target keeps the event');
        assert.equal(revoked.actorId, null, 'the deleted actor is cleared');
      }
    );
  }
);
