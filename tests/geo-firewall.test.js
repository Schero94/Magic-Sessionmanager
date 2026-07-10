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
    { _status: 'ok', isVpn: true }
  );

  assert.equal(decision.blocked, true);
  assert.equal(decision.reason, 'vpn_detected');
});
