'use strict';

function normalizeCountryCode(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

function normalizeCountryList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeCountryCode).filter(Boolean);
}

function getLookupFailureMode(settings = {}) {
  if (settings.geoLookupFailureMode === 'block') return 'block';
  if (settings.geoLookupFailureMode === 'allow') return 'allow';
  return settings.blockSuspiciousSessions === true ? 'block' : 'allow';
}

/**
 * Evaluates whether a login should be blocked based on normalized GEOIP data.
 * Kept pure so firewall behavior can be tested without booting Strapi.
 *
 * @param {object} settings
 * @param {object} geoData
 * @returns {{blocked: boolean, reason: string|null, status: string}}
 */
function evaluateGeoFirewall(settings = {}, geoData = {}) {
  const status = geoData?._status || 'error';

  if (status === 'private') {
    return { blocked: false, reason: null, status };
  }

  if (status !== 'ok') {
    if (getLookupFailureMode(settings) === 'block') {
      return {
        blocked: true,
        reason: `geo_lookup_unavailable:${status}`,
        status,
      };
    }
    return { blocked: false, reason: null, status };
  }

  if (settings.blockSuspiciousSessions) {
    if (geoData.isThreat) {
      return { blocked: true, reason: 'threat_ip', status };
    }
    if (geoData.isVpn) {
      return { blocked: true, reason: 'vpn_detected', status };
    }
    if (geoData.isProxy) {
      return { blocked: true, reason: 'proxy_detected', status };
    }
    if (
      settings.enableSecurityScoring !== false &&
      typeof geoData.securityScore === 'number' &&
      geoData.securityScore < 50
    ) {
      return {
        blocked: true,
        reason: `low_security_score:${geoData.securityScore}`,
        status,
      };
    }
  }

  if (settings.enableGeofencing) {
    const countryCode = normalizeCountryCode(geoData.country_code);
    const blockedCountries = normalizeCountryList(settings.blockedCountries);
    const allowedCountries = normalizeCountryList(settings.allowedCountries);

    if (countryCode && blockedCountries.includes(countryCode)) {
      return {
        blocked: true,
        reason: `country_blocked:${countryCode}`,
        status,
      };
    }

    if (countryCode && allowedCountries.length > 0 && !allowedCountries.includes(countryCode)) {
      return {
        blocked: true,
        reason: `country_not_allowed:${countryCode}`,
        status,
      };
    }
  }

  return { blocked: false, reason: null, status };
}

module.exports = {
  evaluateGeoFirewall,
  normalizeCountryCode,
  normalizeCountryList,
};
