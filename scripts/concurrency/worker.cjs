'use strict';

/**
 * One process of the multi-process coordination check. Started by
 * `scripts/concurrency/run.mjs`; talks to it over the IPC channel.
 *
 * Every worker opens its own knex pool against the shared database and uses
 * the plugin's real coordination backend, like one pm2 worker or replica.
 */

const { createRequire } = require('node:module');

const {
  createCoordinator,
  createDatabaseBackend,
  ensureTables,
} = require('../../server/src/utils/coordination');
const { createLoginLockout } = require('../../server/src/utils/login-lockout');

const strapiDatabaseRequire = createRequire(require.resolve('@strapi/database/package.json'));
const knexFactory = strapiDatabaseRequire('knex');

const config = JSON.parse(process.env.MSM_CONCURRENCY_CONFIG || '{}');

function createKnex() {
  if (config.client === 'pg') {
    return knexFactory({
      client: 'pg',
      connection: config.connection,
      pool: { min: 0, max: 5 },
    });
  }
  return knexFactory({
    client: 'better-sqlite3',
    connection: { filename: config.filename },
    useNullAsDefault: true,
    pool: {
      min: 1,
      max: 1,
      afterCreate(conn, done) {
        // Several processes write the same file: wait for the lock instead
        // of failing with SQLITE_BUSY. WAL mode is set once by the runner;
        // switching it here would itself need an exclusive lock.
        conn.pragma('busy_timeout = 10000');
        done();
      },
    },
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until the parent releases the barrier, so every worker starts together. */
function barrier(name) {
  return new Promise((resolve) => {
    const onMessage = (message) => {
      if (message && message.type === 'go' && message.name === name) {
        process.off('message', onMessage);
        resolve();
      }
    };
    process.on('message', onMessage);
    process.send({ type: 'ready', name });
  });
}

async function main() {
  const knex = createKnex();
  const dialect = config.client === 'pg' ? 'postgres' : 'sqlite';
  const coordinator = createCoordinator();
  const results = {};

  try {
    await barrier('tables');
    await ensureTables(knex);
    coordinator.attachDatabase(createDatabaseBackend({ knex, dialect }));
    results.tables = true;

    // 1. Shared fixed-window counter: every hit must be counted once.
    await barrier('counter');
    // Every hit must also report the value IT wrote (no two hits may see
    // the same count), or limits reject callers too early under a burst.
    results.hitValues = [];
    for (let i = 0; i < config.hitsPerWorker; i++) {
      results.hitValues.push((await coordinator.hit('test:counter', 60_000)).hits);
    }
    results.counter = true;

    // 2. Job lease: exactly one process may win.
    await barrier('lease');
    results.leaseWon = await coordinator.tryAcquireLease('job:test', 60_000);

    // 3. Critical section: read-modify-write without lost updates.
    await barrier('lock');
    for (let i = 0; i < config.lockIterations; i++) {
      await coordinator.withLock('test:rmw', async () => {
        const current = Number((await coordinator.cacheGet('test:rmw')) || 0);
        await sleep(2);
        await coordinator.cacheSet('test:rmw', current + 1, Infinity);
      });
    }
    results.lock = true;

    // 4. Check-then-create without a unique constraint (Core Store shape).
    await barrier('store');
    await coordinator.withLock('store:test', async () => {
      const existing = await knex('msm_concurrency_store').where({ key: 'settings' }).first();
      await sleep(5);
      if (!existing) {
        await knex('msm_concurrency_store').insert({ key: 'settings', value: String(process.pid) });
      }
    });
    results.store = true;

    // 4b. Control: the same check-then-create without the lock. This is
    // what Strapi's core-store set() does; the runner only reports it.
    await barrier('control');
    {
      const existing = await knex('msm_concurrency_store').where({ key: 'control' }).first();
      await sleep(5);
      if (!existing) {
        await knex('msm_concurrency_store').insert({ key: 'control', value: String(process.pid) });
      }
    }

    // 5. Settings revision bumps.
    await barrier('revision');
    results.revisionValues = [];
    for (let i = 0; i < config.revisionBumps; i++) {
      results.revisionValues.push(await coordinator.bumpRevision('test'));
    }
    results.revision = true;

    // 6. Lockout: the plugin's real lockout engine (utils/login-lockout.js),
    // as the sign-in middleware runs it. Per account (every process signs in
    // from its own address) and per IP (one shared address): in each case
    // only `maxFailed` attempts may reach the (simulated) password check in
    // total, cluster-wide.
    await barrier('lockout');
    const lockout = createLoginLockout(coordinator);
    const policy = {
      ipMax: config.maxFailed,
      windowMs: 15 * 60_000,
      durationMs: 15 * 60_000,
      trusted: [],
    };
    const attack = async ({ ip, identifier, ipMax, accountMax }) => {
      let attempts = 0;
      const p = { ...policy, ipMax };
      for (let i = 0; i < config.lockoutAttemptsPerWorker; i++) {
        const decision = await lockout.reserve({ ip, identifier, policy: p, accountMax });
        if (decision.outcome === 'locked') break;
        if (decision.outcome === 'busy') continue;
        attempts++;
        await sleep(1);
        await lockout.settle(decision.reservation, 'failure', {
          policy: p,
          accountMax,
          display: { ip, userDocumentId: 'synthetic-user' },
        });
      }
      return attempts;
    };
    results.accountAttempts = await attack({
      ip: `192.0.2.${10 + config.workerIndex}`,
      identifier: 'shared-account@example.com',
      ipMax: 0,
      accountMax: config.maxFailed,
    });
    await barrier('lockout-ip');
    results.lockoutAttempts = await attack({
      ip: '198.51.100.50',
      identifier: null,
      ipMax: config.maxFailed,
      accountMax: 0,
    });

    // 7. Every process sees the same "Locked now" list; one process lifts
    // both locks and every process then sees the account unlocked.
    await barrier('locks');
    results.listedLocks = (await lockout.listLocks()).map((lock) => lock.kind).sort();
    await barrier('unlock');
    if (config.workerIndex === 0) {
      for (const lock of await lockout.listLocks()) await lockout.unlock(lock.id);
    }
    await barrier('unlocked');
    results.locksAfterUnlock = (await lockout.listLocks()).length;
    const after = await lockout.reserve({
      ip: '203.0.113.50',
      identifier: 'shared-account@example.com',
      policy: { ...policy, ipMax: 0 },
      accountMax: 1000,
    });
    results.afterUnlock = after.outcome;
  } catch (err) {
    results.error = `${err?.name || 'Error'}: ${err?.message || ''}`;
  } finally {
    await knex.destroy().catch(() => {});
  }

  process.send({ type: 'done', results });
}

main().catch((err) => {
  process.send({ type: 'done', results: { error: String(err?.message || err) } });
});
