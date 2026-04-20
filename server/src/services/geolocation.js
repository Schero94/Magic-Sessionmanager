'use strict';

/**
 * IP Geolocation Service.
 *
 * Uses ipapi.co for address lookups with a strict timeout. Returns fallback
 * data for private IPs, rate-limited responses and transport failures so
 * callers can distinguish "trusted no-op" from "unknown-fail-closed".
 */

const GEO_API_TIMEOUT_MS = 4000;

module.exports = ({ strapi }) => ({
  /**
   * Looks up geolocation data for an IP address.
   *
   * Returns a shape including `_status` with one of:
   *   - 'ok'           successful remote lookup
   *   - 'private'      private / localhost IP (no lookup needed)
   *   - 'rate_limited' remote API told us to back off
   *   - 'error'        transport / parsing failure
   *
   * Consumers that enforce security policies should treat anything other than
   * 'ok' and 'private' as potentially unsafe and make their own fail-closed
   * decision.
   *
   * @param {string} ipAddress
   * @returns {Promise<object>}
   */
  async getIpInfo(ipAddress) {
    if (!ipAddress || this.isPrivateIp(ipAddress)) {
      return {
        ip: ipAddress,
        country: 'Local Network',
        country_code: 'XX',
        country_flag: '🏠',
        city: 'Localhost',
        region: 'Private Network',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        latitude: null,
        longitude: null,
        isVpn: false,
        isProxy: false,
        isThreat: false,
        securityScore: 100,
        riskLevel: 'None',
        _status: 'private',
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEO_API_TIMEOUT_MS);

    try {
      const response = await fetch(`https://ipapi.co/${encodeURIComponent(ipAddress)}/json/`, {
        method: 'GET',
        headers: { 'User-Agent': 'Strapi-Magic-SessionManager/1.0' },
        signal: controller.signal,
      });

      if (!response.ok) {
        strapi.log.warn(`[magic-sessionmanager/geolocation] API returned HTTP ${response.status}`);
        return this.getFallbackData(ipAddress, response.status === 429 ? 'rate_limited' : 'error');
      }

      const data = await response.json();

      if (data.error) {
        strapi.log.warn(`[magic-sessionmanager/geolocation] API Error: ${data.reason}`);
        const reason = /rate/i.test(data.reason || '') ? 'rate_limited' : 'error';
        return this.getFallbackData(ipAddress, reason);
      }

      const result = {
        ip: data.ip,
        country: data.country_name,
        country_code: data.country_code,
        country_flag: this.getCountryFlag(data.country_code),
        city: data.city,
        region: data.region,
        timezone: data.timezone,
        latitude: data.latitude,
        longitude: data.longitude,
        postal: data.postal,
        org: data.org,
        asn: data.asn,

        isVpn: data.threat?.is_vpn || false,
        isProxy: data.threat?.is_proxy || false,
        isThreat: data.threat?.is_threat || false,
        isAnonymous: data.threat?.is_anonymous || false,
        isTor: data.threat?.is_tor || false,

        securityScore: this.calculateSecurityScore({
          isVpn: data.threat?.is_vpn,
          isProxy: data.threat?.is_proxy,
          isThreat: data.threat?.is_threat,
          isAnonymous: data.threat?.is_anonymous,
          isTor: data.threat?.is_tor,
        }),

        riskLevel: this.getRiskLevel({
          isVpn: data.threat?.is_vpn,
          isProxy: data.threat?.is_proxy,
          isThreat: data.threat?.is_threat,
        }),

        _status: 'ok',
      };

      strapi.log.debug(`[magic-sessionmanager/geolocation] IP ${ipAddress}: ${result.city}, ${result.country} (Score: ${result.securityScore})`);

      return result;
    } catch (error) {
      const status = error?.name === 'AbortError' ? 'error' : 'error';
      strapi.log.error(`[magic-sessionmanager/geolocation] Error fetching IP info for ${ipAddress}:`, error.message);
      return this.getFallbackData(ipAddress, status);
    } finally {
      clearTimeout(timer);
    }
  },

  /**
   * Returns a normalized security score (0-100, higher is safer).
   * @param {object} flags
   * @returns {number}
   */
  calculateSecurityScore({ isVpn, isProxy, isThreat, isAnonymous, isTor }) {
    let score = 100;
    if (isTor) score -= 50;
    if (isThreat) score -= 40;
    if (isVpn) score -= 20;
    if (isProxy) score -= 15;
    if (isAnonymous) score -= 10;
    return Math.max(0, score);
  },

  /**
   * Maps threat indicators to a human-readable risk level.
   * @param {object} flags
   * @returns {string}
   */
  getRiskLevel({ isVpn, isProxy, isThreat }) {
    if (isThreat) return 'High';
    if (isVpn && isProxy) return 'Medium-High';
    if (isVpn || isProxy) return 'Medium';
    return 'Low';
  },

  /**
   * Converts a 2-letter ISO country code into a flag emoji.
   * @param {string} countryCode
   * @returns {string}
   */
  getCountryFlag(countryCode) {
    if (!countryCode || typeof countryCode !== 'string' || countryCode.length !== 2) return '';
    const upper = countryCode.toUpperCase();
    if (!/^[A-Z]{2}$/.test(upper)) return '';
    const codePoints = upper.split('').map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
  },

  /**
   * Returns true for IPs that belong to private or local ranges (RFC 1918,
   * RFC 4193, loopback, link-local).
   * @param {string} ip
   * @returns {boolean}
   */
  isPrivateIp(ip) {
    if (!ip || ip === 'unknown') return true;

    if (ip === '127.0.0.1' || ip === 'localhost' || ip === '::1') return true;
    if (ip.startsWith('192.168.')) return true;
    if (ip.startsWith('10.')) return true;
    if (ip.startsWith('172.')) {
      const second = parseInt(ip.split('.')[1], 10);
      if (second >= 16 && second <= 31) return true;
    }
    if (ip.startsWith('169.254.')) return true;

    if (ip.startsWith('fc00:') || ip.startsWith('fd00:')) return true;
    if (ip.startsWith('fe80:')) return true;

    return false;
  },

  /**
   * Fallback data used when a lookup fails. The `_status` field tells the
   * caller why the fallback was used so they can make an informed
   * fail-open/fail-closed decision.
   *
   * @param {string} ipAddress
   * @param {string} [reason]
   * @returns {object}
   */
  getFallbackData(ipAddress, reason = 'error') {
    return {
      ip: ipAddress,
      country: 'Unknown',
      country_code: 'XX',
      country_flag: '',
      city: 'Unknown',
      region: 'Unknown',
      timezone: 'Unknown',
      latitude: null,
      longitude: null,
      isVpn: false,
      isProxy: false,
      isThreat: false,
      securityScore: 50,
      riskLevel: 'Unknown',
      _status: reason,
    };
  },

  /**
   * Batch lookup helper for multiple IPs.
   * @param {Array<string>} ipAddresses
   * @returns {Promise<Array<object>>}
   */
  async batchGetIpInfo(ipAddresses) {
    const results = await Promise.all(ipAddresses.map(ip => this.getIpInfo(ip)));
    return results;
  },
});
