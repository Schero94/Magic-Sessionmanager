'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { evaluateGeoFirewall } = require('../server/src/utils/geo-firewall');

test('geo firewall blocks countries from the blocklist', () => {
  const decision = evaluateGeoFirewall(
    {
      enableGeofencing: true,
      blockedCountries: ['RU'],
      allowedCountries: [],
    },
    { _status: 'ok', country_code: 'RU' }
  );

  assert.equal(decision.blocked, true);
  assert.equal(decision.reason, 'country_blocked:RU');
});

test('geo firewall blocks countries outside an allowlist', () => {
  const decision = evaluateGeoFirewall(
    {
      enableGeofencing: true,
      allowedCountries: ['DE', 'AT', 'CH'],
      blockedCountries: [],
    },
    { _status: 'ok', country_code: 'US' }
  );

  assert.equal(decision.blocked, true);
  assert.equal(decision.reason, 'country_not_allowed:US');
});

test('geo firewall allows private network lookups', () => {
  const decision = evaluateGeoFirewall(
    {
      enableGeofencing: true,
      allowedCountries: ['DE'],
      geoLookupFailureMode: 'block',
    },
    { _status: 'private', country_code: 'XX' }
  );

  assert.equal(decision.blocked, false);
});

test('geo firewall can fail closed when lookup is unavailable', () => {
  const decision = evaluateGeoFirewall(
    {
      enableGeofencing: true,
      geoLookupFailureMode: 'block',
    },
    { _status: 'error' }
  );

  assert.equal(decision.blocked, true);
  assert.equal(decision.reason, 'geo_lookup_unavailable:error');
});

test('geo firewall preserves suspicious-session fail-closed behavior', () => {
  const decision = evaluateGeoFirewall(
    {
      blockSuspiciousSessions: true,
    },
    { _status: 'rate_limited' }
  );

  assert.equal(decision.blocked, true);
  assert.equal(decision.reason, 'geo_lookup_unavailable:rate_limited');
});

test('VPN blocking is independent from the email alert toggle', () => {
  const decision = evaluateGeoFirewall(
    {
      blockSuspiciousSessions: true,
      alertOnVpnProxy: false,
    },
    { _status: 'ok', isVpn: true, riskSource: 'anonymous-ip' }
  );

  assert.equal(decision.blocked, true);
  assert.equal(decision.reason, 'vpn_detected');
});

test('risk flags without a risk data source never refuse a sign-in', () => {
  const settings = { blockSuspiciousSessions: true, enableSecurityScoring: true };
  for (const geoData of [
    { _status: 'ok', isVpn: true },
    { _status: 'ok', isThreat: true, securityScore: 10 },
    { _status: 'ok', securityScore: null, riskSource: null },
    { _status: 'ok', isProxy: true, riskSource: 'made-up' },
  ]) {
    assert.deepEqual(evaluateGeoFirewall(settings, geoData), {
      blocked: false,
      reason: null,
      status: 'ok',
    });
  }
});

test('a saved reject switch keeps the Automatic fail-closed rule without a risk source', () => {
  // Upgrade compatibility: the lookup-failure rule does not depend on risk data.
  const decision = evaluateGeoFirewall({ blockSuspiciousSessions: true }, { _status: 'error' });
  assert.equal(decision.blocked, true);
  assert.equal(decision.reason, 'geo_lookup_unavailable:error');
});

test('risk data from a source refuses Tor, VPN, proxy and low scores but not hosting', () => {
  const settings = { blockSuspiciousSessions: true };
  const base = { _status: 'ok', riskSource: 'anonymous-ip', securityScore: 100 };
  assert.equal(
    evaluateGeoFirewall(settings, { ...base, isTor: true, securityScore: 40 }).reason,
    'tor_exit_node'
  );
  assert.equal(
    evaluateGeoFirewall(settings, { ...base, isProxy: true, securityScore: 75 }).reason,
    'proxy_detected'
  );
  assert.equal(
    evaluateGeoFirewall(settings, { ...base, securityScore: 45 }).reason,
    'low_security_score:45'
  );
  assert.equal(
    evaluateGeoFirewall(settings, { ...base, isHosting: true, securityScore: 70 }).blocked,
    false
  );
  assert.equal(
    evaluateGeoFirewall({ blockSuspiciousSessions: false }, { ...base, isVpn: true }).blocked,
    false
  );
});
