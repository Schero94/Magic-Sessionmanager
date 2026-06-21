'use strict';

/**
 * IP Geolocation Service.
 *
 * Uses a local MaxMind-compatible MMDB database when configured, with ipapi.co
 * kept as the legacy remote provider. The local path is preferred for firewall
 * decisions because it does not depend on network availability or API quotas.
 */

const fs = require('node:fs');
const path = require('node:path');
const { getPluginSettings } = require('../utils/settings-loader');

const GEO_API_TIMEOUT_MS = 4000;
const DEFAULT_MMDB_PATH = path.resolve(process.cwd(), 'data', 'GeoLite2-Country.mmdb');
const VALID_PROVIDERS = new Set(['auto', 'local-mmdb', 'ipapi', 'disabled']);

const readerCache = new Map();

function normalizeProvider(value) {
  return VALID_PROVIDERS.has(value) ? value : 'auto';
}

function resolveDatabasePath(settings = {}) {
  const configured =
    settings.geoIpDatabasePath ||
    process.env.MAGIC_SESSIONMANAGER_GEOIP_DATABASE ||
    process.env.GEOLITE2_COUNTRY_MMDB ||
    DEFAULT_MMDB_PATH;

  if (typeof configured !== 'string' || configured.trim() === '') return '';

  const trimmed = configured.trim();
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
}

async function openLocalReader(databasePath) {
  if (readerCache.has(databasePath)) {
    return readerCache.get(databasePath);
  }

  const { Reader } = require('@maxmind/geoip2-node');
  const readerPromise = Reader.open(databasePath, { watchForUpdates: true });
  readerCache.set(databasePath, readerPromise);

  try {
    return await readerPromise;
  } catch (err) {
    readerCache.delete(databasePath);
    throw err;
  }
}

module.exports = ({ strapi }) => ({
  /**
   * Looks up geolocation data for an IP address.
   *
   * Returns a shape including `_status` with one of:
   *   - 'ok'           successful lookup
   *   - 'private'      private / localhost IP (no lookup needed)
   *   - 'rate_limited' remote API told us to back off
   *   - 'disabled'     provider disabled by config
   *   - 'error'        transport / parsing / local DB failure
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
        country_flag: '',
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
        _source: 'local',
      };
    }

    const settings = await this.getGeoSettings();
    const provider = normalizeProvider(settings.geoIpProvider);

    if (provider === 'disabled') {
      return this.getFallbackData(ipAddress, 'disabled', 'disabled');
    }

    if (provider === 'local-mmdb') {
      return this.getLocalMmdbIpInfo(ipAddress, settings);
    }

    if (provider === 'auto') {
      const databasePath = resolveDatabasePath(settings);
      if (databasePath && fs.existsSync(databasePath)) {
        const localResult = await this.getLocalMmdbIpInfo(ipAddress, settings);
        if (localResult?._status === 'ok') {
          return localResult;
        }
        strapi.log.warn(`[magic-sessionmanager/geolocation] Local MMDB lookup failed (${localResult?._reason || localResult?._status}), falling back to ipapi.co`);
      }
    }

    return this.getIpapiIpInfo(ipAddress);
  },

  /**
   * Reads effective GEOIP provider settings.
   * @returns {Promise<object>}
   */
  async getGeoSettings() {
    try {
      return await getPluginSettings(strapi);
    } catch {
      return strapi.config.get('plugin::magic-sessionmanager') || {};
    }
  },

  /**
   * Looks up country data from a local MaxMind-compatible MMDB file.
   * @param {string} ipAddress
   * @param {object} settings
   * @returns {Promise<object>}
   */
  async getLocalMmdbIpInfo(ipAddress, settings = {}) {
    const databasePath = resolveDatabasePath(settings);

    if (!databasePath || !fs.existsSync(databasePath)) {
      return this.getFallbackData(
        ipAddress,
        'error',
        'local-mmdb',
        databasePath ? `GeoIP database not found: ${databasePath}` : 'GeoIP database path missing'
      );
    }

    try {
      const reader = await openLocalReader(databasePath);
      const data = reader.country(ipAddress);
      const country = data.country || data.registeredCountry || data.representedCountry || {};
      const countryCode = country.isoCode || data.registeredCountry?.isoCode || 'XX';
      const countryNames = country.names || {};

      const result = {
        ip: ipAddress,
        country: countryNames.en || countryNames.de || countryCode || 'Unknown',
        country_code: countryCode,
        country_flag: this.getCountryFlag(countryCode),
        city: 'Unknown',
        region: 'Unknown',
        timezone: 'Unknown',
        latitude: null,
        longitude: null,
        postal: null,
        org: null,
        asn: null,
        network: data.traits?.network || null,

        isVpn: false,
        isProxy: false,
        isThreat: false,
        isAnonymous: false,
        isTor: false,

        securityScore: 100,
        riskLevel: 'Low',

        _status: 'ok',
        _source: 'local-mmdb',
      };

      strapi.log.debug(`[magic-sessionmanager/geolocation] Local MMDB IP ${ipAddress}: ${result.country_code}`);
      return result;
    } catch (error) {
      strapi.log.warn(`[magic-sessionmanager/geolocation] Local MMDB lookup failed for ${ipAddress}:`, error.message);
      return this.getFallbackData(ipAddress, 'error', 'local-mmdb', error.message);
    }
  },

  /**
   * Looks up geolocation data through the legacy remote ipapi.co provider.
   * @param {string} ipAddress
   * @returns {Promise<object>}
   */
  async getIpapiIpInfo(ipAddress) {
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
        return this.getFallbackData(ipAddress, response.status === 429 ? 'rate_limited' : 'error', 'ipapi');
      }

      const data = await response.json();

      if (data.error) {
        strapi.log.warn(`[magic-sessionmanager/geolocation] API Error: ${data.reason}`);
        const reason = /rate/i.test(data.reason || '') ? 'rate_limited' : 'error';
        return this.getFallbackData(ipAddress, reason, 'ipapi', data.reason);
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
        _source: 'ipapi',
      };

      strapi.log.debug(`[magic-sessionmanager/geolocation] IP ${ipAddress}: ${result.city}, ${result.country} (Score: ${result.securityScore})`);

      return result;
    } catch (error) {
      const status = error?.name === 'AbortError' ? 'error' : 'error';
      strapi.log.error(`[magic-sessionmanager/geolocation] Error fetching IP info for ${ipAddress}:`, error.message);
      return this.getFallbackData(ipAddress, status, 'ipapi', error.message);
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
   * @param {string} [source]
   * @param {string} [detail]
   * @returns {object}
   */
  getFallbackData(ipAddress, reason = 'error', source = 'ipapi', detail = '') {
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
      _source: source,
      _reason: detail,
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
