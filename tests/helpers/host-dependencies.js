'use strict';

// Locates the Strapi host dependencies that the real-HTTP suites borrow.
// Not a test file itself (the npm test glob only matches tests/*.test.*).
const fs = require('node:fs');
const path = require('node:path');

const sourceRoot = path.resolve(__dirname, '..', '..');
const workbench = path.resolve(sourceRoot, '../..');
const DEFAULT_HOST_MODULES = path.join(workbench, 'test-app', 'node_modules');

/**
 * Resolves the host node_modules directory and reports which required
 * packages are missing.
 *
 * @param {string[]} requiredPackages Package names that must be installed
 * @returns {{modules: string, available: boolean, missing: string[], skip: string|false}}
 *   `skip` is a node:test skip reason, or false when the suite should run.
 *   With SESSION_HTTP_REQUIRED=1 a missing dependency never skips; the
 *   suite runs and fails on `assertHostAvailable` instead.
 */
function resolveHostDependencies(requiredPackages) {
  const modules = process.env.SESSION_HTTP_STRAPI_NODE_MODULES || DEFAULT_HOST_MODULES;
  const missing = requiredPackages.filter((name) => !fs.existsSync(path.join(modules, name, 'package.json')));
  const available = missing.length === 0;
  const required = process.env.SESSION_HTTP_REQUIRED === '1';
  const reason =
    `Isolated host dependencies unavailable (${missing.join(', ')} missing in ${modules}); ` +
    'set SESSION_HTTP_STRAPI_NODE_MODULES to a Strapi host node_modules directory, ' +
    'or SESSION_HTTP_REQUIRED=1 to make this a failure';
  return { modules, available, missing, skip: available || required ? false : reason };
}

/**
 * Fails the current test when required dependencies are missing. Used when
 * SESSION_HTTP_REQUIRED=1 turned the skip into a hard requirement.
 *
 * @param {{available: boolean, missing: string[], modules: string}} host Result of resolveHostDependencies
 */
function assertHostAvailable(host) {
  if (!host.available) {
    throw new Error(
      `SESSION_HTTP_REQUIRED=1 but host dependencies are missing (${host.missing.join(', ')}) in ${host.modules}`
    );
  }
}

module.exports = { DEFAULT_HOST_MODULES, resolveHostDependencies, assertHostAvailable };
