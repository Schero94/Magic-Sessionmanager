'use strict';

/**
 * Latency bench of the Content Manager activity capture: 1000 Content Manager
 * requests with recording off and with recording on, against a real Strapi
 * booted from this checkout (SQLite in a temp directory, loopback only).
 *
 *   SESSION_HTTP_STRAPI_NODE_MODULES=$PWD/node_modules node scripts/bench-admin-activity.cjs
 *
 * Each mode runs 1000 requests: 500 opens (GET of one of 100 entries, so most
 * are de-duplicated views) and 500 edits (PUT). Prints mean, p50, p95 and p99
 * in milliseconds per mode, and the number of stored events. Synthetic data
 * only; nothing leaves the machine.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const sourceRoot = path.resolve(__dirname, '..');
const hostModules =
  process.env.SESSION_HTTP_STRAPI_NODE_MODULES || path.join(sourceRoot, 'node_modules');
const REQUESTS = Number(process.env.BENCH_REQUESTS || 1000);

/**
 * @param {number[]} values Durations.
 * @returns {{mean: number, p50: number, p95: number, p99: number}} Stats in ms.
 */
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const round = (n) => Math.round(n * 100) / 100;
  return {
    mean: round(sorted.reduce((sum, v) => sum + v, 0) / sorted.length),
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    p99: round(at(0.99)),
  };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionmanager-bench-'));
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  fs.symlinkSync(hostModules, path.join(root, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(root, 'public/uploads'), { recursive: true });
  write(
    'package.json',
    JSON.stringify({
      name: 'bench',
      private: true,
      dependencies: { '@strapi/plugin-users-permissions': '*' },
    })
  );
  write(
    'plugin/package.json',
    JSON.stringify({
      name: 'bench-plugin',
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
      attributes: { title: { type: 'string' } },
    })
  );
  write(
    'config/database.js',
    `module.exports = { connection: { client: 'sqlite', connection: { filename: ${JSON.stringify(path.join(root, 'bench.sqlite'))} }, useNullAsDefault: true } };\n`
  );
  write(
    'config/server.js',
    `module.exports = { host: '127.0.0.1', port: 1337, app: { keys: ['a${crypto.randomBytes(8).toString('hex')}', 'b${crypto.randomBytes(8).toString('hex')}'] }, logger: { updates: { enabled: false } } };\n`
  );
  write(
    'config/admin.js',
    `module.exports = { auth: { secret: '${crypto.randomBytes(24).toString('hex')}' }, apiToken: { salt: '${crypto.randomBytes(24).toString('hex')}' }, transfer: { token: { salt: '${crypto.randomBytes(24).toString('hex')}' } }, rateLimit: { enabled: false } };\n`
  );
  write(
    'config/plugins.js',
    `module.exports = { 'users-permissions': { enabled: true, config: { jwtSecret: '${crypto.randomBytes(24).toString('hex')}' } }, 'magic-sessionmanager': { enabled: true, resolve: ${JSON.stringify(path.join(root, 'plugin'))}, config: { enableGeolocation: false, geoIpProvider: 'disabled' } } };\n`
  );
  process.env.NODE_ENV = 'test';
  process.env.STRAPI_TELEMETRY_DISABLED = 'true';
  process.env.ENV_PATH = path.join(root, 'no-dotenv');
  process.env.SESSION_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  process.chdir(root);

  const { createStrapi } = require(path.join(hostModules, '@strapi/strapi'));
  const app = createStrapi({ appDir: root, distDir: root, serveAdminPanel: false });
  await app.load();
  app.log.level = 'error';
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.httpServer.address().port}`;
  const call = async (method, url, token, body) => {
    const started = process.hrtime.bigint();
    const response = await fetch(base + url, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await response.json().catch(() => null);
    return { ms: Number(process.hrtime.bigint() - started) / 1e6, status: response.status, json };
  };

  const password = `Aa1!${crypto.randomBytes(12).toString('base64url')}`;
  const registered = await call('POST', '/admin/register-admin', null, {
    email: 'bench.admin@example.test',
    firstname: 'Bench',
    lastname: 'Admin',
    password,
  });
  const token = registered.json.data.token;
  const cm = '/content-manager/collection-types/api::article.article';
  const ids = [];
  for (let i = 0; i < 100; i += 1) {
    ids.push(
      (await call('POST', cm, token, { title: `Synthetic entry ${i}` })).json.data.documentId
    );
  }
  const store = app.store({ type: 'plugin', name: 'magic-sessionmanager' });
  const { notifySettingsChanged } = require(
    path.join(sourceRoot, 'server/src/utils/settings-loader')
  );
  const service = app.plugin('magic-sessionmanager').service('security-log');
  const events = () =>
    app.db.query('plugin::magic-sessionmanager.security-event').count({
      where: { event: { $startsWith: 'admin.content.' } },
    });

  const run = async (recording) => {
    const current = (await store.get({ key: 'settings' })) || {};
    await store.set({ key: 'settings', value: { ...current, adminContentActivity: recording } });
    await notifySettingsChanged(app);
    await service.flush();
    const before = await events();
    // Warm-up.
    for (let i = 0; i < 50; i += 1) await call('GET', `${cm}/${ids[i % ids.length]}`, token);
    const durations = [];
    for (let i = 0; i < REQUESTS; i += 1) {
      const id = ids[i % ids.length];
      const result =
        i % 2 === 0
          ? await call('GET', `${cm}/${id}`, token)
          : await call('PUT', `${cm}/${id}`, token, { title: `Synthetic entry ${i}` });
      if (result.status !== 200) throw new Error(`unexpected status ${result.status}`);
      durations.push(result.ms);
    }
    await service.flush();
    return { recording, ...stats(durations), storedEvents: (await events()) - before };
  };

  const results = [];
  // Alternate to spread warm-up and caching effects over both modes.
  for (const recording of (process.env.BENCH_ORDER || 'false,true,false,true')
    .split(',')
    .map((v) => v === 'true'))
    results.push(await run(recording));
  console.log(JSON.stringify({ requests: REQUESTS, results }, null, 2));
  await app.destroy();
  fs.rmSync(root, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
