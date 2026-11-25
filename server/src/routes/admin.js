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
 * The Strapi admin panel session routes (`/admin-sessions/...`) also require
 * `admin-sessions.read`, and the sign-out routes `admin-sessions.revoke`
 * (`adminSessionsPolicy()`); `hasPermissions` needs ALL listed actions. The
 * admin sign-in history and Content Manager activity (`/admin-activity/...`)
 * require `admin-sessions.read` and `admin-activity.read`. The app-user
 * security activity (`/user-activity`, 4.22) requires `user-activity.read`.
 * Lifting a sign-in
 * lock (`/lockouts/unlock`) requires `lockouts.unlock`. Sending a signed
 * webhook test (`/webhook/test`) requires `settings.update`. Starting,
 * listing and ending impersonations of app users (`/impersonation/...`,
 * 4.20) require `impersonate.users`, the admin permission preview
 * `impersonate.admins`; listing and ending accept either
 * (`can-impersonate`); starting refuses admin API tokens.
 *
 * The permissions are registered in `server/src/register.js`.
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
const ADMIN_SESSIONS_READ_ACTION = 'plugin::magic-sessionmanager.admin-sessions.read';
const ADMIN_SESSIONS_REVOKE_ACTION = 'plugin::magic-sessionmanager.admin-sessions.revoke';
const ADMIN_ACTIVITY_READ_ACTION = 'plugin::magic-sessionmanager.admin-activity.read';
const USER_ACTIVITY_READ_ACTION = 'plugin::magic-sessionmanager.user-activity.read';
const LOCKOUTS_UNLOCK_ACTION = 'plugin::magic-sessionmanager.lockouts.unlock';
const SETTINGS_UPDATE_ACTION = 'plugin::magic-sessionmanager.settings.update';
const IMPERSONATE_USERS_ACTION = 'plugin::magic-sessionmanager.impersonate.users';
const IMPERSONATE_ADMINS_ACTION = 'plugin::magic-sessionmanager.impersonate.admins';

/**
 * Plugin access plus either impersonation action (list and end serve both
 * kinds; the controller limits each row to the action of its kind).
 *
 * @returns {Array<string|object>}
 */
const impersonationListPolicy = () => [
  ...adminPolicy(),
  'plugin::magic-sessionmanager.can-impersonate',
];

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
/**
 * Policy chain of the Strapi admin panel session routes. `hasPermissions`
 * requires ALL listed actions, so a role needs plugin access plus the
 * admin-session action(s). Only Super Admin has them by default.
 *
 * @param {string[]} actions Additional admin-session actions.
 * @returns {Array<string|object>}
 */
const adminSessionsPolicy = (actions) => [
  'admin::isAuthenticatedAdmin',
  {
    name: 'admin::hasPermissions',
    config: { actions: [PLUGIN_ACCESS_ACTION, ...actions] },
  },
];

/**
 * Write rate limit for signing admins out: 10 per minute per admin user (the
 * write profile can only be tightened in the settings).
 *
 * @returns {Array<object>}
 */
const adminSignOutRateLimit = () => [
  {
    name: 'plugin::magic-sessionmanager.rate-limit',
    config: { profile: 'write', max: 10, window: 60_000 },
  },
];

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

  // ===================== STRAPI ADMIN PANEL SESSIONS =====================
  {
    method: 'GET',
    path: '/admin-sessions/admins',
    handler: 'admin-sessions.listAdmins',
    config: {
      policies: adminSessionsPolicy([ADMIN_SESSIONS_READ_ACTION]),
      middlewares: adminReadRateLimit(),
      description: 'List Strapi admins with their admin panel sessions (admin)',
    },
  },
  {
    method: 'GET',
    path: '/admin-sessions/admins/:adminId/sessions',
    handler: 'admin-sessions.listAdminSessions',
    config: {
      policies: adminSessionsPolicy([ADMIN_SESSIONS_READ_ACTION]),
      middlewares: adminReadRateLimit(),
      description: 'List the admin panel sessions of one Strapi admin (admin)',
    },
  },
  {
    method: 'POST',
    path: '/admin-sessions/admins/:adminId/sessions/:sessionId/sign-out',
    handler: 'admin-sessions.signOutSession',
    config: {
      policies: adminSessionsPolicy([ADMIN_SESSIONS_READ_ACTION, ADMIN_SESSIONS_REVOKE_ACTION]),
      middlewares: adminSignOutRateLimit(),
      description: 'Sign a Strapi admin out of one browser (admin)',
    },
  },
  {
    method: 'POST',
    path: '/admin-sessions/admins/:adminId/sign-out-everywhere',
    handler: 'admin-sessions.signOutEverywhere',
    config: {
      policies: adminSessionsPolicy([ADMIN_SESSIONS_READ_ACTION, ADMIN_SESSIONS_REVOKE_ACTION]),
      middlewares: adminSignOutRateLimit(),
      description: 'Sign a Strapi admin out of every browser (admin)',
    },
  },

  // ============== ADMIN SIGN-IN HISTORY AND CONTENT MANAGER ACTIVITY ==============
  {
    method: 'GET',
    path: '/admin-activity/sign-ins',
    handler: 'admin-activity.listSignIns',
    config: {
      policies: adminSessionsPolicy([ADMIN_SESSIONS_READ_ACTION, ADMIN_ACTIVITY_READ_ACTION]),
      middlewares: adminReadRateLimit(),
      description: 'List the admin sign-in history (admin)',
    },
  },
  {
    method: 'GET',
    path: '/admin-activity/sign-ins/export',
    handler: 'admin-activity.exportSignIns',
    config: {
      policies: adminSessionsPolicy([ADMIN_SESSIONS_READ_ACTION, ADMIN_ACTIVITY_READ_ACTION]),
      middlewares: adminReadRateLimit(),
      description: 'Get one export batch of the admin sign-in history (admin)',
    },
  },
  {
    method: 'GET',
    path: '/admin-activity/content',
    handler: 'admin-activity.listContentActivity',
    config: {
      policies: adminSessionsPolicy([ADMIN_SESSIONS_READ_ACTION, ADMIN_ACTIVITY_READ_ACTION]),
      middlewares: adminReadRateLimit(),
      description: 'List Content Manager activity of admins (admin)',
    },
  },
  {
    method: 'GET',
    path: '/admin-activity/content/export',
    handler: 'admin-activity.exportContentActivity',
    config: {
      policies: adminSessionsPolicy([ADMIN_SESSIONS_READ_ACTION, ADMIN_ACTIVITY_READ_ACTION]),
      middlewares: adminReadRateLimit(),
      description: 'Get one export batch of Content Manager activity of admins (admin)',
    },
  },

  // ===================== APP-USER SECURITY ACTIVITY (4.22) =====================
  {
    method: 'GET',
    path: '/user-activity',
    handler: 'user-activity.list',
    config: {
      policies: adminSessionsPolicy([USER_ACTIVITY_READ_ACTION]),
      middlewares: adminReadRateLimit(),
      description: 'List the security activity of app users (admin)',
    },
  },
  {
    method: 'GET',
    path: '/user-activity/export',
    handler: 'user-activity.export',
    config: {
      policies: adminSessionsPolicy([USER_ACTIVITY_READ_ACTION]),
      middlewares: adminReadRateLimit(),
      description: 'Get one export batch of the security activity of app users (admin)',
    },
  },

  // ===================== SIGN-IN LOCKS AND ROLE RULES =====================
  {
    method: 'GET',
    path: '/lockouts',
    handler: 'lockouts.list',
    config: {
      policies: adminPolicy(),
      middlewares: adminReadRateLimit(),
      description: 'List the active sign-in locks (admin)',
    },
  },
  {
    method: 'POST',
    path: '/lockouts/unlock',
    handler: 'lockouts.unlock',
    config: {
      policies: adminSessionsPolicy([LOCKOUTS_UNLOCK_ACTION]),
      middlewares: adminSignOutRateLimit(),
      description: 'Lift one sign-in lock (admin)',
    },
  },
  {
    method: 'GET',
    path: '/roles',
    handler: 'lockouts.roles',
    config: {
      policies: adminPolicy(),
      middlewares: adminReadRateLimit(),
      description: 'List Users & Permissions roles for per-role rules (admin)',
    },
  },

  // ============================ SIGNED WEBHOOK ============================
  {
    method: 'POST',
    path: '/webhook/test',
    handler: 'webhooks.sendTest',
    config: {
      // Sends to the stored URL: same permission as changing it.
      policies: adminSessionsPolicy([SETTINGS_UPDATE_ACTION]),
      middlewares: [
        {
          name: 'plugin::magic-sessionmanager.rate-limit',
          config: { profile: 'write', max: 5, window: 60_000 },
        },
      ],
      description: 'Send a signed test event to the stored webhook URL (admin)',
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
  // ================== IMPERSONATION (4.20) ==================
  {
    method: 'GET',
    path: '/impersonation/status',
    handler: 'impersonation.status',
    config: {
      policies: adminPolicy(),
      middlewares: adminReadRateLimit(),
    },
  },
  {
    method: 'POST',
    path: '/impersonation/users/:userId',
    handler: 'impersonation.startUser',
    config: {
      policies: adminSessionsPolicy([IMPERSONATE_USERS_ACTION]),
      // Ten starts per ten minutes per admin.
      middlewares: [
        {
          name: 'plugin::magic-sessionmanager.rate-limit',
          config: { max: 10, window: 10 * 60 * 1000 },
        },
      ],
    },
  },
  {
    method: 'POST',
    path: '/impersonation/admins/:adminId/preview',
    handler: 'impersonation.previewAdmin',
    config: {
      policies: adminSessionsPolicy([IMPERSONATE_ADMINS_ACTION]),
      // Ten previews per ten minutes per admin.
      middlewares: [
        {
          name: 'plugin::magic-sessionmanager.rate-limit',
          config: { max: 10, window: 10 * 60 * 1000 },
        },
      ],
    },
  },
  {
    method: 'GET',
    path: '/impersonation/previews/:id',
    handler: 'impersonation.getPreview',
    config: {
      policies: adminSessionsPolicy([IMPERSONATE_ADMINS_ACTION]),
      middlewares: adminReadRateLimit(),
    },
  },
  {
    method: 'GET',
    path: '/impersonation/active',
    handler: 'impersonation.listActive',
    config: {
      policies: impersonationListPolicy(),
      middlewares: adminReadRateLimit(),
    },
  },
  {
    method: 'POST',
    path: '/impersonation/:id/end',
    handler: 'impersonation.end',
    config: {
      policies: impersonationListPolicy(),
      middlewares: adminSignOutRateLimit(),
    },
  },

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
