/**
 * Multi-instance behaviour (pm2 cluster, several replicas): shared counters,
 * leases, locks, settings revision, conditional session updates and locked
 * plugin-store writes. Database-backed cases use a temporary SQLite file
 * shared by two coordinators, like two processes; they are skipped when
 * better-sqlite3 is not built.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
process.env.SESSION_ENCRYPTION_KEY =
  process.env.SESSION_ENCRYPTION_KEY || 'magic-sessionmanager-test-encryption-key';

const coordination = require('../server/src/utils/coordination');
const pluginStore = require('../server/src/utils/plugin-store');
const settingsLoader = require('../server/src/utils/settings-loader');
const bootstrap = require('../server/src/bootstrap');

const {
  LockTimeoutError,
  createCoordinator,
  createDatabaseBackend,
  createMemoryBackend,
  ensureTables,
  getCoordinator,
  hashedKey,
} = coordination;

const silentLog = { debug() {}, info() {}, warn() {}, error() {} };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let knexFactory = null;
let sqliteAvailable;
try {
  const strapiDatabaseRequire = createRequire(require.resolve('@strapi/database/package.json'));
  knexFactory = strapiDatabaseRequire('knex');
  const Database = require('better-sqlite3');
  new Database(':memory:').close();
  sqliteAvailable = true;
} catch {
  sqliteAvailable = false;
}

/**
 * Opens two knex pools on one temporary SQLite file: two "processes".
 */
async function createSharedSqlite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msm-unit-'));
  const filename = path.join(dir, 'db.sqlite');
  const open = () =>
    knexFactory({
      client: 'better-sqlite3',
      connection: { filename },
      useNullAsDefault: true,
      pool: {
        min: 1,
        max: 1,
        afterCreate(conn, done) {
          conn.pragma('busy_timeout = 5000');
          done();
        },
      },
    });
  const a = open();
  const b = open();
  await ensureTables(a);
  await ensureTables(b);
  const processA = createCoordinator({ owner: 'process-a' });
  const processB = createCoordinator({ owner: 'process-b' });
  processA.attachDatabase(createDatabaseBackend({ knex: a, dialect: 'better-sqlite3' }));
  processB.attachDatabase(createDatabaseBackend({ knex: b, dialect: 'better-sqlite3' }));
  return {
    a,
    b,
    processA,
    processB,
    async close() {
      await a.destroy();
      await b.destroy();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------- memory backend

test('memory backend: fixed window counts, resets after the window, blocks and clears', async () => {
  const memory = createMemoryBackend();
  const t0 = 1_000_000;
  assert.equal((await memory.hit('k', 1000, t0)).hits, 1);
  assert.equal((await memory.hit('k', 1000, t0 + 500)).hits, 2);
  const reset = await memory.hit('k', 1000, t0 + 1000);
  assert.equal(reset.hits, 1, 'a hit at the window end starts a new window');
  assert.equal(reset.windowStart, t0 + 1000);

  await memory.block('k', t0 + 5000);
  await memory.block('k', t0 + 2000);
  assert.equal((await memory.peek('k')).blockedUntil, t0 + 5000, 'block never lowers');
  await memory.clear('k');
  assert.equal(await memory.peek('k'), null);
});

test('hashedKey never contains the raw key material', () => {
  const key = hashedKey('lf', '203.0.113.7');
  assert.match(key, /^lf:[0-9a-f]{48}$/);
  assert.ok(!key.includes('203.0.113.7'));
});

test('coordinator falls back to process-local state when the shared store fails', async () => {
  const failing = new Proxy(
    {},
    {
      get: (_target, prop) =>
        prop === 'dialect'
          ? 'postgres'
          : async () => {
              const error = new Error('connection refused');
              error.name = 'ConnectionError';
              throw error;
            },
    }
  );
  coordination.__resetMemoryForTests();
  const coordinator = createCoordinator({ database: failing, log: silentLog });
  assert.equal((await coordinator.hit('fallback:key', 60_000)).hits, 1);
  assert.equal((await coordinator.hit('fallback:key', 60_000)).hits, 2);
  assert.equal(await coordinator.tryAcquireLease('job:fallback', 1000), true);
  assert.equal(await coordinator.withLock('fallback', async () => 'ran'), 'ran');
});

test('coordinator propagates a lock timeout instead of running unlocked', async () => {
  const busy = {
    dialect: 'sqlite',
    async withLock(name) {
      throw new LockTimeoutError(name);
    },
  };
  const coordinator = createCoordinator({ database: busy, log: silentLog });
  let ran = false;
  await assert.rejects(
    coordinator.withLock('busy', async () => {
      ran = true;
    }),
    LockTimeoutError
  );
  assert.equal(ran, false);
});

test('withLock serialises callers in one process and is re-entrant', async () => {
  const coordinator = createCoordinator();
  const order = [];
  await Promise.all(
    [1, 2, 3].map((n) =>
      coordinator.withLock('serial', async () => {
        order.push(`start-${n}`);
        await sleep(5);
        order.push(`end-${n}`);
      })
    )
  );
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3']);

  const nested = await coordinator.withLock('outer', () =>
    coordinator.withLock('outer', async () => 'nested-ok')
  );
  assert.equal(nested, 'nested-ok');
});

test('a configured counter store (for example Redis) is used for counters', async () => {
  const calls = [];
  const counterStore = {
    async hit(key, windowMs) {
      calls.push(['hit', key, windowMs]);
      return { hits: 42, windowStart: 1, blockedUntil: 0 };
    },
    async peek() {
      return null;
    },
    async block() {},
    async clear() {},
  };
  const coordinator = createCoordinator({ counterStore });
  assert.equal((await coordinator.hit('rl:abc', 1000)).hits, 42);
  assert.deepEqual(calls, [['hit', 'rl:abc', 1000]]);
  assert.equal(coordinator.mode, 'custom+memory');
});

test('config validator accepts coordination options and rejects incomplete stores', () => {
  const { validator } = require('../server/src/config');
  assert.doesNotThrow(() => validator({ coordination: { enabled: false } }));
  assert.doesNotThrow(() =>
    validator({
      coordination: {
        counterStore: { hit() {}, peek() {}, block() {}, clear() {} },
      },
    })
  );
  assert.throws(() => validator({ coordination: { counterStore: { hit() {} } } }));
  assert.throws(() => validator({ coordination: { enabled: 'yes' } }));
});

// ---------------------------------------------------------------- database backend

test(
  'database backend: two processes share counters, leases, locks and the cache',
  { skip: !sqliteAvailable && 'better-sqlite3 not available' },
  async () => {
    const shared = await createSharedSqlite();
    try {
      const { processA, processB } = shared;
      await processA.hit('lf:shared', 60_000);
      await processB.hit('lf:shared', 60_000);
      assert.equal((await processA.hit('lf:shared', 60_000)).hits, 3);
      await processB.block('lf:shared', Date.now() + 60_000);
      assert.ok((await processA.peek('lf:shared')).blockedUntil > Date.now());
      await processA.clear('lf:shared');
      assert.equal(await processB.peek('lf:shared'), null);

      assert.equal(await processA.tryAcquireLease('job:test', 60_000), true);
      assert.equal(await processB.tryAcquireLease('job:test', 60_000), false);
      assert.equal(await processA.tryAcquireLease('job:test', 60_000), true, 'owner extends');
      await processA.releaseLease('job:test');
      assert.equal(await processB.tryAcquireLease('job:test', 60_000), true);

      assert.equal(await processA.tryAcquireLease('job:short', 1), true);
      await sleep(5);
      assert.equal(await processB.tryAcquireLease('job:short', 60_000), true, 'expired lease');

      await processA.bumpRevision('settings');
      await processB.bumpRevision('settings');
      assert.equal(await processA.getRevision('settings'), 2);

      await processA.cacheSet('geo:x', { country: 'DE' }, 60_000);
      assert.deepEqual(await processB.cacheGet('geo:x'), { country: 'DE' });
      await processA.cacheSet('geo:old', { country: 'FR' }, 1);
      await sleep(5);
      assert.equal(await processB.cacheGet('geo:old'), null);
      assert.ok((await processB.prune()) >= 1);

      let inside = 0;
      let maxInside = 0;
      await Promise.all(
        [processA, processB, processA, processB].map((coordinator) =>
          coordinator.withLock('critical', async () => {
            inside++;
            maxInside = Math.max(maxInside, inside);
            await sleep(10);
            inside--;
          })
        )
      );
      assert.equal(maxInside, 1, 'the lock admits one holder across processes');
    } finally {
      await shared.close();
    }
  }
);

test(
  'failed-login lockout is shared: failures on one process lock the IP on the other',
  { skip: !sqliteAvailable && 'better-sqlite3 not available' },
  async () => {
    const shared = await createSharedSqlite();
    settingsLoader.invalidateSettingsCache();
    try {
      const makeProcess = (coordinator) => {
        const middlewares = [];
        const strapi = {
          log: silentLog,
          config: { get: (key) => (key === 'plugin::magic-sessionmanager' ? {} : undefined) },
          store: () => ({ get: async () => ({ maxFailedLogins: 3 }) }),
          server: { use: (fn) => middlewares.push(fn) },
        };
        // Bind this fake process to its own database connection.
        const own = getCoordinator(strapi);
        own.attachDatabase(
          createDatabaseBackend({
            knex: coordinator === shared.processA ? shared.a : shared.b,
            dialect: 'better-sqlite3',
          })
        );
        bootstrap.__private.mountFailedLoginLockout({ strapi, log: silentLog });
        return middlewares[0];
      };
      const processA = makeProcess(shared.processA);
      const processB = makeProcess(shared.processB);

      const attempt = async (middleware, status) => {
        const ctx = {
          path: '/api/auth/local',
          method: 'POST',
          request: { ip: '198.51.100.23', headers: {} },
          state: {},
          headers: {},
          set() {},
          status: 0,
          body: null,
        };
        await middleware(ctx, async () => {
          ctx.status = status;
          ctx.body = status === 200 ? { jwt: 'x' } : { error: {} };
        });
        return ctx.status;
      };

      assert.equal(await attempt(processA, 400), 400);
      assert.equal(await attempt(processB, 400), 400);
      assert.equal(await attempt(processA, 400), 400);
      assert.equal(await attempt(processB, 200), 429, 'the other process sees the lock');
      assert.equal(await attempt(processA, 200), 429);
    } finally {
      settingsLoader.invalidateSettingsCache();
      await shared.close();
    }
  }
);

test(
  'a rate limit applies once across processes, not once per process',
  { skip: !sqliteAvailable && 'better-sqlite3 not available' },
  async () => {
    const shared = await createSharedSqlite();
    try {
      const rateLimit = require('../server/src/middlewares/rate-limit');
      const route = { method: 'POST', path: '/logout', handler: 'session.logout' };
      const instances = [shared.a, shared.b].map((knex) => {
        const strapi = { log: silentLog };
        getCoordinator(strapi).attachDatabase(
          createDatabaseBackend({ knex, dialect: 'better-sqlite3' })
        );
        return rateLimit({ max: 2, window: 60_000 }, { strapi });
      });
      const statuses = [];
      for (const middleware of [instances[0], instances[1], instances[0], instances[1]]) {
        const ctx = {
          path: '/api/magic-sessionmanager/logout',
          method: 'POST',
          request: { ip: '192.0.2.10' },
          state: { user: { id: 9 }, route },
          set() {},
          status: 200,
          body: {},
        };
        await middleware(ctx, async () => {});
        statuses.push(ctx.status);
      }
      assert.deepEqual(statuses, [200, 200, 429, 429]);
    } finally {
      await shared.close();
    }
  }
);

// ---------------------------------------------------------------- settings revision

function createSettingsStrapi(initial) {
  const state = { stored: initial, writes: 0 };
  return {
    state,
    strapi: {
      log: silentLog,
      config: { get: () => ({}) },
      store: () => ({
        get: async () => state.stored,
        set: async ({ value }) => {
          state.writes++;
          state.stored = value;
        },
      }),
    },
  };
}

function settingsCtx(body) {
  return {
    request: { body },
    status: 200,
    sent: null,
    send(payload) {
      this.sent = payload;
    },
    badRequest(message, details) {
      this.status = 400;
      this.error = { message, details };
      return this.error;
    },
  };
}

test('settings PUT with a stale revision is rejected with 409 and writes nothing', async () => {
  coordination.__resetMemoryForTests();
  const controller = require('../server/src/controllers/settings');
  const { state, strapi } = createSettingsStrapi({ maxFailedLogins: 5 });
  global.strapi = strapi;

  const read = settingsCtx();
  await controller.getSettings(read);
  const baseRevision = read.sent.revision;
  assert.equal(Number.isInteger(baseRevision), true);

  const first = settingsCtx({ maxFailedLogins: 7, revision: baseRevision });
  await controller.updateSettings(first);
  assert.equal(first.sent.success, true);
  assert.equal(first.sent.revision, baseRevision + 1);

  const stale = settingsCtx({ maxFailedLogins: 9, revision: baseRevision });
  await controller.updateSettings(stale);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.details.revision, baseRevision + 1);
  assert.equal(state.stored.maxFailedLogins, 7);
  assert.equal(state.writes, 1);

  const legacyClient = settingsCtx({ maxFailedLogins: 4 });
  await controller.updateSettings(legacyClient);
  assert.equal(legacyClient.sent.success, true, 'clients without a revision keep working');
  assert.equal(state.stored.maxFailedLogins, 4);

  const invalid = settingsCtx({ maxFailedLogins: 1, revision: 'x' });
  await controller.updateSettings(invalid);
  assert.equal(invalid.status, 400);
});

test('a settings change on another process reaches this process via the revision', async () => {
  coordination.__resetMemoryForTests();
  settingsLoader.invalidateSettingsCache();
  const { state, strapi } = createSettingsStrapi({ maxFailedLogins: 5 });
  try {
    assert.equal((await settingsLoader.getPluginSettings(strapi)).maxFailedLogins, 5);
    // Another process saves and bumps the shared revision. This process's
    // cache is not invalidated directly.
    state.stored = { maxFailedLogins: 2 };
    await getCoordinator(strapi).bumpRevision('settings');
    assert.equal((await settingsLoader.getPluginSettings(strapi)).maxFailedLogins, 5);
    await sleep(2100);
    assert.equal((await settingsLoader.getPluginSettings(strapi)).maxFailedLogins, 2);
  } finally {
    settingsLoader.invalidateSettingsCache();
  }
});

// ---------------------------------------------------------------- plugin store

test('locked plugin-store writes remove duplicate Core Store rows first', async () => {
  const rows = [
    { id: 3, key: 'plugin_magic-sessionmanager_settings' },
    { id: 9, key: 'plugin_magic-sessionmanager_settings' },
    { id: 5, key: 'plugin_magic-sessionmanager_settings' },
  ];
  const writes = [];
  const strapi = {
    log: silentLog,
    db: {
      query: () => ({
        async findMany({ where, orderBy }) {
          assert.equal(where.key, 'plugin_magic-sessionmanager_settings');
          assert.deepEqual(orderBy, { id: 'desc' });
          return [...rows].sort((x, y) => y.id - x.id).map(({ id }) => ({ id }));
        },
        async deleteMany({ where }) {
          const ids = where.id.$in;
          for (const id of ids)
            rows.splice(
              rows.findIndex((row) => row.id === id),
              1
            );
          return { count: ids.length };
        },
      }),
    },
    store: () => ({
      async set(payload) {
        writes.push(payload);
      },
    }),
  };
  await pluginStore.setPluginStoreValue(strapi, 'settings', { a: 1 });
  assert.deepEqual(
    rows.map((row) => row.id),
    [9],
    'the newest row is kept'
  );
  assert.deepEqual(writes, [{ key: 'settings', value: { a: 1 } }]);
});

// ---------------------------------------------------------------- permissions

test('permission setup removes duplicate rows and creates only missing actions', async () => {
  const permissions = [
    { id: 1, documentId: 'p1', action: 'plugin::magic-sessionmanager.session.logout' },
    { id: 2, documentId: 'p2', action: 'plugin::magic-sessionmanager.session.logout' },
  ];
  const created = [];
  const deleted = [];
  const storeValues = {};
  const strapi = {
    log: silentLog,
    store: () => ({
      get: async ({ key }) => storeValues[key] ?? null,
      set: async ({ key, value }) => {
        storeValues[key] = value;
      },
    }),
    documents(uid) {
      if (uid === 'plugin::users-permissions.role') {
        return { findMany: async () => [{ id: 1 }] };
      }
      return {
        findMany: async () => permissions.map((permission) => ({ ...permission })),
        create: async ({ data }) => created.push(data.action),
        delete: async ({ documentId }) => deleted.push(documentId),
      };
    },
  };
  const ok = await bootstrap.__private.ensureContentApiPermissions(strapi, silentLog);
  assert.equal(ok, true);
  assert.deepEqual(deleted, ['p2'], 'the lowest id is kept');
  assert.equal(created.length, 6);
  assert.ok(!created.includes('plugin::magic-sessionmanager.session.logout'));
  assert.equal(storeValues.contentApiPermissionsVersion, 2);
});

// ---------------------------------------------------------------- conditional updates

test('JWT verify does not revive a session another instance terminated meanwhile', async () => {
  settingsLoader.invalidateSettingsCache();
  const jwtService = { verify: async () => ({ id: 7, iat: Math.floor(Date.now() / 1000) - 60 }) };
  const updates = [];
  const strapi = {
    plugin: () => ({ service: () => jwtService }),
    entityService: { findOne: async () => ({ documentId: 'user-doc-id' }) },
    documents(uid) {
      if (uid === 'plugin::magic-sessionmanager.revoked-token')
        return { findFirst: async () => null };
      if (uid === 'plugin::users-permissions.user') {
        return { findOne: async () => ({ documentId: 'user-doc-id', blocked: false }) };
      }
      return {
        // Snapshot: legacy inactive row without a reason (reactivatable).
        findFirst: async () => ({
          documentId: 'legacy',
          isActive: false,
          terminatedManually: false,
          terminationReason: null,
          lastActive: new Date(),
          loginTime: new Date(),
        }),
      };
    },
    db: {
      query: () => ({
        // Another instance set terminationReason='manual' after the read.
        updateMany: async (payload) => {
          updates.push(payload);
          return { count: 0 };
        },
      }),
    },
    config: {
      get: (key, fallback) =>
        key === 'plugin::magic-sessionmanager' ? { strictSessionEnforcement: true } : fallback,
    },
    store: () => ({ get: async () => ({ strictSessionEnforcement: true, inactivityTimeout: 60 }) }),
    log: silentLog,
  };
  try {
    await bootstrap.__private.registerSessionAwareAuthStrategy(strapi);
    assert.equal(await jwtService.verify('y'.repeat(80)), null);
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].where.terminationReason, { $null: true });
    assert.equal(updates[0].where.isActive, false);
  } finally {
    settingsLoader.invalidateSettingsCache();
  }
});

test('idle cleanup skips rows that became active after the scan', async () => {
  settingsLoader.invalidateSettingsCache();
  const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const rows = new Map([
    ['stale', { documentId: 'stale', isActive: true, lastActive: old, loginTime: old }],
    ['fresh', { documentId: 'fresh', isActive: true, lastActive: old, loginTime: old }],
  ]);
  const matches = (row, where) => {
    if (row.documentId !== where.documentId || row.isActive !== where.isActive) return false;
    return where.$or.some(
      (part) =>
        (part.lastActive?.$lt && row.lastActive && row.lastActive < part.lastActive.$lt) ||
        (part.lastActive?.$null && !row.lastActive && row.loginTime < part.loginTime.$lt)
    );
  };
  const strapi = {
    log: silentLog,
    config: {
      get: (key, fallback) =>
        key === 'plugin::magic-sessionmanager' ? { inactivityTimeout: 15 * 60 * 1000 } : fallback,
    },
    store: () => ({ get: async () => null }),
    documents: () => ({
      async findMany({ start = 0 }) {
        if (start > 0) return [];
        const snapshot = [...rows.values()].map((row) => ({ ...row }));
        // Another instance touches "fresh" right after this snapshot.
        rows.get('fresh').lastActive = new Date();
        return snapshot;
      },
    }),
    db: {
      query: () => ({
        async updateMany({ where, data }) {
          const row = rows.get(where.documentId);
          if (!row || !matches(row, where)) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      }),
    },
  };
  const service = require('../server/src/services/session')({ strapi });
  const count = await service.cleanupInactiveSessions();
  assert.equal(count, 1);
  assert.equal(rows.get('stale').isActive, false);
  assert.equal(rows.get('stale').terminationReason, 'idle');
  assert.equal(rows.get('fresh').isActive, true, 'a freshly touched session survives');
  settingsLoader.invalidateSettingsCache();
});

test('two parallel toggle requests flip the block state twice, not once', async () => {
  let blocked = false;
  const responses = [];
  global.strapi = {
    log: silentLog,
    plugin: () => ({ service: () => ({ terminateSession: async () => {} }) }),
    entityService: { findOne: async () => ({ documentId: 'user-1' }) },
    documents: () => ({
      async findOne() {
        const snapshot = { documentId: 'user-1', blocked };
        await sleep(10);
        return snapshot;
      },
      async update({ data }) {
        await sleep(5);
        blocked = data.blocked;
      },
    }),
  };
  const controller = require('../server/src/controllers/session');
  const ctxFor = () => ({
    params: { userId: 'user-1' },
    request: { body: {} },
    notFound() {
      throw new Error('unexpected 404');
    },
    badRequest() {
      throw new Error('unexpected 400');
    },
    internalServerError(message) {
      throw new Error(message);
    },
  });
  const a = ctxFor();
  const b = ctxFor();
  await Promise.all([controller.toggleUserBlock(a), controller.toggleUserBlock(b)]);
  responses.push(a.body.blocked, b.body.blocked);
  assert.deepEqual(responses.sort(), [false, true]);
  assert.equal(blocked, false, 'two toggles return to the original state');
});

test('a wrong password thrown as ValidationError counts as a failed login', async () => {
  coordination.__resetMemoryForTests();
  settingsLoader.invalidateSettingsCache();
  const middlewares = [];
  const strapi = {
    log: silentLog,
    config: { get: (key) => (key === 'plugin::magic-sessionmanager' ? {} : undefined) },
    store: () => ({ get: async () => ({ maxFailedLogins: 2 }) }),
    server: { use: (fn) => middlewares.push(fn) },
  };
  bootstrap.__private.mountFailedLoginLockout({ strapi, log: silentLog });
  const [middleware] = middlewares;
  const ctxFor = () => ({
    path: '/api/auth/local',
    method: 'POST',
    request: { ip: '203.0.113.99', headers: {} },
    state: {},
    set() {},
    status: 404,
    body: null,
  });
  const wrongPassword = async () => {
    const error = new Error('Invalid identifier or password');
    error.name = 'ValidationError';
    throw error;
  };
  try {
    await assert.rejects(middleware(ctxFor(), wrongPassword), { name: 'ValidationError' });
    await assert.rejects(middleware(ctxFor(), wrongPassword), { name: 'ValidationError' });
    const locked = ctxFor();
    await middleware(locked, async () => {
      throw new Error('the handler must not run while locked');
    });
    assert.equal(locked.status, 429);
  } finally {
    settingsLoader.invalidateSettingsCache();
    coordination.__resetMemoryForTests();
  }
});

test(
  'a parallel burst of wrong passwords reaches the password check at most maxFailedLogins times',
  { skip: !sqliteAvailable && 'better-sqlite3 not available' },
  async () => {
    const shared = await createSharedSqlite();
    settingsLoader.invalidateSettingsCache();
    try {
      const mount = (knex) => {
        const middlewares = [];
        const strapi = {
          log: silentLog,
          config: { get: (key) => (key === 'plugin::magic-sessionmanager' ? {} : undefined) },
          store: () => ({ get: async () => ({ maxFailedLogins: 3 }) }),
          server: { use: (fn) => middlewares.push(fn) },
        };
        getCoordinator(strapi).attachDatabase(
          createDatabaseBackend({ knex, dialect: 'better-sqlite3' })
        );
        bootstrap.__private.mountFailedLoginLockout({ strapi, log: silentLog });
        return middlewares[0];
      };
      const processes = [mount(shared.a), mount(shared.b)];
      let checks = 0;
      const attempt = async (index) => {
        const ctx = {
          path: '/api/auth/local',
          method: 'POST',
          request: { ip: '198.51.100.77', headers: {} },
          state: {},
          set() {},
          status: 404,
          body: null,
        };
        try {
          await processes[index % 2](ctx, async () => {
            checks++;
            await sleep(20);
            const error = new Error('Invalid identifier or password');
            error.name = 'ValidationError';
            throw error;
          });
        } catch (err) {
          assert.equal(err.name, 'ValidationError');
          return 400;
        }
        return ctx.status;
      };
      const statuses = await Promise.all(Array.from({ length: 20 }, (_, i) => attempt(i)));
      assert.equal(checks, 3, 'only the reserved attempts reach the handler');
      assert.equal(statuses.filter((s) => s === 400).length, 3);
      assert.equal(statuses.filter((s) => s === 429).length, 17);
    } finally {
      settingsLoader.invalidateSettingsCache();
      await shared.close();
    }
  }
);

test('parallel correct logins from one address are throttled briefly but never lock it', async () => {
  coordination.__resetMemoryForTests();
  settingsLoader.invalidateSettingsCache();
  const middlewares = [];
  const strapi = {
    log: silentLog,
    config: { get: (key) => (key === 'plugin::magic-sessionmanager' ? {} : undefined) },
    store: () => ({ get: async () => ({ maxFailedLogins: 3 }) }),
    server: { use: (fn) => middlewares.push(fn) },
  };
  bootstrap.__private.mountFailedLoginLockout({ strapi, log: silentLog });
  const [middleware] = middlewares;
  const login = async (delay) => {
    const ctx = {
      path: '/api/auth/local',
      method: 'POST',
      request: { ip: '203.0.113.97', headers: {} },
      state: {},
      set() {},
      status: 404,
      body: null,
    };
    await middleware(ctx, async () => {
      await sleep(delay);
      ctx.status = 200;
      ctx.body = { jwt: 'x' };
    });
    return ctx.status;
  };
  try {
    const statuses = await Promise.all(Array.from({ length: 6 }, () => login(20)));
    assert.equal(statuses.filter((s) => s === 200).length, 3);
    assert.equal(statuses.filter((s) => s === 429).length, 3);
    assert.equal(await login(0), 200, 'the address is not locked afterwards');
    const entry = await getCoordinator(strapi).peek(hashedKey('lf', '203.0.113.97'));
    assert.ok(!entry || entry.blockedUntil === 0, 'no block was written');
  } finally {
    settingsLoader.invalidateSettingsCache();
    coordination.__resetMemoryForTests();
  }
});

test('a login that fails with a server error gives its reserved attempt back', async () => {
  coordination.__resetMemoryForTests();
  settingsLoader.invalidateSettingsCache();
  const middlewares = [];
  const strapi = {
    log: silentLog,
    config: { get: (key) => (key === 'plugin::magic-sessionmanager' ? {} : undefined) },
    store: () => ({ get: async () => ({ maxFailedLogins: 2 }) }),
    server: { use: (fn) => middlewares.push(fn) },
  };
  bootstrap.__private.mountFailedLoginLockout({ strapi, log: silentLog });
  const [middleware] = middlewares;
  const ctxFor = () => ({
    path: '/api/auth/local',
    method: 'POST',
    request: { ip: '203.0.113.98', headers: {} },
    state: {},
    set() {},
    status: 404,
    body: null,
  });
  try {
    for (let i = 0; i < 5; i++) {
      const ctx = ctxFor();
      await middleware(ctx, async () => {
        ctx.status = 500;
      });
      assert.equal(ctx.status, 500, 'server errors never lock the client');
    }
    const entry = await getCoordinator(strapi).peek(hashedKey('lf', '203.0.113.98'));
    assert.equal(entry.hits, 0);
  } finally {
    settingsLoader.invalidateSettingsCache();
    coordination.__resetMemoryForTests();
  }
});

test(
  'database counter: parallel hits each report their own count',
  { skip: !sqliteAvailable && 'better-sqlite3 not available' },
  async () => {
    const shared = await createSharedSqlite();
    try {
      const values = await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          (i % 2 ? shared.processA : shared.processB).hit('test:exact', 60_000)
        )
      );
      assert.deepEqual(
        values.map((v) => v.hits).sort((a, b) => a - b),
        Array.from({ length: 30 }, (_, i) => i + 1)
      );
      const revisions = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          (i % 2 ? shared.processA : shared.processB).bumpRevision('exact')
        )
      );
      assert.deepEqual(
        revisions.sort((a, b) => a - b),
        Array.from({ length: 10 }, (_, i) => i + 1)
      );
    } finally {
      await shared.close();
    }
  }
);

test(
  'a job lease taken under a longer interval does not delay a shortened one',
  { skip: !sqliteAvailable && 'better-sqlite3 not available' },
  async () => {
    const shared = await createSharedSqlite();
    try {
      const minutes = (n) => n * 60_000;
      // Process A ran the job under a 30-minute interval, then was replaced.
      assert.equal(await shared.processA.tryAcquireLease('job:idle', minutes(29.5)), true);
      // Same interval: B must wait.
      assert.equal(await shared.processB.tryAcquireLease('job:idle', minutes(29.5)), false);
      // Interval shortened to 5 minutes: B may take over at once, exactly once.
      const [first, second] = await Promise.all([
        shared.processB.tryAcquireLease('job:idle', minutes(4.5)),
        shared.processB.tryAcquireLease('job:idle', minutes(4.5)),
      ]);
      assert.equal(first || second, true);
      assert.equal(await shared.processA.tryAcquireLease('job:idle', minutes(4.5)), false);

      const memory = createMemoryBackend();
      assert.equal(await memory.tryAcquireLease('job', minutes(29.5), 'a'), true);
      assert.equal(await memory.tryAcquireLease('job', minutes(29.5), 'b'), false);
      assert.equal(await memory.tryAcquireLease('job', minutes(4.5), 'b'), true);
      assert.equal(await memory.tryAcquireLease('job', minutes(4.5), 'a'), false);
    } finally {
      await shared.close();
    }
  }
);
