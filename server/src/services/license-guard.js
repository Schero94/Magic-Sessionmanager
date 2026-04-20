'use strict';

/**
 * License Guard Service
 *
 * Handles license creation, verification and ping tracking against the
 * MagicAPI license server. All outbound HTTP calls are subject to a strict
 * timeout and a configurable base URL (overridable via
 * `MAGIC_LICENSE_SERVER_URL`).
 */

const crypto = require('crypto');
const os = require('os');
const pluginPkg = require('../../../package.json');
const { createLogger } = require('../utils/logger');

const DEFAULT_LICENSE_SERVER_URL = 'https://magicapi.fitlex.me';

// 12s default tolerates a cold-start on the license server (serverless
// containers often need 5–10s for the first TLS handshake) — the old
// 5s was too aggressive and produced spurious
//   "This operation was aborted" warnings during first-boot / restart.
// Overridable via MAGIC_LICENSE_TIMEOUT_MS for very fast or very slow
// networks.
const envTimeout = Number(process.env.MAGIC_LICENSE_TIMEOUT_MS);
const DEFAULT_FETCH_TIMEOUT_MS = Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 12000;

// Number of retries (on top of the initial attempt) before we give up
// and trigger the grace-period fallback. One quick retry is enough to
// absorb a cold-start without adding real latency to the happy path.
const FETCH_RETRIES = 1;
const FETCH_RETRY_BACKOFF_MS = 750;

/**
 * Wraps `fetch` with a hard timeout via AbortController and one retry
 * so a cold-start on the license server does not immediately show up
 * as a scary log line. Each attempt has its own fresh AbortController
 * — re-using one across attempts would cancel the retry before it
 * even connects.
 *
 * @param {string} url
 * @param {object} options
 * @param {number} [timeoutMs]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  let lastError;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      lastError = err;
      // Only retry on network-y failures (AbortError = our timeout,
      // TypeError from undici on connection reset, etc.). A 4xx/5xx
      // body never reaches this catch because fetch resolves those.
      if (attempt < FETCH_RETRIES) {
        await new Promise((r) => setTimeout(r, FETCH_RETRY_BACKOFF_MS));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

module.exports = ({ strapi }) => {
  const log = createLogger(strapi);

  return {
  /**
   * Returns the configured license server URL. Overridable via env var.
   * @returns {string}
   */
  getLicenseServerUrl() {
    return process.env.MAGIC_LICENSE_SERVER_URL || DEFAULT_LICENSE_SERVER_URL;
  },

  /**
   * Returns a stable device identifier. Prefers the pluginStore-persisted ID
   * (so restarts don't look like new devices), falling back to a MAC+hostname
   * hash, then random bytes.
   *
   * @returns {Promise<string>}
   */
  async generateDeviceId() {
    try {
      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-sessionmanager' });
      const stored = await pluginStore.get({ key: 'deviceId' });
      if (stored && typeof stored === 'string' && stored.length >= 16) {
        return stored;
      }

      let identifier;
      try {
        const networkInterfaces = os.networkInterfaces();
        const macAddresses = [];
        Object.values(networkInterfaces).forEach(interfaces => {
          interfaces?.forEach(iface => {
            if (iface.mac && iface.mac !== '00:00:00:00:00:00') {
              macAddresses.push(iface.mac);
            }
          });
        });
        identifier = `${macAddresses.join('-')}-${os.hostname()}`;
      } catch {
        identifier = `${Date.now()}-${crypto.randomBytes(16).toString('hex')}`;
      }

      const deviceId = crypto.createHash('sha256').update(identifier).digest('hex').substring(0, 32);
      await pluginStore.set({ key: 'deviceId', value: deviceId });
      return deviceId;
    } catch {
      return crypto.randomBytes(16).toString('hex');
    }
  },

  /**
   * Returns the OS hostname, falling back to a generic label.
   * @returns {string}
   */
  getDeviceName() {
    try {
      return os.hostname() || 'Unknown Device';
    } catch {
      return 'Unknown Device';
    }
  },

  /**
   * Returns the first non-internal IPv4 address, falling back to localhost.
   * @returns {string}
   */
  getIpAddress() {
    try {
      const networkInterfaces = os.networkInterfaces();
      for (const name of Object.keys(networkInterfaces)) {
        const interfaces = networkInterfaces[name];
        if (interfaces) {
          for (const iface of interfaces) {
            if (iface.family === 'IPv4' && !iface.internal) {
              return iface.address;
            }
          }
        }
      }
      return '127.0.0.1';
    } catch {
      return '127.0.0.1';
    }
  },

  /**
   * Returns a user-agent string identifying this plugin instance.
   * @returns {string}
   */
  getUserAgent() {
    const pluginVersion = pluginPkg.version || '1.0.0';
    const strapiVersion = strapi.config.get('info.strapi') || '5.0.0';
    return `MagicSessionManager/${pluginVersion} Strapi/${strapiVersion} Node/${process.version} ${os.platform()}/${os.release()}`;
  },

  /**
   * Creates a new license on the remote server.
   * @param {{email: string, firstName: string, lastName: string}} params
   * @returns {Promise<object|null>}
   */
  async createLicense({ email, firstName, lastName }) {
    try {
      const deviceId = await this.generateDeviceId();
      const deviceName = this.getDeviceName();
      const ipAddress = this.getIpAddress();
      const userAgent = this.getUserAgent();

      const response = await fetchWithTimeout(`${this.getLicenseServerUrl()}/api/licenses/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          firstName,
          lastName,
          deviceName,
          deviceId,
          ipAddress,
          userAgent,
          pluginName: 'magic-sessionmanager',
          productName: 'Magic Session Manager - Premium Session Tracking',
        }),
      });

      const data = await response.json();

      if (data.success) {
        log.info('[SUCCESS] License created:', data.data.licenseKey);
        return data.data;
      }
      log.error('[ERROR] License creation failed:', data);
      return null;
    } catch (error) {
      log.error('[ERROR] Error creating license:', error);
      return null;
    }
  },

  /**
   * Verifies an existing license key against the remote server.
   * @param {string} licenseKey
   * @param {boolean} [allowGracePeriod] - If true, network failures return grace
   * @returns {Promise<{valid: boolean, data: object|null, gracePeriod?: boolean}>}
   */
  async verifyLicense(licenseKey, allowGracePeriod = false) {
    try {
      const response = await fetchWithTimeout(`${this.getLicenseServerUrl()}/api/licenses/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey,
          pluginName: 'magic-sessionmanager',
          productName: 'Magic Session Manager - Premium Session Tracking',
        }),
      });

      const data = await response.json();

      if (data.success && data.data) {
        return { valid: true, data: data.data, gracePeriod: false };
      }
      return { valid: false, data: null };
    } catch (error) {
      if (allowGracePeriod) {
        // fetchWithTimeout already retried once, so by the time we end
        // up here the license server is really not answering within
        // ~24s. We log at info level (not warn) because the grace
        // period is a graceful fallback, not a defect — the plugin
        // keeps working normally for up to 24h while the network or
        // the upstream recovers.
        log.info(
          `License server unreachable after retry, continuing on grace period (${error.message})`
        );
        return { valid: true, data: null, gracePeriod: true };
      }
      return { valid: false, data: null };
    }
  },

  /**
   * Fetches full license details for a given license key.
   * @param {string} licenseKey
   * @returns {Promise<object|null>}
   */
  async getLicenseByKey(licenseKey) {
    try {
      const encodedKey = encodeURIComponent(licenseKey);
      const url = `${this.getLicenseServerUrl()}/api/licenses/key/${encodedKey}`;
      log.debug(`[license-guard] Fetching license from: ${url}`);

      const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (data.success && data.data) {
        log.debug(`[license-guard] License fetched: ${data.data.email}, featurePremium: ${data.data.featurePremium}`);
        return data.data;
      }

      log.warn('[license-guard] License API returned no data');
      return null;
    } catch (error) {
      log.error('[license-guard] Error fetching license by key:', error);
      return null;
    }
  },

  /**
   * Records a liveness ping against the license server.
   * @param {string} licenseKey
   * @returns {Promise<object|null>}
   */
  async pingLicense(licenseKey) {
    try {
      const deviceId = await this.generateDeviceId();
      const deviceName = this.getDeviceName();
      const ipAddress = this.getIpAddress();
      const userAgent = this.getUserAgent();

      const response = await fetchWithTimeout(`${this.getLicenseServerUrl()}/api/licenses/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey,
          deviceId,
          deviceName,
          ipAddress,
          userAgent,
          pluginName: 'magic-sessionmanager',
        }),
      });

      const data = await response.json();
      return data.success ? data.data : null;
    } catch {
      return null;
    }
  },

  /**
   * Persists a license key in the plugin store.
   * @param {string} licenseKey
   */
  async storeLicenseKey(licenseKey) {
    const pluginStore = strapi.store({
      type: 'plugin',
      name: 'magic-sessionmanager'
    });
    await pluginStore.set({ key: 'licenseKey', value: licenseKey });
    log.info(`[SUCCESS] License key stored: ${licenseKey.substring(0, 8)}...`);
  },

  /**
   * Starts a periodic liveness ping. Any previously scheduled interval is
   * cleared first to avoid leaks on repeated calls.
   *
   * @param {string} licenseKey
   * @param {number} [intervalMinutes]
   * @returns {NodeJS.Timeout}
   */
  startPinging(licenseKey, intervalMinutes = 15) {
    log.info(`[TIME] Starting license pings every ${intervalMinutes} minutes`);

    if (strapi.licenseGuard && strapi.licenseGuard.pingInterval) {
      try {
        clearInterval(strapi.licenseGuard.pingInterval);
      } catch {
        // Ignore teardown errors
      }
    }

    this.pingLicense(licenseKey);

    const interval = setInterval(async () => {
      try {
        await this.pingLicense(licenseKey);
      } catch (error) {
        log.error('Ping error:', error);
      }
    }, intervalMinutes * 60 * 1000);

    return interval;
  },

  /**
   * Boot-time license check. On persistent network failure falls back to a
   * grace period (max 24 hours since last successful validation).
   *
   * @returns {Promise<{valid: boolean, demo: boolean, data: object|null, gracePeriod?: boolean, error?: string}>}
   */
  async initialize() {
    try {
      log.info('[SECURE] Initializing License Guard...');

      const pluginStore = strapi.store({
        type: 'plugin',
        name: 'magic-sessionmanager'
      });
      const licenseKey = await pluginStore.get({ key: 'licenseKey' });

      if (!licenseKey) {
        log.info('[INFO] No license found - Running in demo mode');
        return { valid: false, demo: true, data: null };
      }

      const lastValidated = await pluginStore.get({ key: 'lastValidated' });
      const now = new Date();
      const gracePeriodHours = 24;
      let withinGracePeriod = false;

      if (lastValidated) {
        const lastValidatedDate = new Date(lastValidated);
        const hoursSinceValidation = (now.getTime() - lastValidatedDate.getTime()) / (1000 * 60 * 60);
        withinGracePeriod = hoursSinceValidation < gracePeriodHours;
      }

      const verification = await this.verifyLicense(licenseKey, withinGracePeriod);

      if (verification.valid) {
        if (!verification.gracePeriod) {
          await pluginStore.set({ key: 'lastValidated', value: now.toISOString() });
        }

        const pingInterval = this.startPinging(licenseKey, 15);

        strapi.licenseGuard = {
          licenseKey,
          pingInterval,
          data: verification.data,
          gracePeriod: verification.gracePeriod || false,
        };

        return {
          valid: true,
          demo: false,
          data: verification.data,
          gracePeriod: verification.gracePeriod || false,
        };
      }

      log.error('[ERROR] License validation failed');
      return { valid: false, demo: true, error: 'Invalid or expired license', data: null };
    } catch (error) {
      log.error('[ERROR] Error initializing License Guard:', error);
      return { valid: false, demo: true, error: error.message, data: null };
    }
  },
};
};
