import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  canonicalizeDatabaseTarget,
  resolveDatabaseTarget,
  updateGeoIpDatabase,
} from '../scripts/update-geoip-db.mjs';

function makeTempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-sessionmanager-geoip-path-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('database target resolves supported filenames only inside the dedicated directory', async (t) => {
  const root = makeTempRoot(t);
  const target = await canonicalizeDatabaseTarget('GeoLite2-City.mmdb', root);

  assert.equal(target, path.join(fs.realpathSync(root), 'GeoLite2-City.mmdb'));
  assert.equal(resolveDatabaseTarget('GeoLite2-Country.mmdb', root), path.join(root, 'GeoLite2-Country.mmdb'));
});

test('database target rejects traversal and absolute paths outside the dedicated directory', (t) => {
  const root = makeTempRoot(t);

  assert.throws(() => resolveDatabaseTarget('../GeoLite2-City.mmdb', root), /dedicated GeoIP directory/);
  assert.throws(() => resolveDatabaseTarget(path.join(os.tmpdir(), 'GeoLite2-City.mmdb'), root), /dedicated GeoIP directory/);
});

test('database target rejects unsupported names and file extensions', (t) => {
  const root = makeTempRoot(t);

  assert.throws(() => resolveDatabaseTarget('payload.txt', root), /supported MMDB filename/);
  assert.throws(() => resolveDatabaseTarget('GeoLite2-City.db', root), /supported MMDB filename/);
  assert.throws(() => resolveDatabaseTarget(null, root), /must be a string/);
  assert.throws(() => resolveDatabaseTarget(42, root), /must be a string/);
});

test('database target rejects a symlinked dedicated directory', async (t) => {
  const parent = makeTempRoot(t);
  const outside = path.join(parent, 'outside');
  const root = path.join(parent, 'geoip');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, root, 'dir');

  await assert.rejects(canonicalizeDatabaseTarget('GeoLite2-City.mmdb', root), /symlink|canonical/);
});

test('database target rejects a symlinked database or metadata file', async (t) => {
  const parent = makeTempRoot(t);
  const root = path.join(parent, 'geoip');
  const outsideDatabase = path.join(parent, 'outside.mmdb');
  fs.mkdirSync(root);
  fs.writeFileSync(outsideDatabase, 'not a real database');
  fs.symlinkSync(outsideDatabase, path.join(root, 'GeoLite2-City.mmdb'));

  await assert.rejects(canonicalizeDatabaseTarget('GeoLite2-City.mmdb', root), /symlink/);

  fs.unlinkSync(path.join(root, 'GeoLite2-City.mmdb'));
  fs.symlinkSync(outsideDatabase, path.join(root, 'GeoLite2-City.mmdb.metadata.json'));
  await assert.rejects(canonicalizeDatabaseTarget('GeoLite2-City.mmdb', root), /symlink/);
});

test('updater validates the destination before making any network request', async (t) => {
  const previousFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls++;
    throw new Error('network must not be used in this test');
  };
  t.after(() => {
    global.fetch = previousFetch;
  });

  await assert.rejects(
    updateGeoIpDatabase({
      accountId: 'test-account',
      licenseKey: 'test-license',
      editionId: 'GeoLite2-City',
      mmdbFileName: 'GeoLite2-City.mmdb',
      outputPath: path.join(os.tmpdir(), '..', 'outside.mmdb'),
      force: true,
    }),
    /dedicated GeoIP directory/
  );
  assert.equal(fetchCalls, 0);
});
