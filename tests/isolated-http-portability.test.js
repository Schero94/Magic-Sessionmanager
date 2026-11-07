'use strict';

// GA-01 / API-3: the host-dependent HTTP suites must skip with a clear message
// outside the workbench layout, and must fail when the run explicitly
// requires them (SESSION_HTTP_REQUIRED=1), instead of hard-failing on a
// missing module or silently passing.
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const HOST_SUITES = ['isolated-fallback-logout-http.test.js', 'isolated-http-access.test.js'];
const missingModules = path.join(
  os.tmpdir(),
  `sessionmanager-no-host-${process.pid}`,
  'node_modules'
);

function runSuite(file, extraEnv) {
  const env = { ...process.env, SESSION_HTTP_STRAPI_NODE_MODULES: missingModules, ...extraEnv };
  if (!extraEnv.SESSION_HTTP_REQUIRED) delete env.SESSION_HTTP_REQUIRED;
  // Run as an independent test process with plain TAP output.
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', path.join(__dirname, file)],
    {
      cwd: path.resolve(__dirname, '..'),
      env,
      encoding: 'utf8',
      timeout: 60_000,
    }
  );
}

for (const file of HOST_SUITES) {
  test(`${file} skips with a clear message when host dependencies are missing`, () => {
    const result = runSuite(file, {});
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.match(output, /# skipped 1/);
    assert.match(output, /# fail 0/);
    assert.match(output, /SESSION_HTTP_STRAPI_NODE_MODULES/);
  });

  test(`${file} fails when host dependencies are required but missing`, () => {
    const result = runSuite(file, { SESSION_HTTP_REQUIRED: '1' });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0, output);
    assert.match(output, /# fail 1/);
  });
}
