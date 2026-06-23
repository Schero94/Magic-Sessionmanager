'use strict';

/**
 * License Guard Service
 *
 * Marketplace/free build:
 * - All runtime features are available without a license key.
 * - License creation / key storage remains available from the admin License
 *   page as an optional install-tracking flow.
 * - No boot-time remote validation and no periodic ping are performed.
 * - Legacy feature helpers always return permissive values so older callers
 *   keep working without gating behavior.
 */

const crypto = require('crypto');
const os = require('os');
const pluginPkg = require('../../../package.json');
const { createLogger } = require('../utils/logger');

const DEFAULT_LICENSE_SERVER_URL = 'https://magicapi.fitlex.me';

const envTimeout = Number(process.env.MAGIC_LICENSE_TIMEOUT_MS);
const DEFAULT_FETCH_TIMEOUT_MS = Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 12000;
const FETCH_RETRIES = 1;
const FETCH_RETRY_BACKOFF_MS = 750;

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  let lastError;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      lastError = err;
      if (attempt < FETCH_RETRIES) {
        // eslint-disable-next-line no-await-in-loop
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
    getLicenseServerUrl() {
      return process.env.MAGIC_LICENSE_SERVER_URL || DEFAULT_LICENSE_SERVER_URL;
    },

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
          Object.values(networkInterfaces).forEach((interfaces) => {
            interfaces?.forEach((iface) => {
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

    getDeviceName() {
      try {
        return os.hostname() || 'Unknown Device';
      } catch {
        return 'Unknown Device';
      }
    },

    getIpAddress() {
      try {
        const networkInterfaces = os.networkInterfaces();
        for (const name of Object.keys(networkInterfaces)) {
          const interfaces = networkInterfaces[name];
          if (!interfaces) continue;
          for (const iface of interfaces) {
            if (iface.family === 'IPv4' && !iface.internal) {
              return iface.address;
            }
          }
        }
        return '127.0.0.1';
      } catch {
        return '127.0.0.1';
      }
    },

    getUserAgent() {
      const pluginVersion = pluginPkg.version || '1.0.0';
      const strapiVersion = strapi.config.get('info.strapi') || '5.0.0';
      return `MagicSessionManager/${pluginVersion} Strapi/${strapiVersion} Node/${process.version} ${os.platform()}/${os.release()}`;
    },

    async createLicense({ email, firstName, lastName }) {
      try {
        const response = await fetchWithTimeout(`${this.getLicenseServerUrl()}/api/licenses/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            firstName,
            lastName,
            deviceName: this.getDeviceName(),
            deviceId: await this.generateDeviceId(),
            ipAddress: this.getIpAddress(),
            userAgent: this.getUserAgent(),
            pluginName: 'magic-sessionmanager',
            productName: 'Magic Session Manager',
          }),
        });

        const data = await response.json();
        if (data.success) {
          log.info('[SUCCESS] License created');
          return data.data;
        }
        log.warn('[WARNING] License creation rejected by server:', data.message || 'unknown');
        return null;
      } catch (error) {
        log.warn('[WARNING] Error creating license:', error.message);
        return null;
      }
    },

    async verifyLicense(licenseKey) {
      try {
        const response = await fetchWithTimeout(`${this.getLicenseServerUrl()}/api/licenses/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            licenseKey,
            pluginName: 'magic-sessionmanager',
            productName: 'Magic Session Manager',
          }),
        });

        const data = await response.json();
        if (data.success && data.data) {
          const pluginStore = strapi.store({ type: 'plugin', name: 'magic-sessionmanager' });
          await pluginStore.set({ key: 'lastValidated', value: new Date().toISOString() });
          return { valid: true, data: data.data };
        }
        return { valid: false, data: null };
      } catch (error) {
        log.warn(
          `[WARNING] License server unreachable during optional activation: ${error.message}. ` +
            'This does not block the plugin.'
        );
        return { valid: false, data: null, networkError: true };
      }
    },

    async getLicenseByKey(licenseKey) {
      try {
        const encodedKey = encodeURIComponent(licenseKey);
        const response = await fetchWithTimeout(`${this.getLicenseServerUrl()}/api/licenses/key/${encodedKey}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });

        const data = await response.json();
        if (data.success && data.data) return data.data;
        return null;
      } catch (error) {
        log.warn('[WARNING] Could not fetch license by key:', error.message);
        return null;
      }
    },

    async pingLicense() {
      return null;
    },

    async storeLicenseKey(licenseKey) {
      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-sessionmanager' });
      await pluginStore.set({ key: 'licenseKey', value: licenseKey });
      await pluginStore.set({ key: 'lastValidated', value: new Date().toISOString() });
      log.info('[SUCCESS] License key stored');
      return true;
    },

    startPinging() {
      return null;
    },

    async initialize() {
      return { valid: true, demo: false, data: null };
    },

    cleanup() {
      /* intentional no-op */
    },

    async hasFeature() {
      return true;
    },

    async getMaxSessions() {
      return -1;
    },

    async getLicenseTierInfo() {
      try {
        const pluginStore = strapi.store({ type: 'plugin', name: 'magic-sessionmanager' });
        const licenseKey = await pluginStore.get({ key: 'licenseKey' });
        const hasKey = !!licenseKey;
        return {
          tier: hasKey ? 'pro' : 'free',
          hasKey,
          features: {
            premium: true,
            advanced: true,
            enterprise: true,
          },
        };
      } catch {
        return {
          tier: 'free',
          hasKey: false,
          features: { premium: true, advanced: true, enterprise: true },
        };
      }
    },
  };
};
