'use strict';

// Real Strapi 5 HTTP boundary for the sign-in and session policies (4.17):
// account and IP lockout with configurable window and duration, trusted
// addresses, the "Locked now" list with Unlock (RBAC, logged), the lockout
// email, the concurrent session limit (end oldest / refuse), per-role rules
// and ending other sessions after a password change. Synthetic accounts and
// random secrets; outbound network blocked; the email plugin is replaced by
// an in-memory fake.
//
// Runs on SQLite by default, on PostgreSQL with SESSION_HTTP_DB=postgres and
// MSM_TEST_PG_URL (a throwaway schema), in legacy mode by default and in
// refresh mode with SESSION_HTTP_MODE=refresh.
//
//   SESSION_HTTP_STRAPI_NODE_MODULES=$PWD/node_modules SESSION_HTTP_REQUIRED=1 \
//     node --test tests/isolated-policies-http.test.js
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

const SESSION_UID = 'plugin::magic-sessionmanager.session';
const EVENT_UID = 'plugin::magic-sessionmanager.security-event';
const USER_UID = 'plugin::users-permissions.user';

test(
  `isolated Strapi sign-in and session policies over HTTP (${dbKind}, ${mode})`,
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionmanager-policies-'));
    const plugin = path.join(root, 'plugin');
    for (const dir of ['config', 'plugin', 'src', 'public', 'public/uploads']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    fs.symlinkSync(hostModules, path.join(root, 'node_modules'), 'dir');
    const write = (filename, contents) => fs.writeFileSync(path.join(root, filename), contents);
    write(
      'package.json',
      JSON.stringify({
        name: 'isolated-sessionmanager-policies',
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

    const schema = `msm_policies_${crypto.randomBytes(4).toString('hex')}`;
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
      `module.exports = { auth: { secret: process.env.TEST_HTTP_SECRET_A }, apiToken: { salt: process.env.TEST_HTTP_SECRET_B }, transfer: { token: { salt: process.env.TEST_HTTP_SECRET_A } }, rateLimit: { enabled: false } };\n`
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
    const superAdmin = await createAdmin(superRole.id, 'policy-super');
    const viewerRole = await createAdminRole('policy-viewer', [
      'plugin::magic-sessionmanager.access',
    ]);
    const viewer = await createAdmin(viewerRole.id, 'policy-viewer');
    const outsiderRole = await createAdminRole('policy-outsider', []);
    const outsider = await createAdmin(outsiderRole.id, 'policy-outsider');

    // App users with real passwords.
    const upRoles = app.db.query('plugin::users-permissions.role');
    const authenticated = await upRoles.findOne({ where: { type: 'authenticated' } });
    const staffRole = await upRoles.create({
      data: { name: 'Synthetic staff', type: 'synthetic-staff', description: 'Policy test' },
    });
    for (const action of [
      'plugin::users-permissions.user.me',
      'plugin::users-permissions.auth.changePassword',
    ]) {
      await app.db
        .query('plugin::users-permissions.permission')
        .create({ data: { action, role: staffRole.id } });
    }
    const passwords = new Map();
    const createUser = async (name, role = authenticated) => {
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
          role: role.id,
        });
      passwords.set(name, password);
      return user;
    };
    const signIn = (name, { ip = '192.0.2.200', password } = {}) =>
      request('POST', '/api/auth/local', {
        ip,
        body: { identifier: `${name}@example.test`, password: password ?? passwords.get(name) },
      });
    const settings = (body) =>
      request('PUT', '/magic-sessionmanager/settings', { token: superAdmin.token, body });
    const activeSessions = async (user) =>
      app.db.query(SESSION_UID).findMany({
        where: { user: { id: user.id }, isActive: true },
        select: ['documentId'],
      });
    const flushedEvents = async (where = {}) => {
      await app.plugin('magic-sessionmanager').service('security-log').flush();
      return app.db.query(EVENT_UID).findMany({ where, orderBy: { id: 'asc' } });
    };

    // Legacy JWTs carry no unique id: two sign-ins of one user in the same
    // second get the same token. Wait a second between them where it matters.
    const nextSecond = () =>
      mode === 'legacy-support' ? new Promise((resolve) => setTimeout(resolve, 1100)) : null;
    const rejected = (status) => [401, 403].includes(status);

    const alice = await createUser('alice');
    const bob = await createUser('bob');
    const carol = await createUser('carol', staffRole);
    const dave = await createUser('dave');
    const erin = await createUser('erin');

    await t.test(
      'a fresh installation ends other sessions after a password change by default',
      async () => {
        const current = await request('GET', '/magic-sessionmanager/settings', {
          token: superAdmin.token,
        });
        assert.equal(current.status, 200);
        assert.equal(current.body.settings.endOtherSessionsOnPasswordChange, true);
        assert.equal(current.body.settings.maxFailedLogins, 5, 'IP lockout default unchanged');
        assert.equal(current.body.settings.maxFailedLoginsPerAccount, 0);
        assert.equal(current.body.settings.maxSessionsPerUser, 0);
        const store = app.store({ type: 'plugin', name: 'magic-sessionmanager' });
        assert.equal(await store.get({ key: 'defaultsProfile' }), 2);
      }
    );

    await t.test(
      'invalid policy settings are reported per field and nothing is stored',
      async () => {
        const result = await settings({
          maxFailedLoginsPerAccount: 500,
          lockoutTrustedAddresses: ['not-an-address'],
          roleRules: [{ role: 'doesnotexist', maxSessionsPerUser: 1 }],
        });
        assert.equal(result.status, 400);
        const paths = result.body.error.details.errors.map((error) => error.path.join('.'));
        assert.ok(paths.includes('maxFailedLoginsPerAccount'));
        assert.ok(paths.includes('lockoutTrustedAddresses.0'));
        const unknownRole = await settings({
          roleRules: [{ role: 'doesnotexist', maxSessionsPerUser: 1 }],
        });
        assert.equal(unknownRole.status, 400);
        assert.deepEqual(unknownRole.body.error.details.errors[0].path, ['roleRules', 0, 'role']);
      }
    );

    await t.test(
      'policy settings are protected: plugin access alone cannot change them',
      async () => {
        const denied = await request('PUT', '/magic-sessionmanager/settings', {
          token: viewer.token,
          body: { maxSessionsPerUser: 3 },
        });
        assert.equal(denied.status, 403);
        assert.equal(denied.body.error.details.reason, 'settings-update-permission');
        // Sending the stored value back is not a change.
        const unchanged = await request('PUT', '/magic-sessionmanager/settings', {
          token: viewer.token,
          body: { maxSessionsPerUser: 0, inactivityTimeout: 15 },
        });
        assert.equal(unchanged.status, 200);
      }
    );

    await t.test('policy settings are saved', async () => {
      const result = await settings({
        trustedProxies: true,
        maxFailedLogins: 3,
        lockoutWindowMinutes: 10,
        lockoutDurationMinutes: 20,
        maxFailedLoginsPerAccount: 4,
        lockoutTrustedAddresses: ['198.51.100.0/24'],
        lockoutNotifyUser: true,
      });
      assert.equal(result.status, 200, JSON.stringify(result.body?.error || null));
      assert.deepEqual(result.body.settings.lockoutTrustedAddresses, ['198.51.100.0/24']);
    });

    await t.test('IP lockout: threshold, configured duration and Retry-After', async () => {
      for (let i = 0; i < 3; i++) {
        const failed = await request('POST', '/api/auth/local', {
          ip: '192.0.2.10',
          body: { identifier: `nobody${i}@example.test`, password: 'wrong-password-1' },
        });
        assert.equal(failed.status, 400);
      }
      const locked = await request('POST', '/api/auth/local', {
        ip: '192.0.2.10',
        body: { identifier: 'alice@example.test', password: passwords.get('alice') },
      });
      assert.equal(locked.status, 429);
      const retryAfter = Number(locked.headers.get('retry-after'));
      assert.ok(retryAfter > 19 * 60 && retryAfter <= 20 * 60, `Retry-After ${retryAfter}`);
      assert.equal(locked.body.jwt, undefined);
      const elsewhere = await signIn('alice', { ip: '192.0.2.11' });
      assert.equal(elsewhere.status, 200, 'another address is not locked');
    });

    await t.test('trusted addresses are never locked by IP', async () => {
      for (let i = 0; i < 6; i++) {
        const failed = await request('POST', '/api/auth/local', {
          ip: '198.51.100.7',
          body: { identifier: `trusted${i}@example.test`, password: 'wrong-password-1' },
        });
        assert.equal(failed.status, 400, `attempt ${i + 1}`);
      }
    });

    await t.test(
      'account lockout follows the account across addresses and emails the owner',
      async () => {
        for (let i = 0; i < 4; i++) {
          const failed = await signIn('alice', { ip: `203.0.113.${i + 1}`, password: 'wrong-1' });
          assert.equal(failed.status, 400, `attempt ${i + 1}`);
        }
        const locked = await signIn('alice', { ip: '203.0.113.99' });
        assert.equal(
          locked.status,
          429,
          'the correct password is refused while the account is locked'
        );
        const mails = sentMail.filter((mail) => mail.to === 'alice@example.test');
        assert.equal(mails.length, 1);
        assert.match(mails[0].text, /20 minutes/);
        // An unknown account gets exactly the same answer (no enumeration).
        for (let i = 0; i < 4; i++) {
          await request('POST', '/api/auth/local', {
            ip: `203.0.113.${i + 20}`,
            body: { identifier: 'ghost@example.test', password: 'wrong-1' },
          });
        }
        const ghost = await request('POST', '/api/auth/local', {
          ip: '203.0.113.30',
          body: { identifier: 'ghost@example.test', password: 'wrong-1' },
        });
        assert.equal(ghost.status, 429);
        assert.deepEqual(
          Object.keys(ghost.body.error).sort(),
          Object.keys(locked.body.error).sort()
        );
      }
    );

    let accountLockId;
    await t.test(
      '"Locked now" lists IP and account locks without typed identifiers; RBAC holds',
      async () => {
        const denied = await request('GET', '/magic-sessionmanager/lockouts', {
          token: outsider.token,
        });
        assert.equal(denied.status, 403);
        const anonymous = await request('GET', '/magic-sessionmanager/lockouts');
        assert.ok([401, 403].includes(anonymous.status));
        const list = await request('GET', '/magic-sessionmanager/lockouts', {
          token: viewer.token,
        });
        assert.equal(list.status, 200);
        const text = JSON.stringify(list.body);
        assert.doesNotMatch(text, /ghost@example|nobody0@/, 'typed identifiers are never stored');
        const ipLock = list.body.data.find(
          (lock) => lock.kind === 'ip' && lock.ip === '192.0.2.10'
        );
        assert.ok(ipLock, 'IP lock listed');
        const accountLock = list.body.data.find(
          (lock) => lock.kind === 'account' && lock.user?.documentId === alice.documentId
        );
        assert.ok(accountLock, 'account lock listed with its user');
        assert.equal(accountLock.failures, 4);
        assert.ok(
          list.body.data.some((lock) => lock.kind === 'account' && lock.user === null),
          'a lock of an unknown account has no user'
        );
        accountLockId = accountLock.id;

        const viewerUnlock = await request('POST', '/magic-sessionmanager/lockouts/unlock', {
          token: viewer.token,
          body: { id: accountLockId },
        });
        assert.equal(viewerUnlock.status, 403, 'unlock needs lockouts.unlock');
        const invalid = await request('POST', '/magic-sessionmanager/lockouts/unlock', {
          token: superAdmin.token,
          body: { id: 'la:../../x', extra: true },
        });
        assert.equal(invalid.status, 400);
      }
    );

    await t.test('Unlock lifts the account lock and records who lifted it', async () => {
      const unlocked = await request('POST', '/magic-sessionmanager/lockouts/unlock', {
        token: superAdmin.token,
        body: { id: accountLockId },
      });
      assert.equal(unlocked.status, 200);
      assert.deepEqual(unlocked.body.data, { unlocked: true, kind: 'account' });
      const again = await request('POST', '/magic-sessionmanager/lockouts/unlock', {
        token: superAdmin.token,
        body: { id: accountLockId },
      });
      assert.equal(again.status, 404);
      const signedIn = await signIn('alice', { ip: '203.0.113.99' });
      assert.equal(signedIn.status, 200);

      const lifted = await flushedEvents({ event: 'user.lockout.lifted' });
      assert.equal(lifted.length, 1);
      assert.equal(lifted[0].actorType, 'admin');
      assert.equal(String(lifted[0].actorId), String(superAdmin.id));
      assert.equal(lifted[0].targetId, alice.documentId);
      const failed = await flushedEvents({
        event: 'user.sign-in.failed',
        targetId: alice.documentId,
      });
      assert.equal(failed.length, 4);
      const locks = await flushedEvents({ event: 'user.lockout' });
      assert.ok(
        locks.some((row) => row.meta?.kind === 'account' && row.targetId === alice.documentId)
      );
      assert.ok(locks.some((row) => row.meta?.kind === 'ip'));
      // Unknown accounts are aggregated: one failed event per anonymised
      // address per 5 minutes (192.0.2.0, 198.51.100.0 and 203.0.113.0 here).
      const unknown = (await flushedEvents({ event: 'user.sign-in.failed' })).filter(
        (row) => row.meta?.unknownAccount === true
      );
      assert.equal(unknown.length, 3, 'one event per anonymised network');
      assert.ok(unknown.every((row) => row.targetId === null));
      const refused = await flushedEvents({ event: 'user.sign-in.refused' });
      assert.ok(refused.some((row) => row.meta?.reason === 'lockout'));
      for (const row of [...failed, ...refused]) {
        assert.doesNotMatch(JSON.stringify(row.meta || {}), /example\.test|password/);
      }
    });

    await t.test(
      'turning "Record failed and refused sign-ins" off stops those events',
      async () => {
        await settings({ recordUserSignInEvents: false });
        const before = (await flushedEvents({ event: 'user.sign-in.failed' })).length;
        await signIn('bob', { ip: '192.0.2.150', password: 'wrong-1' });
        const after = (await flushedEvents({ event: 'user.sign-in.failed' })).length;
        assert.equal(after, before);
        await settings({ recordUserSignInEvents: true, maxFailedLoginsPerAccount: 0 });
      }
    );

    await t.test('session limit "end oldest" keeps the newest sessions', async () => {
      assert.equal((await settings({ maxSessionsPerUser: 2 })).status, 200);
      const first = await signIn('bob', { ip: '192.0.2.151' });
      await nextSecond();
      await signIn('bob', { ip: '192.0.2.152' });
      await nextSecond();
      const third = await signIn('bob', { ip: '192.0.2.153' });
      assert.equal(third.status, 200);
      assert.equal((await activeSessions(bob)).length, 2);
      const old = await request('GET', '/api/users/me', { token: first.body.jwt });
      assert.ok(rejected(old.status), 'the oldest session was ended');
      const fresh = await request('GET', '/api/users/me', { token: third.body.jwt });
      assert.equal(fresh.status, 200);
      const limitEvents = await flushedEvents({
        event: 'user.session.limit',
        targetId: bob.documentId,
      });
      assert.equal(limitEvents.length, 1);
      assert.equal(limitEvents[0].meta.ended, 1);
    });

    await t.test(
      'session limit "refuse" answers 403 SESSION_LIMIT_REACHED without tokens',
      async () => {
        assert.equal((await settings({ sessionLimitPolicy: 'refuse' })).status, 200);
        const refused = await signIn('bob', { ip: '192.0.2.154' });
        assert.equal(refused.status, 403);
        assert.equal(refused.body.error.details.code, 'SESSION_LIMIT_REACHED');
        assert.equal(refused.body.error.details.limit, 2);
        assert.equal(refused.body.jwt, undefined);
        assert.equal(refused.body.refreshToken, undefined);
        assert.equal(
          refused.headers.getSetCookie().filter((value) => value.startsWith('strapi_up_refresh='))
            .length,
          0
        );
        assert.equal((await activeSessions(bob)).length, 2);
        const events = await flushedEvents({
          event: 'user.sign-in.refused',
          targetId: bob.documentId,
        });
        assert.ok(events.some((row) => row.meta?.reason === 'session-limit'));
        await settings({ maxSessionsPerUser: 0, sessionLimitPolicy: 'end-oldest' });
      }
    );

    await t.test('per-role rules: session limit and inactivity timeout of one role', async () => {
      const roles = await request('GET', '/magic-sessionmanager/roles', { token: viewer.token });
      assert.equal(roles.status, 200);
      const types = roles.body.data.map((role) => role.type);
      assert.ok(types.includes('authenticated') && types.includes('synthetic-staff'));
      assert.ok(!types.includes('public'));
      const saved = await settings({
        roleRules: [
          {
            role: staffRole.documentId,
            maxSessionsPerUser: 1,
            inactivityTimeout: 1,
            maxFailedLoginsPerAccount: null,
          },
        ],
      });
      assert.equal(saved.status, 200, JSON.stringify(saved.body?.error || null));
      await signIn('carol', { ip: '192.0.2.160' });
      await nextSecond();
      const second = await signIn('carol', { ip: '192.0.2.161' });
      assert.equal(second.status, 200);
      assert.equal((await activeSessions(carol)).length, 1, 'the staff role keeps one session');
      // Other roles are not limited.
      await signIn('erin', { ip: '192.0.2.162' });
      await nextSecond();
      await signIn('erin', { ip: '192.0.2.163' });
      assert.equal((await activeSessions(erin)).length, 2);

      // The staff role's 1-minute inactivity timeout ends an idle session.
      const [current] = await activeSessions(carol);
      await app.db.query(SESSION_UID).update({
        where: { documentId: current.documentId },
        data: { lastActive: new Date(Date.now() - 2 * 60 * 1000) },
      });
      const idle = await request('GET', '/api/users/me', { token: second.body.jwt });
      assert.ok(rejected(idle.status));
      const ended = await app.db
        .query(SESSION_UID)
        .findOne({ where: { documentId: current.documentId }, select: ['terminationReason'] });
      assert.equal(ended.terminationReason, 'idle');
      await settings({ roleRules: [] });
    });

    await t.test(
      'a password change ends the other sessions and keeps the current one',
      async () => {
        const a = await signIn('dave', { ip: '192.0.2.170' });
        await nextSecond();
        const b = await signIn('dave', { ip: '192.0.2.171' });
        await nextSecond();
        const next = `Aa1!${crypto.randomBytes(10).toString('base64url')}`;
        const changed = await request('POST', '/api/auth/change-password', {
          token: a.body.jwt,
          ip: '192.0.2.170',
          body: {
            currentPassword: passwords.get('dave'),
            password: next,
            passwordConfirmation: next,
          },
        });
        assert.equal(changed.status, 200, JSON.stringify(changed.body?.error || null));
        passwords.set('dave', next);
        const active = await activeSessions(dave);
        assert.equal(active.length, 1, 'only the current session stays');
        assert.equal(
          (await request('GET', '/api/users/me', { token: changed.body.jwt })).status,
          200
        );
        assert.ok(rejected((await request('GET', '/api/users/me', { token: b.body.jwt })).status));
        const events = await flushedEvents({
          event: 'user.password-change.ended-others',
          targetId: dave.documentId,
        });
        assert.equal(events.length, 1);
        assert.equal(events[0].meta.ended, 1);
      }
    );

    await t.test('with the switch off, a password change keeps the other sessions', async () => {
      assert.equal((await settings({ endOtherSessionsOnPasswordChange: false })).status, 200);
      const before = (await activeSessions(erin)).length;
      await nextSecond();
      const a = await signIn('erin', { ip: '192.0.2.180' });
      await nextSecond();
      const next = `Aa1!${crypto.randomBytes(10).toString('base64url')}`;
      const changed = await request('POST', '/api/auth/change-password', {
        token: a.body.jwt,
        body: {
          currentPassword: passwords.get('erin'),
          password: next,
          passwordConfirmation: next,
        },
      });
      assert.equal(changed.status, 200);
      // In refresh mode Strapi itself revokes the user's other native
      // sessions on a password change; the Magic rows stay as Strapi left
      // them. In legacy mode the other sessions stay usable.
      if (mode === 'legacy-support') {
        assert.equal((await activeSessions(erin)).length, before + 1);
      }
    });

    await t.test('deleting a user deletes their security events', async () => {
      const count = async () =>
        (await flushedEvents({ targetType: 'user', targetId: bob.documentId })).length;
      assert.ok((await count()) > 0);
      await app.documents(USER_UID).delete({ documentId: bob.documentId });
      assert.equal(await count(), 0);
    });
  }
);
