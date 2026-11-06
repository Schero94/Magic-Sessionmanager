import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LICENSE_FEATURES_MESSAGE,
  LICENSE_STATE_MESSAGES,
  describeLicenseState,
  getLicenseState,
} from '../admin/src/utils/licenseStatus.mjs';

const NOW = Date.parse('2026-11-06T12:00:00.000Z');
const formatDate = (value) => `DATE(${new Date(value).toISOString().slice(0, 10)})`;

const withKey = (data) => ({ success: true, valid: true, hasKey: true, data: { licenseKey: 'SYNTHETIC-KEY-0001', ...data } });

test('no stored key is an informational state, not an error (IA D7, G)', () => {
  const state = getLicenseState({ success: true, valid: true, hasKey: false, data: { features: {} } }, NOW);
  assert.equal(state.state, 'noKey');
  assert.equal(state.hasKey, false);
  assert.equal(describeLicenseState(state, formatDate).defaultMessage, 'No license key stored.');
});

test('a key with a future expiry date is valid until that date', () => {
  const state = getLicenseState(withKey({ email: 'holder@example.invalid', expiresAt: '2027-03-01T00:00:00.000Z', isOnline: true }), NOW);
  assert.equal(state.state, 'valid');
  assert.equal(state.serverReachable, true);
  const message = describeLicenseState(state, formatDate);
  assert.equal(message.defaultMessage, 'License valid until {date}.');
  assert.deepEqual(message.values, { date: 'DATE(2027-03-01)' });
});

test('a key without an expiry date is valid without a date', () => {
  const state = getLicenseState(withKey({ email: 'holder@example.invalid', isOnline: true }), NOW);
  assert.equal(state.state, 'validNoExpiry');
});

test('an expired flag or a past expiry date reads "License expired on {date}."', () => {
  const flagged = getLicenseState(withKey({ email: 'a@example.invalid', isExpired: true, expiresAt: '2026-01-01T00:00:00.000Z' }), NOW);
  assert.equal(flagged.state, 'expired');
  assert.equal(describeLicenseState(flagged, formatDate).defaultMessage, 'License expired on {date}.');

  const past = getLicenseState(withKey({ email: 'a@example.invalid', isExpired: false, expiresAt: '2026-01-01T00:00:00.000Z' }), NOW);
  assert.equal(past.state, 'expired');

  const noDate = getLicenseState(withKey({ email: 'a@example.invalid', isExpired: true }), NOW);
  assert.equal(noDate.state, 'expiredNoDate');
});

test('a key the license server did not describe could not be checked', () => {
  // GET /license/status returns null details when the license server is unreachable.
  const state = getLicenseState(withKey({
    email: null, firstName: null, lastName: null, isActive: true, isExpired: false, isOnline: false,
    expiresAt: null, lastPingAt: null, deviceName: null, ipAddress: null, maxDevices: 1, currentDevices: 0,
  }), NOW);
  assert.equal(state.state, 'unchecked');
  assert.equal(state.serverReachable, false);
  assert.equal(describeLicenseState(state, formatDate).defaultMessage, 'The license status could not be checked.');
});

test('an inactive key is reported as not valid', () => {
  const state = getLicenseState(withKey({ email: 'a@example.invalid', isActive: false }), NOW);
  assert.equal(state.state, 'invalid');
});

test('older responses without hasKey fall back to the returned key', () => {
  assert.equal(getLicenseState({ data: { licenseKey: 'K', email: 'a@example.invalid' } }, NOW).hasKey, true);
  assert.equal(getLicenseState({ data: {} }, NOW).state, 'noKey');
  assert.equal(getLicenseState(null, NOW).state, 'noKey');
});

test('status copy never uses Active/Inactive or Online/Offline wording and states that features are never gated', () => {
  assert.equal(LICENSE_FEATURES_MESSAGE.defaultMessage, 'All features are available with or without a key.');
  for (const descriptor of [...Object.values(LICENSE_STATE_MESSAGES), LICENSE_FEATURES_MESSAGE]) {
    assert.match(descriptor.messageId, /^license\./);
    assert.doesNotMatch(descriptor.defaultMessage, /\b(?:Active|Inactive|Online|Offline|Activation)\b/);
  }
});
