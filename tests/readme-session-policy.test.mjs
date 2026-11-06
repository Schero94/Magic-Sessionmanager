import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

/** API-11: the opt-in policy is documented with its exact name, how to attach it and what it checks. */
test('README documents how to attach the opt-in session-required policy and what it checks (API-11)', () => {
  const policies = require('../server/src/policies/index.js');
  assert.equal(typeof policies['session-required'], 'function', 'registered under the documented name');
  const section = readme.slice(readme.indexOf('## Optional route policy: `session-required`'));
  assert.ok(section.length > 0 && readme.includes('Optional route policy'), 'README has the policy section');
  assert.match(section, /policies: \['plugin::magic-sessionmanager\.session-required'\]/);
  assert.match(section, /No plugin route attaches the policy/);
  for (const text of ['No authenticated user', 'No `Authorization: Bearer` token', "jwtManagement: 'refresh'", 'is ended', 'No session row matches', 'Settings or the session lookup fail']) {
    assert.ok(section.includes(text), `case documented: ${text}`);
  }
});

test('no plugin route attaches session-required, as the README says', () => {
  const dir = new URL('../server/src/routes/', import.meta.url);
  const walk = (url) => readdirSync(url).flatMap((name) => {
    const child = new URL(name, url);
    return statSync(child).isDirectory() ? walk(new URL(`${name}/`, url)) : [child];
  });
  for (const file of walk(dir)) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /session-required/, file.pathname);
  }
});
