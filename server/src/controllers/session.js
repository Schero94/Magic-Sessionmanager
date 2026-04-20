'use strict';

const { hashToken } = require('../utils/encryption');
const { enhanceSessions, enhanceSession } = require('../utils/enhance-session');
const { resolveUserDocumentId } = require('../utils/resolve-user');
const { getPluginSettings } = require('../utils/settings-loader');
const { extractBearerToken } = require('../utils/extract-token');

const SESSION_UID = 'plugin::magic-sessionmanager.session';
const USER_UID = 'plugin::users-permissions.user';

/**
 * Session Controller
 * Handles HTTP requests for session management.
 */
module.exports = {
  /**
   * Lists all sessions (active + inactive) for admin overviews.
   * @route GET /magic-sessionmanager/sessions
   * @returns {object} `{ data, meta }`
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
      strapi.log.error('[magic-sessionmanager] getAllSessionsAdmin error:', err);
      ctx.throw(500, 'Error fetching sessions');
    }
  },

  /**
   * Lists currently-active sessions only.
   * @route GET /magic-sessionmanager/sessions/active
   * @returns {object} `{ data, meta }`
   */
  async getActiveSessions(ctx) {
    try {
      const sessionService = strapi
        .plugin('magic-sessionmanager')
        .service('session');

      const sessions = await sessionService.getActiveSessions();

      ctx.body = {
        data: sessions,
        meta: { count: sessions.length },
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] getActiveSessions error:', err);
      ctx.throw(500, 'Error fetching active sessions');
    }
  },

  /**
   * Returns the authenticated user's own sessions, with the current session
   * flagged via `isCurrentSession`.
   *
   * @route GET /api/magic-sessionmanager/my-sessions
   * @returns {object} `{ data, meta }`
   * @throws {UnauthorizedError} When user is not authenticated
   */
  async getOwnSessions(ctx) {
    try {
      const userId = ctx.state.user?.documentId;
      const currentToken = extractBearerToken(ctx);
      const currentTokenHash = currentToken ? hashToken(currentToken) : null;

      if (!userId) {
        return ctx.throw(401, 'Unauthorized');
      }

      const allSessions = await strapi.documents(SESSION_UID).findMany({
        filters: { user: { documentId: userId } },
        sort: { loginTime: 'desc' },
        limit: 200,
      });

      const settings = await getPluginSettings(strapi);
      const enhanceOpts = {
        inactivityTimeout: settings.inactivityTimeout || 15 * 60 * 1000,
        geolocationService: strapi.plugin('magic-sessionmanager').service('geolocation'),
        strapi,
      };

      const sessionsWithCurrent = await enhanceSessions(allSessions, enhanceOpts, 20);

      for (const s of sessionsWithCurrent) {
        s.isCurrentSession = !!(currentTokenHash && allSessions.find(
          raw => raw.documentId === s.documentId && raw.tokenHash === currentTokenHash
        ));
      }

      sessionsWithCurrent.sort((a, b) => {
        if (a.isCurrentSession) return -1;
        if (b.isCurrentSession) return 1;
        return new Date(b.loginTime) - new Date(a.loginTime);
      });

      ctx.body = {
        data: sessionsWithCurrent,
        meta: {
          count: sessionsWithCurrent.length,
          active: sessionsWithCurrent.filter(s => s.isTrulyActive).length,
        },
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error fetching own sessions:', err);
      ctx.throw(500, 'Error fetching sessions');
    }
  },

  /**
   * Get a specific user's sessions. Admins may query any user; Content-API
   * users can only query themselves.
   *
   * @route GET /magic-sessionmanager/user/:userId/sessions (admin)
   * @route GET /api/magic-sessionmanager/user/:userId/sessions (content-api)
   * @throws {ForbiddenError} When a non-admin requests another user's sessions
   */
  async getUserSessions(ctx) {
    try {
      const { userId } = ctx.params;

      const isAdminRequest = !!(ctx.state.userAbility || ctx.state.admin);
      const requestingUserDocId = ctx.state.user?.documentId;

      if (!isAdminRequest) {
        if (!requestingUserDocId) {
          strapi.log.warn(`[magic-sessionmanager] Security: Request without documentId tried to access sessions of user ${userId}`);
          return ctx.forbidden('Cannot verify user identity');
        }

        const requestedDocId = await resolveUserDocumentId(strapi, userId);
        if (!requestedDocId || String(requestingUserDocId) !== String(requestedDocId)) {
          strapi.log.warn(`[magic-sessionmanager] Security: User ${requestingUserDocId} tried to access sessions of user ${userId}`);
          return ctx.forbidden('You can only access your own sessions');
        }
      }

      const sessionService = strapi
        .plugin('magic-sessionmanager')
        .service('session');

      const sessions = await sessionService.getUserSessions(userId);

      ctx.body = {
        data: sessions,
        meta: { count: sessions.length },
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] getUserSessions error:', err);
      ctx.throw(500, 'Error fetching user sessions');
    }
  },

  /**
   * Terminates the session tied to the current JWT.
   * @route POST /api/magic-sessionmanager/logout
   */
  async logout(ctx) {
    try {
      const userId = ctx.state.user?.documentId;
      const token = extractBearerToken(ctx);

      if (!userId || !token) {
        return ctx.throw(401, 'Unauthorized');
      }

      const sessionService = strapi
        .plugin('magic-sessionmanager')
        .service('session');

      const currentTokenHash = hashToken(token);
      const matchingSession = await strapi.documents(SESSION_UID).findFirst({
        filters: {
          user: { documentId: userId },
          tokenHash: currentTokenHash,
          isActive: true,
        },
        fields: ['documentId'],
      });

      if (matchingSession) {
        await sessionService.terminateSession({ sessionId: matchingSession.documentId });
        strapi.log.info(`[magic-sessionmanager] User ${userId} logged out (session ${matchingSession.documentId})`);
      }

      ctx.body = { message: 'Logged out successfully' };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Logout error:', err);
      ctx.throw(500, 'Error during logout');
    }
  },

  /**
   * Terminates all sessions of the authenticated user.
   * @route POST /api/magic-sessionmanager/logout-all
   */
  async logoutAll(ctx) {
    try {
      const userId = ctx.state.user?.documentId;

      if (!userId) {
        return ctx.throw(401, 'Unauthorized');
      }

      const sessionService = strapi
        .plugin('magic-sessionmanager')
        .service('session');

      await sessionService.terminateSession({ userId });

      strapi.log.info(`[magic-sessionmanager] User ${userId} logged out from all devices`);

      ctx.body = { message: 'Logged out from all devices successfully' };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Logout-all error:', err);
      ctx.throw(500, 'Error during logout');
    }
  },

  /**
   * Returns the session associated with the current JWT.
   * @route GET /api/magic-sessionmanager/current-session
   */
  async getCurrentSession(ctx) {
    try {
      const userId = ctx.state.user?.documentId;
      const token = extractBearerToken(ctx);

      if (!userId || !token) {
        return ctx.throw(401, 'Unauthorized');
      }

      const currentTokenHash = hashToken(token);
      const currentSession = await strapi.documents(SESSION_UID).findFirst({
        filters: {
          user: { documentId: userId },
          tokenHash: currentTokenHash,
          isActive: true,
        },
      });

      if (!currentSession) {
        return ctx.notFound('Current session not found');
      }

      const settings = await getPluginSettings(strapi);
      const enhanced = await enhanceSession(currentSession, {
        inactivityTimeout: settings.inactivityTimeout || 15 * 60 * 1000,
        geolocationService: strapi.plugin('magic-sessionmanager').service('geolocation'),
        geoCounter: { remaining: 1 },
        strapi,
      });

      ctx.body = {
        data: { ...enhanced, isCurrentSession: true },
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error getting current session:', err);
      ctx.throw(500, 'Error fetching current session');
    }
  },

  /**
   * Terminates one of the authenticated user's OWN sessions (not the current one).
   * @route DELETE /api/magic-sessionmanager/my-sessions/:sessionId
   */
  async terminateOwnSession(ctx) {
    try {
      const userId = ctx.state.user?.documentId;
      const { sessionId } = ctx.params;
      const currentToken = extractBearerToken(ctx);
      const currentTokenHash = currentToken ? hashToken(currentToken) : null;

      if (!userId) {
        return ctx.throw(401, 'Unauthorized');
      }

      if (!sessionId) {
        return ctx.badRequest('Session ID is required');
      }

      const sessionToTerminate = await strapi.documents(SESSION_UID).findOne({
        documentId: sessionId,
        populate: { user: { fields: ['documentId'] } },
      });

      if (!sessionToTerminate) {
        return ctx.notFound('Session not found');
      }

      const sessionUserId = sessionToTerminate.user?.documentId;
      if (sessionUserId !== userId) {
        strapi.log.warn(`[magic-sessionmanager] Security: User ${userId} tried to terminate session ${sessionId} of user ${sessionUserId}`);
        return ctx.forbidden('You can only terminate your own sessions');
      }

      if (currentTokenHash && sessionToTerminate.tokenHash === currentTokenHash) {
        return ctx.badRequest('Cannot terminate current session. Use /logout instead.');
      }

      const sessionService = strapi
        .plugin('magic-sessionmanager')
        .service('session');

      await sessionService.terminateSession({ sessionId });

      strapi.log.info(`[magic-sessionmanager] User ${userId} terminated own session ${sessionId}`);

      ctx.body = {
        message: `Session ${sessionId} terminated successfully`,
        success: true,
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error terminating own session:', err);
      ctx.throw(500, 'Error terminating session');
    }
  },

  /**
   * Sets isActive:false + terminatedManually:false on a session, simulating
   * a cleanup timeout. Available only outside of production/staging.
   *
   * @route POST /magic-sessionmanager/sessions/:sessionId/simulate-timeout
   */
  async simulateTimeout(ctx) {
    try {
      const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase();
      if (nodeEnv === 'production' || nodeEnv === 'staging') {
        return ctx.forbidden('simulate-timeout is disabled outside development');
      }

      const { sessionId } = ctx.params;

      const session = await strapi.documents(SESSION_UID).findOne({
        documentId: sessionId,
        fields: ['documentId'],
      });

      if (!session) {
        return ctx.notFound('Session not found');
      }

      await strapi.documents(SESSION_UID).update({
        documentId: sessionId,
        data: { isActive: false, terminatedManually: false },
      });

      strapi.log.info(`[magic-sessionmanager] [TEST] Session ${sessionId} simulated timeout (terminatedManually: false)`);

      ctx.body = {
        message: `Session ${sessionId} marked as timed out (reactivatable)`,
        success: true,
        terminatedManually: false,
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error simulating timeout:', err);
      ctx.throw(500, 'Error simulating session timeout');
    }
  },

  /**
   * Terminates a specific session (admin action).
   * @route POST /magic-sessionmanager/sessions/:sessionId/terminate
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
   * Terminates ALL sessions for a specific user (admin action).
   * @route POST /magic-sessionmanager/user/:userId/terminate-all
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
   * Returns geolocation data for a specific IP address (Premium feature).
   *
   * @route GET /magic-sessionmanager/geolocation/:ipAddress
   * @throws {ForbiddenError} When no premium license is active
   */
  async getIpGeolocation(ctx) {
    try {
      const { ipAddress } = ctx.params;

      if (!ipAddress) {
        return ctx.badRequest('IP address is required');
      }

      const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
      const ipv4Match = ipAddress.match(IPV4_REGEX);
      const isValidIpv4 = ipv4Match && ipv4Match.slice(1).every(octet => {
        const n = parseInt(octet, 10);
        return n >= 0 && n <= 255;
      });

      let isValidIpv6 = false;
      if (!isValidIpv4) {
        try {
          const net = require('net');
          isValidIpv6 = net.isIPv6(ipAddress);
        } catch {
          isValidIpv6 = false;
        }
      }

      if (!isValidIpv4 && !isValidIpv6) {
        return ctx.badRequest('Invalid IP address format');
      }

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
   * Permanently deletes a session (admin action).
   * @route DELETE /magic-sessionmanager/sessions/:sessionId
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
   * Deletes all inactive sessions (admin action).
   * @route POST /magic-sessionmanager/sessions/clean-inactive
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
   * Toggles a user's blocked status and terminates their sessions on block.
   *
   * @route POST /magic-sessionmanager/user/:userId/toggle-block
   * @throws {NotFoundError} When the user cannot be found
   */
  async toggleUserBlock(ctx) {
    try {
      const { userId } = ctx.params;

      let userDocumentId = await resolveUserDocumentId(strapi, userId);

      if (!userDocumentId) {
        try {
          const directUser = await strapi.documents(USER_UID).findOne({ documentId: userId });
          if (directUser) {
            userDocumentId = directUser.documentId;
          }
        } catch {
          // swallow; we throw a 404 below
        }
      }

      if (!userDocumentId) {
        return ctx.throw(404, 'User not found');
      }

      const user = await strapi.documents(USER_UID).findOne({ documentId: userDocumentId });

      if (!user) {
        return ctx.throw(404, 'User not found');
      }

      const newBlockedStatus = !user.blocked;

      await strapi.documents(USER_UID).update({
        documentId: userDocumentId,
        data: { blocked: newBlockedStatus },
      });

      if (newBlockedStatus) {
        const sessionService = strapi
          .plugin('magic-sessionmanager')
          .service('session');
        await sessionService.terminateSession({ userId: userDocumentId });
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
