'use strict';

/**
 * Admin API routes.
 *
 * SECURITY MODEL
 * --------------
 * Every route is gated by the combined policies built by `adminPolicy()`:
 *
 *   1. `admin::isAuthenticatedAdmin`
 *        Ensures a valid admin JWT is present. Blocks anonymous and
 *        end-user Content-API tokens.
 *
 *   2. `admin::hasPermissions` with `plugin::magic-sessionmanager.access`
 *        Ensures the calling admin ACTUALLY has the plugin-access
 *        permission. Without this second policy, any admin role (even
 *        "Editor" or "Author" without explicit plugin access) could
 *        bypass the hidden UI menu and call this API directly via curl.
 *
 * The `access` permission is registered in `server/src/register.js`.
 * By Strapi convention:
 *   - the Super-Admin role owns every plugin permission automatically,
 *   - other admin roles only receive it when a Super-Admin explicitly
 *     grants it via Settings → Administration Panel → Roles.
 *
 * `simulate-timeout` is a test-only endpoint that is stripped from the
 * route list whenever NODE_ENV is 'production' or 'staging', eliminating
 * an entire class of attack surface outside of development.
 */

const PLUGIN_ACCESS_ACTION = 'plugin::magic-sessionmanager.access';

/**
 * Returns the policy chain that every admin route in this plugin must use.
 * Kept as a function (not a frozen constant) so every route ends up with
 * its own array instance — Strapi mutates policy arrays internally during
 * boot, which would otherwise leak cross-route configuration.
 *
 * @returns {Array<string|object>}
 */
const adminPolicy = () => [
  'admin::isAuthenticatedAdmin',
  {
    name: 'admin::hasPermissions',
    config: { actions: [PLUGIN_ACCESS_ACTION] },
  },
];

const isDevEnvironment = (() => {
  const env = (process.env.NODE_ENV || 'development').toLowerCase();
  return env !== 'production' && env !== 'staging';
})();

const baseRoutes = [
  // ============================ SESSIONS ============================
  {
    method: 'GET',
    path: '/sessions',
    handler: 'session.getAllSessionsAdmin',
    config: {
      policies: adminPolicy(),
      description: 'Get all sessions - active and inactive (admin)',
    },
  },
  {
    method: 'GET',
    path: '/sessions/active',
    handler: 'session.getActiveSessions',
    config: {
      policies: adminPolicy(),
      description: 'Get only active sessions (admin)',
    },
  },
  {
    method: 'GET',
    path: '/user/:userId/sessions',
    handler: 'session.getUserSessions',
    config: {
      policies: adminPolicy(),
      description: 'Get sessions for a specific user (admin)',
    },
  },
  {
    method: 'POST',
    path: '/sessions/:sessionId/terminate',
    handler: 'session.terminateSingleSession',
    config: {
      policies: adminPolicy(),
      description: 'Terminate a specific session (admin)',
    },
  },
  {
    method: 'DELETE',
    path: '/sessions/:sessionId',
    handler: 'session.deleteSession',
    config: {
      policies: adminPolicy(),
      description: 'Delete a single session permanently (admin)',
    },
  },
  {
    method: 'POST',
    path: '/sessions/clean-inactive',
    handler: 'session.cleanInactiveSessions',
    config: {
      policies: adminPolicy(),
      description: 'Delete all inactive sessions from database (admin)',
    },
  },
  {
    method: 'POST',
    path: '/user/:userId/terminate-all',
    handler: 'session.terminateAllUserSessions',
    config: {
      policies: adminPolicy(),
      description: 'Terminate all sessions for a user (admin)',
    },
  },
  {
    method: 'POST',
    path: '/user/:userId/toggle-block',
    handler: 'session.toggleUserBlock',
    config: {
      policies: adminPolicy(),
      description: 'Toggle user blocked status (admin)',
    },
  },

  // ============================ LICENSE ============================
  {
    method: 'GET',
    path: '/license/status',
    handler: 'license.getStatus',
    config: {
      policies: adminPolicy(),
      description: 'Get license status (admin)',
    },
  },
  {
    method: 'POST',
    path: '/license/auto-create',
    handler: 'license.autoCreate',
    config: {
      policies: adminPolicy(),
      description: 'Auto-create license for current admin (admin)',
    },
  },
  {
    method: 'POST',
    path: '/license/create',
    handler: 'license.createAndActivate',
    config: {
      policies: adminPolicy(),
      description: 'Create and activate a new license (admin)',
    },
  },
  {
    method: 'POST',
    path: '/license/ping',
    handler: 'license.ping',
    config: {
      policies: adminPolicy(),
      description: 'Ping the license server (admin)',
    },
  },
  {
    method: 'POST',
    path: '/license/store-key',
    handler: 'license.storeKey',
    config: {
      policies: adminPolicy(),
      description: 'Store a license key (admin)',
    },
  },

  // ============================ GEOLOCATION ============================
  {
    method: 'GET',
    path: '/geolocation/:ipAddress',
    handler: 'session.getIpGeolocation',
    config: {
      policies: adminPolicy(),
      description: 'Get IP geolocation data (Premium feature, admin)',
    },
  },

  // ============================ SETTINGS ============================
  {
    method: 'GET',
    path: '/settings',
    handler: 'settings.getSettings',
    config: {
      policies: adminPolicy(),
      description: 'Get plugin settings (admin)',
    },
  },
  {
    method: 'PUT',
    path: '/settings',
    handler: 'settings.updateSettings',
    config: {
      policies: adminPolicy(),
      description: 'Update plugin settings (admin)',
    },
  },
];

const devOnlyRoutes = [
  {
    method: 'POST',
    path: '/sessions/:sessionId/simulate-timeout',
    handler: 'session.simulateTimeout',
    config: {
      policies: adminPolicy(),
      description: 'Simulate session timeout (dev-only, admin)',
    },
  },
];

module.exports = {
  type: 'admin',
  routes: isDevEnvironment ? [...baseRoutes, ...devOnlyRoutes] : baseRoutes,
};
