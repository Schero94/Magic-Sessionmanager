'use strict';

/**
 * IP Geolocation Service.
 *
 * Uses a local MaxMind-compatible MMDB database when configured, with ipapi.co
 * kept as the legacy remote provider. The local path is preferred for firewall
 * decisions because it does not depend on network availability or API quotas.
 */

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { getPluginSettings } = require('../utils/settings-loader');

const GEO_API_TIMEOUT_MS = 4000;
const IPAPI_SUCCESS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const IPAPI_FAILURE_CACHE_TTL_MS = 5 * 60 * 1000;
const IPAPI_RATE_LIMIT_BACKOFF_MS = 15 * 60 * 1000;
const IPAPI_RATE_LIMIT_LOG_INTERVAL_MS = 60 * 1000;
const IPAPI_MAX_CONCURRENT_REQUESTS = 4;
const IPAPI_MAX_QUEUE_SIZE = 50;
const DEFAULT_CITY_MMDB_PATH = path.resolve(process.cwd(), 'data', 'GeoLite2-City.mmdb');
const DEFAULT_COUNTRY_MMDB_PATH = path.resolve(process.cwd(), 'data', 'GeoLite2-Country.mmdb');
const VALID_PROVIDERS = new Set(['auto', 'local-mmdb', 'ipapi', 'disabled']);

const readerCache = new Map();
const ipapiCache = new Map();
const ipapiInFlight = new Map();
const ipapiQueue = [];
let ipapiActiveRequests = 0;
let ipapiRateLimitedUntil = 0;
let ipapiLastRateLimitLogAt = 0;

function normalizeProvider(value) {
  return VALID_PROVIDERS.has(value) ? value : 'auto';
}

function normalizeDatabasePath(value) {
  if (typeof value !== 'string' || value.trim() === '') return '';

  const trimmed = value.trim();
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function resolveDatabaseCandidates(settings = {}) {
  const configured = normalizeDatabasePath(
    settings.geoIpDatabasePath ||
    process.env.MAGIC_SESSIONMANAGER_GEOIP_DATABASE ||
    process.env.GEOIP_DATABASE_PATH
  );

  if (configured) return [configured];

  return uniqueValues([
    normalizeDatabasePath(process.env.GEOLITE2_CITY_MMDB),
    normalizeDatabasePath(process.env.GEOIP_CITY_DATABASE_PATH),
    normalizeDatabasePath(process.env.GEOLITE2_COUNTRY_MMDB),
    normalizeDatabasePath(process.env.GEOIP_COUNTRY_DATABASE_PATH),
    DEFAULT_CITY_MMDB_PATH,
    DEFAULT_COUNTRY_MMDB_PATH,
  ]);
}

function resolveDatabasePath(settings = {}) {
  return resolveDatabaseCandidates(settings)[0] || '';
}

function resolveExistingDatabasePath(settings = {}) {
  const candidates = resolveDatabaseCandidates(settings);
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0] || '';
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

function cloneGeoData(data) {
  return data ? { ...data } : data;
}

function getCachedIpapiResult(lookupIp) {
  const cached = ipapiCache.get(lookupIp);
  if (!cached) return null;

  if (cached.expiresAt <= Date.now()) {
    ipapiCache.delete(lookupIp);
    return null;
  }

  return cloneGeoData(cached.data);
}

function cacheIpapiResult(lookupIp, data, ttlMs) {
  if (!lookupIp || !data || ttlMs <= 0) return;

  if (ipapiCache.size > 1000) {
    const oldestKey = ipapiCache.keys().next().value;
    if (oldestKey) ipapiCache.delete(oldestKey);
  }

  ipapiCache.set(lookupIp, {
    data: cloneGeoData(data),
    expiresAt: Date.now() + ttlMs,
  });
}

function getRetryAfterMs(response) {
  const retryAfter = response?.headers?.get?.('retry-after');
  if (!retryAfter) return null;

  const seconds = Number.parseInt(retryAfter, 10);
  if (Number.isFinite(seconds)) {
    return Math.max(1000, Math.min(seconds * 1000, 60 * 60 * 1000));
  }

  const retryDate = Date.parse(retryAfter);
  if (Number.isFinite(retryDate)) {
    return Math.max(1000, Math.min(retryDate - Date.now(), 60 * 60 * 1000));
  }

  return null;
}

function markIpapiRateLimited(response) {
  const backoffMs = getRetryAfterMs(response) || IPAPI_RATE_LIMIT_BACKOFF_MS;
  ipapiRateLimitedUntil = Math.max(ipapiRateLimitedUntil, Date.now() + backoffMs);
  return backoffMs;
}

function getIpapiRateLimitRemainingMs() {
  return Math.max(0, ipapiRateLimitedUntil - Date.now());
}

function logIpapiRateLimit(strapi, message) {
  const now = Date.now();
  if (now - ipapiLastRateLimitLogAt < IPAPI_RATE_LIMIT_LOG_INTERVAL_MS) return;

  ipapiLastRateLimitLogAt = now;
  strapi.log.warn(message);
}

async function acquireIpapiSlot() {
  if (ipapiActiveRequests < IPAPI_MAX_CONCURRENT_REQUESTS) {
    ipapiActiveRequests++;
    return releaseIpapiSlot;
  }

  if (ipapiQueue.length >= IPAPI_MAX_QUEUE_SIZE) {
    return null;
  }

  return new Promise((resolve) => {
    ipapiQueue.push(resolve);
  });
}

function releaseIpapiSlot() {
  ipapiActiveRequests = Math.max(0, ipapiActiveRequests - 1);

  const next = ipapiQueue.shift();
  if (next) {
    ipapiActiveRequests++;
    next(releaseIpapiSlot);
  }
}

function getName(names = {}, fallback = '') {
  return names.en || names.de || names.fr || names.es || names.pt || fallback;
}

function getReaderDatabaseType(reader, databasePath) {
  const metadataType =
    reader?.metadata?.databaseType ||
    reader?.metadata?.database_type ||
    reader?.metadata?.database_type_name;

  if (typeof metadataType === 'string' && metadataType.trim()) {
    return metadataType;
  }

  return path.basename(databasePath || '');
}

function isCityDatabase(reader, databasePath) {
  return /(?:^|[-_])City(?:\.|[-_]|$)/i.test(getReaderDatabaseType(reader, databasePath));
}

function normalizeLocalCountryResult(data, lookupIp, getCountryFlag) {
  const country = data.country || data.registeredCountry || data.representedCountry || {};
  const countryCode = country.isoCode || data.registeredCountry?.isoCode || 'XX';

  return {
    ip: lookupIp,
    country: getName(country.names, countryCode || 'Unknown'),
    country_code: countryCode,
    country_flag: getCountryFlag(countryCode),
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
    _databaseType: 'country',
  };
}

function normalizeLocalCityResult(data, lookupIp, getCountryFlag) {
  const country = data.country || data.registeredCountry || data.representedCountry || {};
  const countryCode = country.isoCode || data.registeredCountry?.isoCode || 'XX';
  const region = Array.isArray(data.subdivisions) && data.subdivisions.length > 0
    ? data.subdivisions[0]
    : null;

  return {
    ip: lookupIp,
    country: getName(country.names, countryCode || 'Unknown'),
    country_code: countryCode,
    country_flag: getCountryFlag(countryCode),
    city: getName(data.city?.names, 'Unknown'),
    region: getName(region?.names, region?.isoCode || 'Unknown'),
    timezone: data.location?.timeZone || 'Unknown',
    latitude: data.location?.latitude ?? null,
    longitude: data.location?.longitude ?? null,
    accuracyRadius: data.location?.accuracyRadius ?? null,
    postal: data.postal?.code || null,
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
    _databaseType: 'city',
  };
}

function normalizeLookupIp(ipAddress) {
  if (typeof ipAddress !== 'string') return '';

  let normalized = ipAddress.trim();
  if (!normalized) return '';

  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1).trim();
  }

  const ipv4Mapped = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (ipv4Mapped && net.isIP(ipv4Mapped[1]) === 4) {
    return ipv4Mapped[1];
  }

  return normalized;
}

function parseIpv4(ip) {
  if (net.isIP(ip) !== 4) return null;

  const parts = ip.split('.').map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }

  return parts;
}

function isPrivateIpv4(ip) {
  const parts = parseIpv4(ip);
  if (!parts) return false;

  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function getFirstHextet(ip) {
  const first = ip.split(':')[0];
  if (!first) return 0;

  const parsed = Number.parseInt(first, 16);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function isPrivateIpv6(ip) {
  const lower = ip.toLowerCase();

  if (lower === '::' || lower === '::1') return true;
  if (/^(?:0:){7}0$/.test(lower) || /^(?:0:){7}1$/.test(lower)) return true;

  if (lower.startsWith('::ffff:')) {
    return isPrivateIpv4(normalizeLookupIp(lower));
  }

  const firstHextet = getFirstHextet(lower);
  return (
    (firstHextet & 0xfe00) === 0xfc00 ||
    (firstHextet & 0xffc0) === 0xfe80
  );
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
    const lookupIp = normalizeLookupIp(ipAddress);

    if (!lookupIp || this.isPrivateIp(lookupIp)) {
      return {
        ip: lookupIp || ipAddress,
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

    if (net.isIP(lookupIp) === 0) {
      return this.getFallbackData(ipAddress, 'error', 'validation', 'Invalid IP address');
    }

    const settings = await this.getGeoSettings();
    const provider = normalizeProvider(settings.geoIpProvider);

    if (provider === 'disabled') {
      return this.getFallbackData(lookupIp, 'disabled', 'disabled');
    }

    if (provider === 'local-mmdb') {
      return this.getLocalMmdbIpInfo(lookupIp, settings);
    }

    if (provider === 'auto') {
      const databasePath = resolveExistingDatabasePath(settings);
      if (databasePath && fs.existsSync(databasePath)) {
        const localResult = await this.getLocalMmdbIpInfo(lookupIp, settings);
        if (localResult?._status === 'ok' || settings.geoLookupFailureMode === 'block') {
          return localResult;
        }
        strapi.log.warn(`[magic-sessionmanager/geolocation] Local MMDB lookup failed (${localResult?._reason || localResult?._status}), falling back to ipapi.co`);
      }
    }

    return this.getIpapiIpInfo(lookupIp);
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
   * Looks up geolocation data from a local MaxMind-compatible MMDB file.
   * GeoLite2-City is preferred for city-level data; GeoLite2-Country remains
   * supported for existing installations and country-only firewall decisions.
   * @param {string} ipAddress
   * @param {object} settings
   * @returns {Promise<object>}
   */
  async getLocalMmdbIpInfo(ipAddress, settings = {}) {
    const lookupIp = normalizeLookupIp(ipAddress);
    if (!lookupIp || net.isIP(lookupIp) === 0) {
      return this.getFallbackData(ipAddress, 'error', 'validation', 'Invalid IP address');
    }

    const databasePath = resolveExistingDatabasePath(settings);

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
      const useCityLookup = isCityDatabase(reader, databasePath) && typeof reader.city === 'function';
      const data = useCityLookup ? reader.city(lookupIp) : reader.country(lookupIp);
      const result = useCityLookup
        ? normalizeLocalCityResult(data, lookupIp, this.getCountryFlag.bind(this))
        : normalizeLocalCountryResult(data, lookupIp, this.getCountryFlag.bind(this));

      strapi.log.debug(
        `[magic-sessionmanager/geolocation] Local MMDB ${result._databaseType} IP ${lookupIp}: ${result.city}, ${result.country_code}`
      );
      return result;
    } catch (error) {
      strapi.log.warn(`[magic-sessionmanager/geolocation] Local MMDB lookup failed for ${lookupIp}:`, error.message);
      return this.getFallbackData(lookupIp, 'error', 'local-mmdb', error.message);
    }
  },

  /**
   * Looks up geolocation data through the legacy remote ipapi.co provider.
   * @param {string} ipAddress
   * @returns {Promise<object>}
   */
  async getIpapiIpInfo(ipAddress) {
    const lookupIp = normalizeLookupIp(ipAddress);
    if (!lookupIp || net.isIP(lookupIp) === 0) {
      return this.getFallbackData(ipAddress, 'error', 'validation', 'Invalid IP address');
    }

    const cached = getCachedIpapiResult(lookupIp);
    if (cached) return cached;

    const rateLimitRemainingMs = getIpapiRateLimitRemainingMs();
    if (rateLimitRemainingMs > 0) {
      logIpapiRateLimit(
        strapi,
        `[magic-sessionmanager/geolocation] ipapi.co is rate-limited; skipping remote lookups for ${Math.ceil(rateLimitRemainingMs / 1000)}s`
      );
      return this.getFallbackData(lookupIp, 'rate_limited', 'ipapi', 'Remote GeoIP provider is backing off after HTTP 429');
    }

    if (ipapiInFlight.has(lookupIp)) {
      return cloneGeoData(await ipapiInFlight.get(lookupIp));
    }

    const lookupPromise = (async () => {
      const releaseSlot = await acquireIpapiSlot();
      if (!releaseSlot) {
        const fallback = this.getFallbackData(
          lookupIp,
          'rate_limited',
          'ipapi',
          'Remote GeoIP provider concurrency limit reached'
        );
        cacheIpapiResult(lookupIp, fallback, IPAPI_FAILURE_CACHE_TTL_MS);
        return fallback;
      }

      const queuedRateLimitRemainingMs = getIpapiRateLimitRemainingMs();
      if (queuedRateLimitRemainingMs > 0) {
        releaseSlot();
        logIpapiRateLimit(
          strapi,
          `[magic-sessionmanager/geolocation] ipapi.co is rate-limited; skipping remote lookups for ${Math.ceil(queuedRateLimitRemainingMs / 1000)}s`
        );
        return this.getFallbackData(lookupIp, 'rate_limited', 'ipapi', 'Remote GeoIP provider is backing off after HTTP 429');
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GEO_API_TIMEOUT_MS);

      try {
        const response = await fetch(`https://ipapi.co/${encodeURIComponent(lookupIp)}/json/`, {
          method: 'GET',
          headers: { 'User-Agent': 'Strapi-Magic-SessionManager/1.0' },
          signal: controller.signal,
        });

        if (!response.ok) {
          const reason = response.status === 429 ? 'rate_limited' : 'error';
          if (response.status === 429) {
            const backoffMs = markIpapiRateLimited(response);
            logIpapiRateLimit(
              strapi,
              `[magic-sessionmanager/geolocation] API returned HTTP 429; backing off ipapi.co lookups for ${Math.ceil(backoffMs / 1000)}s`
            );
          } else {
            strapi.log.warn(`[magic-sessionmanager/geolocation] API returned HTTP ${response.status}`);
          }

          const fallback = this.getFallbackData(lookupIp, reason, 'ipapi', `HTTP ${response.status}`);
          cacheIpapiResult(lookupIp, fallback, IPAPI_FAILURE_CACHE_TTL_MS);
          return fallback;
        }

        const data = await response.json();

        if (data.error) {
          const reason = /rate/i.test(data.reason || '') ? 'rate_limited' : 'error';
          if (reason === 'rate_limited') {
            const backoffMs = markIpapiRateLimited();
            logIpapiRateLimit(
              strapi,
              `[magic-sessionmanager/geolocation] API reported rate limit; backing off ipapi.co lookups for ${Math.ceil(backoffMs / 1000)}s`
            );
          } else {
            strapi.log.warn(`[magic-sessionmanager/geolocation] API Error: ${data.reason}`);
          }

          const fallback = this.getFallbackData(lookupIp, reason, 'ipapi', data.reason);
          cacheIpapiResult(lookupIp, fallback, IPAPI_FAILURE_CACHE_TTL_MS);
          return fallback;
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
        cacheIpapiResult(lookupIp, result, IPAPI_SUCCESS_CACHE_TTL_MS);

        return result;
      } catch (error) {
        const status = error?.name === 'AbortError' ? 'error' : 'error';
        strapi.log.error(`[magic-sessionmanager/geolocation] Error fetching IP info for ${lookupIp}:`, error.message);
        const fallback = this.getFallbackData(lookupIp, status, 'ipapi', error.message);
        cacheIpapiResult(lookupIp, fallback, IPAPI_FAILURE_CACHE_TTL_MS);
        return fallback;
      } finally {
        clearTimeout(timer);
        releaseSlot();
      }
    })();

    ipapiInFlight.set(lookupIp, lookupPromise);

    try {
      return cloneGeoData(await lookupPromise);
    } finally {
      ipapiInFlight.delete(lookupIp);
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
    const normalized = normalizeLookupIp(ip);
    const lower = normalized.toLowerCase();

    if (!normalized || lower === 'unknown' || lower === 'localhost') return true;

    const version = net.isIP(normalized);
    if (version === 4) return isPrivateIpv4(normalized);
    if (version === 6) return isPrivateIpv6(normalized);

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
