import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RISK_LEVELS,
  RISK_LEVEL_MESSAGES,
  RISK_LEVEL_TONES,
  getRiskLevelFromScore,
  getStoredGeoData,
  normalizeGeoData,
  normalizeRiskLevel,
} from '../admin/src/utils/sessionSecurity.mjs';

test('server risk labels map to translated levels instead of raw English (DASH-15)', () => {
  assert.equal(normalizeRiskLevel('None'), 'none');
  assert.equal(normalizeRiskLevel('Low'), 'low');
  assert.equal(normalizeRiskLevel('Medium'), 'medium');
  assert.equal(normalizeRiskLevel('Medium-High'), 'mediumHigh');
  assert.equal(normalizeRiskLevel('HIGH'), 'high');
  assert.equal(normalizeRiskLevel('Unknown'), '');
  assert.equal(normalizeRiskLevel(undefined), '');
  for (const level of RISK_LEVELS) {
    assert.match(RISK_LEVEL_MESSAGES[level].messageId, /^modal\.security\.risk\./);
    assert.ok(RISK_LEVEL_TONES[level]);
  }
});

test('a stored score derives the historical risk rule', () => {
  assert.equal(getRiskLevelFromScore(49), 'high');
  assert.equal(getRiskLevelFromScore(50), 'low');
  assert.equal(getRiskLevelFromScore(Number.NaN), '');
  assert.equal(getRiskLevelFromScore('80'), '');
});

test('geo data keeps missing facts missing and never invents security values', () => {
  assert.equal(normalizeGeoData(null), null);
  assert.equal(normalizeGeoData({ city: 'Unknown', timezone: '' }), null);

  const local = normalizeGeoData({
    country: 'Local Network',
    city: 'Localhost',
    timezone: 'Europe/Berlin',
    country_flag: 'XX-flag',
    securityScore: 100,
    riskLevel: 'None',
    isVpn: false,
    isProxy: false,
  });
  assert.deepEqual(local, {
    country: 'Local Network',
    city: 'Localhost',
    timezone: 'Europe/Berlin',
    securityScore: 100,
    riskLevel: 'none',
    isVpn: false,
    isProxy: false,
  });

  const partial = normalizeGeoData({ country_code: 'DE', city: 'unknown' });
  assert.equal(partial.country, 'DE');
  assert.equal(partial.city, '');
  assert.equal(partial.securityScore, null);
  assert.equal(partial.riskLevel, '');
  assert.equal(partial.isVpn, null);
  assert.equal(partial.isProxy, null);
});

test('stored session geo data trusts only the session score', () => {
  const stored = getStoredGeoData({
    securityScore: 30,
    geoLocation: JSON.stringify({ country: 'Germany', securityScore: 100, riskLevel: 'None', isVpn: true }),
  });
  assert.equal(stored.securityScore, 30);
  assert.equal(stored.riskLevel, 'high');
  assert.equal(stored.isVpn, true);
  assert.equal(getStoredGeoData({ geoLocation: '{not json' }), null);
  assert.equal(getStoredGeoData({}), null);
});
