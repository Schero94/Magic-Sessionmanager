'use strict';

/**
 * Cross-process coordination for multi-instance deployments.
 *
 * Several Strapi processes (pm2 cluster workers, Railway replicas, Kubernetes
 * pods) share one database but no memory. Everything that must be consistent
 * across them goes through this module:
 *
 *  - fixed-window counters (failed-login lockout, Content-API rate limits),
 *  - revision counters (settings cache invalidation),
 *  - job leases (cleanup and retention run on one process per interval),
 *  - named critical sections (plugin-store writes, permission setup),
 *  - a small TTL cache (shared ipapi.co results and back-off marker).
 *
 * The database is the single source of truth, so no extra infrastructure is
 * required. Three plugin-owned tables are created on bootstrap with portable
 * knex schema calls (`magic_sm_counters`, `magic_sm_leases`,
 * `magic_sm_cache`). Strapi's schema sync leaves tables alone that are
 * neither in the content-type schema nor in its previously persisted schema
 * (@strapi/database 5.61 `schema/diff.js`), so they survive restarts.
 *
 * Portability: every write is either a single-row `UPDATE ... WHERE ...`
 * (atomic on PostgreSQL, MySQL and SQLite) or an `INSERT` with knex
 * `onConflict().ignore()` / `.merge()` (ON CONFLICT on PostgreSQL and
 * SQLite >= 3.24, INSERT IGNORE / ON DUPLICATE KEY UPDATE on MySQL).
 * Critical sections use `pg_advisory_xact_lock` on PostgreSQL and a lease row
 * elsewhere.
 *
 * Until `init()` succeeds, and whenever a database call fails, the
 * coordinator falls back to an in-process implementation with the same
 * semantics as the plugin had before (per-process state). A custom counter
 * store (for example Redis) can be configured through
 * `config.coordination.counterStore`; see README "Running several instances".
 */

const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');
const os = require('node:os');

/** Names of the critical sections held by the current async call chain. */
const heldLocks = new AsyncLocalStorage();

const TABLES = Object.freeze({
  counters: 'magic_sm_counters',
  leases: 'magic_sm_leases',
  cache: 'magic_sm_cache',
});

/** First key of the two-key PostgreSQL advisory lock space used by this plugin. */
const PG_LOCK_NAMESPACE = 0x4d534d; // "MSM"
const NEVER_EXPIRES = 8_000_000_000_000_000; // < 2^63, > any realistic epoch ms
const MAX_KEY_LENGTH = 191;
/**
 * A held lease is taken over when it ends more than this much later than a
 * lease taken now with the caller's TTL would (see tryAcquireLease).
 */
const LEASE_SHRINK_MARGIN_MS = 60_000;
const COUNTER_COLUMNS = Object.freeze(['hits', 'window_start', 'blocked_until']);

let instanceIdCache = null;

/**
 * Returns a stable identifier for this process. Used as lease owner.
 * It contains a hash of the host name, never the host name itself.
 *
 * @returns {string}
 */
function getInstanceId() {
  if (instanceIdCache) return instanceIdCache;
  let host = 'unknown';
  try {
    host = os.hostname() || 'unknown';
  } catch {
    // keep default
  }
  const hostHash = crypto.createHash('sha256').update(host).digest('hex').slice(0, 12);
  instanceIdCache = `${hostHash}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`;
  return instanceIdCache;
}

/**
 * Returns a short, non-reversible identifier of this host (no PID), for
 * display in status endpoints.
 *
 * @returns {string}
 */
function getHostFingerprint() {
  return getInstanceId().split(':')[0];
}

/**
 * Builds a bounded storage key. Raw parts (IPs, user ids, route paths) are
 * hashed so the tables never store them in clear text.
 *
 * @param {string} prefix Short namespace such as "lf" or "rl"
 * @param {string} raw Raw key material
 * @returns {string}
 */
function hashedKey(prefix, raw) {
  const digest = crypto.createHash('sha256').update(String(raw)).digest('hex').slice(0, 48);
  return `${prefix}:${digest}`;
}

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function assertKey(key) {
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) {
    throw new TypeError('coordination key must be a non-empty string of at most 191 characters');
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Error thrown when a named critical section could not be entered in time.
 */
class LockTimeoutError extends Error {
  constructor(name) {
    super(`Timed out waiting for lock "${name}"`);
    this.name = 'LockTimeoutError';
  }
}

// ---------------------------------------------------------------------------
// In-process backend (fallback and single-process default)
// ---------------------------------------------------------------------------

/**
 * Creates the in-process backend. Its semantics match the database backend,
 * scoped to one process.
 *
 * @returns {object}
 */
function createMemoryBackend() {
  const counters = new Map();
  const leases = new Map();
  const revisions = new Map();
  const lockTails = new Map();

  const pruneCounters = (now) => {
    if (counters.size < 5000) return;
    for (const [k, v] of counters) {
      if (v.expiresAt <= now && v.blockedUntil <= now) counters.delete(k);
    }
  };

  return {
    mode: 'memory',

    async hit(key, windowMs, now = Date.now()) {
      pruneCounters(now);
      let entry = counters.get(key);
      if (!entry) {
        entry = { hits: 0, windowStart: 0, blockedUntil: 0, expiresAt: 0 };
        counters.set(key, entry);
      }
      if (entry.windowStart <= now - windowMs) {
        entry.hits = 1;
        entry.windowStart = now;
      } else {
        entry.hits += 1;
      }
      entry.expiresAt = Math.max(entry.expiresAt, now + windowMs);
      return { hits: entry.hits, windowStart: entry.windowStart, blockedUntil: entry.blockedUntil };
    },

    async peek(key) {
      const entry = counters.get(key);
      if (!entry) return null;
      return { hits: entry.hits, windowStart: entry.windowStart, blockedUntil: entry.blockedUntil };
    },

    async block(key, untilMs) {
      const entry = counters.get(key) || {
        hits: 0,
        windowStart: 0,
        blockedUntil: 0,
        expiresAt: 0,
      };
      if (entry.blockedUntil < untilMs) entry.blockedUntil = untilMs;
      entry.expiresAt = Math.max(entry.expiresAt, untilMs);
      counters.set(key, entry);
    },

    async clear(key) {
      counters.delete(key);
    },

    async release(key) {
      const entry = counters.get(key);
      if (entry && entry.hits > 0) entry.hits -= 1;
    },

    async getRevision(name) {
      return revisions.get(name) || 0;
    },

    async bumpRevision(name) {
      const next = (revisions.get(name) || 0) + 1;
      revisions.set(name, next);
      return next;
    },

    async tryAcquireLease(name, ttlMs, owner, now = Date.now()) {
      const lease = leases.get(name);
      if (
        lease &&
        lease.until > now &&
        lease.owner !== owner &&
        lease.until <= now + ttlMs + LEASE_SHRINK_MARGIN_MS
      ) {
        return false;
      }
      leases.set(name, { owner, until: now + ttlMs });
      return true;
    },

    async releaseLease(name, owner) {
      const lease = leases.get(name);
      if (lease && lease.owner === owner) leases.delete(name);
    },

    async withLock(name, fn) {
      const previous = lockTails.get(name) || Promise.resolve();
      let release;
      const current = new Promise((resolve) => {
        release = resolve;
      });
      const tail = previous.then(() => current);
      lockTails.set(name, tail);
      await previous;
      try {
        return await fn();
      } finally {
        release();
        if (lockTails.get(name) === tail) lockTails.delete(name);
      }
    },

    // The shared cache is an L2 behind per-module L1 caches; in memory mode
    // the L1 caches already cover the process, so this layer stays empty.
    async cacheGet() {
      return null;
    },

    async cacheSet() {},

    async prune(now = Date.now()) {
      let removed = 0;
      for (const [k, v] of counters) {
        if (v.expiresAt <= now && v.blockedUntil <= now) {
          counters.delete(k);
          removed++;
        }
      }
      return removed;
    },

    reset() {
      counters.clear();
      leases.clear();
      revisions.clear();
      lockTails.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Database backend
// ---------------------------------------------------------------------------

/**
 * Normalises a knex/Strapi dialect name.
 *
 * @param {string} client
 * @returns {'postgres'|'mysql'|'sqlite'|'other'}
 */
function normalizeDialect(client) {
  const value = String(client || '').toLowerCase();
  if (value === 'postgres' || value === 'pg' || value === 'postgresql') return 'postgres';
  if (value === 'mysql' || value === 'mysql2' || value === 'mariadb') return 'mysql';
  if (value === 'sqlite' || value === 'sqlite3' || value === 'better-sqlite3') return 'sqlite';
  return 'other';
}

/**
 * Creates the plugin coordination tables if they do not exist yet. Safe to
 * run from several processes at once: a losing CREATE TABLE is caught and
 * the table is re-checked.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 * @throws {Error} When a table is still missing after the attempt
 */
async function ensureTables(knex) {
  const definitions = [
    [
      TABLES.counters,
      (table) => {
        table.string('k', MAX_KEY_LENGTH).notNullable().primary();
        table.integer('hits').notNullable().defaultTo(0);
        table.bigInteger('window_start').notNullable().defaultTo(0);
        table.bigInteger('blocked_until').notNullable().defaultTo(0);
        table.bigInteger('expires_at').notNullable().defaultTo(0);
        table.index(['expires_at'], 'magic_sm_counters_expires_idx');
      },
    ],
    [
      TABLES.leases,
      (table) => {
        table.string('name', MAX_KEY_LENGTH).notNullable().primary();
        table.string('owner', MAX_KEY_LENGTH).notNullable().defaultTo('');
        table.bigInteger('lease_until').notNullable().defaultTo(0);
      },
    ],
    [
      TABLES.cache,
      (table) => {
        table.string('k', MAX_KEY_LENGTH).notNullable().primary();
        table.text('v');
        table.bigInteger('expires_at').notNullable().defaultTo(0);
        table.index(['expires_at'], 'magic_sm_cache_expires_idx');
      },
    ],
  ];

  for (const [name, build] of definitions) {
    if (await knex.schema.hasTable(name)) continue;
    try {
      await knex.schema.createTable(name, build);
    } catch (err) {
      // Another process may have created it between hasTable and createTable.
      if (!(await knex.schema.hasTable(name))) throw err;
    }
  }
}

/**
 * Creates the database backend on a knex instance.
 *
 * @param {{knex: import('knex').Knex, dialect: string}} options
 * @returns {object}
 */
function createDatabaseBackend({ knex, dialect }) {
  const kind = normalizeDialect(dialect);

  const readCounter = async (key) => {
    const row = await knex(TABLES.counters)
      .select('hits', 'window_start', 'blocked_until')
      .where({ k: key })
      .first();
    if (!row) return null;
    return {
      hits: toNumber(row.hits),
      windowStart: toNumber(row.window_start),
      blockedUntil: toNumber(row.blocked_until),
    };
  };

  const ensureCounterRow = (key, expiresAt) =>
    knex(TABLES.counters)
      .insert({ k: key, hits: 0, window_start: 0, blocked_until: 0, expires_at: expiresAt })
      .onConflict('k')
      .ignore();

  const supportsReturning = kind === 'postgres' || kind === 'sqlite';

  const toCounter = (row) =>
    row
      ? {
          hits: toNumber(row.hits),
          windowStart: toNumber(row.window_start),
          blockedUntil: toNumber(row.blocked_until),
        }
      : null;

  /**
   * Runs a single-row counter UPDATE and returns the row as written by it,
   * or null when no row matched.
   *
   * @param {string} key
   * @param {(qb: import('knex').Knex.QueryBuilder) => Promise<object[]>} withReturning
   * @param {(trx: import('knex').Knex.Transaction) => Promise<number>} withoutReturning
   * @returns {Promise<{hits: number, windowStart: number, blockedUntil: number}|null>}
   */
  const updateCounterReturning = async (key, withReturning, withoutReturning) => {
    if (supportsReturning) {
      const rows = await withReturning(knex(TABLES.counters).where({ k: key }));
      return Array.isArray(rows) && rows.length > 0 ? toCounter(rows[0]) : null;
    }
    return knex.transaction(async (trx) => {
      if (toNumber(await withoutReturning(trx)) === 0) return null;
      const row = await trx(TABLES.counters)
        .select(...COUNTER_COLUMNS)
        .where({ k: key })
        .forUpdate()
        .first();
      return toCounter(row);
    });
  };

  const tryAcquireLease = async (name, ttlMs, owner, now = Date.now()) => {
    await knex(TABLES.leases)
      .insert({ name, owner: '', lease_until: 0 })
      .onConflict('name')
      .ignore();
    const changed = await knex(TABLES.leases)
      .where({ name })
      .andWhere((qb) => {
        // Free when expired or already ours. A lease that ends later than a
        // fresh one would (plus a margin for clock skew between hosts) was
        // taken under a longer interval, for example before the cleanup
        // interval was shortened or by a process that has since been
        // replaced; it may be taken over, so the new interval applies
        // without waiting for the old lease to run out.
        qb.where('lease_until', '<=', now)
          .orWhere('owner', owner)
          .orWhere('lease_until', '>', now + ttlMs + LEASE_SHRINK_MARGIN_MS);
      })
      .update({ owner, lease_until: now + ttlMs });
    return toNumber(changed) === 1;
  };

  const releaseLease = async (name, owner) => {
    await knex(TABLES.leases).where({ name, owner }).update({ lease_until: 0 });
  };

  return {
    mode: 'database',
    dialect: kind,

    /**
     * Increments a fixed-window counter in one atomic UPDATE and returns the
     * value written by THIS update. The CASE expressions only read
     * `window_start`, which is assigned last, so the result is the same under
     * MySQL's left-to-right SET evaluation and the all-old-values semantics
     * of PostgreSQL and SQLite.
     *
     * Reading the row in a separate statement after the UPDATE would return
     * the count after later concurrent increments as well, so under a burst
     * most callers would see a number above the limit and be rejected
     * (measured: 2 of 48 parallel requests allowed with a limit of 10).
     * PostgreSQL and SQLite therefore use `UPDATE ... RETURNING` (knex
     * `returning`, SQLite >= 3.35); other dialects run UPDATE and SELECT in
     * one transaction, where the row lock taken by the UPDATE keeps other
     * writers out until the read is done.
     */
    async hit(key, windowMs, now = Date.now()) {
      const cutoff = now - windowMs;
      const data = {
        hits: knex.raw('CASE WHEN window_start <= ? THEN 1 ELSE hits + 1 END', [cutoff]),
        expires_at: knex.raw('CASE WHEN expires_at < ? THEN ? ELSE expires_at END', [
          now + windowMs,
          now + windowMs,
        ]),
        window_start: knex.raw('CASE WHEN window_start <= ? THEN ? ELSE window_start END', [
          cutoff,
          now,
        ]),
      };
      const update = () =>
        updateCounterReturning(
          key,
          (qb) => qb.update(data, [...COUNTER_COLUMNS]),
          (trx) => trx(TABLES.counters).where({ k: key }).update(data)
        );

      let row = await update();
      if (!row) {
        await ensureCounterRow(key, now + windowMs);
        row = await update();
      }
      return row || (await readCounter(key)) || { hits: 1, windowStart: now, blockedUntil: 0 };
    },

    /**
     * Gives back one attempt counted by `hit` (for example when the request
     * ended with a server error and must not count as a failed login).
     */
    async release(key) {
      await knex(TABLES.counters)
        .where({ k: key })
        .andWhere('hits', '>', 0)
        .update({ hits: knex.raw('hits - 1') });
    },

    peek: readCounter,

    async block(key, untilMs) {
      await ensureCounterRow(key, untilMs);
      await knex(TABLES.counters)
        .where({ k: key })
        .andWhere('blocked_until', '<', untilMs)
        .update({
          blocked_until: untilMs,
          expires_at: knex.raw('CASE WHEN expires_at < ? THEN ? ELSE expires_at END', [
            untilMs,
            untilMs,
          ]),
        });
    },

    async clear(key) {
      await knex(TABLES.counters).where({ k: key }).del();
    },

    async getRevision(name) {
      const row = await knex(TABLES.counters)
        .select('hits')
        .where({ k: `rev:${name}` })
        .first();
      return row ? toNumber(row.hits) : 0;
    },

    async bumpRevision(name) {
      const key = `rev:${name}`;
      await ensureCounterRow(key, NEVER_EXPIRES);
      const data = { hits: knex.raw('hits + 1'), expires_at: NEVER_EXPIRES };
      const row = await updateCounterReturning(
        key,
        (qb) => qb.update(data, [...COUNTER_COLUMNS]),
        (trx) => trx(TABLES.counters).where({ k: key }).update(data)
      );
      return row ? row.hits : this.getRevision(name);
    },

    tryAcquireLease,
    releaseLease,

    /**
     * Runs `fn` while holding a cluster-wide named lock.
     *
     * PostgreSQL: a transaction-level advisory lock (`pg_advisory_xact_lock`)
     * on a dedicated transaction; it is released when that transaction ends,
     * also when the process dies. `fn` runs on other connections, so it must
     * not depend on that transaction. Other dialects: a lease row, polled
     * until it is free or `waitMs` elapses; the lease expires after `ttlMs`
     * if the holder dies.
     */
    async withLock(name, fn, { waitMs = 15_000, ttlMs = 30_000, owner } = {}) {
      if (kind === 'postgres') {
        const timeout = Math.max(1, Math.floor(waitMs));
        return knex.transaction(async (trx) => {
          try {
            await trx.raw(`SET LOCAL lock_timeout = '${timeout}ms'`);
            await trx.raw('SELECT pg_advisory_xact_lock(?, hashtext(?))', [
              PG_LOCK_NAMESPACE,
              name,
            ]);
          } catch (err) {
            if (err?.code === '55P03') throw new LockTimeoutError(name);
            throw err;
          }
          return fn();
        });
      }

      const leaseName = `lock:${name}`;
      const deadline = Date.now() + waitMs;
      let delay = 25;
      while (!(await tryAcquireLease(leaseName, ttlMs, owner))) {
        if (Date.now() >= deadline) throw new LockTimeoutError(name);
        await sleep(delay + Math.floor(Math.random() * delay));
        delay = Math.min(delay * 2, 250);
      }
      try {
        return await fn();
      } finally {
        await releaseLease(leaseName, owner).catch(() => {});
      }
    },

    async cacheGet(key, now = Date.now()) {
      const row = await knex(TABLES.cache)
        .select('v', 'expires_at')
        .where({ k: key })
        .andWhere('expires_at', '>', now)
        .first();
      if (!row || row.v === null || row.v === undefined) return null;
      try {
        return JSON.parse(row.v);
      } catch {
        return null;
      }
    },

    async cacheSet(key, value, ttlMs, now = Date.now()) {
      const expiresAt = ttlMs === Infinity ? NEVER_EXPIRES : now + ttlMs;
      await knex(TABLES.cache)
        .insert({ k: key, v: JSON.stringify(value), expires_at: expiresAt })
        .onConflict('k')
        .merge(['v', 'expires_at']);
    },

    async prune(now = Date.now()) {
      const counters = await knex(TABLES.counters)
        .where('expires_at', '<', now)
        .andWhere('blocked_until', '<', now)
        .del();
      const cache = await knex(TABLES.cache).where('expires_at', '<', now).del();
      return toNumber(counters) + toNumber(cache);
    },
  };
}

// ---------------------------------------------------------------------------
// Coordinator (routes to custom store, database, or memory)
// ---------------------------------------------------------------------------

const sharedMemory = createMemoryBackend();
const coordinators = new WeakMap();

/**
 * Creates a coordinator. `database` is optional; without it every call uses
 * the in-process backend.
 *
 * @param {{database?: object|null, counterStore?: object|null, log?: object, owner?: string}} [options]
 *   `owner` identifies the process for leases; it defaults to this process.
 * @returns {object}
 */
function createCoordinator({
  database = null,
  counterStore = null,
  log = null,
  owner = getInstanceId(),
} = {}) {
  let db = database;
  let lastFallbackLogAt = 0;

  const reportFallback = (operation, err) => {
    const now = Date.now();
    if (now - lastFallbackLogAt < 60_000) return;
    lastFallbackLogAt = now;
    log?.warn?.(
      `[COORDINATION] ${operation} failed on the shared store, using process-local state:`,
      err?.name || 'Error'
    );
  };

  const run = async (operation, sharedCall, memoryCall) => {
    if (!db) return memoryCall();
    try {
      return await sharedCall(db);
    } catch (err) {
      if (err instanceof LockTimeoutError) throw err;
      reportFallback(operation, err);
      return memoryCall();
    }
  };

  const counterCall = async (operation, method, args) => {
    if (counterStore && typeof counterStore[method] === 'function') {
      try {
        return await counterStore[method](...args);
      } catch (err) {
        reportFallback(`${operation} (custom store)`, err);
      }
    }
    return run(
      operation,
      (backend) => backend[method](...args),
      () => sharedMemory[method](...args)
    );
  };

  return {
    owner,
    get mode() {
      if (counterStore) return db ? 'custom+database' : 'custom+memory';
      return db ? 'database' : 'memory';
    },
    get dialect() {
      return db?.dialect || null;
    },

    /** Switches the coordinator to the database backend. */
    attachDatabase(backend) {
      db = backend;
    },

    /** Switches the coordinator back to process-local state. */
    detachDatabase() {
      db = null;
    },

    /**
     * Increments the fixed-window counter `key`.
     * @returns {Promise<{hits: number, windowStart: number, blockedUntil: number}>}
     */
    hit(key, windowMs) {
      assertKey(key);
      return counterCall('counter increment', 'hit', [key, windowMs]);
    },

    /** @returns {Promise<{hits: number, windowStart: number, blockedUntil: number}|null>} */
    peek(key) {
      assertKey(key);
      return counterCall('counter read', 'peek', [key]);
    },

    /** Raises the block deadline of `key` to `untilMs` (never lowers it). */
    block(key, untilMs) {
      assertKey(key);
      return counterCall('counter block', 'block', [key, untilMs]);
    },

    /** Removes counter `key`. */
    clear(key) {
      assertKey(key);
      return counterCall('counter clear', 'clear', [key]);
    },

    /**
     * Gives back one hit of counter `key`. Optional for a custom
     * `counterStore`: a store without `release` keeps the hit.
     */
    async release(key) {
      assertKey(key);
      if (counterStore && typeof counterStore.release !== 'function') return;
      return counterCall('counter release', 'release', [key]);
    },

    getRevision(name) {
      return run(
        'revision read',
        (backend) => backend.getRevision(name),
        () => sharedMemory.getRevision(name)
      );
    },

    bumpRevision(name) {
      return run(
        'revision bump',
        (backend) => backend.bumpRevision(name),
        () => sharedMemory.bumpRevision(name)
      );
    },

    /**
     * Takes the lease `name` for `ttlMs` unless another process holds an
     * unexpired lease. Re-acquiring an own lease extends it.
     * @returns {Promise<boolean>}
     */
    tryAcquireLease(name, ttlMs) {
      return run(
        'lease acquire',
        (backend) => backend.tryAcquireLease(name, ttlMs, owner),
        () => sharedMemory.tryAcquireLease(name, ttlMs, owner)
      );
    },

    releaseLease(name) {
      return run(
        'lease release',
        (backend) => backend.releaseLease(name, owner),
        () => sharedMemory.releaseLease(name, owner)
      );
    },

    /**
     * Runs `fn` inside the cluster-wide critical section `name`. A process-
     * local mutex is always taken first, so concurrent callers in one process
     * do not compete for database connections.
     *
     * @template T
     * @param {string} name
     * @param {() => Promise<T>} fn
     * @param {{waitMs?: number, ttlMs?: number}} [options]
     * @returns {Promise<T>}
     * @throws {LockTimeoutError} When the lock could not be taken in time
     */
    withLock(name, fn, options = {}) {
      const held = heldLocks.getStore();
      // Re-entrant: a nested call for a lock this call chain already holds
      // (for example a lifecycle hook fired inside the critical section)
      // runs directly instead of waiting for itself.
      if (held && held.has(name)) return fn();
      const inner = () => heldLocks.run(new Set([...(held || []), name]), fn);

      return sharedMemory.withLock(`local:${name}`, async () => {
        if (!db) return inner();
        let entered = false;
        try {
          return await db.withLock(
            name,
            () => {
              entered = true;
              return inner();
            },
            { ...options, owner }
          );
        } catch (err) {
          if (entered || err instanceof LockTimeoutError) throw err;
          reportFallback('lock', err);
          return inner();
        }
      });
    },

    cacheGet(key) {
      assertKey(key);
      return run(
        'cache read',
        (backend) => backend.cacheGet(key),
        () => sharedMemory.cacheGet(key)
      );
    },

    cacheSet(key, value, ttlMs) {
      assertKey(key);
      return run(
        'cache write',
        (backend) => backend.cacheSet(key, value, ttlMs),
        () => sharedMemory.cacheSet(key, value, ttlMs)
      );
    },

    prune() {
      return run(
        'prune',
        (backend) => backend.prune(),
        () => sharedMemory.prune()
      );
    },
  };
}

/**
 * Returns the coordinator bound to a Strapi instance. Before
 * `initCoordination()` ran it uses process-local state.
 *
 * @param {object} strapi
 * @returns {object}
 */
function getCoordinator(strapi) {
  const key = strapi && typeof strapi === 'object' ? strapi : sharedMemory;
  let coordinator = coordinators.get(key);
  if (!coordinator) {
    const config = readCoordinationConfig(strapi);
    coordinator = createCoordinator({
      counterStore: config.counterStore,
      log: strapi?.log || null,
    });
    coordinators.set(key, coordinator);
  }
  return coordinator;
}

/**
 * Reads `config.coordination` from the plugin config.
 *
 * @param {object} strapi
 * @returns {{enabled: boolean, counterStore: object|null}}
 */
function readCoordinationConfig(strapi) {
  let raw;
  try {
    raw = strapi?.config?.get?.('plugin::magic-sessionmanager.coordination') || null;
  } catch {
    raw = null;
  }
  const config = raw && typeof raw === 'object' ? raw : {};
  const counterStore =
    config.counterStore && typeof config.counterStore === 'object' ? config.counterStore : null;
  return { enabled: config.enabled !== false, counterStore };
}

/**
 * Creates the coordination tables and switches the Strapi instance's
 * coordinator to the database backend. Failures leave it on process-local
 * state and are logged; they never stop the bootstrap.
 *
 * @param {object} strapi
 * @param {object} [log]
 * @returns {Promise<object>} The coordinator
 */
async function initCoordination(strapi, log = strapi?.log) {
  const coordinator = getCoordinator(strapi);
  const config = readCoordinationConfig(strapi);
  if (!config.enabled) {
    log?.info?.('[COORDINATION] Disabled by config; using process-local state');
    return coordinator;
  }

  const knex = strapi?.db?.connection;
  if (typeof knex !== 'function' || !knex.schema) {
    log?.warn?.('[COORDINATION] No database connection; using process-local state');
    return coordinator;
  }

  try {
    await ensureTables(knex);
    coordinator.attachDatabase(
      createDatabaseBackend({
        knex,
        dialect: strapi.db?.dialect?.client || knex.client?.config?.client,
      })
    );
    log?.info?.(`[COORDINATION] Shared state enabled (${coordinator.mode})`);
  } catch (err) {
    log?.error?.(
      '[COORDINATION] Could not prepare shared tables; using process-local state:',
      err?.name || 'Error'
    );
  }
  return coordinator;
}

module.exports = {
  TABLES,
  LockTimeoutError,
  createCoordinator,
  createDatabaseBackend,
  createMemoryBackend,
  ensureTables,
  getCoordinator,
  getHostFingerprint,
  getInstanceId,
  hashedKey,
  initCoordination,
  normalizeDialect,
  __resetMemoryForTests() {
    sharedMemory.reset();
  },
};
