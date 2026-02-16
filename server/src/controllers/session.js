'use strict';

const { hashToken } = require('../utils/encryption');
const { parseUserAgent } = require('../utils/user-agent-parser');

const SESSION_UID = 'plugin::magic-sessionmanager.session';
const USER_UID = 'plugin::users-permissions.user';

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
   * Get own sessions (authenticated user)
   * GET /api/magic-sessionmanager/my-sessions
   * Automatically uses the authenticated user's documentId
   * Marks which session is the current one (based on JWT token hash)
   * Fetches geolocation data on-demand if not already stored
   */
  async getOwnSessions(ctx) {
    try {
      // Strapi v5: Use documentId from authenticated user
      const userId = ctx.state.user?.documentId;
      const currentToken = ctx.request.headers.authorization?.replace('Bearer ', '');
      const currentTokenHash = currentToken ? hashToken(currentToken) : null;

      if (!userId) {
        return ctx.throw(401, 'Unauthorized');
      }

      // Get all sessions for the user (limited to prevent memory issues)
      const allSessions = await strapi.documents(SESSION_UID).findMany({
        filters: { user: { documentId: userId } },
        sort: { loginTime: 'desc' },
        limit: 200,
      });

      // Get config for inactivity timeout
      const config = strapi.config.get('plugin::magic-sessionmanager') || {};
      const inactivityTimeout = config.inactivityTimeout || 15 * 60 * 1000;
      const now = new Date();
      
      // Get geolocation service for on-demand lookups
      const geolocationService = strapi.plugin('magic-sessionmanager').service('geolocation');

      // Enhance sessions with isCurrentSession flag and parsed device info
      const sessionsWithCurrent = await Promise.all(allSessions.map(async (session) => {
        const lastActiveTime = session.lastActive ? new Date(session.lastActive) : new Date(session.loginTime);
        const timeSinceActive = now - lastActiveTime;
        const isTrulyActive = session.isActive && (timeSinceActive < inactivityTimeout);

        // Check if this is the current session using tokenHash (no decryption needed!)
        const isCurrentSession = currentTokenHash && session.tokenHash === currentTokenHash;

        // Parse user agent to get device info (if not already stored)
        const parsedUA = parseUserAgent(session.userAgent);
        const deviceType = session.deviceType || parsedUA.deviceType;
        const browserName = session.browserName || (parsedUA.browserVersion 
          ? `${parsedUA.browserName} ${parsedUA.browserVersion}` 
          : parsedUA.browserName);
        const osName = session.osName || (parsedUA.osVersion 
          ? `${parsedUA.osName} ${parsedUA.osVersion}` 
          : parsedUA.osName);

        // Parse geoLocation JSON if stored as string
        let geoLocation = session.geoLocation;
        if (typeof geoLocation === 'string') {
          try {
            geoLocation = JSON.parse(geoLocation);
          } catch (e) {
            geoLocation = null;
          }
        }
        
        // On-demand geolocation lookup if not already stored
        if (!geoLocation && session.ipAddress) {
          try {
            const geoData = await geolocationService.getIpInfo(session.ipAddress);
            if (geoData && geoData.country !== 'Unknown') {
              geoLocation = {
                country: geoData.country,
                country_code: geoData.country_code,
                country_flag: geoData.country_flag,
                city: geoData.city,
                region: geoData.region,
                timezone: geoData.timezone,
              };
              
              // Persist to database for future requests (fire-and-forget)
              strapi.documents(SESSION_UID).update({
                documentId: session.documentId,
                data: { 
                  geoLocation,
                  securityScore: geoData.securityScore || null,
                },
              }).catch(() => {}); // Ignore update errors
            }
          } catch (geoErr) {
            strapi.log.debug('[magic-sessionmanager] Geolocation lookup failed:', geoErr.message);
          }
        }

        // Remove sensitive token fields and internal fields
        const { 
          token, tokenHash, refreshToken, refreshTokenHash,
          locale, publishedAt, // Remove Strapi internal fields
          geoLocation: _geo, // Remove raw geoLocation
          ...sessionWithoutTokens 
        } = session;

        return {
          ...sessionWithoutTokens,
          deviceType,
          browserName,
          osName,
          geoLocation, // Parsed object or null
          isCurrentSession,
          isTrulyActive,
          minutesSinceActive: Math.floor(timeSinceActive / 1000 / 60),
        };
      }));

      // Sort: current session first, then by loginTime
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
      // Strapi v5: Use documentId instead of numeric id
      const requestingUserDocId = ctx.state.user?.documentId;

      // SECURITY CHECK: Content API users can only see their own sessions
      // Admins can see any user's sessions
      if (!isAdminRequest) {
        // CRITICAL: If we cannot determine the requesting user's documentId,
        // deny access to prevent IDOR attacks via null/undefined bypass
        if (!requestingUserDocId) {
          strapi.log.warn(`[magic-sessionmanager] Security: Request without documentId tried to access sessions of user ${userId}`);
          return ctx.forbidden('Cannot verify user identity');
        }
        if (String(requestingUserDocId) !== String(userId)) {
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
      // Strapi v5: Use documentId instead of numeric id
      const userId = ctx.state.user?.documentId;
      const token = ctx.request.headers.authorization?.replace('Bearer ', '');

      if (!userId) {
        return ctx.throw(401, 'Unauthorized');
      }

      const sessionService = strapi
        .plugin('magic-sessionmanager')
        .service('session');

      // Find current session by tokenHash (O(1) lookup, no decryption needed!)
      const currentTokenHash = hashToken(token);
      const matchingSession = await strapi.documents(SESSION_UID).findFirst({
        filters: {
          user: { documentId: userId },
          tokenHash: currentTokenHash,
          isActive: true,
        },
      });

      if (matchingSession) {
        // Terminate only the current session
        await sessionService.terminateSession({ sessionId: matchingSession.documentId });
        strapi.log.info(`[magic-sessionmanager] User ${userId} logged out (session ${matchingSession.documentId})`);
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
      // Strapi v5: Use documentId instead of numeric id
      const userId = ctx.state.user?.documentId;

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
   * Get current session info based on JWT token hash
   * GET /api/magic-sessionmanager/current-session
   * Returns the session associated with the current JWT token
   * Fetches geolocation on-demand if not already stored
   */
  async getCurrentSession(ctx) {
    try {
      const userId = ctx.state.user?.documentId;
      const token = ctx.request.headers.authorization?.replace('Bearer ', '');

      if (!userId || !token) {
        return ctx.throw(401, 'Unauthorized');
      }

      // Find session by tokenHash (O(1) lookup, no decryption needed!)
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

      // Get config for inactivity timeout
      const config = strapi.config.get('plugin::magic-sessionmanager') || {};
      const inactivityTimeout = config.inactivityTimeout || 15 * 60 * 1000;
      const now = new Date();
      const lastActiveTime = currentSession.lastActive ? new Date(currentSession.lastActive) : new Date(currentSession.loginTime);
      const timeSinceActive = now - lastActiveTime;

      // Parse user agent to get device info (if not already stored)
      const parsedUA = parseUserAgent(currentSession.userAgent);
      const deviceType = currentSession.deviceType || parsedUA.deviceType;
      const browserName = currentSession.browserName || (parsedUA.browserVersion 
        ? `${parsedUA.browserName} ${parsedUA.browserVersion}` 
        : parsedUA.browserName);
      const osName = currentSession.osName || (parsedUA.osVersion 
        ? `${parsedUA.osName} ${parsedUA.osVersion}` 
        : parsedUA.osName);

      // Parse geoLocation JSON if stored as string
      let geoLocation = currentSession.geoLocation;
      if (typeof geoLocation === 'string') {
        try {
          geoLocation = JSON.parse(geoLocation);
        } catch (e) {
          geoLocation = null;
        }
      }
      
      // On-demand geolocation lookup if not already stored
      if (!geoLocation && currentSession.ipAddress) {
        try {
          const geolocationService = strapi.plugin('magic-sessionmanager').service('geolocation');
          const geoData = await geolocationService.getIpInfo(currentSession.ipAddress);
          if (geoData && geoData.country !== 'Unknown') {
            geoLocation = {
              country: geoData.country,
              country_code: geoData.country_code,
              country_flag: geoData.country_flag,
              city: geoData.city,
              region: geoData.region,
              timezone: geoData.timezone,
            };
            
            // Persist to database for future requests (fire-and-forget)
            strapi.documents(SESSION_UID).update({
              documentId: currentSession.documentId,
              data: { 
                geoLocation,
                securityScore: geoData.securityScore || null,
              },
            }).catch(() => {}); // Ignore update errors
          }
        } catch (geoErr) {
          strapi.log.debug('[magic-sessionmanager] Geolocation lookup failed:', geoErr.message);
        }
      }

      // Remove sensitive token fields and internal fields
      const { 
        token: _, tokenHash: _th, refreshToken: __, refreshTokenHash: _rth,
        locale: _l, publishedAt: _p, geoLocation: _geo,
        ...sessionWithoutTokens 
      } = currentSession;

      ctx.body = {
        data: {
          ...sessionWithoutTokens,
          deviceType,
          browserName,
          osName,
          geoLocation, // Parsed object or null
          isCurrentSession: true,
          isTrulyActive: timeSinceActive < inactivityTimeout,
          minutesSinceActive: Math.floor(timeSinceActive / 1000 / 60),
        },
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error getting current session:', err);
      ctx.throw(500, 'Error fetching current session');
    }
  },

  /**
   * Terminate a specific own session (not the current one)
   * DELETE /api/magic-sessionmanager/my-sessions/:sessionId
   * SECURITY: User can only terminate their OWN sessions
   */
  async terminateOwnSession(ctx) {
    try {
      const userId = ctx.state.user?.documentId;
      const { sessionId } = ctx.params;
      const currentToken = ctx.request.headers.authorization?.replace('Bearer ', '');
      const currentTokenHash = currentToken ? hashToken(currentToken) : null;

      if (!userId) {
        return ctx.throw(401, 'Unauthorized');
      }

      if (!sessionId) {
        return ctx.badRequest('Session ID is required');
      }

      // Find the session to terminate
      const sessionToTerminate = await strapi.documents(SESSION_UID).findOne({
        documentId: sessionId,
        populate: { user: { fields: ['documentId'] } },
      });

      if (!sessionToTerminate) {
        return ctx.notFound('Session not found');
      }

      // SECURITY CHECK: Verify session belongs to current user
      const sessionUserId = sessionToTerminate.user?.documentId;
      if (sessionUserId !== userId) {
        strapi.log.warn(`[magic-sessionmanager] Security: User ${userId} tried to terminate session ${sessionId} of user ${sessionUserId}`);
        return ctx.forbidden('You can only terminate your own sessions');
      }

      // Check if this is the current session using tokenHash (cannot terminate current session via this endpoint)
      if (currentTokenHash && sessionToTerminate.tokenHash === currentTokenHash) {
        return ctx.badRequest('Cannot terminate current session. Use /logout instead.');
      }

      // Terminate the session
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
   * Simulate session timeout for testing (Admin action)
   * POST /magic-sessionmanager/sessions/:sessionId/simulate-timeout
   * Sets isActive: false, terminatedManually: false (as if cleanup job ran)
   * This allows testing session reactivation behavior
   */
  async simulateTimeout(ctx) {
    try {
      // SECURITY: Only allow in non-production environments
      const nodeEnv = process.env.NODE_ENV || 'development';
      if (nodeEnv === 'production') {
        return ctx.forbidden('simulate-timeout is disabled in production');
      }

      const { sessionId } = ctx.params;
      
      // Find the session first
      const session = await strapi.documents(SESSION_UID).findOne({
        documentId: sessionId,
      });
      
      if (!session) {
        return ctx.notFound('Session not found');
      }
      
      // Simulate timeout: set isActive false but terminatedManually false
      await strapi.documents(SESSION_UID).update({
        documentId: sessionId,
        data: {
          isActive: false,
          terminatedManually: false, // This allows reactivation!
        },
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

      // Validate IP address format to prevent SSRF
      const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
      const ipv4Match = ipAddress.match(IPV4_REGEX);
      const isValidIpv4 = ipv4Match && ipv4Match.slice(1).every(octet => {
        const n = parseInt(octet, 10);
        return n >= 0 && n <= 255;
      });
      
      // IPv6: must contain at least 2 colons, only hex digits and colons, 3-45 chars
      const IPV6_REGEX = /^[0-9a-fA-F:]{3,45}$/;
      const isValidIpv6 = !isValidIpv4 && IPV6_REGEX.test(ipAddress) && (ipAddress.match(/:/g) || []).length >= 2;
      
      if (!isValidIpv4 && !isValidIpv6) {
        return ctx.badRequest('Invalid IP address format');
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
   * Supports both numeric id (from Content Manager) and documentId
   */
  async toggleUserBlock(ctx) {
    try {
      const { userId } = ctx.params;
      
      // Strapi v5: userId from params could be numeric id or documentId
      // If numeric, look up the documentId first using entityService (fallback)
      let userDocumentId = userId;
      let user = null;
      
      // Try to find by documentId first (preferred)
      user = await strapi.documents(USER_UID).findOne({ documentId: userId });
      
      // If not found, try numeric id lookup via entityService (fallback for Content Manager)
      // NOTE: entityService is deprecated, but required here for numeric ID -> documentId conversion
      if (!user && !isNaN(userId)) {
        const numericUser = await strapi.entityService.findOne(USER_UID, parseInt(userId, 10));
        if (numericUser) {
          userDocumentId = numericUser.documentId;
          user = numericUser;
        }
      }
      
      if (!user) {
        return ctx.throw(404, 'User not found');
      }

      // Toggle blocked status
      const newBlockedStatus = !user.blocked;
      
      await strapi.documents(USER_UID).update({
        documentId: userDocumentId,
        data: {
          blocked: newBlockedStatus,
        },
      });

      // If blocking user, terminate all their sessions
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
