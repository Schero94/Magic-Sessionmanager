'use strict';

/**
 * Content API Routes for Magic Session Manager
 * 
 * SECURITY: All routes require authentication
 * - User can only access their own sessions
 * - Admin routes are in admin.js
 */

module.exports = {
  type: 'content-api',
  routes: [
    // ============================================================
    // LOGOUT ENDPOINTS
    // ============================================================
    
    {
      method: 'POST',
      path: '/logout',
      handler: 'session.logout',
    config: {
        auth: { strategies: ['users-permissions'] },
        description: 'Logout current session (requires JWT)',
      },
    },
    {
      method: 'POST',
      path: '/logout-all',
      handler: 'session.logoutAll',
      config: {
        auth: { strategies: ['users-permissions'] },
        description: 'Logout from all devices (requires JWT)',
      },
    },
    
    // ============================================================
    // SESSION QUERIES
    // ============================================================
    
    {
      method: 'GET',
      path: '/my-sessions',
      handler: 'session.getOwnSessions',
      config: {
        auth: { strategies: ['users-permissions'] },
        description: 'Get own sessions (automatically uses authenticated user)',
      },
    },
    {
      method: 'GET',
      path: '/user/:userId/sessions',
      handler: 'session.getUserSessions',
      config: {
        auth: { strategies: ['users-permissions'] },
        description: 'Get sessions by userId (validates user can only see own sessions)',
      },
    },
  ],
};
