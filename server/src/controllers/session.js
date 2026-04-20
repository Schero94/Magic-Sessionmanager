'use strict';

const { hashToken } = require('../utils/encryption');
const { enhanceSessions, enhanceSession } = require('../utils/enhance-session');
const { resolveUserDocumentId } = require('../utils/resolve-user');
const { getPluginSettings } = require('../utils/settings-loader');
const { extractBearerToken } = require('../utils/extract-token');

const SESSION_UID = 'plugin::magic-sessionmanager.session';
const USER_UID = 'plugin::users-permissions.user';
const OWN_SESSIONS_LIMIT = 200;

/**
 * Resolves the authenticated user's documentId, falling back to the numeric
 * id lookup path when users-permissions didn't populate documentId yet.
 *
 * @param {object} ctx - Koa context
 * @returns {Promise<string|null>}
 */
async function resolveAuthUserDocId(ctx) {
  const u = ctx.state.user;
  if (!u) return null;
  if (u.documentId) return u.documentId;
  if (u.id) return resolveUserDocumentId(strapi, u.id);
  return null;
}

/**
 * Session Controller
 * Handles HTTP requests for session management.
 *
 * Error-handling convention: every 4xx response uses the Koa / Strapi
 * convenience helpers (`ctx.unauthorized`, `ctx.forbidden`,
 * `ctx.badRequest`, `ctx.notFound`) so every plugin response is wrapped
 * in the standard `{ data, error }` envelope. We never call
 * `ctx.throw(4xx, ...)` because that path returns a raw text body that
 * the frontend has to special-case.
 */
module.exports = {
  /**
   * Lists all sessions (active + inactive) for admin overviews.
   * @route GET /magic-sessionmanager/sessions
   */
  async getAllSessionsAdmin(ctx) {
    try {
      const sessionService = strapi.plugin('magic-sessionmanager').service('session');
      const sessions = await sessionService.getAllSessions();

      ctx.body = {
        data: sessions,
        meta: {
          count: sessions.length,
          active: sessions.filter((s) => s.isTrulyActive).length,
          inactive: sessions.filter((s) => !s.isTrulyActive).length,
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
   */
  async getActiveSessions(ctx) {
    try {
      const sessionService = strapi.plugin('magic-sessionmanager').service('session');
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
   * Returns the authenticated user's own sessions, current session flagged.
   * @route GET /api/magic-sessionmanager/my-sessions
   */
  async getOwnSessions(ctx) {
    try {
      const userDocId = await resolveAuthUserDocId(ctx);
      if (!userDocId) {
        return ctx.unauthorized('Authentication required');
      }

      const currentToken = extractBearerToken(ctx);
      const currentTokenHash = currentToken ? hashToken(currentToken) : null;

      // We deliberately fetch one more than the display cap so we can
      // report hasMore to the client without scanning the full table.
      const allSessions = await strapi.documents(SESSION_UID).findMany({
        filters: { user: { documentId: userDocId } },
        sort: { loginTime: 'desc' },
        limit: OWN_SESSIONS_LIMIT + 1,
      });

      const hasMore = allSessions.length > OWN_SESSIONS_LIMIT;
      const paged = hasMore ? allSessions.slice(0, OWN_SESSIONS_LIMIT) : allSessions;

      const settings = await getPluginSettings(strapi);
      const enhanceOpts = {
        inactivityTimeout: settings.inactivityTimeout || 15 * 60 * 1000,
        geolocationService: strapi.plugin('magic-sessionmanager').service('geolocation'),
        strapi,
      };

      const sessionsWithCurrent = await enhanceSessions(paged, enhanceOpts, 20);

      for (const s of sessionsWithCurrent) {
        s.isCurrentSession = !!(currentTokenHash && paged.find(
          (raw) => raw.documentId === s.documentId && raw.tokenHash === currentTokenHash
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
          active: sessionsWithCurrent.filter((s) => s.isTrulyActive).length,
          hasMore,
          limit: OWN_SESSIONS_LIMIT,
        },
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error fetching own sessions:', err);
      ctx.throw(500, 'Error fetching sessions');
    }
  },

  /**
   * Get a specific user's sessions. Admins can query any user; content-api
   * users can only query themselves.
   */
  async getUserSessions(ctx) {
    try {
      const { userId } = ctx.params;

      const isAdminRequest = !!(ctx.state.userAbility || ctx.state.admin);
      const requestingUserDocId = await resolveAuthUserDocId(ctx);

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

      const sessionService = strapi.plugin('magic-sessionmanager').service('session');
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
      const userDocId = await resolveAuthUserDocId(ctx);
      const token = extractBearerToken(ctx);

      if (!userDocId || !token) {
        return ctx.unauthorized('Authentication required');
      }

      const sessionService = strapi.plugin('magic-sessionmanager').service('session');
      const currentTokenHash = hashToken(token);
      const matchingSession = await strapi.documents(SESSION_UID).findFirst({
        filters: {
          user: { documentId: userDocId },
          tokenHash: currentTokenHash,
          isActive: true,
        },
        fields: ['documentId'],
      });

      let terminated = false;
      if (matchingSession) {
        await sessionService.terminateSession({
          sessionId: matchingSession.documentId,
          reason: 'manual',
        });
        terminated = true;
        strapi.log.info(`[magic-sessionmanager] User ${userDocId} logged out (session ${matchingSession.documentId})`);
      }

      ctx.body = {
        message: 'Logged out successfully',
        terminated,
      };
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
      const userDocId = await resolveAuthUserDocId(ctx);
      if (!userDocId) {
        return ctx.unauthorized('Authentication required');
      }

      const sessionService = strapi.plugin('magic-sessionmanager').service('session');
      await sessionService.terminateSession({ userId: userDocId, reason: 'manual' });

      strapi.log.info(`[magic-sessionmanager] User ${userDocId} logged out from all devices`);

      ctx.body = { message: 'Logged out from all devices successfully' };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Logout-all error:', err);
      ctx.throw(500, 'Error during logout');
    }
  },

  /**
   * Returns the session associated with the current JWT.
   *
   * During the post-login grace window the session-create write may not
   * yet be visible. In that case we return 202 Accepted with
   * `{ pending: true }` so the client knows to retry shortly instead of
   * interpreting a 404 as "no session at all".
   *
   * @route GET /api/magic-sessionmanager/current-session
   */
  async getCurrentSession(ctx) {
    try {
      const userDocId = await resolveAuthUserDocId(ctx);
      const token = extractBearerToken(ctx);

      if (!userDocId || !token) {
        return ctx.unauthorized('Authentication required');
      }

      const currentTokenHash = hashToken(token);
      const currentSession = await strapi.documents(SESSION_UID).findFirst({
        filters: {
          user: { documentId: userDocId },
          tokenHash: currentTokenHash,
          isActive: true,
        },
      });

      if (!currentSession) {
        // Check grace period — is this a freshly-issued JWT whose session
        // row may not have been committed yet?
        const settings = await getPluginSettings(strapi);
        const gracePeriodMs = Math.max(0, Number(settings.sessionCreationGraceMs) || 5000);
        const iat = ctx.state.user?.iat || ctx.state.auth?.credentials?.iat || null;

        if (gracePeriodMs > 0 && typeof iat === 'number') {
          const ageMs = Date.now() - iat * 1000;
          if (ageMs >= 0 && ageMs < gracePeriodMs) {
            ctx.status = 202;
            ctx.body = {
              data: null,
              meta: { pending: true, retryAfterMs: gracePeriodMs - ageMs },
              message: 'Session is still being created — please retry shortly.',
            };
            return;
          }
        }
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
   * Terminates one of the authenticated user's OWN sessions (not current).
   * @route DELETE /api/magic-sessionmanager/my-sessions/:sessionId
   */
  async terminateOwnSession(ctx) {
    try {
      const userDocId = await resolveAuthUserDocId(ctx);
      const { sessionId } = ctx.params;
      const currentToken = extractBearerToken(ctx);
      const currentTokenHash = currentToken ? hashToken(currentToken) : null;

      if (!userDocId) {
        return ctx.unauthorized('Authentication required');
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
      if (sessionUserId !== userDocId) {
        strapi.log.warn(`[magic-sessionmanager] Security: User ${userDocId} tried to terminate session ${sessionId} of user ${sessionUserId}`);
        return ctx.forbidden('You can only terminate your own sessions');
      }

      if (currentTokenHash && sessionToTerminate.tokenHash === currentTokenHash) {
        return ctx.badRequest('Cannot terminate the current session. Use /logout instead.');
      }

      // Idempotency: terminating an already-terminated session is a no-op
      // but we still return 200 so client retry logic is not penalised.
      const alreadyTerminated = sessionToTerminate.isActive === false;

      if (!alreadyTerminated) {
        const sessionService = strapi.plugin('magic-sessionmanager').service('session');
        await sessionService.terminateSession({ sessionId, reason: 'manual' });
        strapi.log.info(`[magic-sessionmanager] User ${userDocId} terminated own session ${sessionId}`);
      }

      ctx.body = {
        message: alreadyTerminated
          ? `Session ${sessionId} was already terminated`
          : `Session ${sessionId} terminated successfully`,
        success: true,
        alreadyTerminated,
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error terminating own session:', err);
      ctx.throw(500, 'Error terminating session');
    }
  },

  /**
   * Simulates an inactivity timeout on a session. Dev-only.
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
        data: {
          isActive: false,
          terminatedManually: false,
          terminationReason: 'idle',
        },
      });

      strapi.log.info(`[magic-sessionmanager] [TEST] Session ${sessionId} simulated timeout`);

      ctx.body = {
        message: `Session ${sessionId} marked as timed out`,
        success: true,
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error simulating timeout:', err);
      ctx.throw(500, 'Error simulating session timeout');
    }
  },

  /**
   * Terminates a specific session (admin action).
   */
  async terminateSingleSession(ctx) {
    try {
      const { sessionId } = ctx.params;
      const sessionService = strapi.plugin('magic-sessionmanager').service('session');
      await sessionService.terminateSession({ sessionId, reason: 'manual' });

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
   */
  async terminateAllUserSessions(ctx) {
    try {
      const { userId } = ctx.params;
      const sessionService = strapi.plugin('magic-sessionmanager').service('session');
      await sessionService.terminateSession({ userId, reason: 'manual' });

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
   */
  async getIpGeolocation(ctx) {
    try {
      const { ipAddress } = ctx.params;

      if (!ipAddress) {
        return ctx.badRequest('IP address is required');
      }

      const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
      const ipv4Match = ipAddress.match(IPV4_REGEX);
      const isValidIpv4 = ipv4Match && ipv4Match.slice(1).every((octet) => {
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
      const pluginStore = strapi.store({ type: 'plugin', name: 'magic-sessionmanager' });
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
   */
  async deleteSession(ctx) {
    try {
      const { sessionId } = ctx.params;
      const sessionService = strapi.plugin('magic-sessionmanager').service('session');
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
   */
  async cleanInactiveSessions(ctx) {
    try {
      const sessionService = strapi.plugin('magic-sessionmanager').service('session');
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
        return ctx.notFound('User not found');
      }

      const user = await strapi.documents(USER_UID).findOne({ documentId: userDocumentId });

      if (!user) {
        return ctx.notFound('User not found');
      }

      const newBlockedStatus = !user.blocked;

      await strapi.documents(USER_UID).update({
        documentId: userDocumentId,
        data: { blocked: newBlockedStatus },
      });

      if (newBlockedStatus) {
        const sessionService = strapi.plugin('magic-sessionmanager').service('session');
        await sessionService.terminateSession({ userId: userDocumentId, reason: 'blocked' });
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
