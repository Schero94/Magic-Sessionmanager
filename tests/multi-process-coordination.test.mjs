/**
 * Runs the real multi-process check (8 Node processes on one database) as
 * part of `npm test`. SQLite always runs when better-sqlite3 is built;
 * PostgreSQL runs too when MSM_TEST_PG_URL is set. See
 * scripts/concurrency/run.mjs.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let sqliteAvailable;
try {
  const Database = require('better-sqlite3');
  new Database(':memory:').close();
  sqliteAvailable = true;
} catch {
  sqliteAvailable = false;
}

test(
  'eight processes on one database keep counters, leases, locks and lockout consistent',
  { skip: !sqliteAvailable && 'better-sqlite3 not available', timeout: 180_000 },
  () => {
    const result = spawnSync(process.execPath, ['scripts/concurrency/run.mjs'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, MSM_CONCURRENCY_REQUIRE: 'sqlite' },
      timeout: 170_000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /concurrency check passed/);
  }
);
