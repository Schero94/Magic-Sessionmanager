'use strict';

// Real Strapi 5 HTTP boundary for the sign-in signals, integrations and
// privacy controls (4.17, part 2): new-device email with the "This wasn't
// me" link (signed, single use, never used by GET), impossible travel (alert
// and re-sign-in), the signed webhook (write-only URL and secret, SSRF
// guard, event selection), the own-data export and shortened session IPs.
// Synthetic accounts and random secrets; outbound network blocked; the email
// plugin and the location lookup are in-memory fakes.
//
// Runs on SQLite by default, on PostgreSQL with SESSION_HTTP_DB=postgres and
// MSM_TEST_PG_URL (a throwaway schema), in legacy mode by default and in
// refresh mode with SESSION_HTTP_MODE=refresh.
//
//   SESSION_HTTP_STRAPI_NODE_MODULES=$PWD/node_modules SESSION_HTTP_REQUIRED=1 \
//     node --test tests/isolated-signals-http.test.js
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

test(
  `isolated Strapi sign-in signals, webhook and privacy over HTTP (${dbKind}, ${mode})`,
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
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionmanager-signals-'));
    const plugin = path.join(root, 'plugin');
    for (const dir of ['config', 'plugin', 'src', 'public', 'public/uploads']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    fs.symlinkSync(hostModules, path.join(root, 'node_modules'), 'dir');
    const write = (filename, contents) => fs.writeFileSync(path.join(root, filename), contents);
    write(
      'package.json',
      JSON.stringify({
        name: 'isolated-sessionmanager-signals',
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

    const schema = `msm_signals_${crypto.randomBytes(4).toString('hex')}`;
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
      `module.exports = { host: '127.0.0.1', port: 1337, url: 'https://app.example.test', app: { keys: [process.env.TEST_HTTP_SECRET_A, process.env.TEST_HTTP_SECRET_B] }, logger: { updates: { enabled: false } } };\n`
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
    const outsiderRole = await createAdminRole('policy-outsider', []);
    const outsider = await createAdmin(outsiderRole.id, 'policy-outsider');

    // App users with real passwords.
    const upRoles = app.db.query('plugin::users-permissions.role');
    const authenticated = await upRoles.findOne({ where: { type: 'authenticated' } });
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
    const settings = (body) =>
      request('PUT', '/magic-sessionmanager/settings', { token: superAdmin.token, body });
    const flushedEvents = async (where = {}) => {
      await app.plugin('magic-sessionmanager').service('security-log').flush();
      return app.db.query(EVENT_UID).findMany({ where, orderBy: { id: 'asc' } });
    };

    const rejected = (status) => [401, 403].includes(status);
    const UA_MAC =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';
    const UA_WIN =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    const signInAs = async (name, { ip = '192.0.2.200', ua = UA_MAC, deviceId } = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/auth/local`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, 'user-agent': ua },
        body: JSON.stringify({
          identifier: `${name}@example.test`,
          password: passwords.get(name),
          ...(deviceId ? { deviceId } : {}),
        }),
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    };
    const sessionsOf = (user, where = {}) =>
      app.db.query(SESSION_UID).findMany({
        where: { user: { id: user.id }, ...where },
        select: ['documentId', 'isActive', 'ipAddress', 'geoLocation', 'deviceKey'],
      });

    // Location lookup fake: synthetic coordinates per documentation address.
    const PLACES = {
      '203.0.113.1': {
        country: 'Germany',
        country_code: 'DE',
        city: 'Berlin',
        latitude: 52.52,
        longitude: 13.405,
      },
      '203.0.113.2': {
        country: 'Australia',
        country_code: 'AU',
        city: 'Sydney',
        latitude: -33.87,
        longitude: 151.21,
      },
      '203.0.113.3': {
        country: 'Germany',
        country_code: 'DE',
        city: 'Potsdam',
        latitude: 52.39,
        longitude: 13.06,
      },
    };
    app.plugin('magic-sessionmanager').service('geolocation').getIpInfo = async (ip) =>
      PLACES[ip]
        ? { _status: 'ok', ...PLACES[ip] }
        : {
            _status: 'ok',
            country: null,
            country_code: null,
            city: null,
            latitude: null,
            longitude: null,
          };

    // Webhook emissions are observed on the service (deliveries cannot leave the test).
    const emitted = [];
    const webhooksService = app.plugin('magic-sessionmanager').service('webhooks');
    const originalEmit = webhooksService.emit.bind(webhooksService);
    webhooksService.emit = (event, input, options) => {
      emitted.push({ event, input });
      return originalEmit(event, input, options);
    };

    let newDeviceToken;
    const anna = await createUser('anna');
    const ben = await createUser('ben');
    const cara = await createUser('cara');
    const dora = await createUser('dora');

    await t.test(
      'fresh install: nothing new is on, and every sign-in is not selected for webhooks',
      async () => {
        const current = await request('GET', '/magic-sessionmanager/settings', {
          token: superAdmin.token,
        });
        assert.equal(current.status, 200);
        const s = current.body.settings;
        assert.equal(s.alertOnNewDevice, false);
        assert.equal(s.impossibleTravelEnabled, false);
        assert.equal(s.genericWebhookEnabled, false);
        assert.equal(s.sessionIpAnonymize, false);
        assert.ok(!s.webhookEvents.includes('login.success'));
        assert.equal(s.hasGenericWebhook, false);
        assert.equal(s.hasGenericWebhookSecret, false);
        assert.equal('genericWebhookUrl' in s, false);
        assert.equal('genericWebhookSecret' in s, false);
        // Defaults: no device key and no coordinates are stored.
        await signInAs('anna', { ip: '203.0.113.1' });
        const [row] = await sessionsOf(anna);
        assert.match(row.deviceKey, /^[a-f0-9]{32}$/, 'device key is an HMAC, no raw device data');
        assert.equal(row.geoLocation?.latitude, undefined);
      }
    );

    await t.test(
      'new-device email with a "This wasn\'t me" link; first sign-in and known device send nothing',
      async () => {
        const saved = await settings({
          trustedProxies: ['127.0.0.1/32', '::1/128'],
          enableGeolocation: true,
          enableEmailAlerts: true,
          alertOnNewDevice: true,
        });
        assert.equal(saved.status, 200, JSON.stringify(saved.body?.error || null));
        sentMail.length = 0;
        await signInAs('ben', { ip: '203.0.113.1', ua: UA_MAC }); // first sign-in
        await signInAs('ben', { ip: '203.0.113.1', ua: UA_MAC }); // same device
        assert.equal(sentMail.length, 0);
        await signInAs('ben', { ip: '203.0.113.3', ua: UA_WIN }); // new device
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert.equal(sentMail.length, 1);
        const mail = sentMail[0];
        assert.equal(mail.to, 'ben@example.test');
        assert.match(mail.text, /Chrome on Windows/);
        // L5 (security review 2): the token is in the fragment, never in the
        // query, so it does not reach the server's or a proxy's access log.
        assert.doesNotMatch(mail.text, /not-me\?token=/);
        const link =
          /https:\/\/app\.example\.test\/api\/magic-sessionmanager\/not-me#token=([A-Za-z0-9_.%-]+)/.exec(
            mail.text
          );
        assert.ok(link, 'the email carries the link');
        newDeviceToken = decodeURIComponent(link[1]);
        const events = await flushedEvents({
          event: 'user.sign-in.new-device',
          targetId: ben.documentId,
        });
        assert.equal(events.length, 1);
        assert.deepEqual(Object.keys(events[0].meta).sort(), ['browser', 'deviceType', 'os']);
        // An app-supplied deviceId makes the same browser a different device.
        await signInAs('ben', { ip: '203.0.113.1', ua: UA_MAC, deviceId: 'synthetic-device-2' });
        await new Promise((resolve) => setTimeout(resolve, 200));
        assert.equal(sentMail.length, 2);
      }
    );

    await t.test(
      '"This wasn\'t me": GET only confirms; POST ends that session once; tampering fails',
      async () => {
        // The browser requests the page without the fragment.
        const page = await fetch(`http://127.0.0.1:${port}/api/magic-sessionmanager/not-me`, {
          headers: { 'accept-language': 'de-DE,de;q=0.9' },
        });
        assert.equal(page.status, 200);
        const csp = page.headers.get('content-security-policy');
        assert.match(csp, /default-src 'none'/);
        assert.match(csp, /script-src 'sha256-[A-Za-z0-9+/=]+'/);
        assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
        const html = await page.text();
        assert.match(html, /Waren Sie das nicht\?/);
        const script = /<script>([\s\S]*?)<\/script>/.exec(html);
        assert.ok(script, 'the page copies the fragment token with one inline script');
        const hash = crypto.createHash('sha256').update(script[1]).digest('base64');
        assert.ok(csp.includes(`'sha256-${hash}'`), 'the CSP allows exactly that script');
        // A link from an earlier email (?token=) still opens without a script.
        const legacy = await fetch(
          `http://127.0.0.1:${port}/api/magic-sessionmanager/not-me?token=${encodeURIComponent(newDeviceToken)}`
        );
        assert.equal(legacy.status, 200);
        assert.doesNotMatch(await legacy.text(), /<script/i);
        const activeBefore = (await sessionsOf(ben, { isActive: true })).length;
        assert.equal(activeBefore, 4, 'opening the link ends nothing');

        const tampered = `${newDeviceToken.slice(0, -2)}xx`;
        const bad = await fetch(`http://127.0.0.1:${port}/api/magic-sessionmanager/not-me`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ token: tampered }),
        });
        assert.equal(bad.status, 410);

        const post = await fetch(`http://127.0.0.1:${port}/api/magic-sessionmanager/not-me`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: newDeviceToken, scope: 'session' }).toString(),
        });
        assert.equal(post.status, 200);
        assert.equal(
          (await sessionsOf(ben, { isActive: true })).length,
          3,
          'exactly that session ended'
        );
        const again = await fetch(`http://127.0.0.1:${port}/api/magic-sessionmanager/not-me`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ token: newDeviceToken }),
        });
        assert.equal(again.status, 410, 'single use');
        const events = await flushedEvents({ event: 'user.not-me', targetId: ben.documentId });
        assert.equal(events.length, 1);
        assert.deepEqual(events[0].meta, { scope: 'session', ended: 1 });
      }
    );

    await t.test('"This wasn\'t me" with scope all ends every session of the user', async () => {
      sentMail.length = 0;
      await signInAs('ben', {
        ip: '203.0.113.1',
        ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      const token = decodeURIComponent(/token=([A-Za-z0-9_.%-]+)/.exec(sentMail[0].text)[1]);
      const post = await fetch(`http://127.0.0.1:${port}/api/magic-sessionmanager/not-me`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ token, scope: 'all' }),
      });
      assert.equal(post.status, 200);
      assert.equal((await post.json()).data.scope, 'all');
      assert.equal((await sessionsOf(ben, { isActive: true })).length, 0);
    });

    await t.test(
      'impossible travel: alert by default, with distance and speed, and an email',
      async () => {
        const saved = await settings({
          impossibleTravelEnabled: true,
          alertOnImpossibleTravel: true,
          alertOnNewDevice: false,
        });
        assert.equal(saved.status, 200);
        sentMail.length = 0;
        const first = await signInAs('cara', { ip: '203.0.113.1' });
        assert.equal(first.status, 200);
        const [stored] = await sessionsOf(cara);
        assert.equal(stored.geoLocation.latitude, 52.5, 'coordinates are rounded to 0.1 degree');
        const second = await signInAs('cara', { ip: '203.0.113.2' });
        assert.equal(second.status, 200, 'alert only: the sign-in succeeds');
        await new Promise((resolve) => setTimeout(resolve, 200));
        const events = await flushedEvents({
          event: 'user.sign-in.impossible-travel',
          targetId: cara.documentId,
        });
        assert.equal(events.length, 1);
        assert.ok(events[0].meta.distanceKm > 15000);
        assert.equal(events[0].meta.from, 'DE');
        assert.equal(events[0].meta.to, 'AU');
        // The country also changed, so the existing new-country email is sent too.
        const travelMails = sentMail.filter((mail) => /Unusual sign-in/.test(mail.subject));
        assert.equal(travelMails.length, 1);
        assert.match(travelMails[0].text, /km away from your previous sign-in/);
        // A short trip is not flagged.
        await signInAs('cara', { ip: '203.0.113.2' });
        assert.equal(
          (
            await flushedEvents({
              event: 'user.sign-in.impossible-travel',
              targetId: cara.documentId,
            })
          ).length,
          1
        );
      }
    );

    await t.test(
      'impossible travel with "require a new sign-in" ends every session and returns no token',
      async () => {
        assert.equal((await settings({ impossibleTravelAction: 'reauthenticate' })).status, 200);
        await signInAs('dora', { ip: '203.0.113.1' });
        const second = await signInAs('dora', { ip: '203.0.113.2' });
        assert.equal(second.status, 401);
        assert.equal(second.body.error.details.code, 'REAUTHENTICATION_REQUIRED');
        assert.equal(second.body.jwt, undefined);
        assert.equal((await sessionsOf(dora, { isActive: true })).length, 0);
        // The next sign-in from the new place compares with the refused one and succeeds.
        const third = await signInAs('dora', { ip: '203.0.113.2' });
        assert.equal(third.status, 200);
        await settings({ impossibleTravelEnabled: false, impossibleTravelAction: 'alert' });
      }
    );

    await t.test(
      'signed webhook: URL and secret are write-only; invalid values are rejected',
      async () => {
        const bad = await settings({
          genericWebhookUrl: 'http://hooks.example.test/x',
          genericWebhookSecret: 'short',
        });
        assert.equal(bad.status, 400);
        const paths = bad.body.error.details.errors.map((error) => error.path.join('.'));
        assert.ok(paths.includes('genericWebhookUrl') && paths.includes('genericWebhookSecret'));
        const secret = crypto.randomBytes(32).toString('base64url');
        // IP literals that delivery refuses are refused when saved (security
        // review 2, hardening 10).
        for (const url of [
          'https://127.0.0.1/hook',
          'https://[::1]/hook',
          'https://0x7f000001/hook',
          'https://169.254.169.254/latest/meta-data',
          'https://[::ffff:127.0.0.1]/hook',
        ]) {
          const literal = await settings({ genericWebhookUrl: url, genericWebhookSecret: secret });
          assert.equal(literal.status, 400, url);
        }
        const saved = await settings({
          genericWebhookEnabled: true,
          genericWebhookUrl: 'https://hooks.example.test/hook',
          genericWebhookSecret: secret,
          webhookEvents: ['lockout', 'login.new_device', 'login.success'],
        });
        assert.equal(saved.status, 200);
        const text = JSON.stringify(saved.body);
        assert.ok(
          !text.includes(secret) && !text.includes('hooks.example.test/hook'),
          'PUT never returns them'
        );
        // A new URL needs the secret entered again (security review 2, hardening 5).
        const urlOnly = await settings({ genericWebhookUrl: 'https://other.example.test/hook' });
        assert.equal(urlOnly.status, 400);
        assert.deepEqual(urlOnly.body.error.details.errors[0].path, ['genericWebhookSecret']);
        const sameUrl = await settings({ genericWebhookUrl: 'https://hooks.example.test/hook' });
        assert.equal(sameUrl.status, 200, 'sending the stored URL back is not a change');
        const read = await request('GET', '/magic-sessionmanager/settings', {
          token: superAdmin.token,
        });
        const readText = JSON.stringify(read.body);
        assert.ok(
          !readText.includes(secret) && !readText.includes('hooks.example.test/hook'),
          'GET never returns them'
        );
        assert.equal(read.body.settings.hasGenericWebhook, true);
        assert.equal(read.body.settings.hasGenericWebhookSecret, true);
        // A PUT without the fields keeps them.
        await settings({ sessionIpAnonymize: false });
        const again = await request('GET', '/magic-sessionmanager/settings', {
          token: superAdmin.token,
        });
        assert.equal(again.body.settings.hasGenericWebhook, true);
        const store = await app
          .store({ type: 'plugin', name: 'magic-sessionmanager' })
          .get({ key: 'settings' });
        assert.notEqual(store.genericWebhookSecret, secret, 'the secret is stored encrypted');
      }
    );

    await t.test(
      'signed webhook: the test send refuses local and metadata addresses (SSRF), RBAC holds',
      async () => {
        const denied = await request('POST', '/magic-sessionmanager/webhook/test', {
          token: outsider.token,
        });
        assert.equal(denied.status, 403);
        // Local and metadata IP literals cannot be saved any more (see the
        // test above); a host name that resolves to one is refused at send
        // time (tests/signals-webhooks.test.js covers the resolver seam).
        const secret = crypto.randomBytes(32).toString('base64url');
        const metadata = await settings({
          genericWebhookUrl: 'https://169.254.169.254/latest/meta-data',
          genericWebhookSecret: secret,
        });
        assert.equal(metadata.status, 400);
        await settings({
          genericWebhookUrl: 'https://hooks.example.test/x',
          genericWebhookSecret: secret,
        });
        const dns = await request('POST', '/magic-sessionmanager/webhook/test', {
          token: superAdmin.token,
        });
        assert.ok(
          ['dns_failed', 'address_not_allowed', 'network_error'].includes(dns.body.data.code)
        );
        assert.equal(dns.body.data.ok, false);
      }
    );

    await t.test(
      'protected detection settings and the webhook test need Change protected settings',
      async () => {
        const viewerRole = await createAdminRole('signals-viewer', [
          'plugin::magic-sessionmanager.access',
        ]);
        const viewer = await createAdmin(viewerRole.id, 'signals-viewer');
        const put = (body) =>
          request('PUT', '/magic-sessionmanager/settings', { token: viewer.token, body });
        const before = await request('GET', '/magic-sessionmanager/settings', {
          token: viewer.token,
        });
        assert.equal(before.status, 200);
        const current = before.body.settings;
        assert.equal(current.genericWebhookHint, 'https://hooks.example.test/…');
        assert.ok(!('genericWebhookUrl' in current) && !('genericWebhookSecret' in current));
        for (const body of [
          { genericWebhookEnabled: !current.genericWebhookEnabled },
          {
            genericWebhookUrl: 'https://hooks.example.test/other',
            genericWebhookSecret: crypto.randomBytes(32).toString('base64url'),
          },
          { genericWebhookSecret: crypto.randomBytes(32).toString('base64url') },
          { webhookEvents: ['user.not_me'] },
          { impossibleTravelEnabled: !current.impossibleTravelEnabled },
          { impossibleTravelAction: 'reauthenticate' },
          { sessionIpAnonymize: !current.sessionIpAnonymize },
        ]) {
          const denied = await put(body);
          assert.equal(denied.status, 403, `${Object.keys(body)[0]} is protected`);
          assert.equal(denied.body.error.details.reason, 'settings-update-permission');
        }
        // Sending the whole form back unchanged is allowed.
        const unchanged = await put(current);
        assert.equal(unchanged.status, 200);
        // The alert email switches stay with plugin access.
        const email = await put({ alertOnNewDevice: !current.alertOnNewDevice });
        assert.equal(email.status, 200);
        await settings({ alertOnNewDevice: current.alertOnNewDevice });
        const test = await request('POST', '/magic-sessionmanager/webhook/test', {
          token: viewer.token,
        });
        assert.equal(test.status, 403, 'Send test needs settings.update');
      }
    );

    await t.test('webhook events follow the selection', async () => {
      emitted.length = 0;
      await settings({ maxFailedLogins: 2 });
      for (let i = 0; i < 2; i++) {
        await request('POST', '/api/auth/local', {
          ip: '192.0.2.77',
          body: { identifier: 'anna@example.test', password: 'wrong-password-1' },
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      const events = emitted.map((entry) => entry.event);
      assert.ok(events.includes('lockout'), 'selected event emitted');
      // login.failed reaches the service but is not selected, so nothing is sent for it.
      const current = await request('GET', '/magic-sessionmanager/settings', {
        token: superAdmin.token,
      });
      assert.equal(webhooksService.isSelected(current.body.settings, 'login.failed'), false);
      assert.equal(webhooksService.isSelected(current.body.settings, 'lockout'), true);
      await settings({ maxFailedLogins: 5 });
    });

    await t.test(
      'own-data export: own sessions and events only, no token material, rate limited',
      async () => {
        const login = await signInAs('anna', { ip: '203.0.113.1' });
        assert.equal(login.status, 200);
        const exportOf = (token) =>
          fetch(`http://127.0.0.1:${port}/api/magic-sessionmanager/my-data`, {
            headers: token ? { authorization: `Bearer ${token}` } : {},
          });
        await flushedEvents();
        const anonymous = await exportOf(null);
        assert.ok(rejected(anonymous.status));
        const response = await exportOf(login.body.jwt);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-disposition'), /attachment/);
        const data = await response.json();
        assert.equal(data.user.documentId, anna.documentId);
        assert.ok(data.sessions.length >= 2);
        const text = JSON.stringify(data);
        for (const forbidden of [
          'tokenHash',
          'refreshToken',
          'deviceKey',
          'nativeSessionId',
          '"token"',
        ]) {
          assert.ok(!text.includes(forbidden), `${forbidden} is not exported`);
        }
        assert.ok(!text.includes('ben@example.test'), 'no other user');
        assert.ok(data.securityEvents.some((event) => event.event === 'user.sign-in.failed'));
        await exportOf(login.body.jwt);
        await exportOf(login.body.jwt);
        const limited = await exportOf(login.body.jwt);
        assert.equal(limited.status, 429);
        const exported = await flushedEvents({
          event: 'user.data.exported',
          targetId: anna.documentId,
        });
        assert.equal(exported.length, 3);
      }
    );

    await t.test('the Authenticated role received the export permission once', async () => {
      const rows = await app.db.query('plugin::users-permissions.permission').findMany({
        where: {
          action: 'plugin::magic-sessionmanager.self-service.exportOwnData',
          role: authenticated.id,
        },
      });
      assert.equal(rows.length, 1);
    });

    await t.test('shortened IP addresses for app-user sessions', async () => {
      assert.equal((await settings({ sessionIpAnonymize: true })).status, 200);
      await signInAs('anna', { ip: '198.51.100.77' });
      const rows = await sessionsOf(anna);
      assert.ok(rows.some((row) => row.ipAddress === '198.51.100.0'));
      assert.ok(!rows.some((row) => row.ipAddress === '198.51.100.77'));
    });
  }
);
