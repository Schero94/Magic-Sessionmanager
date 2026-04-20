'use strict';

/**
 * Admin API routes.
 *
 * `simulate-timeout` is a test-only endpoint that is stripped from the route
 * list whenever NODE_ENV is 'production' or 'staging', which eliminates an
 * entire class of attack surface outside of development.
 */

const isDevEnvironment = (() => {
  const env = (process.env.NODE_ENV || 'development').toLowerCase();
  return env !== 'production' && env !== 'staging';
})();

const baseRoutes = [
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
  {
    method: 'GET',
    path: '/license/status',
    handler: 'license.getStatus',
    config: { policies: ['admin::isAuthenticatedAdmin'] },
  },
  {
    method: 'POST',
    path: '/license/auto-create',
    handler: 'license.autoCreate',
    config: { policies: ['admin::isAuthenticatedAdmin'] },
  },
  {
    method: 'POST',
    path: '/license/create',
    handler: 'license.createAndActivate',
    config: { policies: ['admin::isAuthenticatedAdmin'] },
  },
  {
    method: 'POST',
    path: '/license/ping',
    handler: 'license.ping',
    config: { policies: ['admin::isAuthenticatedAdmin'] },
  },
  {
    method: 'POST',
    path: '/license/store-key',
    handler: 'license.storeKey',
    config: { policies: ['admin::isAuthenticatedAdmin'] },
  },
  {
    method: 'GET',
    path: '/geolocation/:ipAddress',
    handler: 'session.getIpGeolocation',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
      description: 'Get IP geolocation data (Premium feature)',
    },
  },
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
];

const devOnlyRoutes = [
  {
    method: 'POST',
    path: '/sessions/:sessionId/simulate-timeout',
    handler: 'session.simulateTimeout',
    config: {
      policies: ['admin::isAuthenticatedAdmin'],
      description: 'Simulate session timeout (dev-only)',
    },
  },
];

module.exports = {
  type: 'admin',
  routes: isDevEnvironment ? [...baseRoutes, ...devOnlyRoutes] : baseRoutes,
};
