'use strict';

// Real Strapi 5 HTTP boundary for the findings of the second security review
// (4.22.1), on a host with the GraphQL plugin:
//
// - H1: every GraphQL mutation is refused while impersonating (plain, alias,
//   fragment, persisted query by hash, batched request), queries still work,
//   the host's own Apollo plugins are kept;
// - H2: client-set proxy headers never choose the lockout address, with a
//   trusted proxy list and (Strapi 5.52+) with Koa's proxy settings
//   (`proxy.koa`, `maxIpsCount: 1`); trustedProxies, maxFailedLogins and the
//   email templates are protected settings;
// - M1: every path spelling of POST /auth/local and the GraphQL `login`
//   mutation are counted and refused by the lockout;
// - L2: a sign-in refused by the session limit is not a failed guess;
// - M2: a sign-in to the attacker's own account does not reset the address;
// - L1: trusted addresses and recognised devices pass an account lock; one
//   lock email per window;
// - L3: the user's data export shows a fixed text for impersonations.
//
// Synthetic accounts and random secrets; outbound network blocked; the
// email plugin is an in-memory fake. Runs on SQLite by default, on
// PostgreSQL with SESSION_HTTP_DB=postgres and MSM_TEST_PG_URL, in legacy
// mode by default and in refresh mode with SESSION_HTTP_MODE=refresh.
//
//   SESSION_HTTP_STRAPI_NODE_MODULES=$PWD/node_modules SESSION_HTTP_REQUIRED=1 \
//     node --test tests/isolated-security-review2-http.test.js
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
  '@strapi/plugin-graphql',
  dbKind === 'postgres' ? 'pg' : 'better-sqlite3',
]);
const pgUrl = process.env.MSM_TEST_PG_URL || '';
const pgMissing = dbKind === 'postgres' && !pgUrl;

const EVENT_UID = 'plugin::magic-sessionmanager.security-event';
const USER_UID = 'plugin::users-permissions.user';

/**
 * Whether the installed Strapi passes `server.proxy.maxIpsCount` to Koa
 * (5.52.0 and later).
 *
 * @param {string} modules Host node_modules.
 * @returns {boolean}
 */
function supportsMaxIpsCount(modules) {
  try {
    const { version } = JSON.parse(
      fs.readFileSync(path.join(modules, '@strapi/core/package.json'), 'utf8')
    );
    const [major, minor] = version.split('.').map(Number);
    return major > 5 || (major === 5 && minor >= 52);
  } catch {
    return false;
  }
}

test(
  `isolated Strapi security review 2 over HTTP (${dbKind}, ${mode})`,
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionmanager-review2-'));
    const plugin = path.join(root, 'plugin');
    for (const dir of ['config', 'plugin', 'src', 'public', 'public/uploads']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    fs.symlinkSync(hostModules, path.join(root, 'node_modules'), 'dir');
    const write = (filename, contents) => fs.writeFileSync(path.join(root, filename), contents);
    write(
      'package.json',
      JSON.stringify({
        name: 'isolated-sessionmanager-review2',
        version: '0.0.0',
        private: true,
        dependencies: { '@strapi/plugin-users-permissions': '*', '@strapi/plugin-graphql': '*' },
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

    const schema = `msm_review2_${crypto.randomBytes(4).toString('hex')}`;
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
    // One trusted proxy in front of Strapi: Koa takes the right-most
    // X-Forwarded-For entry (Strapi 5.52+ passes maxIpsCount to Koa).
    write(
      'config/server.js',
      `module.exports = { host: '127.0.0.1', port: 1337, proxy: { koa: true, maxIpsCount: 1 }, app: { keys: [process.env.TEST_HTTP_SECRET_A, process.env.TEST_HTTP_SECRET_B] }, logger: { updates: { enabled: false } } };\n`
    );
    write(
      'config/admin.js',
      `module.exports = { auth: { secret: process.env.TEST_HTTP_SECRET_A }, apiToken: { salt: process.env.TEST_HTTP_SECRET_B }, secrets: { encryptionKey: process.env.TEST_HTTP_SECRET_B }, transfer: { token: { salt: process.env.TEST_HTTP_SECRET_A } }, rateLimit: { enabled: false } };\n`
    );
    // The host keeps one Apollo plugin of its own (it marks every response),
    // to prove the plugin's guard is added next to it, not instead of it.
    write(
      'config/plugins.js',
      `module.exports = {
  'users-permissions': { enabled: true, config: { jwtSecret: process.env.TEST_HTTP_SECRET_B, jwtManagement: ${JSON.stringify(mode)}, ratelimit: { enabled: false } } },
  graphql: { enabled: true, config: { endpoint: '/graphql', shadowCRUD: true, landingPage: false, depthLimit: 10, maxLimit: 100, apolloServer: { allowBatchedHttpRequests: true, plugins: [{ async requestDidStart() { return { async willSendResponse({ response }) { response.http.headers.set('x-host-apollo-plugin', 'kept'); } }; } }] } } },
  'magic-sessionmanager': { enabled: true, resolve: ${JSON.stringify(plugin)}, config: { enableGeolocation: false, geoIpProvider: 'disabled', enableWebhooks: false, enableEmailAlerts: false } },
};\n`
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

    const UA = 'Mozilla/5.0 (X11; Linux x86_64) Firefox/133.0';
    /**
     * Calls the test server. `ip` becomes the X-Forwarded-For value (the
     * proxy's view); `headers` adds what a client could send itself.
     */
    const request = async (method, url, { token, body, ip, headers = {}, raw } = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${url}`, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(ip ? { 'x-forwarded-for': ip } : {}),
          'user-agent': UA,
          ...headers,
        },
        ...(body !== undefined ? { body: raw ?? JSON.stringify(body) } : {}),
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
    const gql = (query, variables, options = {}) =>
      request('POST', '/graphql', { ...options, body: { query, variables, ...options.extra } });
    const errorCode = (result) => result.body?.errors?.[0]?.extensions?.code;

    // Admins.
    const adminRoles = app.db.query('admin::role');
    const superRole = await adminRoles.findOne({ where: { code: 'strapi-super-admin' } });
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
    const superAdmin = await createAdmin(superRole.id, 'review2-super');
    const viewerRole = await adminRoles.create({
      data: { name: 'Synthetic review2 viewer', code: 'review2-viewer' },
    });
    await app.db.query('admin::permission').create({
      data: { action: 'plugin::magic-sessionmanager.access', conditions: [], role: viewerRole.id },
    });
    const viewer = await createAdmin(viewerRole.id, 'review2-viewer');
    const settings = (body, token = superAdmin.token) =>
      request('PUT', '/magic-sessionmanager/settings', { token, body });

    // App users. Authenticated users may read themselves and update a user
    // (a host that lets users edit their profile, as in the review).
    const upRoles = app.db.query('plugin::users-permissions.role');
    const authenticated = await upRoles.findOne({ where: { type: 'authenticated' } });
    for (const action of [
      'plugin::users-permissions.user.me',
      'plugin::users-permissions.user.update',
      'plugin::magic-sessionmanager.self-service.exportOwnData',
    ]) {
      await app.db
        .query('plugin::users-permissions.permission')
        .create({ data: { action, role: authenticated.id } });
    }
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
    const signIn = (
      name,
      { ip, password, path: url = '/api/auth/local', headers, deviceId } = {}
    ) =>
      request('POST', url, {
        ip,
        headers,
        body: {
          identifier: `${name}@example.test`,
          password: password ?? passwords.get(name),
          ...(deviceId ? { deviceId } : {}),
        },
      });
    const gqlLogin = (name, { ip, password } = {}) =>
      gql(
        'mutation L($i: String!, $p: String!) { login(input: { identifier: $i, password: $p }) { jwt } }',
        { i: `${name}@example.test`, p: password ?? passwords.get(name) },
        { ip }
      );
    const unlockAll = async () => {
      const list = await request('GET', '/magic-sessionmanager/lockouts', {
        token: superAdmin.token,
      });
      for (const lock of list.body?.data || []) {
        await request('POST', '/magic-sessionmanager/lockouts/unlock', {
          token: superAdmin.token,
          body: { id: lock.id },
        });
      }
    };
    const flushedEvents = async (where = {}) => {
      await app.plugin('magic-sessionmanager').service('security-log').flush();
      return app.db.query(EVENT_UID).findMany({ where, orderBy: { id: 'asc' } });
    };

    const anna = await createUser('anna');
    await createUser('bert');
    await createUser('cleo');
    await createUser('dora');
    await createUser('owner');
    await createUser('attacker');

    // Lockout tests run with the loopback test client listed as the proxy.
    const base = await settings({
      impersonationEnabled: true,
      maxFailedLogins: 3,
      lockoutWindowMinutes: 15,
      lockoutDurationMinutes: 15,
      trustedProxies: ['127.0.0.1/32', '::1/128'],
    });
    assert.equal(base.status, 200, JSON.stringify(base.body?.error || null));

    await t.test('H1: every GraphQL mutation is refused while impersonating', async () => {
      const started = await request(
        'POST',
        `/magic-sessionmanager/impersonation/users/${anna.documentId}`,
        {
          token: superAdmin.token,
          body: { reason: 'Ticket 4711: profile', durationMinutes: 15 },
        }
      );
      assert.equal(started.status, 201, JSON.stringify(started.body?.error || null));
      const impersonation = started.body.data.handoff.jwt;
      const own = (await signIn('anna', { ip: '192.0.2.1' })).body.jwt;
      assert.ok(own, 'the user signs in themselves');
      const id = String(anna.id);
      const email = (tag) => `anna-${tag}-${crypto.randomBytes(3).toString('hex')}@example.test`;
      const plain =
        'mutation M($id: ID!, $email: String) { updateUsersPermissionsUser(id: $id, data: { email: $email }) { data { email } } }';
      const alias =
        'mutation M($id: ID!, $email: String) { renamed: updateUsersPermissionsUser(id: $id, data: { email: $email }) { data { email } } }';
      const fragment =
        'mutation M($id: ID!, $email: String) { updateUsersPermissionsUser(id: $id, data: { email: $email }) { ...F } } fragment F on UsersPermissionsUserEntityResponse { data { email } }';

      // Control: the user's own token may run each form (so a refusal below
      // is the impersonation rule, not a schema or permission error).
      for (const query of [plain, alias, fragment]) {
        const control = await gql(query, { id, email: email('own') }, { token: own });
        assert.equal(control.status, 200, JSON.stringify(control.body));
        assert.equal(control.body.errors, undefined, JSON.stringify(control.body.errors));
      }
      const emailNow = async () =>
        (await app.db.query(USER_UID).findOne({ where: { id: anna.id } })).email;

      for (const [label, query] of [
        ['plain', plain],
        ['alias', alias],
        ['fragment', fragment],
      ]) {
        const refused = await gql(query, { id, email: email(label) }, { token: impersonation });
        assert.equal(refused.status, 403, `${label}: ${JSON.stringify(refused.body)}`);
        assert.equal(errorCode(refused), 'FORBIDDEN', label);
        assert.equal(
          refused.body.errors[0].extensions.error.details.reason,
          'impersonation-mutation'
        );
        assert.equal(refused.headers.get('x-magic-impersonation'), 'true');
        assert.equal(refused.headers.get('x-host-apollo-plugin'), 'kept');
      }

      // Persisted query: registered without any token, run by hash only.
      const sha256Hash = crypto.createHash('sha256').update(plain).digest('hex');
      const persisted = { persistedQuery: { version: 1, sha256Hash } };
      const register = await gql(
        plain,
        { id, email: email('apq-own') },
        {
          token: own,
          extra: { extensions: persisted },
        }
      );
      assert.equal(register.body.errors, undefined, JSON.stringify(register.body.errors));
      // Baseline after the user's own (allowed) runs; nothing below may change it.
      const before = await emailNow();
      const byHash = await request('POST', '/graphql', {
        token: impersonation,
        body: { variables: { id, email: email('apq') }, extensions: persisted },
      });
      assert.equal(byHash.status, 403, JSON.stringify(byHash.body));
      assert.equal(errorCode(byHash), 'FORBIDDEN');

      // Batched request: the query runs, the mutation is refused.
      const batch = await request('POST', '/graphql', {
        token: impersonation,
        body: [
          { query: '{ me { id } }' },
          { query: plain, variables: { id, email: email('batch') } },
        ],
      });
      assert.ok(Array.isArray(batch.body), JSON.stringify(batch.body));
      assert.equal(String(batch.body[0].data.me.id), id);
      assert.equal(batch.body[1].errors[0].extensions.code, 'FORBIDDEN');

      // The login mutation is a mutation too; queries stay allowed.
      const login = await gql(
        'mutation { login(input: { identifier: "anna@example.test", password: "x" }) { jwt } }',
        {},
        { token: impersonation }
      );
      assert.equal(errorCode(login), 'FORBIDDEN');
      const me = await gql('{ me { id email } }', {}, { token: impersonation });
      assert.equal(me.status, 200);
      assert.equal(String(me.body.data.me.id), id);

      assert.equal(await emailNow(), before, 'no impersonated mutation changed the account');
      // The control runs above changed the email; later tests sign in with it.
      await app.db
        .query(USER_UID)
        .update({ where: { id: anna.id }, data: { email: 'anna@example.test' } });
      const refusals = await flushedEvents({ event: 'impersonation.refused' });
      assert.ok(
        refusals.some((event) => event.meta?.refusal === 'call-mutation'),
        JSON.stringify(refusals.map((event) => event.meta))
      );
      await request(
        'POST',
        `/magic-sessionmanager/impersonation/${started.body.data.impersonation.id}/end`,
        { token: superAdmin.token }
      );
    });

    await t.test('M1: every path spelling and GraphQL login are refused while locked', async () => {
      await unlockAll();
      const ip = '198.51.100.10';
      for (let i = 0; i < 3; i++) {
        const wrong = await signIn('bert', { ip, password: `wrong-${i}` });
        assert.equal(wrong.status, 400);
      }
      for (const url of [
        '/api/auth/local',
        '/api/auth/local/',
        '/API/auth/local',
        '/api/Auth/Local',
      ]) {
        const locked = await signIn('bert', { ip, path: url });
        assert.equal(locked.status, 429, url);
        assert.equal(locked.body.jwt, undefined, url);
        // The same spelling works from another address (it is routed).
        const elsewhere = await signIn('bert', { ip: '198.51.100.99', path: url });
        assert.equal(elsewhere.status, 200, `${url} elsewhere`);
      }
      const graphql = await gqlLogin('bert', { ip });
      // The error name, not the code: when the host and this source tree load
      // different @strapi/utils copies (the 5.50 floor job), Strapi's GraphQL
      // formatter cannot map the class to STRAPI_RATE_LIMIT_ERROR.
      assert.equal(
        graphql.body?.errors?.[0]?.extensions?.error?.name,
        'RateLimitError',
        JSON.stringify(graphql.body)
      );
      assert.equal(graphql.body.data?.login?.jwt, undefined);
    });

    await t.test('M1: guesses through other spellings and GraphQL are counted', async () => {
      await unlockAll();
      const ip = '198.51.100.11';
      assert.equal(
        (await signIn('bert', { ip, path: '/api/auth/local/', password: 'x1' })).status,
        400
      );
      assert.equal(
        (await signIn('bert', { ip, path: '/API/auth/local', password: 'x2' })).status,
        400
      );
      const graphql = await gqlLogin('bert', { ip, password: 'x3' });
      assert.equal(errorCode(graphql), 'BAD_USER_INPUT', JSON.stringify(graphql.body));
      const locked = await signIn('bert', { ip });
      assert.equal(locked.status, 429, 'three guesses in three spellings lock the address');
    });

    await t.test('L2: a sign-in refused by the session limit is not a failed guess', async () => {
      await unlockAll();
      assert.equal(
        (await settings({ maxSessionsPerUser: 1, sessionLimitPolicy: 'refuse' })).status,
        200
      );
      try {
        const ip = '198.51.100.12';
        assert.equal((await signIn('cleo', { ip })).status, 200);
        for (let i = 0; i < 3; i++) {
          const refused = await signIn('cleo', { ip });
          assert.equal(refused.status, 403);
          assert.equal(refused.body.error.details.code, 'SESSION_LIMIT_REACHED');
        }
        const wrong = await signIn('cleo', { ip, password: 'wrong-1' });
        assert.equal(wrong.status, 400, 'three refusals did not lock the address');
      } finally {
        await settings({ maxSessionsPerUser: 0 });
      }
    });

    await t.test('M2: signing in to an own account does not reset the address', async () => {
      await unlockAll();
      const ip = '198.51.100.13';
      const statuses = [];
      for (let round = 0; round < 3; round++) {
        statuses.push((await signIn('dora', { ip, password: `guess-${round}-a` })).status);
        statuses.push((await signIn('owner', { ip, password: `guess-${round}-b` })).status);
        statuses.push((await signIn('attacker', { ip })).status);
      }
      assert.ok(statuses.includes(429), `the address gets locked: ${statuses.join(' ')}`);
      assert.equal((await signIn('attacker', { ip })).status, 429);
    });

    await t.test('H2: client-set headers never choose the lockout address', async () => {
      await unlockAll();
      // Listed proxy (the loopback test client): the client is the right-most
      // X-Forwarded-For entry that is not a listed proxy.
      const statuses = [];
      for (let i = 0; i < 4; i++) {
        statuses.push(
          (
            await signIn('bert', {
              password: `spoof-${i}`,
              ip: `198.51.100.${50 + i}, 203.0.113.50`,
              headers: {
                'cf-connecting-ip': `198.51.100.${60 + i}`,
                'true-client-ip': `198.51.100.${70 + i}`,
                'x-real-ip': `198.51.100.${80 + i}`,
              },
            })
          ).status
        );
      }
      assert.deepEqual(statuses, [400, 400, 400, 429]);
    });

    await t.test(
      "H2: with Strapi's proxy settings (maxIpsCount 1) headers never choose the address",
      { skip: !supportsMaxIpsCount(hostModules) && 'server.proxy.maxIpsCount needs Strapi 5.52+' },
      async () => {
        await unlockAll();
        // The legacy switch is accepted and means "use Strapi's settings".
        for (const trustedProxies of [[], true]) {
          await unlockAll();
          const saved = await settings({ trustedProxies });
          assert.equal(saved.status, 200);
          assert.deepEqual(saved.body.settings.trustedProxies, []);
          const statuses = [];
          for (let i = 0; i < 4; i++) {
            statuses.push(
              (
                await signIn('bert', {
                  password: `koa-${i}`,
                  ip: `198.51.100.${90 + i}, 203.0.113.60`,
                  headers: {
                    'cf-connecting-ip': `198.51.100.${100 + i}`,
                    'true-client-ip': `198.51.100.${110 + i}`,
                    'x-real-ip': `198.51.100.${120 + i}`,
                  },
                })
              ).status
            );
          }
          assert.deepEqual(statuses, [400, 400, 400, 429], JSON.stringify(trustedProxies));
        }
        await settings({ trustedProxies: ['127.0.0.1/32', '::1/128'] });
      }
    );

    await t.test('H2: proxy list, IP threshold and email texts need settings.update', async () => {
      for (const body of [
        { trustedProxies: ['10.0.0.0/8'] },
        { maxFailedLogins: 50 },
        { emailTemplates: { newLocation: { subject: 'Verify your account here' } } },
      ]) {
        const denied = await settings(body, viewer.token);
        assert.equal(denied.status, 403, JSON.stringify(body));
        assert.equal(denied.body.error.details.reason, 'settings-update-permission');
      }
      const current = await request('GET', '/magic-sessionmanager/settings', {
        token: viewer.token,
      });
      const unchanged = await settings(
        { ...current.body.settings, inactivityTimeout: 17 },
        viewer.token
      );
      assert.equal(unchanged.status, 200, 'the whole form with unchanged values still saves');
    });

    await t.test('L1: trusted addresses and known devices pass an account lock', async () => {
      await unlockAll();
      assert.equal(
        (
          await settings({
            maxFailedLoginsPerAccount: 3,
            lockoutTrustedAddresses: ['192.0.2.0/24'],
            lockoutNotifyUser: true,
          })
        ).status,
        200
      );
      try {
        // The owner's app signs in once with its device id.
        const known = await signIn('owner', { ip: '198.51.100.30', deviceId: 'owner-phone-1' });
        assert.equal(known.status, 200);
        const lockMails = () => sentMail.filter((mail) => mail.to === 'owner@example.test').length;
        const mailsBefore = lockMails();
        // A stranger locks the account from three addresses.
        for (let i = 0; i < 3; i++) {
          const wrong = await signIn('owner', { ip: `203.0.113.${i + 1}`, password: 'wrong' });
          assert.equal(wrong.status, 400);
        }
        const stranger = await signIn('owner', { ip: '203.0.113.9' });
        assert.equal(stranger.status, 429, 'the account is locked for others');
        assert.equal(
          (await signIn('owner', { ip: '192.0.2.10' })).status,
          200,
          'the office network (trusted address) still signs in'
        );
        assert.equal(
          (await signIn('owner', { ip: '198.51.100.31', deviceId: 'owner-phone-1' })).status,
          200,
          'the known device still signs in'
        );
        assert.equal(
          (await signIn('owner', { ip: '198.51.100.32', deviceId: 'guessed-device' })).status,
          429,
          'an unknown device id does not help'
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert.equal(lockMails() - mailsBefore, 1, 'one lock email');
        // Locked again within the window: no second email.
        await unlockAll();
        for (let i = 0; i < 3; i++) {
          await signIn('owner', { ip: `203.0.113.${i + 20}`, password: 'wrong' });
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert.equal(lockMails() - mailsBefore, 1, 'still one lock email in this window');
      } finally {
        await settings({ maxFailedLoginsPerAccount: 0, lockoutTrustedAddresses: [] });
        await unlockAll();
      }
    });

    await t.test('L3: the data export shows a fixed text for an impersonation', async () => {
      const started = await request(
        'POST',
        `/magic-sessionmanager/impersonation/users/${anna.documentId}`,
        {
          token: superAdmin.token,
          body: { reason: 'Internal note: suspected fraud', durationMinutes: 30 },
        }
      );
      assert.equal(started.status, 201);
      await request(
        'POST',
        `/magic-sessionmanager/impersonation/${started.body.data.impersonation.id}/end`,
        { token: superAdmin.token }
      );
      await flushedEvents();
      const signedIn = await signIn('anna', { ip: '192.0.2.2' });
      assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));
      const own = signedIn.body.jwt;
      const exported = await request('GET', '/api/magic-sessionmanager/my-data', { token: own });
      assert.equal(exported.status, 200, JSON.stringify(exported.body));
      const text = JSON.stringify(exported.body);
      assert.ok(!text.includes('suspected fraud'), 'the reason stays internal');
      assert.ok(!text.includes('startedBy'), 'the admin id is not exported');
      const startedEvents = exported.body.securityEvents.filter(
        (event) => event.event === 'impersonation.started'
      );
      assert.ok(startedEvents.length >= 1);
      assert.deepEqual(startedEvents[0].meta, {
        description: 'An administrator opened your account',
        durationMinutes: 30,
      });
    });
  }
);
