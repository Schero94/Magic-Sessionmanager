'use strict';

/**
 * Content-API routes for Magic Session Manager.
 *
 * SECURITY:
 *  - Every route requires a valid users-permissions JWT.
 *  - A user can only access / terminate their own sessions. Admin routes
 *    live in admin.js.
 *  - Logout and session-termination endpoints are rate-limited per caller
 *    so a compromised JWT cannot be used to hammer the DB with soft-delete
 *    updates.
 *  - Read endpoints use a looser budget because a polling dashboard on the
 *    frontend legitimately hits them often.
 */

// Writes (logout / terminate) — tight limit. The `profile: 'write'` tag
// means the admin can only TIGHTEN via settings, never loosen, so these
// destructive endpoints keep their protective floor.
const writeRateLimit = [
  {
    name: 'plugin::magic-sessionmanager.rate-limit',
    config: { profile: 'write', max: 10, window: 60_000 },
  },
];

// Reads (listings / current-session) — generous floor. The `profile: 'read'`
// tag lets admins RAISE the limit via `rateLimitReadMax` (useful for
// dashboards that poll often) without needing a plugin release.
const readRateLimit = [
  {
    name: 'plugin::magic-sessionmanager.rate-limit',
    config: { profile: 'read', max: 120, window: 60_000 },
  },
];

module.exports = {
  type: 'content-api',
  routes: [
    // ================== LOGOUT ENDPOINTS ==================
    {
      method: 'POST',
      path: '/logout',
      handler: 'session.logout',
      config: {
        auth: { strategies: ['users-permissions'] },
        middlewares: writeRateLimit,
        description: 'Logout current session (requires JWT)',
      },
    },
    {
      method: 'POST',
      path: '/logout-all',
      handler: 'session.logoutAll',
      config: {
        auth: { strategies: ['users-permissions'] },
        middlewares: writeRateLimit,
        description: 'Logout from ALL devices including the current one (requires JWT)',
      },
    },
    {
      method: 'POST',
      path: '/logout-others',
      handler: 'session.logoutOthers',
      config: {
        auth: { strategies: ['users-permissions'] },
        middlewares: writeRateLimit,
        description: 'Logout from all OTHER devices, keep current session alive (requires JWT)',
      },
    },

    // ================== SESSION QUERIES ==================
    {
      method: 'GET',
      path: '/my-sessions',
      handler: 'session.getOwnSessions',
      config: {
        auth: { strategies: ['users-permissions'] },
        middlewares: readRateLimit,
        description: 'Get own sessions (automatically uses authenticated user)',
      },
    },
    {
      method: 'GET',
      path: '/current-session',
      handler: 'session.getCurrentSession',
      config: {
        auth: { strategies: ['users-permissions'] },
        middlewares: readRateLimit,
        description: 'Get current session info based on JWT token',
      },
    },
    {
      method: 'GET',
      path: '/user/:userId/sessions',
      handler: 'session.getUserSessions',
      config: {
        auth: { strategies: ['users-permissions'] },
        middlewares: readRateLimit,
        description: 'Get sessions by userId (user can only see own sessions)',
      },
    },

    // ================== OWN SESSION MANAGEMENT ==================
    {
      method: 'DELETE',
      path: '/my-sessions/:sessionId',
      handler: 'session.terminateOwnSession',
      config: {
        auth: { strategies: ['users-permissions'] },
        middlewares: writeRateLimit,
        description: 'Terminate a specific own session (not current)',
      },
    },
  ],
};
