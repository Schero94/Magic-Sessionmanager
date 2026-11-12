'use strict';

// Real Strapi 5 HTTP boundary in Users & Permissions refresh mode: every way
// Strapi can create a native session, whether the plugin links it, and the
// untracked-session summary and clean-up routes. Synthetic data only;
// outbound network is blocked. Run in its own process:
//
//   node --test tests/isolated-native-capture-http.test.js
//
// Environment:
//   SESSION_HTTP_STRAPI_NODE_MODULES  host node_modules (Strapi, users-permissions,
//                                     better-sqlite3; pg for PostgreSQL;
//                                     @strapi/plugin-graphql optional)
//   SESSION_HTTP_PLUGIN_DIR           plugin package to load (an unpacked
//                                     `npm pack` tarball); default: source
//   MSM_TEST_PG_URL                   run against this (empty) PostgreSQL database
//   SESSION_HTTP_API_PREFIX           REST prefix, default /api (e.g. /v1)
//   SESSION_HTTP_REQUIRED=1           fail instead of skip without a host
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');

const { resolveHostDependencies, assertHostAvailable } = require('./helpers/host-dependencies');

const sourceRoot = path.resolve(__dirname, '..');
const pgUrl = process.env.MSM_TEST_PG_URL || '';
const host = resolveHostDependencies([
  '@strapi/strapi',
  '@strapi/plugin-users-permissions',
  pgUrl ? 'pg' : 'better-sqlite3',
]);
const hostDependencies = host.modules;
const pluginDir = process.env.SESSION_HTTP_PLUGIN_DIR || '';
const apiPrefix = process.env.SESSION_HTTP_API_PREFIX || '/api';
const hasGraphql = fs.existsSync(
  path.join(hostDependencies, '@strapi', 'plugin-graphql', 'package.json')
);
const dbLabel = pgUrl ? 'postgres' : 'sqlite';

test(
  `native session capture and untracked-session routes (${dbLabel}, prefix ${apiPrefix}, ${pluginDir ? 'packed plugin' : 'source'})`,
  { timeout: 240000, skip: host.skip },
  async (t) => {
    assertHostAvailable(host);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionmanager-capture-'));
    const write = (filename, contents) => fs.writeFileSync(path.join(root, filename), contents);
    for (const dir of ['config', 'plugin', 'src', 'public', 'public/uploads']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    fs.symlinkSync(hostDependencies, path.join(root, 'node_modules'), 'dir');
    write(
      'package.json',
      JSON.stringify({
        name: 'isolated-sessionmanager-capture',
        version: '0.0.0',
        private: true,
        dependencies: {
          '@strapi/plugin-users-permissions': '*',
          ...(hasGraphql ? { '@strapi/plugin-graphql': '*' } : {}),
        },
      })
    );
    let pluginResolve = pluginDir;
    if (!pluginResolve) {
      pluginResolve = path.join(root, 'plugin');
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
    }
    const database = pgUrl
      ? `{ connection: { client: 'postgres', connection: { connectionString: process.env.MSM_TEST_PG_URL }, pool: { min: 0, max: 5 } } }`
      : `{ connection: { client: 'sqlite', connection: { filename: ${JSON.stringify(path.join(root, 'test.sqlite'))} }, useNullAsDefault: true } }`;
    write('config/database.js', `module.exports = ${database};\n`);
    write(
      'config/server.js',
      `module.exports = { host: '127.0.0.1', port: 1337, url: 'http://127.0.0.1:1337', app: { keys: [process.env.TEST_HTTP_SECRET_A, process.env.TEST_HTTP_SECRET_B] }, logger: { updates: { enabled: false } } };\n`
    );
    write(
      'config/api.js',
      `module.exports = { rest: { prefix: ${JSON.stringify(apiPrefix)} } };\n`
    );
    write(
      'config/admin.js',
      `module.exports = { auth: { secret: process.env.TEST_HTTP_SECRET_A }, apiToken: { salt: process.env.TEST_HTTP_SECRET_B }, transfer: { token: { salt: process.env.TEST_HTTP_SECRET_A } } };\n`
    );
    write(
      'config/plugins.js',
      `module.exports = { ${hasGraphql ? 'graphql: { enabled: true, config: { playgroundAlways: false, landingPage: false } },' : ''} 'users-permissions': { enabled: true, config: { jwtSecret: process.env.TEST_HTTP_SECRET_B, jwtManagement: 'refresh' } }, 'magic-sessionmanager': { enabled: true, resolve: ${JSON.stringify(pluginResolve)}, config: { enableGeolocation: false, geoIpProvider: 'disabled', enableWebhooks: false, enableEmailAlerts: false } } };\n`
    );

    let allowedPorts = new Set();
    const pgPort = pgUrl ? Number(new URL(pgUrl).port || 5432) : null;
    if (pgPort) allowedPorts.add(pgPort);
    const originalConnect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function (...args) {
      const options = Array.isArray(args[0])
        ? args[0][0]
        : typeof args[0] === 'object'
          ? args[0]
          : { port: args[0], host: args[1] };
      const hostName = options.host || options.hostname || 'localhost';
      const local = ['127.0.0.1', '::1', 'localhost'].includes(hostName) || options.path;
      if (!local || (!options.path && !allowedPorts.has(Number(options.port)))) {
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
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    const { createStrapi } = require(path.join(hostDependencies, '@strapi/strapi'));
    app = createStrapi({ appDir: root, distDir: root, serveAdminPanel: false });
    await app.load();
    app.log.level = 'error';

    const UP = 'users-permissions';
    const native = () => app.sessionManager(UP);
    const userService = app.plugin(UP).service('user');
    const jwtService = app.plugin(UP).service('jwt');
    const role = await app.db.query('plugin::users-permissions.role').findOne({
      where: { type: 'authenticated' },
    });
    const password = `Synthetic-${crypto.randomBytes(9).toString('base64url')}1`;
    const createUser = (suffix, extra = {}) =>
      userService.add({
        username: `synthetic-${suffix}`,
        email: `${suffix}@example.test`,
        password,
        provider: 'local',
        confirmed: true,
        blocked: false,
        role: role.id,
        ...extra,
      });

    // Test-only routes that create native sessions the way custom code does.
    const respondWithRefresh = async (user) => {
      const refresh = await native().generateRefreshToken(String(user.id), undefined, {
        type: 'refresh',
      });
      const access = await native().generateAccessToken(refresh.token);
      return { refresh: refresh.token, access: access.token };
    };
    const customUsers = {};
    app.server.routes([
      {
        method: 'POST',
        path: `${apiPrefix}/custom/login-refresh`,
        handler: async (ctx) => {
          const tokens = await respondWithRefresh(customUsers.refresh);
          ctx.body = { jwt: tokens.access, refreshToken: tokens.refresh };
        },
        config: { auth: false },
      },
      {
        method: 'POST',
        path: `${apiPrefix}/custom/login-issue`,
        handler: async (ctx) => {
          ctx.body = { jwt: await jwtService.issue({ id: customUsers.issue.id }) };
        },
        config: { auth: false },
      },
      {
        method: 'POST',
        path: `${apiPrefix}/custom/send-login-link`,
        handler: async (ctx) => {
          await respondWithRefresh(customUsers.outOfBand);
          ctx.body = { sent: true };
        },
        config: { auth: false },
      },
      {
        // An intercepted magic-link path whose handler forgets to await
        // jwt.issue(), so the body holds a Promise.
        method: 'POST',
        path: `${apiPrefix}/magic-link/login`,
        handler: async (ctx) => {
          const user = customUsers.unawaited;
          ctx.body = { jwt: jwtService.issue({ id: user.id }), user: { id: user.id } };
        },
        config: { auth: false },
      },
    ]);

    // Synthetic OAuth provider: the grant response is injected; nothing leaves the host.
    app
      .plugin(UP)
      .service('providers-registry')
      .add('synthetic', {
        enabled: true,
        icon: '',
        grantConfig: {},
        async authCallback() {
          return { username: 'synthetic-oauth', email: 'oauth@example.test' };
        },
      });
    const grantStore = app.store({ type: 'plugin', name: UP, key: 'grant' });
    await grantStore.set({ value: { ...(await grantStore.get()), synthetic: { enabled: true } } });
    app.server.use(async (ctx, next) => {
      if (ctx.path === `${apiPrefix}/auth/synthetic/callback` && ctx.session) {
        ctx.session.grant = { response: { access_token: 'synthetic-provider-token' } };
      }
      return next();
    });

    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const port = app.server.httpServer.address().port;
    allowedPorts.add(port);
    assert.throws(() => net.connect({ host: '192.0.2.1', port }), /Outbound network disabled/);

    const request = async (method, url, { token, body, raw } = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${url}`, {
        method,
        redirect: 'manual',
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0 Safari/537.36',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: raw ? body : JSON.stringify(body) } : {}),
      });
      const text = await response.text();
      let json;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: response.status, body: json };
    };
    const api = (p) => `${apiPrefix}${p}`;

    const sidecarFor = (nativeSessionId) =>
      app.db
        .query('plugin::magic-sessionmanager.session')
        .findOne({ where: { nativeSessionId }, select: ['id', 'isActive'] });
    const sessionOfRefresh = async (token) =>
      (await native().validateRefreshToken(token)).sessionId;
    const sessionOfAccess = (token) => native().validateAccessToken(token).payload?.sessionId;
    const nativeCount = () =>
      app.db.query('admin::session').count({ where: { origin: UP, status: 'active' } });
    const assertLinked = async (nativeSessionId, label) => {
      assert.ok(nativeSessionId, `${label}: native session id`);
      const sidecar = await sidecarFor(nativeSessionId);
      assert.ok(sidecar, `${label}: linked to a Magic session`);
      assert.equal(sidecar.isActive, true, `${label}: sidecar active`);
    };

    const store = await app
      .store({ type: 'plugin', name: 'magic-sessionmanager' })
      .get({ key: 'nativeTracking' });
    const trackingSince = store?.since ? new Date(store.since) : null;
    await t.test('bootstrap stores the tracking start date', () => {
      assert.ok(trackingSince && Number.isFinite(trackingSince.getTime()));
    });

    // Legacy rows: created 20 days before tracking started, plus an admin
    // panel session that no route may count or end.
    const legacyUser = await createUser('legacy');
    const backdate = async (sessionId, ms) => {
      const meta = app.db.metadata.get('admin::session');
      await app.db
        .connection(meta.tableName)
        .where(meta.attributes.sessionId.columnName || 'session_id', sessionId)
        .update({ [meta.attributes.createdAt.columnName]: new Date(Date.now() - ms) });
    };
    const legacy = [];
    for (let index = 0; index < 2; index += 1) {
      const refresh = await native().generateRefreshToken(
        String(legacyUser.id),
        `legacy-${index}`,
        {
          type: 'refresh',
          metadata: { deviceName: 'Safari on iOS', loginAt: new Date().toISOString() },
        }
      );
      legacy.push(refresh.sessionId);
      await backdate(refresh.sessionId, 20 * 24 * 60 * 60 * 1000);
    }
    const adminRoleRow = await app.db
      .query('admin::role')
      .findOne({ where: { code: 'strapi-super-admin' } });
    const editorRole = await app.db
      .query('admin::role')
      .findOne({ where: { code: 'strapi-editor' } });
    const createAdminToken = async (roleId, suffix) => {
      const admin = await app.db.query('admin::user').create({
        data: {
          email: `${suffix}@example.test`,
          firstname: 'Synthetic',
          lastname: 'Admin',
          isActive: true,
          roles: [roleId],
        },
      });
      const refresh = await app
        .sessionManager('admin')
        .generateRefreshToken(String(admin.id), undefined, { type: 'session' });
      return {
        token: (await app.sessionManager('admin').generateAccessToken(refresh.token)).token,
        sessionId: refresh.sessionId,
      };
    };
    const superAdmin = await createAdminToken(adminRoleRow.id, 'super-admin');
    const editor = await createAdminToken(editorRole.id, 'editor');
    await backdate(superAdmin.sessionId, 20 * 24 * 60 * 60 * 1000);

    await t.test('local login is linked', async () => {
      const user = await createUser('local');
      const result = await request('POST', api('/auth/local'), {
        body: { identifier: user.email, password },
      });
      assert.equal(result.status, 200);
      await assertLinked(await sessionOfRefresh(result.body.refreshToken), 'local login');
    });

    let refreshToken;
    await t.test('register is linked', async () => {
      const result = await request('POST', api('/auth/local/register'), {
        body: { username: 'synthetic-register', email: 'register@example.test', password },
      });
      assert.equal(result.status, 200);
      refreshToken = result.body.refreshToken;
      await assertLinked(await sessionOfRefresh(refreshToken), 'register');
    });

    await t.test('refresh rotation links the child and retires the parent', async () => {
      const parent = await sessionOfRefresh(refreshToken);
      const result = await request('POST', api('/auth/refresh'), { body: { refreshToken } });
      assert.equal(result.status, 200);
      const child = await sessionOfRefresh(result.body.refreshToken);
      assert.notEqual(child, parent);
      await assertLinked(child, 'refresh child');
      const parentRow = await app.db
        .query('admin::session')
        .findOne({ where: { sessionId: parent } });
      assert.equal(parentRow.status, 'rotated');
    });

    await t.test('change password is linked to the reissued session', async () => {
      const user = await createUser('change');
      const login = await request('POST', api('/auth/local'), {
        body: { identifier: user.email, password },
      });
      const next = `${password}x`;
      const result = await request('POST', api('/auth/change-password'), {
        token: login.body.jwt,
        body: { currentPassword: password, password: next, passwordConfirmation: next },
      });
      assert.equal(result.status, 200);
      await assertLinked(await sessionOfRefresh(result.body.refreshToken), 'change password');
    });

    await t.test('password reset is linked to the reissued session', async () => {
      const user = await createUser('reset');
      await app.db
        .query('plugin::users-permissions.user')
        .update({ where: { id: user.id }, data: { resetPasswordToken: 'synthetic-reset-code' } });
      const next = `${password}y`;
      const result = await request('POST', api('/auth/reset-password'), {
        body: { code: 'synthetic-reset-code', password: next, passwordConfirmation: next },
      });
      assert.equal(result.status, 200);
      await assertLinked(await sessionOfRefresh(result.body.refreshToken), 'password reset');
    });

    await t.test('provider callback is linked', async () => {
      const result = await request('GET', api('/auth/synthetic/callback'));
      assert.equal(result.status, 200, JSON.stringify(result.body?.error || null));
      await assertLinked(await sessionOfRefresh(result.body.refreshToken), 'provider callback');
    });

    await t.test('REST email confirmation redirects and creates no session', async () => {
      await createUser('confirm-rest', {
        confirmed: false,
        confirmationToken: 'synthetic-confirm-rest',
      });
      const before = await nativeCount();
      const result = await request(
        'GET',
        api('/auth/email-confirmation?confirmation=synthetic-confirm-rest')
      );
      assert.equal(result.status, 302);
      assert.equal(await nativeCount(), before);
    });

    await t.test(
      'a custom route returning Strapi tokens is linked (unintercepted path)',
      async () => {
        customUsers.refresh = await createUser('custom-refresh');
        const result = await request('POST', api('/custom/login-refresh'), { body: {} });
        assert.equal(result.status, 200);
        await assertLinked(sessionOfAccess(result.body.jwt), 'custom refresh route');
      }
    );

    await t.test('a custom route using refresh-mode jwt.issue() is linked', async () => {
      customUsers.issue = await createUser('custom-issue');
      const result = await request('POST', api('/custom/login-issue'), { body: {} });
      assert.equal(result.status, 200);
      await assertLinked(sessionOfAccess(result.body.jwt), 'jwt.issue route');
    });

    await t.test(
      'an intercepted route with an unawaited jwt.issue() sends and links the token',
      async () => {
        customUsers.unawaited = await createUser('unawaited');
        const result = await request('POST', api('/magic-link/login'), { body: {} });
        assert.equal(result.status, 200);
        assert.equal(typeof result.body.jwt, 'string', 'the client receives a real token');
        await assertLinked(sessionOfAccess(result.body.jwt), 'unawaited jwt.issue');
      }
    );

    if (hasGraphql) {
      await t.test('GraphQL login is linked', async () => {
        const user = await createUser('graphql');
        const result = await request('POST', '/graphql', {
          body: {
            query: 'mutation($input: UsersPermissionsLoginInput!) { login(input: $input) { jwt } }',
            variables: { input: { identifier: user.email, password } },
          },
        });
        assert.equal(result.status, 200, JSON.stringify(result.body?.errors || null));
        await assertLinked(sessionOfAccess(result.body.data.login.jwt), 'GraphQL login');
      });

      await t.test('GraphQL email confirmation is linked', async () => {
        await createUser('confirm-gql', {
          confirmed: false,
          confirmationToken: 'synthetic-confirm-gql',
        });
        const result = await request('POST', '/graphql', {
          body: {
            query: 'mutation { emailConfirmation(confirmation: "synthetic-confirm-gql") { jwt } }',
          },
        });
        assert.equal(result.status, 200, JSON.stringify(result.body?.errors || null));
        await assertLinked(
          sessionOfAccess(result.body.data.emailConfirmation.jwt),
          'GraphQL email confirmation'
        );
      });
    }

    let outOfBandSessionId;
    await t.test('a token delivered out of band cannot be linked and stays untracked', async () => {
      customUsers.outOfBand = await createUser('out-of-band');
      const before = await nativeCount();
      const result = await request('POST', api('/custom/send-login-link'), { body: {} });
      assert.equal(result.status, 200);
      assert.equal(await nativeCount(), before + 1);
      const rows = await app.db.query('admin::session').findMany({
        where: { userId: String(customUsers.outOfBand.id), origin: UP },
        select: ['sessionId'],
      });
      outOfBandSessionId = rows[0].sessionId;
      assert.equal(await sidecarFor(outOfBandSessionId), null);
    });

    await t.test('stats and summary report counts only, split by tracking start', async () => {
      const stats = await request('GET', '/magic-sessionmanager/sessions/stats', {
        token: superAdmin.token,
      });
      assert.equal(stats.status, 200);
      assert.equal(stats.body.data.nativeOnly, 3, 'two legacy rows and the out-of-band one');
      assert.equal(stats.body.data.nativeOnlyAfterTracking, 1);

      const summary = await request('GET', '/magic-sessionmanager/sessions/native-only/summary', {
        token: superAdmin.token,
      });
      assert.equal(summary.status, 200);
      const data = summary.body.data;
      assert.equal(data.total, 3);
      assert.equal(data.beforeTracking, 2);
      assert.equal(data.afterTracking, 1);
      assert.equal(data.trackingSince, trackingSince?.toISOString());
      assert.deepEqual(data.bySource, { signIn: 2, passwordChange: 0, tokenOnly: 1 });
      assert.deepEqual(data.byDevice, { desktop: 0, mobile: 2, unknown: 1 });
      assert.equal(data.expiring.within30Days, 3);
      const serialized = JSON.stringify(summary.body);
      for (const forbidden of [...legacy, outOfBandSessionId, 'example.test', 'Safari']) {
        assert.ok(!serialized.includes(forbidden), 'no identifiers or user data in the summary');
      }
    });

    await t.test('summary and end routes deny anonymous, editors and content users', async () => {
      const contentToken = (
        await request('POST', api('/auth/local'), {
          body: { identifier: 'local@example.test', password },
        })
      ).body.jwt;
      for (const [method, url] of [
        ['GET', '/magic-sessionmanager/sessions/native-only/summary'],
        ['POST', '/magic-sessionmanager/sessions/native-only/end'],
      ]) {
        for (const [kind, token] of [
          ['anonymous', null],
          ['editor', editor.token],
          ['content-user', contentToken],
        ]) {
          const result = await request(method, url, {
            token,
            body: method === 'POST' ? {} : undefined,
          });
          assert.ok(
            [401, 403].includes(result.status),
            `${method} ${url}: ${kind} got ${result.status}`
          );
        }
      }
      const withQuery = await request(
        'GET',
        '/magic-sessionmanager/sessions/native-only/summary?userId=1',
        { token: superAdmin.token }
      );
      assert.equal(withQuery.status, 400);
      const withBody = await request('POST', '/magic-sessionmanager/sessions/native-only/end', {
        token: superAdmin.token,
        body: { userId: 1 },
      });
      assert.equal(withBody.status, 400);
      assert.equal((await nativeCount()) >= 3, true, 'denied calls ended nothing');
    });

    await t.test(
      'ending untracked sessions spares admin, linked and brand-new sessions',
      async () => {
        const linkedBefore = await app.db
          .query('plugin::magic-sessionmanager.session')
          .count({ where: { isActive: true } });
        const first = await request('POST', '/magic-sessionmanager/sessions/native-only/end', {
          token: superAdmin.token,
          body: {},
        });
        assert.equal(first.status, 200);
        assert.equal(first.body.data.ended, 2, 'the two legacy rows');
        assert.equal(
          first.body.data.remaining,
          1,
          'the out-of-band row is younger than two minutes'
        );
        for (const id of legacy) {
          assert.equal(
            await app.db.query('admin::session').findOne({ where: { sessionId: id } }),
            null
          );
        }
        assert.ok(
          await app.db
            .query('admin::session')
            .findOne({ where: { sessionId: superAdmin.sessionId } }),
          'the admin panel session is untouched'
        );
        const me = await request('GET', '/magic-sessionmanager/sessions/stats', {
          token: superAdmin.token,
        });
        assert.equal(me.status, 200, 'the administrator is still signed in');
        assert.equal(
          await app.db
            .query('plugin::magic-sessionmanager.session')
            .count({ where: { isActive: true } }),
          linkedBefore,
          'linked sessions are untouched'
        );

        await backdate(outOfBandSessionId, 10 * 60 * 1000);
        const second = await request('POST', '/magic-sessionmanager/sessions/native-only/end', {
          token: superAdmin.token,
          body: {},
        });
        assert.equal(second.status, 200);
        assert.deepEqual(
          { ended: second.body.data.ended, remaining: second.body.data.remaining },
          { ended: 1, remaining: 0 }
        );
        const summary = await request('GET', '/magic-sessionmanager/sessions/native-only/summary', {
          token: superAdmin.token,
        });
        assert.equal(summary.body.data.total, 0);
      }
    );
  }
);
