'use strict';

/**
 * License Controller for Magic Session Manager.
 *
 * The plugin is free to use without activation. License keys are optional
 * metadata for install tracking / display and never unlock or lock features.
 *
 * Error contract: invalid input is a 400, an unreachable license provider a
 * 503, and any other server-side failure (store, provider exception) a 500.
 * Messages are fixed strings and never include exception details.
 */

const { sendServerError } = require('../utils/http-errors');

const PROVIDER_UNREACHABLE_MESSAGE =
  'License server unreachable. The plugin keeps working without a key.';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
      strapi.log.error('[magic-sessionmanager] Error getting license status:', error?.name || 'Error');
      return sendServerError(ctx, 500, 'Error getting license status');
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
        return sendServerError(ctx, 503, PROVIDER_UNREACHABLE_MESSAGE);
      }

      await licenseGuard.storeLicenseKey(license.licenseKey);

      return ctx.send({
        success: true,
        message: 'License automatically created and stored',
        data: license,
      });
    } catch (error) {
      strapi.log.error('[magic-sessionmanager] Error auto-creating license:', error?.name || 'Error');
      return sendServerError(ctx, 500, 'Error creating license');
    }
  },

  async createAndActivate(ctx) {
    try {
      const { email, firstName, lastName } = ctx.request.body || {};

      if (![email, firstName, lastName].every((value) => typeof value === 'string' && value.trim())) {
        return ctx.badRequest('Email, firstName, and lastName are required');
      }

      const licenseGuard = strapi.plugin('magic-sessionmanager').service('license-guard');
      const license = await licenseGuard.createLicense({ email, firstName, lastName });

      if (!license) {
        return sendServerError(ctx, 503, PROVIDER_UNREACHABLE_MESSAGE);
      }

      await licenseGuard.storeLicenseKey(license.licenseKey);

      return ctx.send({
        success: true,
        message: 'License created and stored successfully',
        data: license,
      });
    } catch (error) {
      strapi.log.error('[magic-sessionmanager] Error creating license:', error?.name || 'Error');
      return sendServerError(ctx, 500, 'Error creating license');
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
      strapi.log.error('[magic-sessionmanager] Error refreshing license:', error?.name || 'Error');
      return sendServerError(ctx, 500, 'Error refreshing license');
    }
  },

  async storeKey(ctx) {
    try {
      const { licenseKey, email } = ctx.request.body || {};

      if (typeof licenseKey !== 'string' || !licenseKey.trim()) {
        return ctx.badRequest('License key is required');
      }

      if (email !== undefined && email !== null && email !== '') {
        if (typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim())) {
          return ctx.badRequest('Email must be a valid email address');
        }
      }

      const trimmedKey = licenseKey.trim();
      const trimmedEmail = typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
      const licenseGuard = strapi.plugin('magic-sessionmanager').service('license-guard');

      const verification = await licenseGuard.verifyLicense(trimmedKey);

      if (!verification.valid && !verification.networkError) {
        strapi.log.warn('[magic-sessionmanager] Rejected an invalid license key');
        return ctx.badRequest('Invalid or expired license key');
      }

      const license = verification.valid ? await licenseGuard.getLicenseByKey(trimmedKey) : null;

      if (license?.email && trimmedEmail && license.email.toLowerCase() !== trimmedEmail) {
        strapi.log.warn('[magic-sessionmanager] Rejected a license holder email mismatch');
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
      strapi.log.error('[magic-sessionmanager] Error storing license key:', error?.name || 'Error');
      return sendServerError(ctx, 500, 'Error validating license key');
    }
  },
});
