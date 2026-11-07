#!/usr/bin/env node
/**
 * Multi-process coordination check.
 *
 * Starts N worker processes (default 8, like 2 replicas x 4 pm2 workers)
 * against one shared database and verifies the plugin's cross-process
 * guarantees: exact shared counters, a single lease winner, lock-protected
 * read-modify-write without lost updates, no duplicate check-then-create
 * rows, exact revision bumps, and a cluster-wide failed-login lockout.
 *
 * Targets:
 *   - SQLite (temporary file) when `better-sqlite3` can be loaded.
 *   - PostgreSQL when MSM_TEST_PG_URL is set, e.g.
 *     MSM_TEST_PG_URL=postgres://strapi@127.0.0.1:5440/mi_sm
 *
 * A target whose driver is missing is reported as skipped. Set
 * MSM_CONCURRENCY_REQUIRE=sqlite,postgres to turn a skip into a failure (CI).
 *
 * Usage: npm run test:concurrency
 */

import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(here, 'worker.cjs');
const strapiDatabaseRequire = createRequire(require.resolve('@strapi/database/package.json'));
const knexFactory = strapiDatabaseRequire('knex');

const WORKERS = Number.parseInt(process.env.MSM_CONCURRENCY_WORKERS || '8', 10);
const HITS_PER_WORKER = 25;
const LOCK_ITERATIONS = 10;
const REVISION_BUMPS = 5;
const MAX_FAILED = 5;
const LOCKOUT_ATTEMPTS_PER_WORKER = 10;
const PHASES = ['tables', 'counter', 'lease', 'lock', 'store', 'control', 'revision', 'lockout'];
const required = new Set(
  String(process.env.MSM_CONCURRENCY_REQUIRE || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);

function canLoad(moduleName) {
  try {
    strapiDatabaseRequire.resolve(moduleName);
  } catch {
    try {
      require.resolve(moduleName);
    } catch {
      return false;
    }
  }
  try {
    const loaded = require(moduleName);
    if (moduleName === 'better-sqlite3') new loaded(':memory:').close();
    return true;
  } catch {
    return false;
  }
}

function knexFor(target) {
  return target.client === 'pg'
    ? knexFactory({ client: 'pg', connection: target.connection, pool: { min: 0, max: 2 } })
    : knexFactory({
        client: 'better-sqlite3',
        connection: { filename: target.filename },
        useNullAsDefault: true,
      });
}

async function resetDatabase(target) {
  const knex = knexFor(target);
  try {
    for (const table of [
      'magic_sm_counters',
      'magic_sm_leases',
      'magic_sm_cache',
      'msm_concurrency_store',
    ]) {
      await knex.schema.dropTableIfExists(table);
    }
    if (target.client !== 'pg') await knex.raw('PRAGMA journal_mode = WAL');
    // Same shape as strapi_core_store_settings: no unique constraint on key.
    await knex.schema.createTable('msm_concurrency_store', (table) => {
      table.increments('id');
      table.string('key');
      table.text('value');
    });
  } finally {
    await knex.destroy();
  }
}

async function readState(target) {
  const knex = knexFor(target);
  try {
    const counter = await knex('magic_sm_counters').where({ k: 'test:counter' }).first();
    const revision = await knex('magic_sm_counters').where({ k: 'rev:test' }).first();
    const rmw = await knex('magic_sm_cache').where({ k: 'test:rmw' }).first();
    const storeRows = await knex('msm_concurrency_store').where({ key: 'settings' });
    const controlRows = await knex('msm_concurrency_store').where({ key: 'control' });
    return {
      counter: Number(counter?.hits),
      revision: Number(revision?.hits),
      rmw: rmw ? Number(JSON.parse(rmw.v)) : 0,
      storeRows: storeRows.length,
      controlRows: controlRows.length,
    };
  } finally {
    await knex.destroy();
  }
}

async function runWorkers(target) {
  const workerConfig = {
    ...target,
    hitsPerWorker: HITS_PER_WORKER,
    lockIterations: LOCK_ITERATIONS,
    revisionBumps: REVISION_BUMPS,
    maxFailed: MAX_FAILED,
    lockoutAttemptsPerWorker: LOCKOUT_ATTEMPTS_PER_WORKER,
  };
  const workers = Array.from({ length: WORKERS }, () =>
    fork(workerPath, [], {
      env: { ...process.env, MSM_CONCURRENCY_CONFIG: JSON.stringify(workerConfig) },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    })
  );

  const ready = new Map(PHASES.map((phase) => [phase, 0]));
  const results = [];

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      for (const worker of workers) worker.kill();
      reject(new Error('workers timed out'));
    }, 120_000);
    for (const worker of workers) {
      worker.on('message', (message) => {
        if (message.type === 'ready') {
          ready.set(message.name, ready.get(message.name) + 1);
          // Release a phase only when every worker reached it.
          if (ready.get(message.name) === WORKERS) {
            for (const w of workers) w.send({ type: 'go', name: message.name });
          }
        } else if (message.type === 'done') {
          results.push(message.results);
          if (results.length === WORKERS) {
            clearTimeout(timer);
            resolve();
          }
        }
      });
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0 && results.length < WORKERS) {
          clearTimeout(timer);
          reject(new Error(`a worker exited with code ${code}`));
        }
      });
    }
  });

  return results;
}

/**
 * True when `values` is exactly 1..n in some order.
 *
 * @param {number[]} values
 * @param {number} n
 * @returns {boolean}
 */
function exactSequence(values, n) {
  if (values.length !== n) return false;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.every((value, index) => value === index + 1);
}

function check(label, condition, detail) {
  const status = condition ? 'ok  ' : 'FAIL';
  console.log(`  ${status} ${label}${detail ? ` (${detail})` : ''}`);
  return condition;
}

async function runTarget(target) {
  console.log(`\n[${target.name}] ${WORKERS} processes`);
  await resetDatabase(target);
  const results = await runWorkers(target);
  const errors = results.filter((result) => result.error);
  const state = await readState(target);
  const winners = results.filter((result) => result.leaseWon === true).length;
  const lockoutAttempts = results.reduce((sum, result) => sum + (result.lockoutAttempts || 0), 0);

  const checks = [
    check('no worker errors', errors.length === 0, errors.map((e) => e.error).join('; ')),
    check(
      'shared counter counts every hit exactly once',
      state.counter === WORKERS * HITS_PER_WORKER,
      `${state.counter}/${WORKERS * HITS_PER_WORKER}`
    ),
    check(
      'every hit reports its own count (1..N, no duplicates)',
      exactSequence(
        results.flatMap((r) => r.hitValues || []),
        WORKERS * HITS_PER_WORKER
      ),
      'returned values'
    ),
    check(
      'every revision bump reports its own revision (1..N, no duplicates)',
      exactSequence(
        results.flatMap((r) => r.revisionValues || []),
        WORKERS * REVISION_BUMPS
      ),
      'returned values'
    ),
    check('exactly one process wins the job lease', winners === 1, `${winners} winners`),
    check(
      'locked read-modify-write loses no update',
      state.rmw === WORKERS * LOCK_ITERATIONS,
      `${state.rmw}/${WORKERS * LOCK_ITERATIONS}`
    ),
    check(
      'locked check-then-create writes one row',
      state.storeRows === 1,
      `${state.storeRows} rows`
    ),
    check(
      'revision bumps are exact',
      state.revision === WORKERS * REVISION_BUMPS,
      `${state.revision}/${WORKERS * REVISION_BUMPS}`
    ),
    check(
      'failed-login lockout is cluster-wide',
      lockoutAttempts === MAX_FAILED,
      `${lockoutAttempts} attempts, per-process limit would allow ${MAX_FAILED * WORKERS}`
    ),
  ];
  console.log(
    `  info same check-then-create without the lock wrote ${state.controlRows} row(s) (control)`
  );
  return checks.every(Boolean);
}

async function main() {
  const targets = [];
  const skipped = [];

  if (canLoad('better-sqlite3')) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msm-concurrency-'));
    targets.push({
      name: 'sqlite',
      client: 'better-sqlite3',
      filename: path.join(dir, 'db.sqlite'),
    });
  } else {
    skipped.push('sqlite (better-sqlite3 not installed or not built)');
  }

  if (process.env.MSM_TEST_PG_URL && canLoad('pg')) {
    targets.push({ name: 'postgres', client: 'pg', connection: process.env.MSM_TEST_PG_URL });
  } else {
    skipped.push(
      process.env.MSM_TEST_PG_URL
        ? 'postgres (pg not installed)'
        : 'postgres (MSM_TEST_PG_URL unset)'
    );
  }

  for (const reason of skipped) console.log(`skipped: ${reason}`);
  const missingRequired = [...required].filter(
    (name) => !targets.some((target) => target.name === name)
  );
  if (missingRequired.length > 0) {
    console.error(`required target(s) not available: ${missingRequired.join(', ')}`);
    process.exit(1);
  }

  let ok = true;
  for (const target of targets) {
    ok = (await runTarget(target)) && ok;
  }
  if (targets.length === 0) console.log('no database target available; nothing to check');
  console.log(ok ? '\nconcurrency check passed' : '\nconcurrency check FAILED');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('concurrency check crashed:', err?.message || err);
  process.exit(1);
});
