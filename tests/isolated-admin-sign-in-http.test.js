'use strict';

// Real Strapi 5 HTTP boundary of "Sign in as this admin" (4.23): the RBAC
// action, the version guard, every anti-escalation rule, the one-time code
// (bound to the starting admin, single use), the Strapi admin session of the
// target (own device id, expires with the impersonation), read-only by
// default, identity routes never, "Allow changes" with attribution in the
// security log, `/admin/logout` ending only the impersonation, ending from
// the tab, from the list and by expiry, and that the target's own sessions
// and the real admin's session survive every ending. Synthetic accounts and
// random secrets; outbound network blocked.
//
//   SESSION_HTTP_STRAPI_NODE_MODULES=$PWD/node_modules SESSION_HTTP_REQUIRED=1 \
//     node --test tests/isolated-admin-sign-in-http.test.js
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
  `isolated Strapi sign-in as another admin over HTTP (${dbKind})`,
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionmanager-admin-sign-in-'));
    const plugin = path.join(root, 'plugin');
    for (const dir of ['config', 'plugin', 'src', 'public', 'public/uploads']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    fs.symlinkSync(hostModules, path.join(root, 'node_modules'), 'dir');
    const write = (filename, contents) => fs.writeFileSync(path.join(root, filename), contents);
    write(
      'package.json',
      JSON.stringify({
        name: 'isolated-sessionmanager-admin-sign-in',
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

    const schema = `msm_asi_${crypto.randomBytes(4).toString('hex')}`;
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
    const outsiderRole = await adminRoles.create({
      data: { name: 'Synthetic outsider', code: 'asi-outsider' },
    });
    const ARTICLE = 'api::article.article';
    const cm = (action) => ({
      action: `plugin::content-manager.explorer.${action}`,
      subject: ARTICLE,
      properties: { fields: ['title'] },
    });
    const ACCESS = { action: 'plugin::magic-sessionmanager.access' };
    const SIGN_IN = { action: 'plugin::magic-sessionmanager.impersonate.admins.sign-in' };

    const supers = [];
    for (let i = 0; i < 6; i += 1) supers.push(await createAdmin(superRole.id, `asi-super-${i}`));
    const [superA, superB, superC, superD, superE, superF] = supers;
    const editorRole = await createAdminRole('asi-editor', [
      cm('read'),
      cm('create'),
      cm('update'),
      cm('delete'),
    ]);
    const editor = await createAdmin(editorRole.id, 'asi-editor');
    // The editor is signed in on two more devices of their own.
    const editorDevice2 = await editor.signIn();
    const editorDevice3 = await editor.signIn();
    const readerRole = await createAdminRole('asi-reader', [cm('read')]);
    const reader = await createAdmin(readerRole.id, 'asi-reader');
    const inactive = await createAdmin(readerRole.id, 'asi-inactive', { active: false });
    const supportRole = await createAdminRole('asi-support', [ACCESS, SIGN_IN, cm('read')]);
    const support = await createAdmin(supportRole.id, 'asi-support');
    const noActionRole = await createAdminRole('asi-no-action', [ACCESS, cm('read'), cm('update')]);
    const noAction = await createAdmin(noActionRole.id, 'asi-no-action');

    const flushedEvents = async (where = {}) => {
      await app.plugin('magic-sessionmanager').service('security-log').flush();
      return app.db.query(EVENT_UID).findMany({ where, orderBy: { id: 'asc' } });
    };
    const settings = (body) =>
      request('PUT', '/magic-sessionmanager/settings', { token: superA.token, body });
    const signIn = (target, token, body = {}) =>
      request('POST', `/magic-sessionmanager/impersonation/admins/${target.id}/sign-in`, {
        token,
        body: { reason: 'Ticket 4711: editor cannot save', durationMinutes: 15, ...body },
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
    const activeAdminSessions = (userId) =>
      app.db
        .query('admin::session')
        .findMany({ where: { userId: String(userId), origin: 'admin', status: 'active' } });
    const refusedWith = (result, reason) => {
      assert.equal(result.status, 403, JSON.stringify(result.body?.error));
      assert.equal(result.body.error.details.reason, reason);
    };
    /** The editor's own sessions and the real admin's session must survive every ending. */
    const assertUntouched = async (actor) => {
      assert.equal(await me(editor.token), editor.id);
      assert.equal(await me(editorDevice2), editor.id);
      assert.equal(await me(editorDevice3), editor.id);
      assert.equal(await me(actor.token), actor.id);
      const own = (await activeAdminSessions(editor.id)).filter(
        (row) => !String(row.deviceId).startsWith('msm-admin-impersonation-')
      );
      assert.equal(own.length, 3);
    };

    await t.test('off by default; the status reports the tested Strapi release', async () => {
      const status = await request('GET', '/magic-sessionmanager/impersonation/status', {
        token: superA.token,
      });
      assert.equal(status.status, 200);
      assert.equal(status.body.data.enabled, false);
      assert.equal(status.body.data.adminSignIn.supported, true);
      assert.deepEqual(status.body.data.adminSignIn.durations, [15, 30]);
      refusedWith(await signIn(editor, superA.token), 'disabled');
      assert.equal((await settings({ impersonationEnabled: true })).status, 200);
    });

    await t.test('RBAC: Super Admin automatically, granted roles only', async () => {
      assert.equal(
        (await signIn(reader, (await createAdmin(outsiderRole.id, 'asi-outsider')).token)).status,
        403
      );
      assert.equal((await signIn(reader, noAction.token)).status, 403);
      const granted = await signIn(reader, support.token);
      assert.equal(granted.status, 201, JSON.stringify(granted.body?.error));
      await request(
        'POST',
        `/magic-sessionmanager/impersonation/${granted.body.data.impersonation.id}/end`,
        {
          token: support.token,
        }
      );
    });

    await t.test(
      'anti-escalation: never self, a Super Admin, an inactive admin or a wider role',
      async () => {
        refusedWith(await signIn(superA, superA.token), 'self');
        refusedWith(await signIn(superB, superA.token), 'super-admin');
        refusedWith(await signIn(inactive, superA.token), 'inactive');
        refusedWith(await signIn(editor, support.token), 'not-subset');
        const invalid = await signIn(reader, superA.token, { durationMinutes: 60 });
        assert.equal(invalid.status, 400);
        const unknownField = await signIn(reader, superA.token, { admin: true });
        assert.equal(unknownField.status, 400);
        assert.equal((await signIn({ id: 999999 }, superA.token)).status, 404);
        const refused = await flushedEvents({ event: 'impersonation.refused' });
        assert.ok(
          refused.some((row) => row.meta.refusal === 'not-subset' && row.meta.via === 'sign-in')
        );
      }
    );

    await t.test(
      'the code is single use, bound to the starting admin, and no query parameter',
      async () => {
        const started = await signIn(reader, superB.token);
        assert.equal(started.status, 201);
        const { handoff, impersonation } = started.body.data;
        assert.equal(handoff.type, 'admin-tab');
        assert.equal(handoff.path, '/plugins/magic-sessionmanager/impersonate/land');
        assert.equal(handoff.cookieName, 'jwtToken');
        assert.equal(impersonation.allowChanges, false);
        // No session exists before the exchange.
        const before = await activeAdminSessions(reader.id);
        assert.equal(before.length, 1);
        assert.equal((await exchange(handoff.code, superC.token)).status, 400, 'other admin');
        assert.equal((await exchange(handoff.code, undefined)).status, 401, 'anonymous');
        const swapped = await exchange(handoff.code, superB.token);
        assert.equal(swapped.status, 200);
        assert.equal(swapped.headers.get('cache-control'), 'no-store');
        assert.equal((await exchange(handoff.code, superB.token)).status, 400, 'reuse');
        assert.equal(await me(swapped.body.data.token), reader.id);
        const row = await app.db
          .query(IMPERSONATION_UID)
          .findOne({ where: { documentId: impersonation.id } });
        const session = (await activeAdminSessions(reader.id)).find((item) =>
          String(item.deviceId).startsWith('msm-admin-impersonation-')
        );
        assert.ok(session);
        assert.equal(session.metadata.msmImpersonation, impersonation.id);
        assert.equal(new Date(session.expiresAt).getTime(), new Date(row.expiresAt).getTime());
        // A second sign-in as the same admin is refused while one runs.
        refusedWith(await signIn(reader, superC.token), 'already-active');
        await request('POST', `/magic-sessionmanager/impersonation/${impersonation.id}/end`, {
          token: superB.token,
        });
        assert.equal(await me(swapped.body.data.token), 401);
      }
    );

    await t.test('read-only by default; identity, tokens and nesting are refused', async () => {
      const { id, token } = await impersonate(editor, superC);
      const self = await request('GET', '/magic-sessionmanager/admin-impersonation/self', {
        token,
      });
      assert.equal(self.status, 200);
      assert.equal(self.body.data.id, id);
      assert.equal(self.body.data.allowChanges, false);
      assert.equal(self.headers.get('x-magic-impersonation'), 'true');
      const list = await request('GET', `/content-manager/collection-types/${ARTICLE}`, { token });
      assert.equal(list.status, 200);
      const check = await request('POST', '/admin/permissions/check', {
        token,
        body: {
          permissions: [{ action: 'plugin::content-manager.explorer.read', subject: ARTICLE }],
        },
      });
      assert.equal(check.status, 200);
      refusedWith(
        await request('POST', `/content-manager/collection-types/${ARTICLE}`, {
          token,
          body: { title: 'Read-only' },
        }),
        'impersonation-read-only'
      );
      refusedWith(
        await request('PUT', '/admin/users/me', { token, body: { firstname: 'Changed' } }),
        'impersonation-identity'
      );
      refusedWith(
        await request('POST', '/admin/api-tokens', {
          token,
          body: { name: 'x', type: 'read-only', lifespan: null },
        }),
        'impersonation-identity'
      );
      refusedWith(await signIn(reader, token), 'impersonation-identity');
      const refused = await flushedEvents({ event: 'impersonation.refused' });
      const last = refused.at(-1);
      assert.equal(last.actorId, String(superC.id));
      assert.equal(last.targetId, String(editor.id));
      assert.equal(last.meta.impersonating, String(editor.id));
      // The self routes answer nobody else.
      assert.equal(
        (
          await request('GET', '/magic-sessionmanager/admin-impersonation/self', {
            token: editor.token,
          })
        ).status,
        401
      );
      assert.equal(
        (
          await request('POST', '/magic-sessionmanager/admin-impersonation/self/end', {
            token: superC.token,
          })
        ).status,
        401
      );
      // End from the tab: only the impersonation session goes.
      const ended = await request('POST', '/magic-sessionmanager/admin-impersonation/self/end', {
        token,
      });
      assert.deepEqual(ended.body.data, { ended: true });
      assert.equal(await me(token), 401);
      await assertUntouched(superC);
    });

    await t.test('/admin/logout in the tab ends the impersonation only', async () => {
      const { id, token } = await impersonate(editor, superD);
      // Strapi's own logout without a device id would delete every session of
      // the signed-in admin; the guard answers it instead.
      const out = await request('POST', '/admin/logout', { token, body: {} });
      assert.equal(out.status, 200);
      assert.equal(await me(token), 401);
      const row = await app.db.query(IMPERSONATION_UID).findOne({ where: { documentId: id } });
      assert.equal(row.state, 'ended');
      await assertUntouched(superD);
    });

    await t.test(
      '"Allow changes": writes work, show as the target, are recorded for the real admin',
      async () => {
        const { id, token } = await impersonate(editor, superE, { allowChanges: true });
        const created = await request('POST', `/content-manager/collection-types/${ARTICLE}`, {
          token,
          body: { title: 'Written while signed in as the editor' },
        });
        assert.equal(created.status, 201, JSON.stringify(created.body?.error));
        const article = await app.db.query(ARTICLE).findOne({
          where: { documentId: created.body.data.documentId },
          populate: ['updatedBy'],
        });
        assert.equal(article.updatedBy.id, editor.id, 'Strapi attributes it to the target');
        refusedWith(
          await request('PUT', '/admin/users/me', { token, body: { firstname: 'Changed' } }),
          'impersonation-identity'
        );
        const writes = await flushedEvents({ event: 'impersonation.write' });
        const write = writes.at(-1);
        assert.equal(write.actorType, 'admin');
        assert.equal(write.actorId, String(superE.id));
        assert.equal(write.targetType, 'admin');
        assert.equal(write.targetId, String(editor.id));
        assert.equal(write.meta.impersonating, String(editor.id));
        assert.equal(write.meta.impersonation, id);
        assert.equal(write.meta.method, 'POST');
        assert.equal(write.meta.route, `/content-manager/collection-types/${ARTICLE}`);
        assert.equal(write.meta.status, 201);
        // The sign-in history of the target lists it under "Impersonation".
        const history = await request(
          'GET',
          `/magic-sessionmanager/admin-activity/sign-ins?event=impersonation&adminId=${editor.id}`,
          { token: superA.token }
        );
        assert.equal(history.status, 200);
        const events = (history.body.data || []).map((row) => row.event);
        assert.ok(events.includes('impersonation.write'), JSON.stringify(events));
        // End from the Admin panel list.
        const listed = await request('GET', '/magic-sessionmanager/impersonation/active', {
          token: superE.token,
        });
        const entry = listed.body.data.find((row) => row.id === id);
        assert.equal(entry.handoff, 'admin-session');
        assert.equal(entry.allowChanges, true);
        const end = await request('POST', `/magic-sessionmanager/impersonation/${id}/end`, {
          token: superE.token,
        });
        assert.deepEqual(end.body.data, { ended: true });
        assert.equal(await me(token), 401);
        await assertUntouched(superE);
      }
    );

    await t.test('expiry ends the session on its own; the target keeps theirs', async () => {
      const { id, token } = await impersonate(editor, superF);
      const past = new Date(Date.now() - 1000);
      await app.db
        .query(IMPERSONATION_UID)
        .update({ where: { documentId: id }, data: { expiresAt: past } });
      const expired = await request('GET', '/admin/users/me', { token });
      assert.equal(expired.status, 401);
      const row = await app.db.query(IMPERSONATION_UID).findOne({ where: { documentId: id } });
      assert.equal(row.state, 'expired');
      // Strapi's own check would end it too: the session expires with the impersonation.
      const left = (await activeAdminSessions(editor.id)).filter((item) =>
        String(item.deviceId).startsWith('msm-admin-impersonation-')
      );
      assert.equal(left.length, 0);
      await assertUntouched(superF);
      const events = await flushedEvents({ event: 'impersonation.expired' });
      assert.equal(events.at(-1).targetId, String(editor.id));
    });

    await t.test('an untested Strapi release switches the feature off', async () => {
      const real = app.config.get('info.strapi');
      app.config.set('info.strapi', '5.65.0');
      try {
        const status = await request('GET', '/magic-sessionmanager/impersonation/status', {
          token: superA.token,
        });
        assert.deepEqual(status.body.data.adminSignIn, {
          supported: false,
          version: '5.65.0',
          reason: 'untested-version',
          durations: [15, 30],
        });
        refusedWith(await signIn(reader, superA.token), 'unsupported');
      } finally {
        app.config.set('info.strapi', real);
      }
    });

    await t.test('turning the switch off ends every running sign-in', async () => {
      const { token } = await impersonate(reader, superA);
      assert.equal(await me(token), reader.id);
      assert.equal((await settings({ impersonationEnabled: false })).status, 200);
      await app.plugin('magic-sessionmanager').service('impersonation').sweep();
      assert.equal(await me(token), 401);
      assert.equal(await me(reader.token), reader.id);
    });
  }
);
