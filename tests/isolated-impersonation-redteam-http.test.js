'use strict';

// Real Strapi 5 HTTP regression tests of the impersonation red-team review
// (both kinds: app users and "Sign in as this admin"):
// F1 an admin sign-in never reaches a token route, reads included (the
//    decrypted key of the target's own admin token), and never mints one;
// F2 a sign-in needs the target's conditional permissions held without
//    conditions (`admin::is-creator` follows the signed-in identity);
// F3 a role change of the target during a sign-in ends it;
// F4 the starter's deactivation, a lost action or the starter signing out
//    ends a running impersonation of either kind, and only that one;
// H1 the Strapi session of an app-user impersonation (refresh mode) expires
//    with the impersonation on its own;
// A1 a Content Manager read while signed in is recorded for the real admin.
// Synthetic accounts and random secrets; outbound network blocked.
//
//   SESSION_HTTP_STRAPI_NODE_MODULES=$PWD/node_modules SESSION_HTTP_REQUIRED=1 \
//     [SESSION_HTTP_MODE=refresh] [SESSION_HTTP_DB=postgres MSM_TEST_PG_URL=...] \
//     node --test tests/isolated-impersonation-redteam-http.test.js
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
  `isolated Strapi impersonation red-team regressions over HTTP (${dbKind}, ${mode})`,
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionmanager-redteam-'));
    const plugin = path.join(root, 'plugin');
    for (const dir of ['config', 'plugin', 'src', 'public', 'public/uploads']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    fs.symlinkSync(hostModules, path.join(root, 'node_modules'), 'dir');
    const write = (filename, contents) => fs.writeFileSync(path.join(root, filename), contents);
    write(
      'package.json',
      JSON.stringify({
        name: 'isolated-sessionmanager-redteam',
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

    // One synthetic content type for Content Manager writes.
    fs.mkdirSync(path.join(root, 'src/api/article/content-types/article'), { recursive: true });
    write(
      'src/api/article/content-types/article/schema.json',
      JSON.stringify({
        kind: 'collectionType',
        collectionName: 'articles',
        info: { singularName: 'article', pluralName: 'articles', displayName: 'Article' },
        options: { draftAndPublish: false },
        attributes: { title: { type: 'string' } },
      })
    );

    const schema = `msm_rt_${crypto.randomBytes(4).toString('hex')}`;
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
    const createAdminRole = async (code, permissions) => {
      const role = await adminRoles.create({ data: { name: `Synthetic ${code}`, code } });
      for (const permission of permissions) {
        await app.db.query('admin::permission').create({
          data: { conditions: [], properties: {}, ...permission, role: role.id },
        });
      }
      return role;
    };
    /** Admin with one Strapi admin session on its own device. */
    const createAdmin = async (roleId, suffix, { active = true } = {}) => {
      const admin = await app.db.query('admin::user').create({
        data: {
          email: `${suffix}@example.invalid`,
          firstname: 'Synthetic',
          lastname: suffix,
          isActive: active,
          roles: [roleId],
        },
      });
      const signIn = async () => {
        const refresh = await app
          .sessionManager('admin')
          .generateRefreshToken(String(admin.id), crypto.randomUUID(), { type: 'session' });
        return (await app.sessionManager('admin').generateAccessToken(refresh.token)).token;
      };
      return { id: admin.id, token: await signIn(), signIn };
    };
    const ARTICLE = 'api::article.article';
    const cm = (action) => ({
      action: `plugin::content-manager.explorer.${action}`,
      subject: ARTICLE,
      properties: { fields: ['title'] },
    });
    const ACCESS = { action: 'plugin::magic-sessionmanager.access' };
    const SIGN_IN = { action: 'plugin::magic-sessionmanager.impersonate.admins.sign-in' };

    const superA = await createAdmin(superRole.id, 'rt-super-a');

    const flushedEvents = async (where = {}) => {
      await app.plugin('magic-sessionmanager').service('security-log').flush();
      return app.db.query(EVENT_UID).findMany({ where, orderBy: { id: 'asc' } });
    };
    const settings = (body) =>
      request('PUT', '/magic-sessionmanager/settings', { token: superA.token, body });
    const signIn = (target, token, body = {}) =>
      request('POST', `/magic-sessionmanager/impersonation/admins/${target.id}/sign-in`, {
        token,
        body: { reason: 'Ticket 4711: support check', durationMinutes: 15, ...body },
      });
    const exchange = (code, token) =>
      request('POST', '/magic-sessionmanager/admin-impersonation/exchange', {
        token,
        body: { code },
      });
    /** Starts and exchanges; returns the impersonation id and the tab token. */
    const impersonate = async (target, actor, body = {}) => {
      const started = await signIn(target, actor.token, body);
      assert.equal(started.status, 201, JSON.stringify(started.body?.error));
      const swapped = await exchange(started.body.data.handoff.code, actor.token);
      assert.equal(swapped.status, 200, JSON.stringify(swapped.body?.error));
      return { id: started.body.data.impersonation.id, token: swapped.body.data.token };
    };
    const me = async (token) => {
      const result = await request('GET', '/admin/users/me', { token });
      return result.status === 200 ? result.body.data.id : result.status;
    };
    const refusedWith = (result, reason) => {
      assert.equal(result.status, 403, JSON.stringify(result.body?.error));
      assert.equal(result.body.error.details.reason, reason);
    };
    const end = (id, token = superA.token) =>
      request('POST', `/magic-sessionmanager/impersonation/${id}/end`, { token });
    const row = (documentId) => app.db.query(IMPERSONATION_UID).findOne({ where: { documentId } });
    /** Past the five-second trust window of a passed re-check. */
    const pastRecheckWindow = () => new Promise((resolve) => setTimeout(resolve, 5300));
    const revoked = (result) => {
      assert.equal(result.status, 401, JSON.stringify(result.body));
      assert.equal(result.body.error.details.reason, 'impersonation-revoked');
    };
    const setAdmin = (id, data) => app.db.query('admin::user').update({ where: { id }, data });

    // App users with the Authenticated role.
    const upRoles = app.db.query('plugin::users-permissions.role');
    const authenticated = await upRoles.findOne({ where: { type: 'authenticated' } });
    for (const action of ['plugin::users-permissions.user.me']) {
      const exists = await app.db
        .query('plugin::users-permissions.permission')
        .findOne({ where: { action, role: authenticated.id } });
      if (!exists) {
        await app.db
          .query('plugin::users-permissions.permission')
          .create({ data: { action, role: authenticated.id } });
      }
    }
    const createUser = (name) =>
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
        });
    const startUser = (user, token) =>
      request('POST', `/magic-sessionmanager/impersonation/users/${user.documentId}`, {
        token,
        body: { reason: 'Ticket 4711: checkout fails', durationMinutes: 15 },
      });

    await t.test('setup: impersonation on', async () => {
      assert.equal((await settings({ impersonationEnabled: true })).status, 200);
    });

    await t.test('F1: a sign-in never reaches a token route, reads included', async () => {
      const role = await createAdminRole('rt-tokens', [
        cm('read'),
        { action: 'admin::api-tokens.access' },
        { action: 'admin::api-tokens.read' },
        { action: 'admin::admin-tokens.access' },
        { action: 'admin::admin-tokens.read' },
        { action: 'admin::admin-tokens.create' },
      ]);
      const victim = await createAdmin(role.id, 'rt-victim');
      const created = await request('POST', '/admin/admin-tokens', {
        token: victim.token,
        body: { name: 'victim personal', description: '', lifespan: null, adminPermissions: [] },
      });
      // Admin tokens exist since Strapi 5.6x; the floor (5.50) has none, the
      // route answers 404 there and the guard still refuses the prefix.
      const tokenId = created.status === 201 ? created.body.data.id : 1;
      const starter = await createAdmin(superRole.id, 'rt-f1-starter');
      const ro = await impersonate({ id: victim.id }, starter);
      for (const url of [
        `/admin/admin-tokens/${tokenId}`,
        '/admin/admin-tokens',
        `/admin/admin-tokens/${tokenId}/owner-permissions`,
        '/admin/api-tokens',
        '/admin/transfer/tokens',
      ]) {
        const result = await request('GET', url, { token: ro.token });
        refusedWith(result, 'impersonation-identity');
        assert.equal(JSON.stringify(result.body).includes('accessKey'), false, url);
      }
      // The victim still reads their own key.
      if (created.status === 201) {
        const own = await request('GET', `/admin/admin-tokens/${tokenId}`, { token: victim.token });
        assert.equal(own.status, 200);
      }
      await end(ro.id, starter.token);
      const rw = await impersonate({ id: victim.id }, starter, { allowChanges: true });
      const mint = await request('POST', '/admin/admin-tokens', {
        token: rw.token,
        body: { name: 'minted', description: '', lifespan: null, adminPermissions: [] },
      });
      refusedWith(mint, 'impersonation-identity');
      const regenerate = await request('POST', `/admin/admin-tokens/${tokenId}/regenerate`, {
        token: rw.token,
      });
      refusedWith(regenerate, 'impersonation-identity');
      await end(rw.id, starter.token);
      if (created.status === 201) {
        const tokens = await app.db
          .query('admin::api-token')
          .findMany({ where: { kind: 'admin' } });
        assert.equal(tokens.length, 1, 'no token was minted for the victim');
      }
    });

    await t.test(
      'F2: own-entries permissions need an unconditional holder to sign in',
      async () => {
        const own = (action) => ({ ...cm(action), conditions: ['admin::is-creator'] });
        const authorRole = await createAdminRole('rt-author', [own('read'), own('update')]);
        const author = await createAdmin(authorRole.id, 'rt-author');
        const sameRole = await createAdmin(
          (await createAdminRole('rt-own-support', [ACCESS, SIGN_IN, own('read'), own('update')]))
            .id,
          'rt-own-support'
        );
        refusedWith(await signIn(author, sameRole.token, { allowChanges: true }), 'not-subset');
        const wide = await createAdmin(
          (await createAdminRole('rt-all-support', [ACCESS, SIGN_IN, cm('read'), cm('update')])).id,
          'rt-all-support'
        );
        const allowed = await impersonate(author, wide);
        assert.equal(await me(allowed.token), author.id);
        await end(allowed.id, wide.token);
      }
    );

    await t.test('F3: a role change of the target during a sign-in ends it', async () => {
      const target = await createAdmin(
        (await createAdminRole('rt-plain3', [cm('read')])).id,
        'rt-promoted'
      );
      const helper = await createAdmin(
        (await createAdminRole('rt-support3', [ACCESS, SIGN_IN, cm('read')])).id,
        'rt-support3'
      );
      const { id, token } = await impersonate(target, helper);
      assert.equal((await request('GET', '/admin/users', { token })).status, 403);
      await setAdmin(target.id, { roles: [superRole.id] });
      await pastRecheckWindow();
      revoked(await request('GET', '/admin/users', { token }));
      const ended = await row(id);
      assert.equal(ended.state, 'ended');
      assert.equal(ended.endReason, 'revoked');
      assert.equal(await me(token), 401);
      // The target's own session survives.
      assert.equal(await me(target.token), target.id);
      // Same for a permission the starter does not hold.
      const second = await createAdmin(
        (await createAdminRole('rt-plain3b', [cm('read')])).id,
        'rt-widened'
      );
      const other = await impersonate(second, helper);
      const [secondRole] = (
        await app.db
          .query('admin::user')
          .findOne({ where: { id: second.id }, populate: { roles: true } })
      ).roles;
      await app.db.query('admin::permission').create({
        data: { ...cm('delete'), conditions: [], role: secondRole.id },
      });
      revoked(await request('GET', '/admin/users/me', { token: other.token }));
    });

    await t.test(
      'F4: the starter deactivated, without the action or signed out ends it',
      async () => {
        const targetRole = await createAdminRole('rt-plain4', [cm('read')]);
        const target = await createAdmin(targetRole.id, 'rt-target4');

        const deactivated = await createAdmin(superRole.id, 'rt-starter4a');
        const first = await impersonate(target, deactivated);
        assert.equal(await me(first.token), target.id);
        await setAdmin(deactivated.id, { isActive: false });
        await pastRecheckWindow();
        revoked(await request('GET', '/admin/users/me', { token: first.token }));
        assert.equal((await row(first.id)).endReason, 'revoked');

        const supportRole = await createAdminRole('rt-support4', [ACCESS, SIGN_IN, cm('read')]);
        const helper = await createAdmin(supportRole.id, 'rt-support4');
        const second = await impersonate(target, helper);
        await app.db
          .query('admin::permission')
          .deleteMany({ where: { role: supportRole.id, action: SIGN_IN.action } });
        revoked(await request('GET', '/admin/users/me', { token: second.token }));

        // Signing out on another device of the starter keeps it; signing out
        // on the starting device ends it.
        const starter = await createAdmin(superRole.id, 'rt-starter4c');
        const otherDevice = await starter.signIn();
        const third = await impersonate(target, starter);
        const elsewhere = await request('POST', '/admin/logout', {
          token: otherDevice,
          body: { deviceId: 'unknown-device' },
        });
        assert.equal(elsewhere.status, 200);
        assert.equal(await me(third.token), target.id);
        assert.equal(
          (await request('POST', '/admin/logout', { token: starter.token })).status,
          200
        );
        await pastRecheckWindow();
        revoked(await request('GET', '/admin/users/me', { token: third.token }));
        // The target's own session is untouched by all of this.
        assert.equal(await me(target.token), target.id);
        const events = await flushedEvents({ event: 'impersonation.ended' });
        assert.ok(events.filter((event) => event.meta.endReason === 'revoked').length >= 3);
      }
    );

    await t.test(
      'audit: a content read while signed in is recorded for the real admin',
      async () => {
        assert.equal((await settings({ adminContentActivity: true })).status, 200);
        const created = await request('POST', `/content-manager/collection-types/${ARTICLE}`, {
          token: superA.token,
          body: { title: 'synthetic entry' },
        });
        assert.equal(created.status, 201);
        const documentId = created.body.data.documentId;
        const target = await createAdmin(
          (await createAdminRole('rt-audit', [cm('read')])).id,
          'rt-audit-target'
        );
        const starter = await createAdmin(superRole.id, 'rt-audit-starter');
        const { id, token } = await impersonate(target, starter);
        const read = await request(
          'GET',
          `/content-manager/collection-types/${ARTICLE}/${documentId}`,
          { token }
        );
        assert.equal(read.status, 200);
        const views = await flushedEvents({ event: 'admin.content.view', targetId: documentId });
        const mine = views.filter((event) => event.meta?.impersonation === id);
        assert.equal(mine.length, 1);
        assert.equal(mine[0].actorId, String(starter.id));
        assert.equal(mine[0].meta.impersonating, String(target.id));
        assert.equal(
          views.some((event) => event.actorId === String(target.id)),
          false,
          'never attributed to the other admin'
        );
        await end(id, starter.token);
      }
    );

    await t.test(`F4 for app users (${mode}): the starter's state ends it`, async () => {
      const starter = await createAdmin(superRole.id, 'rt-u-starter');
      const anna = await createUser('anna');
      const started = await startUser(anna, starter.token);
      assert.equal(started.status, 201, JSON.stringify(started.body?.error));
      const { handoff, impersonation } = started.body.data;
      const meUser = await request('GET', '/api/users/me', { token: handoff.jwt });
      assert.equal(meUser.status, 200);
      if (handoff.refreshToken) {
        // H1: the Strapi session expires with the impersonation.
        const session = await app.db.query('admin::session').findOne({
          where: { origin: 'users-permissions', deviceId: { $startsWith: 'msm-impersonation-' } },
        });
        assert.ok(
          new Date(session.absoluteExpiresAt).getTime() <= Date.parse(handoff.expiresAt) + 1000
        );
        assert.ok(new Date(session.expiresAt).getTime() <= Date.parse(handoff.expiresAt) + 1000);
      }
      await setAdmin(starter.id, { isActive: false });
      await pastRecheckWindow();
      revoked(await request('GET', '/api/users/me', { token: handoff.jwt }));
      assert.equal((await row(impersonation.id)).endReason, 'revoked');
      if (handoff.refreshToken) {
        const refreshed = await request('POST', '/api/auth/refresh', {
          body: { refreshToken: handoff.refreshToken },
        });
        assert.ok([400, 401, 403].includes(refreshed.status), String(refreshed.status));
      }

      const role = await adminRoles.create({ data: { name: 'Synthetic rt-u2', code: 'rt-u2' } });
      for (const action of [ACCESS.action, 'plugin::magic-sessionmanager.impersonate.users']) {
        await app.db
          .query('admin::permission')
          .create({ data: { action, conditions: [], properties: {}, role: role.id } });
      }
      const helper = await createAdmin(role.id, 'rt-u-helper');
      const ben = await createUser('ben');
      const second = await startUser(ben, helper.token);
      assert.equal(second.status, 201, JSON.stringify(second.body?.error));
      await request('POST', '/admin/logout', { token: helper.token });
      revoked(await request('GET', '/api/users/me', { token: second.body.data.handoff.jwt }));
    });
  }
);
