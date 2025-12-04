/**
 * License Guard Service for Magic Session Manager
 * Handles license creation, verification, and ping tracking
 */

const crypto = require('crypto');
const os = require('os');
const pluginPkg = require('../../../package.json');

// FIXED LICENSE SERVER URL
const LICENSE_SERVER_URL = 'https://magicapi.fitlex.me';

module.exports = ({ strapi }) => ({
  /**
   * Get license server URL
   */
  getLicenseServerUrl() {
    return LICENSE_SERVER_URL;
  },

  /**
   * Generate device ID
   */
  generateDeviceId() {
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
      
      const identifier = `${macAddresses.join('-')}-${os.hostname()}`;
      return crypto.createHash('sha256').update(identifier).digest('hex').substring(0, 32);
    } catch (error) {
      return crypto.randomBytes(16).toString('hex');
    }
  },

  getDeviceName() {
    try {
      return os.hostname() || 'Unknown Device';
    } catch (error) {
      return 'Unknown Device';
    }
  },

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
    } catch (error) {
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
      const deviceId = this.generateDeviceId();
      const deviceName = this.getDeviceName();
      const ipAddress = this.getIpAddress();
      const userAgent = this.getUserAgent();

      const licenseServerUrl = this.getLicenseServerUrl();
      const response = await fetch(`${licenseServerUrl}/api/licenses/create`, {
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
        strapi.log.info('[magic-sessionmanager] [SUCCESS] License created:', data.data.licenseKey);
        return data.data;
      } else {
        strapi.log.error('[magic-sessionmanager] [ERROR] License creation failed:', data);
        return null;
      }
    } catch (error) {
      strapi.log.error('[magic-sessionmanager] [ERROR] Error creating license:', error);
      return null;
    }
  },

  async verifyLicense(licenseKey, allowGracePeriod = false) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const licenseServerUrl = this.getLicenseServerUrl();
      const response = await fetch(`${licenseServerUrl}/api/licenses/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          licenseKey,
          pluginName: 'magic-sessionmanager',
          productName: 'Magic Session Manager - Premium Session Tracking',
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      const data = await response.json();

      if (data.success && data.data) {
        return { valid: true, data: data.data, gracePeriod: false };
      } else {
        return { valid: false, data: null };
      }
    } catch (error) {
      if (allowGracePeriod) {
        return { valid: true, data: null, gracePeriod: true };
      }
      return { valid: false, data: null };
    }
  },

  async getLicenseByKey(licenseKey) {
    try {
      const licenseServerUrl = this.getLicenseServerUrl();
      const url = `${licenseServerUrl}/api/licenses/key/${licenseKey}`;
      
      strapi.log.debug(`[magic-sessionmanager/license-guard] Fetching license from: ${url}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (data.success && data.data) {
        strapi.log.debug(`[magic-sessionmanager/license-guard] License fetched: ${data.data.email}, featurePremium: ${data.data.featurePremium}`);
        return data.data;
      }
      
      strapi.log.warn(`[magic-sessionmanager/license-guard] License API returned no data`);
      return null;
    } catch (error) {
      strapi.log.error('[magic-sessionmanager/license-guard] Error fetching license by key:', error);
      return null;
    }
  },

  async pingLicense(licenseKey) {
    try {
      const deviceId = this.generateDeviceId();
      const deviceName = this.getDeviceName();
      const ipAddress = this.getIpAddress();
      const userAgent = this.getUserAgent();

      const licenseServerUrl = this.getLicenseServerUrl();
      const response = await fetch(`${licenseServerUrl}/api/licenses/ping`, {
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
    } catch (error) {
      return null;
    }
  },

  async storeLicenseKey(licenseKey) {
    const pluginStore = strapi.store({ 
      type: 'plugin', 
      name: 'magic-sessionmanager' 
    });
    await pluginStore.set({ key: 'licenseKey', value: licenseKey });
    strapi.log.info(`[magic-sessionmanager] [SUCCESS] License key stored: ${licenseKey.substring(0, 8)}...`);
  },

  startPinging(licenseKey, intervalMinutes = 15) {
    strapi.log.info(`[magic-sessionmanager] [TIME] Starting license pings every ${intervalMinutes} minutes`);
    
    // Immediate ping
    this.pingLicense(licenseKey);
    
    const interval = setInterval(async () => {
      try {
        await this.pingLicense(licenseKey);
      } catch (error) {
        strapi.log.error('[magic-sessionmanager] Ping error:', error);
      }
    }, intervalMinutes * 60 * 1000);

    return interval;
  },

  /**
   * Initialize license guard
   * Checks for existing license and starts pinging
   */
  async initialize() {
    try {
      strapi.log.info('[magic-sessionmanager] [SECURE] Initializing License Guard...');

      // Check if license key exists in plugin store
      const pluginStore = strapi.store({ 
        type: 'plugin', 
        name: 'magic-sessionmanager' 
      });
      const licenseKey = await pluginStore.get({ key: 'licenseKey' });

      if (!licenseKey) {
        strapi.log.info('[magic-sessionmanager] [INFO] No license found - Running in demo mode');
        return {
          valid: false,
          demo: true,
          data: null,
        };
      }

      // Check last validation timestamp for grace period
      const lastValidated = await pluginStore.get({ key: 'lastValidated' });
      const now = new Date();
      const gracePeriodHours = 24;
      let withinGracePeriod = false;
      
      if (lastValidated) {
        const lastValidatedDate = new Date(lastValidated);
        const hoursSinceValidation = (now.getTime() - lastValidatedDate.getTime()) / (1000 * 60 * 60);
        withinGracePeriod = hoursSinceValidation < gracePeriodHours;
      }

      // Verify license (allow grace period if we have a last validation)
      const verification = await this.verifyLicense(licenseKey, withinGracePeriod);

      if (verification.valid) {
        // Update last validated timestamp
        await pluginStore.set({ 
          key: 'lastValidated', 
          value: now.toISOString() 
        });

        // Start automatic pinging
        const pingInterval = this.startPinging(licenseKey, 15);
        
        // Store interval globally so we can clean it up
        strapi.licenseGuard = {
          licenseKey,
          pingInterval,
          data: verification.data,
        };

        return {
          valid: true,
          demo: false,
          data: verification.data,
          gracePeriod: verification.gracePeriod || false,
        };
      } else {
        strapi.log.error('[magic-sessionmanager] [ERROR] License validation failed');
        return {
          valid: false,
          demo: true,
          error: 'Invalid or expired license',
          data: null,
        };
      }
    } catch (error) {
      strapi.log.error('[magic-sessionmanager] [ERROR] Error initializing License Guard:', error);
      return {
        valid: false,
        demo: true,
        error: error.message,
        data: null,
      };
    }
  },
});
