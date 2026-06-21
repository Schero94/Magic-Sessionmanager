'use strict';

/**
 * License Controller for Magic Session Manager.
 *
 * The plugin is free to use without activation. License keys are optional
 * metadata for install tracking / display and never unlock or lock features.
 */

module.exports = ({ strapi }) => ({
  async getStatus(ctx) {
    try {
      const licenseGuard = strapi.plugin('magic-sessionmanager').service('license-guard');
      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-sessionmanager' });
      const licenseKey = await pluginStore.get({ key: 'licenseKey' });

      if (!licenseKey) {
        return ctx.send({
          success: true,
          valid: true,
          demo: false,
          hasKey: false,
          data: {
            features: {
              premium: true,
              advanced: true,
              enterprise: true,
              custom: true,
            },
          },
          message: 'Plugin is active. License key activation is optional.',
        });
      }

      const license = await licenseGuard.getLicenseByKey(licenseKey);

      return ctx.send({
        success: true,
        valid: true,
        demo: false,
        hasKey: true,
        data: {
          licenseKey,
          email: license?.email || null,
          firstName: license?.firstName || null,
          lastName: license?.lastName || null,
          isActive: license?.isActive ?? true,
          isExpired: license?.isExpired ?? false,
          isOnline: license?.isOnline ?? false,
          expiresAt: license?.expiresAt || null,
          lastPingAt: license?.lastPingAt || null,
          deviceName: license?.deviceName || null,
          deviceId: license?.deviceId || null,
          ipAddress: license?.ipAddress || null,
          features: {
            premium: true,
            advanced: true,
            enterprise: true,
            custom: true,
          },
          maxDevices: license?.maxDevices || 1,
          currentDevices: license?.currentDevices || 0,
        },
      });
    } catch (error) {
      strapi.log.error('[magic-sessionmanager] Error getting license status:', error);
      return ctx.badRequest('Error getting license status');
    }
  },

  async autoCreate(ctx) {
    try {
      const adminUser = ctx.state.user;
      if (!adminUser) {
        return ctx.unauthorized('No admin user logged in');
      }

      const licenseGuard = strapi.plugin('magic-sessionmanager').service('license-guard');
      const license = await licenseGuard.createLicense({
        email: adminUser.email,
        firstName: adminUser.firstname || 'Admin',
        lastName: adminUser.lastname || 'User',
      });

      if (!license) {
        return ctx.badRequest('License server unreachable. The plugin keeps working without a key.');
      }

      await licenseGuard.storeLicenseKey(license.licenseKey);

      return ctx.send({
        success: true,
        message: 'License automatically created and stored',
        data: license,
      });
    } catch (error) {
      strapi.log.error('[magic-sessionmanager] Error auto-creating license:', error);
      return ctx.badRequest('Error creating license');
    }
  },

  async createAndActivate(ctx) {
    try {
      const { email, firstName, lastName } = ctx.request.body || {};

      if (!email || !firstName || !lastName) {
        return ctx.badRequest('Email, firstName, and lastName are required');
      }

      const licenseGuard = strapi.plugin('magic-sessionmanager').service('license-guard');
      const license = await licenseGuard.createLicense({ email, firstName, lastName });

      if (!license) {
        return ctx.badRequest('License server unreachable. The plugin keeps working without a key.');
      }

      await licenseGuard.storeLicenseKey(license.licenseKey);

      return ctx.send({
        success: true,
        message: 'License created and stored successfully',
        data: license,
      });
    } catch (error) {
      strapi.log.error('[magic-sessionmanager] Error creating license:', error);
      return ctx.badRequest('Error creating license');
    }
  },

  async ping(ctx) {
    try {
      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-sessionmanager' });
      const licenseKey = await pluginStore.get({ key: 'licenseKey' });

      if (!licenseKey) {
        return ctx.badRequest('No license key found');
      }

      const licenseGuard = strapi.plugin('magic-sessionmanager').service('license-guard');
      const verification = await licenseGuard.verifyLicense(licenseKey);

      return ctx.send({
        success: true,
        message: verification.valid
          ? 'License refreshed successfully'
          : 'License key could not be verified, but the plugin keeps working.',
        data: verification.data,
      });
    } catch (error) {
      strapi.log.error('[magic-sessionmanager] Error refreshing license:', error);
      return ctx.badRequest('Error refreshing license');
    }
  },

  async storeKey(ctx) {
    try {
      const { licenseKey, email } = ctx.request.body || {};

      if (!licenseKey || !licenseKey.trim()) {
        return ctx.badRequest('License key is required');
      }

      const trimmedKey = licenseKey.trim();
      const trimmedEmail = email?.trim().toLowerCase() || null;
      const licenseGuard = strapi.plugin('magic-sessionmanager').service('license-guard');

      const verification = await licenseGuard.verifyLicense(trimmedKey);

      if (!verification.valid && !verification.networkError) {
        strapi.log.warn(`[magic-sessionmanager] Invalid license key: ${trimmedKey.substring(0, 8)}...`);
        return ctx.badRequest('Invalid or expired license key');
      }

      const license = verification.valid ? await licenseGuard.getLicenseByKey(trimmedKey) : null;

      if (license?.email && trimmedEmail && license.email.toLowerCase() !== trimmedEmail) {
        strapi.log.warn(
          `[magic-sessionmanager] Email mismatch for license key: ${trimmedKey.substring(0, 8)}... (attempted: ${trimmedEmail})`
        );
        return ctx.badRequest('Email address does not match this license key');
      }

      await licenseGuard.storeLicenseKey(trimmedKey);

      return ctx.send({
        success: true,
        message: verification.networkError
          ? 'License key stored. The license server was unreachable, but the plugin keeps working.'
          : 'License key stored successfully',
        data: verification.data || { licenseKey: trimmedKey, email: trimmedEmail },
      });
    } catch (error) {
      strapi.log.error('[magic-sessionmanager] Error storing license key:', error);
      return ctx.badRequest('Error validating license key');
    }
  },
});
