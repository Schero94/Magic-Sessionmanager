import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RISK_LEVELS,
  RISK_LEVEL_MESSAGES,
  RISK_LEVEL_TONES,
  getStoredGeoData,
  interpretLookupResult,
  normalizeGeoData,
  normalizeRiskLevel,
} from '../admin/src/utils/sessionSecurity.mjs';
import * as security from '../admin/src/utils/sessionSecurity.mjs';

test('server risk labels map to translated levels instead of raw English (DASH-15, IA H.12)', () => {
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
  assert.deepEqual(
    RISK_LEVELS.map((level) => RISK_LEVEL_MESSAGES[level].defaultMessage),
    ['None', 'Low', 'Medium', 'Medium-high', 'High']
  );
});

test('no client-side "below 50 = High" mapping remains (IA D2.6)', () => {
  assert.equal('getRiskLevelFromScore' in security, false);
  assert.equal(normalizeGeoData({ country: 'Germany', securityScore: 10 }).riskLevel, '');
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
  // No risk source: the record's score, level and flags were never checked.
  assert.deepEqual(local, {
    country: 'Local Network',
    city: 'Localhost',
    timezone: 'Europe/Berlin',
    riskSource: null,
    securityScore: null,
    riskLevel: '',
    isVpn: null,
    isProxy: null,
    isHosting: null,
  });

  // The ASN heuristic sees hosting networks only: VPN and proxy stay unknown.
  const heuristic = normalizeGeoData({
    country: 'Germany',
    securityScore: 80,
    isVpn: false,
    isProxy: false,
    isHosting: true,
    riskSource: 'asn-heuristic',
  });
  assert.equal(heuristic.isVpn, null);
  assert.equal(heuristic.isProxy, null);
  assert.equal(heuristic.isHosting, true);
  assert.equal(heuristic.securityScore, 80);

  const checked = normalizeGeoData({
    country: 'Germany',
    securityScore: 70,
    riskLevel: 'Medium',
    isVpn: true,
    isProxy: false,
    riskSource: 'anonymous-ip',
  });
  assert.equal(checked.riskSource, 'anonymous-ip');
  assert.equal(checked.securityScore, 70);
  assert.equal(checked.riskLevel, 'medium');
  assert.equal(checked.isVpn, true);
  assert.equal(checked.isProxy, false);

  const partial = normalizeGeoData({ country_code: 'DE', city: 'unknown' });
  assert.equal(partial.country, 'DE');
  assert.equal(partial.city, '');
  assert.equal(partial.securityScore, null);
  assert.equal(partial.riskLevel, '');
  assert.equal(partial.isVpn, null);
  assert.equal(partial.isProxy, null);
});

test('stored location trusts only the session score and has no VPN, proxy or risk data', () => {
  const stored = getStoredGeoData({
    securityScore: 30,
    geoLocation: JSON.stringify({
      country: 'Germany',
      securityScore: 100,
      riskLevel: 'None',
      isVpn: true,
      isProxy: false,
      riskSource: 'anonymous-ip',
    }),
  });
  assert.equal(stored.securityScore, 30);
  assert.equal(stored.riskSource, 'anonymous-ip');
  assert.equal(stored.riskLevel, '', 'risk level only from a live lookup');
  assert.equal(stored.isVpn, null, 'shown as "Not stored for past sign-ins"');
  assert.equal(stored.isProxy, null);
  // Rows written before risk sources existed carry a fake 100: not available.
  const legacy = getStoredGeoData({ securityScore: 100, geoLocation: { country: 'Germany' } });
  assert.equal(legacy.securityScore, null);
  assert.equal(legacy.riskSource, null);
  assert.equal(getStoredGeoData({ geoLocation: '{not json' }), null);
  assert.equal(getStoredGeoData({}), null);
});

test('on-demand lookup results: ok, lookup off, or could not be determined (decision I.2-7)', () => {
  const ok = interpretLookupResult({
    success: true,
    data: {
      _status: 'ok',
      country: 'Germany',
      city: 'Berlin',
      timezone: 'Europe/Berlin',
      securityScore: 85,
      riskLevel: 'Low',
      isVpn: true,
      isProxy: false,
      riskSource: 'anonymous-ip',
    },
  });
  assert.equal(ok.status, 'ok');
  assert.equal(ok.geo.riskLevel, 'low');
  assert.equal(ok.geo.isVpn, true);

  // The server answers a disabled lookup with placeholder values; they are not shown as data.
  const disabled = interpretLookupResult({
    success: true,
    data: {
      _status: 'disabled',
      country: 'Unknown',
      city: 'Unknown',
      securityScore: 50,
      isVpn: false,
    },
  });
  assert.deepEqual(disabled, { status: 'disabled', geo: null });

  // A location-only answer (ipapi.co, GeoLite2) has no risk data.
  const locationOnly = interpretLookupResult({
    data: { _status: 'ok', country: 'Germany', securityScore: 100, isVpn: false },
  });
  assert.equal(locationOnly.status, 'ok');
  assert.equal(locationOnly.geo.securityScore, null);
  assert.equal(locationOnly.geo.isVpn, null);

  assert.deepEqual(interpretLookupResult({ data: { _status: 'private', country: 'Local' } }), {
    status: 'failed',
    geo: null,
  });
  assert.deepEqual(interpretLookupResult({ data: { _status: 'ok', country: 'Unknown' } }), {
    status: 'failed',
    geo: null,
  });
  assert.deepEqual(interpretLookupResult(null), { status: 'failed', geo: null });
});
