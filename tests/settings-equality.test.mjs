import assert from 'node:assert/strict';
import test from 'node:test';
import { areSettingsEqual } from '../admin/src/utils/settingsEquality.mjs';

test('settings comparison ignores object key order and compares nested values', () => {
  assert.equal(
    areSettingsEqual(
      { enabled: true, templates: { subject: 'Alert', variables: ['email', 'ip'] } },
      { templates: { variables: ['email', 'ip'], subject: 'Alert' }, enabled: true }
    ),
    true
  );
});

test('settings comparison detects nested, array-order, and type changes', () => {
  const baseline = { enabled: false, values: ['a', 'b'], options: { limit: 3 } };

  assert.equal(areSettingsEqual(baseline, { ...baseline, enabled: true }), false);
  assert.equal(areSettingsEqual(baseline, { ...baseline, values: ['b', 'a'] }), false);
  assert.equal(areSettingsEqual(baseline, { ...baseline, options: { limit: '3' } }), false);
});

test('settings comparison handles nulls and primitive values', () => {
  assert.equal(areSettingsEqual(null, null), true);
  assert.equal(areSettingsEqual(null, {}), false);
  assert.equal(areSettingsEqual(1, '1'), false);
});
