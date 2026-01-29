'use strict';

module.exports = {
  type: 'admin',
  routes: [
    {
      method: 'GET',
      path: '/sessions',
      handler: 'session.getAllSessionsAdmin',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        description: 'Get all sessions - active and inactive (admin)',
      },
    },
    {
      method: 'GET',
      path: '/sessions/active',
      handler: 'session.getActiveSessions',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        description: 'Get only active sessions (admin)',
      },
    },
    {
      method: 'GET',
      path: '/user/:userId/sessions',
      handler: 'session.getUserSessions',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        description: 'Get user sessions (admin)',
      },
    },
    {
      method: 'POST',
      path: '/sessions/:sessionId/terminate',
      handler: 'session.terminateSingleSession',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        description: 'Terminate a specific session (admin)',
      },
    },
    {
      method: 'POST',
      path: '/sessions/:sessionId/simulate-timeout',
      handler: 'session.simulateTimeout',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        description: 'Simulate session timeout for testing (sets isActive: false, terminatedManually: false)',
      },
    },
    {
      method: 'DELETE',
      path: '/sessions/:sessionId',
      handler: 'session.deleteSession',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        description: 'Delete a single session permanently (admin)',
      },
    },
    {
      method: 'POST',
      path: '/sessions/clean-inactive',
      handler: 'session.cleanInactiveSessions',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        description: 'Delete all inactive sessions from database (admin)',
      },
    },
    {
      method: 'POST',
      path: '/user/:userId/terminate-all',
      handler: 'session.terminateAllUserSessions',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        description: 'Terminate all sessions for a user (admin)',
      },
    },
    {
      method: 'POST',
      path: '/user/:userId/toggle-block',
      handler: 'session.toggleUserBlock',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        description: 'Toggle user blocked status (admin)',
      },
    },
    // License Management
    {
      method: 'GET',
      path: '/license/status',
      handler: 'license.getStatus',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/license/auto-create',
      handler: 'license.autoCreate',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/license/create',
      handler: 'license.createAndActivate',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/license/ping',
      handler: 'license.ping',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/license/store-key',
      handler: 'license.storeKey',
      config: {
        policies: [],
      },
    },
    // Geolocation (Premium Feature)
    {
      method: 'GET',
      path: '/geolocation/:ipAddress',
      handler: 'session.getIpGeolocation',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        description: 'Get IP geolocation data (Premium feature)',
      },
    },
    // Settings Management
    {
      method: 'GET',
      path: '/settings',
      handler: 'settings.getSettings',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        description: 'Get plugin settings',
      },
    },
    {
      method: 'PUT',
      path: '/settings',
      handler: 'settings.updateSettings',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        description: 'Update plugin settings',
      },
    },
  ],
};
