'use strict';

const { hashToken } = require('../utils/encryption');
const {
  enhanceSessions,
  enhanceSession,
  shouldResolveGeoData,
} = require('../utils/enhance-session');
const { resolveUserDocumentId } = require('../utils/resolve-user');
const {
  getPluginSettings,
  getSessionCreationGraceMs,
} = require('../utils/settings-loader');
const { extractBearerToken } = require('../utils/extract-token');

const SESSION_UID = 'plugin::magic-sessionmanager.session';
const USER_UID = 'plugin::users-permissions.user';
const OWN_SESSIONS_LIMIT = 200;
const NATIVE_SESSION_KEY_PREFIX = 'native_';
const JWT_MANAGEMENT_CONFIG = 'plugin::users-permissions.jwtManagement';
const LEGACY_JWT_MANAGEMENT = 'legacy-support';

/**
 * Returns the standard unknown-location shape without invoking a GeoIP
 * provider when administrators disable geolocation.
 *
 * @param {string} ipAddress Validated IP address
 * @returns {object} Disabled lookup result for the admin detail panel
 */
function createDisabledGeolocationResult(ipAddress) {
  return {
    ip: ipAddress,
    country: 'Unknown',
    country_code: 'XX',
    country_flag: '',
    city: 'Unknown',
    region: 'Unknown',
    timezone: 'Unknown',
    latitude: null,
    longitude: null,
    isVpn: false,
    isProxy: false,
    isThreat: false,
    securityScore: 50,
    riskLevel: 'Unknown',
    _status: 'disabled',
    _source: 'disabled',
  };
}

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
 * Returns only the numeric identity authenticated by Users & Permissions.
 * Native session-manager ownership is keyed by this ID; document IDs and
 * administrator identities are never substituted for it.
 *
 * @param {object} ctx - Koa context
 * @returns {string|null} Native Users & Permissions owner ID
 */
function getAuthenticatedNativeUserId(ctx) {
  const id = ctx?.state?.user?.id;
  return id === undefined || id === null ? null : String(id);
}

/**
 * Checks whether Users & Permissions owns session lifecycle for this request.
 * The controller uses this only to select its compatibility flow; all native
 * session reads and writes remain delegated to the session service.
 *
 * @returns {boolean} Whether native refresh-token session management is active
 */
function isNativeSessionMode() {
  return strapi?.config?.get?.(JWT_MANAGEMENT_CONFIG, LEGACY_JWT_MANAGEMENT) === 'refresh';
}

/**
 * Reads the current native session ID from Strapi's verified request state.
 * It deliberately does not decode or trust a caller-supplied request value.
 *
 * @param {object} ctx - Authenticated Koa context
 * @returns {string|null} Native session ID from verified credentials
 */
function getCurrentNativeSessionId(ctx) {
  const value = ctx?.state?.session?.id ?? ctx?.state?.auth?.credentials?.sessionId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Returns the stable key that existing Magic session actions can pass to the
 * session service for a native-only session row.
 *
 * @param {object} session - Normalized session view
 * @returns {string|null} Public session key
 */
function getSessionViewKey(session) {
  const key = session?.documentId ?? session?.id ?? session?.sessionId;
  return key === undefined || key === null ? null : String(key);
}

/**
 * Finds a native-only row by its explicit public key within the authenticated
 * user's own service result. No cross-user ID lookup is performed.
 *
 * @param {object[]} sessions - Sessions already scoped to one authenticated user
 * @param {string} publicKey - Requested `native_` session key
 * @returns {object|undefined} Matching native session view
 */
function findOwnedNativeSession(sessions, publicKey) {
  if (typeof publicKey !== 'string' || !publicKey.startsWith(NATIVE_SESSION_KEY_PREFIX)) {
    return undefined;
  }

  return sessions.find((session) =>
    getSessionViewKey(session) === publicKey &&
    typeof session?.nativeSessionId === 'string' &&
    session.nativeSessionId.length > 0
  );
}

/**
 * Tests whether a service-provided row represents the current verified native
 * session, whether it is linked to a Magic sidecar or native-only.
 *
 * @param {object} session - Normalized session view
 * @param {string|null} nativeSessionId - Verified session ID from auth context
 * @returns {boolean} Whether this row is the current request's session
 */
function isCurrentNativeSession(session, nativeSessionId) {
  if (!nativeSessionId) return false;
  return session?.nativeSessionId === nativeSessionId;
}

/**
 * Exposes the session service's bounded-result signal without changing the
 * established metadata envelope when a result is complete.
 *
 * @param {object[]} sessions Session rows returned by the session service
 * @returns {{truncated: true}|{}} Optional public truncation metadata
 */
function getTruncationMeta(sessions) {
  return sessions?.truncated === true ? { truncated: true } : {};
}

/**
 * Preserves the existing post-login pending response when a session record is
 * not yet visible in either the Magic history or native session view.
 *
 * @param {object} ctx - Koa context
 * @returns {Promise<boolean>} True when the pending response was written
 */
async function respondIfSessionCreationPending(ctx) {
  const settings = await getPluginSettings(strapi);
  const gracePeriodMs = getSessionCreationGraceMs(settings);
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
      return true;
    }
  }

  return false;
}

/**
 * Session Controller
 * Handles HTTP requests for session management.
 *
 * Error-handling convention: EVERY error response — 4xx and 5xx — uses
 * the Koa / Strapi convenience helpers (`ctx.unauthorized`,
 * `ctx.forbidden`, `ctx.badRequest`, `ctx.notFound`,
 * `ctx.internalServerError`) so every plugin response is wrapped in the
 * standard `{ data, error: { status, name, message, details } }`
 * envelope. We never call `ctx.throw(statusCode, ...)` because that
 * path returns a raw text body that the frontend has to special-case.
 * Returning the helper call directly (i.e. `return ctx.xyz(...)`) also
 * prevents accidental fall-through since the helpers do not throw.
 */
module.exports = {
  /**
   * Returns aggregate Users & Permissions counts without exposing user rows.
   * The admin route is protected by the plugin's existing authentication and
   * access policies; only the two non-identifying totals cross the API.
   *
   * @route GET /magic-sessionmanager/users/stats
   * @param {object} ctx Koa response context
   * @returns {Promise<object>} Count-only success envelope or stable error
   */
  async getUserStatsAdmin(ctx) {
    try {
      const [totalUsers, blockedUsers] = await Promise.all([
        strapi.db.query(USER_UID).count(),
        strapi.db.query(USER_UID).count({ where: { blocked: true } }),
      ]);

      return ctx.send({
        success: true,
        data: { totalUsers, blockedUsers },
      });
    } catch (error) {
      strapi.log.error(
        '[magic-sessionmanager] getUserStatsAdmin failed:',
        error?.name || 'Error'
      );
      return ctx.internalServerError('Unable to load end-user counts');
    }
  },

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
          ...getTruncationMeta(sessions),
        },
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] getAllSessionsAdmin failed:', err?.name || 'Error');
      return ctx.internalServerError('Error fetching sessions');
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
        meta: { count: sessions.length, ...getTruncationMeta(sessions) },
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] getActiveSessions failed:', err?.name || 'Error');
      return ctx.internalServerError('Error fetching active sessions');
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

      if (isNativeSessionMode()) {
        const userId = getAuthenticatedNativeUserId(ctx);
        if (!userId) return ctx.unauthorized('Authentication required');

        const sessionService = strapi.plugin('magic-sessionmanager').service('session');
        const allSessions = await sessionService.getUserSessions(userId);
        if (!Array.isArray(allSessions)) {
          throw new Error('Session service returned an invalid native session list');
        }

        const truncated = allSessions.truncated === true;
        const hasMore = allSessions.length > OWN_SESSIONS_LIMIT || truncated;
        const paged = allSessions.slice(0, OWN_SESSIONS_LIMIT);
        const currentNativeSessionId = getCurrentNativeSessionId(ctx);
        const sessionsWithCurrent = paged.map((session) => ({
          ...session,
          isCurrentSession: isCurrentNativeSession(session, currentNativeSessionId),
        }));

        sessionsWithCurrent.sort((a, b) => {
          if (a.isCurrentSession) return -1;
          if (b.isCurrentSession) return 1;
          return new Date(b.loginTime || 0) - new Date(a.loginTime || 0);
        });

        ctx.body = {
          data: sessionsWithCurrent,
          meta: {
            count: sessionsWithCurrent.length,
            active: sessionsWithCurrent.filter((session) => session.isTrulyActive).length,
            hasMore,
            limit: OWN_SESSIONS_LIMIT,
            ...(truncated ? { truncated: true } : {}),
          },
        };
        return;
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
        geolocationService: shouldResolveGeoData(settings)
          ? strapi.plugin('magic-sessionmanager').service('geolocation')
          : null,
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
      strapi.log.error('[magic-sessionmanager] Error fetching own sessions:', err?.name || 'Error');
      return ctx.internalServerError('Error fetching sessions');
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
          strapi.log.warn('[magic-sessionmanager] Denied a session lookup without a verifiable user identity');
          return ctx.forbidden('Cannot verify user identity');
        }

        const requestedDocId = await resolveUserDocumentId(strapi, userId);
        if (!requestedDocId || String(requestingUserDocId) !== String(requestedDocId)) {
          strapi.log.warn('[magic-sessionmanager] Denied a cross-user session lookup');
          return ctx.forbidden('You can only access your own sessions');
        }
      }

      const sessionService = strapi.plugin('magic-sessionmanager').service('session');
      const serviceUserId =
        !isAdminRequest && isNativeSessionMode() ? getAuthenticatedNativeUserId(ctx) : userId;
      if (!serviceUserId) return ctx.forbidden('Cannot verify user identity');
      const sessions = await sessionService.getUserSessions(serviceUserId);

      ctx.body = {
        data: sessions,
        meta: { count: sessions.length, ...getTruncationMeta(sessions) },
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] getUserSessions failed:', err?.name || 'Error');
      return ctx.internalServerError('Error fetching user sessions');
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

      if (isNativeSessionMode()) {
        const userId = getAuthenticatedNativeUserId(ctx);
        if (!userId) return ctx.unauthorized('Authentication required');

        const nativeSessionId = getCurrentNativeSessionId(ctx);
        if (!nativeSessionId) {
          throw new Error(
            'Authenticated native session ID is missing from Users & Permissions credentials'
          );
        }

        const ownedSessions = await sessionService.getUserSessions(userId);
        if (!Array.isArray(ownedSessions)) {
          throw new Error('Session service returned an invalid native session list');
        }
        const currentSession = ownedSessions.find((session) =>
          isCurrentNativeSession(session, nativeSessionId)
        );
        const currentSessionKey = getSessionViewKey(currentSession);
        if (!currentSessionKey) {
          ctx.body = {
            message: 'No active session found — you are already logged out',
            terminated: false,
          };
          return;
        }

        const { terminatedCount = 0 } = await sessionService.terminateSession({
          sessionId: currentSessionKey,
          userId,
          reason: 'logout',
        });
        const terminated = terminatedCount > 0;

        ctx.body = {
          message: terminated
            ? 'Logged out successfully'
            : 'No active session found — you are already logged out',
          terminated,
        };
        return;
      }

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
          reason: 'logout',
        });
        terminated = true;
        strapi.log.info('[magic-sessionmanager] Current user logged out of one session');
      }

      // Message must reflect reality: "Logged out successfully" when we
      // actually terminated a session, otherwise make it clear that no
      // active session was on record (the user may have been logged out
      // by the JWT-verify wrapper just before this request arrived).
      ctx.body = {
        message: terminated
          ? 'Logged out successfully'
          : 'No active session found — you are already logged out',
        terminated,
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Logout failed:', err?.name || 'Error');
      return ctx.internalServerError('Error during logout');
    }
  },

  /**
   * Terminates EVERY session of the authenticated user — including the
   * current one. After this call the caller will also be logged out on
   * the next request (their own JWT is rejected by the JWT-verify wrapper
   * with reason=logout).
   *
   * For the "log me out everywhere ELSE but keep me here" flow, use
   * `/logout-others` below.
   *
   * @route POST /api/magic-sessionmanager/logout-all
   */
  async logoutAll(ctx) {
    try {
      const userDocId = await resolveAuthUserDocId(ctx);
      if (!userDocId) {
        return ctx.unauthorized('Authentication required');
      }

      const sessionService = strapi.plugin('magic-sessionmanager').service('session');
      const serviceUserId = isNativeSessionMode() ? getAuthenticatedNativeUserId(ctx) : userDocId;
      if (!serviceUserId) return ctx.unauthorized('Authentication required');
      const { terminatedCount } = await sessionService.terminateSession({
        userId: serviceUserId,
        reason: 'logout',
      });

      strapi.log.info(
        `[magic-sessionmanager] Current user logged out from all devices (${terminatedCount} sessions)`
      );

      ctx.body = {
        message: 'Logged out from all devices successfully',
        terminatedCount,
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Logout-all failed:', err?.name || 'Error');
      return ctx.internalServerError('Error during logout');
    }
  },

  /**
   * Terminates every session of the authenticated user EXCEPT the current
   * one. This is the "kick everyone else off my account" flow — the
   * caller stays logged in on the device they are using.
   *
   * If no "current session" record can be located for the caller's JWT
   * (edge case: user logged in before the session-manager was installed,
   * or right at the end of the grace window) we fall back to terminating
   * ALL sessions so the user still gets the safety effect they asked for,
   * and we report `fellBackToLogoutAll: true` so the client can adjust
   * its success message.
   *
   * @route POST /api/magic-sessionmanager/logout-others
   */
  async logoutOthers(ctx) {
    try {
      const userDocId = await resolveAuthUserDocId(ctx);
      const token = extractBearerToken(ctx);

      if (!userDocId || !token) {
        return ctx.unauthorized('Authentication required');
      }

      const sessionService = strapi.plugin('magic-sessionmanager').service('session');

      if (isNativeSessionMode()) {
        const userId = getAuthenticatedNativeUserId(ctx);
        if (!userId) return ctx.unauthorized('Authentication required');

        const currentNativeSessionId = getCurrentNativeSessionId(ctx);
        const ownedSessions = await sessionService.getUserSessions(userId);
        if (!Array.isArray(ownedSessions)) {
          throw new Error('Session service returned an invalid native session list');
        }
        const currentSession = currentNativeSessionId
          ? ownedSessions.find((session) => isCurrentNativeSession(session, currentNativeSessionId))
          : null;
        const currentSessionKey = getSessionViewKey(currentSession);

        if (!currentSessionKey) {
          const { terminatedCount } = await sessionService.terminateSession({
            userId,
            reason: 'logout',
          });
          strapi.log.warn(
            '[magic-sessionmanager] logoutOthers fell back to logoutAll (no current session match)'
          );
          ctx.body = {
            message: 'All sessions terminated (could not preserve current session)',
            terminatedCount,
            fellBackToLogoutAll: true,
          };
          return;
        }

        const { terminatedCount } = await sessionService.terminateSession({
          userId,
          exceptSessionId: currentSessionKey,
          reason: 'logout',
        });

        ctx.body = {
          message:
            terminatedCount === 0
              ? 'No other active sessions to terminate'
              : `${terminatedCount} other session(s) terminated`,
          terminatedCount,
          currentSessionPreserved: true,
        };
        return;
      }

      const currentTokenHash = hashToken(token);
      const currentSession = await strapi.documents(SESSION_UID).findFirst({
        filters: { user: { documentId: userDocId }, tokenHash: currentTokenHash },
        fields: ['documentId'],
      });

      if (!currentSession) {
        // No current-session record to preserve — falling back to logoutAll
        // keeps the safety semantic ("throw every session out"). Client
        // gets told so they can re-login if needed.
        const { terminatedCount } = await sessionService.terminateSession({
          userId: userDocId,
          reason: 'logout',
        });
        strapi.log.warn(
          '[magic-sessionmanager] logoutOthers fell back to logoutAll (no current session match)'
        );
        ctx.body = {
          message: 'All sessions terminated (could not preserve current session)',
          terminatedCount,
          fellBackToLogoutAll: true,
        };
        return;
      }

      const { terminatedCount } = await sessionService.terminateSession({
        userId: userDocId,
        exceptSessionId: currentSession.documentId,
        reason: 'logout',
      });

      strapi.log.info(
        `[magic-sessionmanager] Current user logged out ${terminatedCount} other device(s)`
      );

      ctx.body = {
        message: terminatedCount === 0
          ? 'No other active sessions to terminate'
          : `${terminatedCount} other session(s) terminated`,
        terminatedCount,
        currentSessionPreserved: true,
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Logout-others failed:', err?.name || 'Error');
      return ctx.internalServerError('Error terminating other sessions');
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

      if (isNativeSessionMode()) {
        const userId = getAuthenticatedNativeUserId(ctx);
        if (!userId) return ctx.unauthorized('Authentication required');

        const nativeSessionId = getCurrentNativeSessionId(ctx);
        const sessionService = strapi.plugin('magic-sessionmanager').service('session');
        const sessions = await sessionService.getUserSessions(userId);
        if (!Array.isArray(sessions)) {
          throw new Error('Session service returned an invalid native session list');
        }

        const currentSession = sessions.find((session) =>
          isCurrentNativeSession(session, nativeSessionId)
        );
        if (!currentSession) {
          if (await respondIfSessionCreationPending(ctx)) return;
          return ctx.notFound('Current session not found');
        }

        ctx.body = {
          data: { ...currentSession, isCurrentSession: true },
        };
        return;
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
        if (await respondIfSessionCreationPending(ctx)) return;
        return ctx.notFound('Current session not found');
      }

      const settings = await getPluginSettings(strapi);
      const enhanced = await enhanceSession(currentSession, {
        inactivityTimeout: settings.inactivityTimeout || 15 * 60 * 1000,
        geolocationService: shouldResolveGeoData(settings)
          ? strapi.plugin('magic-sessionmanager').service('geolocation')
          : null,
        geoCounter: { remaining: 1 },
        strapi,
      });

      ctx.body = {
        data: { ...enhanced, isCurrentSession: true },
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error getting current session:', err?.name || 'Error');
      return ctx.internalServerError('Error fetching current session');
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

      const sessionService = strapi.plugin('magic-sessionmanager').service('session');

      if (isNativeSessionMode() && sessionId.startsWith(NATIVE_SESSION_KEY_PREFIX)) {
        const serviceUserId = getAuthenticatedNativeUserId(ctx);
        if (!serviceUserId) return ctx.unauthorized('Authentication required');

        const ownedSessions = await sessionService.getUserSessions(serviceUserId);
        if (!Array.isArray(ownedSessions)) {
          throw new Error('Session service returned an invalid native session list');
        }

        const sessionToTerminate = findOwnedNativeSession(ownedSessions, sessionId);
        if (!sessionToTerminate) return ctx.notFound('Session not found');

        if (isCurrentNativeSession(sessionToTerminate, getCurrentNativeSessionId(ctx))) {
          return ctx.badRequest('Cannot terminate the current session. Use /logout instead.');
        }

        const alreadyTerminated = sessionToTerminate.isActive === false;
        if (!alreadyTerminated) {
          const result = await sessionService.terminateSession({
            sessionId,
            userId: serviceUserId,
            reason: 'manual',
          });
          if (result?.terminatedCount === 0) {
            ctx.body = {
              message: `Session ${sessionId} was already terminated`,
              success: true,
              alreadyTerminated: true,
            };
            return;
          }
        }

        ctx.body = {
          message: alreadyTerminated
            ? `Session ${sessionId} was already terminated`
            : `Session ${sessionId} terminated successfully`,
          success: true,
          alreadyTerminated,
        };
        return;
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
        strapi.log.warn('[magic-sessionmanager] Denied an attempt to terminate another user session');
        return ctx.forbidden('You can only terminate your own sessions');
      }

      if (currentTokenHash && sessionToTerminate.tokenHash === currentTokenHash) {
        return ctx.badRequest('Cannot terminate the current session. Use /logout instead.');
      }

      // Idempotency: terminating an already-terminated session is a no-op
      // but we still return 200 so client retry logic is not penalised.
      const alreadyTerminated = sessionToTerminate.isActive === false;

      if (!alreadyTerminated) {
        await sessionService.terminateSession({ sessionId, reason: 'manual' });
        strapi.log.info('[magic-sessionmanager] Current user terminated one own session');
      }

      ctx.body = {
        message: alreadyTerminated
          ? `Session ${sessionId} was already terminated`
          : `Session ${sessionId} terminated successfully`,
        success: true,
        alreadyTerminated,
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error terminating own session:', err?.name || 'Error');
      return ctx.internalServerError('Error terminating session');
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

      strapi.log.info('[magic-sessionmanager] [TEST] Session timeout simulated');

      ctx.body = {
        message: `Session ${sessionId} marked as timed out`,
        success: true,
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error simulating timeout:', err?.name || 'Error');
      return ctx.internalServerError('Error simulating session timeout');
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
      strapi.log.error('[magic-sessionmanager] Error terminating session:', err?.name || 'Error');
      return ctx.internalServerError('Error terminating session');
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
      strapi.log.error('[magic-sessionmanager] Error terminating all user sessions:', err?.name || 'Error');
      return ctx.internalServerError('Error terminating all user sessions');
    }
  },

  /**
   * Returns geolocation data for a specific IP address. Disabled settings
   * return a local placeholder without contacting the configured provider.
   *
   * @route GET /magic-sessionmanager/geolocation/:ipAddress
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

      const settings = await getPluginSettings(strapi);
      if (settings.enableGeolocation === false || settings.geoIpProvider === 'disabled') {
        ctx.body = {
          success: true,
          data: createDisabledGeolocationResult(ipAddress),
        };
        return;
      }

      const geolocationService = strapi.plugin('magic-sessionmanager').service('geolocation');
      const ipData = await geolocationService.getIpInfo(ipAddress);

      ctx.body = {
        success: true,
        data: ipData,
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error getting IP geolocation:', err?.name || 'Error');
      return ctx.internalServerError('Error fetching IP geolocation data');
    }
  },

  /**
   * Removes session details after preserving an access-token revocation hash.
   *
   * @route DELETE /magic-sessionmanager/sessions/:sessionId
   * @sideeffect Deletes the session row and keeps a minimal deny record until
   *   any unexpired JWT expires
   */
  async deleteSession(ctx) {
    try {
      const { sessionId } = ctx.params;
      const sessionService = strapi.plugin('magic-sessionmanager').service('session');
      const removed = await sessionService.deleteSession(sessionId);
      if (!removed) return ctx.notFound('Session not found');

      ctx.body = {
        message: 'Session details removed; access-token revocation preserved',
        success: true,
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error deleting session:', err?.name || 'Error');
      return ctx.internalServerError('Error deleting session');
    }
  },

  /**
   * Removes inactive session rows after preserving hashes for unexpired JWTs.
   *
   * @route POST /magic-sessionmanager/sessions/clean-inactive
   * @sideeffect Deletes inactive session rows and retains token deny records
   *   until expiry
   */
  async cleanInactiveSessions(ctx) {
    try {
      const sessionService = strapi.plugin('magic-sessionmanager').service('session');
      const deletedCount = await sessionService.deleteInactiveSessions();

      ctx.body = {
        message: `Removed ${deletedCount} inactive session records; access-token revocation preserved`,
        success: true,
        deletedCount,
      };
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error cleaning inactive sessions:', err?.name || 'Error');
      return ctx.internalServerError('Error deleting inactive sessions');
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
      strapi.log.error('[magic-sessionmanager] Error toggling user block:', err?.name || 'Error');
      return ctx.internalServerError('Error toggling user block status');
    }
  },
};
