'use strict';

const { decryptToken } = require('../utils/encryption');

/**
 * Session Controller
 * Handles HTTP requests for session management
 */
module.exports = {
  /**
   * Get ALL sessions (active + inactive) - Admin only
   * GET /magic-sessionmanager/sessions
   */
  async getAllSessionsAdmin(ctx) {
    try {
      const sessionService = strapi
        .plugin('magic-sessionmanager')
        .service('session');

      const sessions = await sessionService.getAllSessions();

      ctx.body = {
        data: sessions,
        meta: {
          count: sessions.length,
          active: sessions.filter(s => s.isTrulyActive).length,
          inactive: sessions.filter(s => !s.isTrulyActive).length,
        },
      };
    } catch (err) {
      ctx.throw(500, 'Error fetching sessions');
    }
  },

  /**
   * Get active sessions only
   * GET /magic-sessionmanager/sessions/active
   */
  async getActiveSessions(ctx) {
    try {
      const sessionService = strapi
        .plugin('magic-sessionmanager')
        .service('session');

      const sessions = await sessionService.getActiveSessions();

      ctx.body = {
        data: sessions,
        meta: {
          count: sessions.length,
        },
      };
    } catch (err) {
      ctx.throw(500, 'Error fetching active sessions');
    }
  },

  /**
   * Get user's sessions
   * GET /magic-sessionmanager/user/:userId/sessions (Admin API)
   * GET /api/magic-sessionmanager/user/:userId/sessions (Content API)
   * SECURITY: Admins can view any user, Content API users only their own
   */
  async getUserSessions(ctx) {
    try {
      const { userId } = ctx.params;
      
      // Check if this is an admin request
      const isAdminRequest = ctx.state.userAbility || ctx.state.admin;
      const requestingUserId = ctx.state.user?.id;

      // SECURITY CHECK: Content API users can only see their own sessions
      // Admins can see any user's sessions
      if (!isAdminRequest && requestingUserId && String(requestingUserId) !== String(userId)) {
        strapi.log.warn(`[magic-sessionmanager] Security: User ${requestingUserId} tried to access sessions of user ${userId}`);
        return ctx.forbidden('You can only access your own sessions');
      }

      const sessionService = strapi
        .plugin('magic-sessionmanager')
        .service('session');

      const sessions = await sessionService.getUserSessions(userId);

      ctx.body = {
        data: sessions,
        meta: {
          count: sessions.length,
        },
      };
    } catch (err) {
      ctx.throw(500, 'Error fetching user sessions');
    }
  },

  /**
   * Logout handler - terminates current session
   * POST /api/magic-sessionmanager/logout
   */
  async logout(ctx) {
    try {
      const userId = ctx.state.user?.id;
      const token = ctx.request.headers.authorization?.replace('Bearer ', '');

      if (!userId) {
        return ctx.throw(401, 'Unauthorized');
      }

      const sessionService = strapi
        .plugin('magic-sessionmanager')
        .service('session');

      // Find current session by decrypting and comparing tokens
      const sessions = await strapi.entityService.findMany('plugin::magic-sessionmanager.session', {
        filters: {
          user: { id: userId },
          isActive: true,
        },
      });

      // Find matching session by decrypting tokens
      const matchingSession = sessions.find(session => {
        if (!session.token) return false;
        try {
          const decrypted = decryptToken(session.token);
          return decrypted === token;
        } catch (err) {
          return false;
        }
      });

      if (matchingSession) {
        // Terminate only the current session
        await sessionService.terminateSession({ sessionId: matchingSession.id });
        strapi.log.info(`[magic-sessionmanager] User ${userId} logged out (session ${matchingSession.id})`);
      }

      ctx.body = {
        message: 'Logged out successfully',
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Logout error:', err);
      ctx.throw(500, 'Error during logout');
    }
  },

  /**
   * Logout from all devices - terminates all sessions for current user
   * POST /api/magic-sessionmanager/logout-all
   */
  async logoutAll(ctx) {
    try {
      const userId = ctx.state.user?.id;

      if (!userId) {
        return ctx.throw(401, 'Unauthorized');
      }

      const sessionService = strapi
        .plugin('magic-sessionmanager')
        .service('session');

      // Terminate all sessions for this user
      await sessionService.terminateSession({ userId });
      
      strapi.log.info(`[magic-sessionmanager] User ${userId} logged out from all devices`);

      ctx.body = {
        message: 'Logged out from all devices successfully',
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Logout-all error:', err);
      ctx.throw(500, 'Error during logout');
    }
  },

  /**
   * Terminate specific session
   * DELETE /magic-sessionmanager/sessions/:sessionId
   */
  async terminateSession(ctx) {
    try {
      const { sessionId } = ctx.params;
      const sessionService = strapi
        .plugin('magic-sessionmanager')
        .service('session');

      await sessionService.terminateSession({ sessionId });

      ctx.body = {
        message: `Session ${sessionId} terminated`,
      };
    } catch (err) {
      ctx.throw(500, 'Error terminating session');
    }
  },

  /**
   * Terminate a single session (Admin action)
   * POST /magic-sessionmanager/sessions/:sessionId/terminate
   */
  async terminateSingleSession(ctx) {
    try {
      const { sessionId } = ctx.params;
      
      const sessionService = strapi
        .plugin('magic-sessionmanager')
        .service('session');

      await sessionService.terminateSession({ sessionId });

      ctx.body = {
        message: `Session ${sessionId} terminated`,
        success: true,
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error terminating session:', err);
      ctx.throw(500, 'Error terminating session');
    }
  },

  /**
   * Terminate ALL sessions for a specific user (Admin action)
   * POST /magic-sessionmanager/user/:userId/terminate-all
   */
  async terminateAllUserSessions(ctx) {
    try {
      const { userId } = ctx.params;
      
      const sessionService = strapi
        .plugin('magic-sessionmanager')
        .service('session');

      await sessionService.terminateSession({ userId });

      ctx.body = {
        message: `All sessions terminated for user ${userId}`,
        success: true,
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error terminating all user sessions:', err);
      ctx.throw(500, 'Error terminating all user sessions');
    }
  },

  /**
   * Get IP Geolocation data (Premium feature)
   * GET /magic-sessionmanager/geolocation/:ipAddress
   */
  async getIpGeolocation(ctx) {
    try {
      const { ipAddress } = ctx.params;

      if (!ipAddress) {
        return ctx.badRequest('IP address is required');
      }

      // Check if user has premium license
      const licenseGuard = strapi.plugin('magic-sessionmanager').service('license-guard');
      const pluginStore = strapi.store({ 
        type: 'plugin', 
        name: 'magic-sessionmanager' 
      });
      const licenseKey = await pluginStore.get({ key: 'licenseKey' });

      if (!licenseKey) {
        return ctx.forbidden('Premium license required for geolocation features');
      }

      const license = await licenseGuard.getLicenseByKey(licenseKey);
      
      if (!license || !license.featurePremium) {
        return ctx.forbidden('Premium license required for geolocation features');
      }

      // Get geolocation data
      const geolocationService = strapi.plugin('magic-sessionmanager').service('geolocation');
      const ipData = await geolocationService.getIpInfo(ipAddress);

      ctx.body = {
        success: true,
        data: ipData,
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error getting IP geolocation:', err);
      ctx.throw(500, 'Error fetching IP geolocation data');
    }
  },

  /**
   * Delete a single session permanently (Admin action)
   * DELETE /magic-sessionmanager/sessions/:sessionId
   */
  async deleteSession(ctx) {
    try {
      const { sessionId } = ctx.params;
      
      const sessionService = strapi
        .plugin('magic-sessionmanager')
        .service('session');

      await sessionService.deleteSession(sessionId);

      ctx.body = {
        message: `Session ${sessionId} permanently deleted`,
        success: true,
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error deleting session:', err);
      ctx.throw(500, 'Error deleting session');
    }
  },

  /**
   * Delete all inactive sessions (Admin action)
   * POST /magic-sessionmanager/sessions/clean-inactive
   */
  async cleanInactiveSessions(ctx) {
    try {
      const sessionService = strapi
        .plugin('magic-sessionmanager')
        .service('session');

      const deletedCount = await sessionService.deleteInactiveSessions();

      ctx.body = {
        message: `Successfully deleted ${deletedCount} inactive sessions`,
        success: true,
        deletedCount,
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error cleaning inactive sessions:', err);
      ctx.throw(500, 'Error deleting inactive sessions');
    }
  },

  /**
   * Toggle user blocked status
   * POST /magic-sessionmanager/user/:userId/toggle-block
   */
  async toggleUserBlock(ctx) {
    try {
      const { userId } = ctx.params;
      
      // Get current user status
      const user = await strapi.entityService.findOne('plugin::users-permissions.user', userId);
      
      if (!user) {
        return ctx.throw(404, 'User not found');
      }

      // Toggle blocked status
      const newBlockedStatus = !user.blocked;
      
      await strapi.entityService.update('plugin::users-permissions.user', userId, {
        data: {
          blocked: newBlockedStatus,
        },
      });

      // If blocking user, terminate all their sessions
      if (newBlockedStatus) {
        const sessionService = strapi
          .plugin('magic-sessionmanager')
          .service('session');
        await sessionService.terminateSession({ userId });
      }

      ctx.body = {
        message: `User ${newBlockedStatus ? 'blocked' : 'unblocked'} successfully`,
        blocked: newBlockedStatus,
        success: true,
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error toggling user block:', err);
      ctx.throw(500, 'Error toggling user block status');
    }
  },
};
