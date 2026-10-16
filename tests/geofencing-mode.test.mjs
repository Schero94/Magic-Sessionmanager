import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getGeofencingField,
  inferGeofencingMode,
  selectGeofencingMode,
} from '../admin/src/utils/geofencingMode.mjs';

test('geofencing defaults to allowlist when both country lists are empty', () => {
  assert.equal(inferGeofencingMode({ allowedCountries: [], blockedCountries: [] }), 'allowlist');
});

test('geofencing mode switches remain selected before the first country is added', () => {
  const blocklistSelection = selectGeofencingMode('allowlist', 'blocklist');

  assert.deepEqual(blocklistSelection, {
    mode: 'blocklist',
    clearField: 'allowedCountries',
  });
  assert.equal(getGeofencingField(blocklistSelection.mode), 'blockedCountries');

  const allowlistSelection = selectGeofencingMode('blocklist', 'allowlist');

  assert.deepEqual(allowlistSelection, {
    mode: 'allowlist',
    clearField: 'blockedCountries',
  });
  assert.equal(getGeofencingField(allowlistSelection.mode), 'allowedCountries');
});

test('saved non-empty country lists still infer their established mode', () => {
  assert.equal(inferGeofencingMode({ allowedCountries: ['JP'], blockedCountries: [] }), 'allowlist');
  assert.equal(inferGeofencingMode({ allowedCountries: [], blockedCountries: ['DE'] }), 'blocklist');
});
