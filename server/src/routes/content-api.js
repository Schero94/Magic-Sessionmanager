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

    // ================== SELF-SERVICE (4.17) ==================
    {
      method: 'GET',
      path: '/my-data',
      handler: 'self-service.exportOwnData',
      config: {
        auth: { strategies: ['users-permissions'] },
        // An export reads every own session and event: 3 per hour per user.
        middlewares: [
          {
            name: 'plugin::magic-sessionmanager.rate-limit',
            config: { max: 3, window: 60 * 60 * 1000 },
          },
        ],
        description: 'Download own sessions and security events as JSON (GDPR Art. 15)',
      },
    },
    {
      method: 'GET',
      path: '/not-me',
      handler: 'self-service.notMePage',
      config: {
        // Public on purpose: opened from the "This wasn't me" email. Only
        // shows a confirmation; the signed token is checked, nothing changes.
        auth: false,
        middlewares: [
          {
            name: 'plugin::magic-sessionmanager.rate-limit',
            config: { max: 30, window: 60_000 },
          },
        ],
        description: 'Confirmation page of the "This wasn\'t me" email link (public)',
      },
    },
    {
      method: 'POST',
      path: '/not-me',
      handler: 'self-service.notMeConfirm',
      config: {
        // Public on purpose: the signed, expiring, single-use token from the
        // email is the authorisation.
        auth: false,
        middlewares: [
          {
            name: 'plugin::magic-sessionmanager.rate-limit',
            config: { max: 10, window: 60_000 },
          },
        ],
        description: 'End the session of a "This wasn\'t me" link (public, single-use token)',
      },
    },

    // ================== IMPERSONATION HAND-OFF (4.20) ==================
    {
      method: 'POST',
      path: '/impersonation/exchange',
      handler: 'impersonation.exchange',
      config: {
        // Public on purpose: the one-time code is the credential (32 random
        // bytes, stored hashed, 60 seconds, single use). Every invalid code
        // gets the same 400.
        auth: false,
        middlewares: [
          {
            name: 'plugin::magic-sessionmanager.rate-limit',
            config: { max: 10, window: 60_000 },
          },
        ],
        description: 'Exchange a one-time impersonation code for a short-lived credential',
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
