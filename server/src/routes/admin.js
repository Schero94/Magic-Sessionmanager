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

/**
 * Read rate limit for the session lists, statistics and export batches. Same
 * limiter and `read` profile as the Content API listings: the admin can raise
 * the floor via `rateLimitReadMax`. The key is per admin user.
 *
 * @returns {Array<object>}
 */
const adminReadRateLimit = () => [
  {
    name: 'plugin::magic-sessionmanager.rate-limit',
    config: { profile: 'read', max: 120, window: 60_000 },
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
      middlewares: adminReadRateLimit(),
      description: 'List sessions (admin); paginated with page/pageSize, filters and sort',
    },
  },
  {
    method: 'GET',
    path: '/sessions/active',
    handler: 'session.getActiveSessions',
    config: {
      policies: adminPolicy(),
      middlewares: adminReadRateLimit(),
      description: 'Get only active sessions (admin); paginated with page/pageSize',
    },
  },
  {
    method: 'GET',
    path: '/sessions/stats',
    handler: 'session.getSessionStatsAdmin',
    config: {
      policies: adminPolicy(),
      middlewares: adminReadRateLimit(),
      description: 'Get count-only session statistics (admin)',
    },
  },
  {
    method: 'GET',
    path: '/sessions/native-only/summary',
    handler: 'session.getNativeOnlySummaryAdmin',
    config: {
      policies: adminPolicy(),
      middlewares: adminReadRateLimit(),
      description: 'Get count-only diagnostics of untracked Strapi sessions (admin)',
    },
  },
  {
    method: 'POST',
    path: '/sessions/native-only/end',
    handler: 'session.endNativeOnlySessionsAdmin',
    config: {
      policies: adminPolicy(),
      middlewares: [
        {
          name: 'plugin::magic-sessionmanager.rate-limit',
          config: { profile: 'write', max: 5, window: 60_000 },
        },
      ],
      description: 'End untracked Users & Permissions sessions, bounded per request (admin)',
    },
  },
  {
    method: 'GET',
    path: '/sessions/analytics',
    handler: 'session.getSessionAnalyticsAdmin',
    config: {
      policies: adminPolicy(),
      middlewares: adminReadRateLimit(),
      description: 'Get count-only analytics over all sessions (admin)',
    },
  },
  {
    method: 'GET',
    path: '/sessions/export',
    handler: 'session.exportSessionsAdmin',
    config: {
      policies: adminPolicy(),
      middlewares: adminReadRateLimit(),
      description: 'Get one export batch of sessions with a keyset cursor (admin)',
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
      description: 'Remove session details while preserving access-token revocation (admin)',
    },
  },
  {
    method: 'POST',
    path: '/sessions/clean-inactive',
    handler: 'session.cleanInactiveSessions',
    config: {
      policies: adminPolicy(),
      description: 'Remove inactive session details while preserving token revocation (admin)',
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
      description: 'Set an explicit user blocked status (admin)',
    },
  },
  {
    method: 'GET',
    path: '/users/stats',
    handler: 'session.getUserStatsAdmin',
    config: {
      policies: adminPolicy(),
      middlewares: adminReadRateLimit(),
      description: 'Get aggregate end-user counts only (admin)',
    },
  },

  // ============================ GEOLOCATION ============================
  {
    method: 'GET',
    path: '/geolocation/:ipAddress',
    handler: 'session.getIpGeolocation',
    config: {
      policies: adminPolicy(),
      description: 'Get IP geolocation data (admin)',
    },
  },
  {
    method: 'GET',
    path: '/geoip/status',
    handler: 'geoip.getStatus',
    config: {
      policies: adminPolicy(),
      description: 'Get local GeoIP database status (admin)',
    },
  },
  {
    method: 'PUT',
    path: '/geoip/credentials',
    handler: 'geoip.storeCredentials',
    config: {
      policies: adminPolicy(),
      description: 'Store MaxMind credentials for GeoIP downloads (admin)',
    },
  },
  {
    method: 'POST',
    path: '/geoip/update',
    handler: 'geoip.updateDatabase',
    config: {
      policies: adminPolicy(),
      description: 'Download or update the local GeoIP database (admin)',
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
