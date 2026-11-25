// Admin-side policy helpers (4.17): inline validation with the server's
// bounds, trusted-address text, role rule list operations and lock order.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatTrustedAddressText,
  isTrustedAddressLine,
  parseTrustedAddressText,
  removeRoleRule,
  sortLocks,
  toRoleRule,
  upsertRoleRule,
  validatePolicyFields,
  validateRoleRule,
} from '../admin/src/utils/policyForm.mjs';
import { SETTINGS_DEFAULTS, validateSettings } from '../admin/src/utils/settingsForm.mjs';
import { getErrorTab } from '../admin/src/pages/Settings/settingsTabs.mjs';

test('client defaults match the server defaults of the policies', () => {
  assert.equal(SETTINGS_DEFAULTS.maxFailedLoginsPerAccount, 0);
  assert.equal(SETTINGS_DEFAULTS.lockoutWindowMinutes, 15);
  assert.equal(SETTINGS_DEFAULTS.lockoutDurationMinutes, 15);
  assert.equal(SETTINGS_DEFAULTS.maxSessionsPerUser, 0);
  assert.equal(SETTINGS_DEFAULTS.sessionLimitPolicy, 'end-oldest');
  assert.equal(SETTINGS_DEFAULTS.recordUserSignInEvents, true);
});

test('policy numbers are validated inline with the server bounds, never clamped', () => {
  const errors = validatePolicyFields({
    maxFailedLoginsPerAccount: 101,
    lockoutWindowMinutes: 0,
    lockoutDurationMinutes: undefined,
    maxSessionsPerUser: 2.5,
  });
  assert.equal(errors.maxFailedLoginsPerAccount.messageId, 'settings.validation.range');
  assert.deepEqual(errors.lockoutWindowMinutes.values, { min: 1, max: 1440 });
  assert.equal(errors.lockoutDurationMinutes.messageId, 'settings.validation.required');
  assert.ok(errors.maxSessionsPerUser);
  assert.deepEqual(validatePolicyFields({}), {}, 'absent keys keep their stored value');
  assert.equal(
    getErrorTab(validateSettings({ maxFailedLogins: 1, maxSessionsPerUser: -1 })),
    'sessions'
  );
  assert.equal(
    getErrorTab(validateSettings({ maxFailedLogins: 1, lockoutDurationMinutes: 0 })),
    'login-protection'
  );
});

test('trusted addresses: one per line, light format check, the server stays the authority', () => {
  assert.deepEqual(parseTrustedAddressText(' 192.0.2.1\n\n2001:db8::/32, 198.51.100.0/24 \n'), [
    '192.0.2.1',
    '2001:db8::/32',
    '198.51.100.0/24',
  ]);
  assert.equal(formatTrustedAddressText(['a', 'b']), 'a\nb');
  assert.equal(formatTrustedAddressText(null), '');
  for (const ok of [
    '192.0.2.1',
    '192.0.2.0/24',
    '0.0.0.0/0',
    '2001:db8::1',
    '::1',
    '2001:db8::/48',
  ]) {
    assert.equal(isTrustedAddressLine(ok), true, ok);
  }
  for (const bad of ['192.0.2.256', '192.0.2.0/33', 'example.com', '2001:db8::/129', '1.2.3.4/x']) {
    assert.equal(isTrustedAddressLine(bad), false, bad);
  }
  const errors = validatePolicyFields({ lockoutTrustedAddresses: ['192.0.2.1', 'nope'] });
  assert.equal(errors.lockoutTrustedAddresses.values.value, 'nope');
});

test('role rule dialog: role required, unique, at least one value, empty means general', () => {
  assert.equal(validateRoleRule({}).role.messageId, 'settings.roleRules.validation.role');
  assert.equal(
    validateRoleRule({ role: 'a', maxSessionsPerUser: 1 }, ['a']).role.messageId,
    'settings.roleRules.validation.duplicate'
  );
  assert.equal(
    validateRoleRule({ role: 'a' }).form.messageId,
    'settings.roleRules.validation.empty'
  );
  assert.ok(validateRoleRule({ role: 'a', inactivityTimeout: 0 }).inactivityTimeout);
  assert.deepEqual(validateRoleRule({ role: 'a', maxFailedLoginsPerAccount: 0 }), {});
  assert.deepEqual(toRoleRule({ role: 'a', maxSessionsPerUser: 2, inactivityTimeout: '' }), {
    role: 'a',
    maxSessionsPerUser: 2,
    inactivityTimeout: null,
    maxFailedLoginsPerAccount: null,
  });
});

test('role rule list: add, replace in place (also when the role changes) and remove', () => {
  const a = { role: 'a', maxSessionsPerUser: 1 };
  const b = { role: 'b', maxSessionsPerUser: 2 };
  let rules = upsertRoleRule([], a);
  rules = upsertRoleRule(rules, b);
  assert.deepEqual(rules, [a, b]);
  rules = upsertRoleRule(rules, { role: 'c', maxSessionsPerUser: 3 }, 'a');
  assert.deepEqual(
    rules.map((rule) => rule.role),
    ['c', 'b']
  );
  assert.deepEqual(removeRoleRule(rules, 'b'), [{ role: 'c', maxSessionsPerUser: 3 }]);
});

test('locks are listed with the longest remaining lock first', () => {
  const now = Date.now();
  const sorted = sortLocks([
    { id: 'x', until: new Date(now + 1000).toISOString() },
    { id: 'y', until: new Date(now + 5000).toISOString() },
  ]);
  assert.deepEqual(
    sorted.map((lock) => lock.id),
    ['y', 'x']
  );
  assert.deepEqual(sortLocks(null), []);
});
