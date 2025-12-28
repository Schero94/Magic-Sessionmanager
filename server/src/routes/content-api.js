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
      path: '/current-session',
      handler: 'session.getCurrentSession',
      config: {
        auth: { strategies: ['users-permissions'] },
        description: 'Get current session info based on JWT token',
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
    
    // ============================================================
    // SESSION MANAGEMENT (for own sessions only)
    // ============================================================
    
    {
      method: 'DELETE',
      path: '/my-sessions/:sessionId',
      handler: 'session.terminateOwnSession',
      config: {
        auth: { strategies: ['users-permissions'] },
        description: 'Terminate a specific own session (not current)',
      },
    },
  ],
};
