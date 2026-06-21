import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const cjsModule = require('../dist/server/index.js');
const esmModule = await import('../dist/server/index.mjs');

const cjsPlugin = cjsModule.default || cjsModule;
const esmPlugin = esmModule.default || esmModule;

// Each export must not only EXIST but hold a usable value. The @strapi/sdk-plugin
// v6 stub-bundle failure mode produces a module whose keys are present but whose
// values are `undefined` factories — `'register' in plugin` would still be true.
// So assert the expected runtime type per key, not mere key presence.
const expectedKeys = {
  bootstrap: 'function',
  destroy: 'function',
  register: 'function',
  config: 'object',
  contentTypes: 'object',
  controllers: 'object',
  middlewares: 'object',
  policies: 'object',
  routes: 'object', // object or array — both are typeof 'object'
  services: 'object',
};

for (const [label, plugin] of [
  ['cjs', cjsPlugin],
  ['esm', esmPlugin],
]) {
  if (!plugin || typeof plugin !== 'object') {
    throw new Error(`${label} server bundle did not export a plugin object`);
  }

  const problems = [];
  for (const [key, expectedType] of Object.entries(expectedKeys)) {
    const value = plugin[key];
    if (value === undefined || value === null) {
      problems.push(`${key} is ${value} (expected ${expectedType})`);
    } else if (typeof value !== expectedType) {
      problems.push(`${key} is ${typeof value} (expected ${expectedType})`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`${label} server bundle has invalid exports:\n  - ${problems.join('\n  - ')}`);
  }
}

console.log('Server bundle runtime check passed');
