'use strict';

/**
 * lastSeen Middleware
 * Updates user lastSeen and session lastActive on each authenticated request
 * Rate-limited to prevent DB write noise (default: 30 seconds)
 * 
 * CRITICAL: This middleware validates that authenticated users have active sessions.
 * If a session is terminated, the JWT becomes invalid even if not expired.
 * 
 * [SUCCESS] Migrated to strapi.documents() API (Strapi v5 Best Practice)
 */

const SESSION_UID = 'plugin::magic-sessionmanager.session';
const USER_UID = 'plugin::users-permissions.user';

/**
 * Patterns that identify auth-related endpoints (excluded from session checking)
 * Uses simple substring matching for maintainability
 */
const AUTH_PATTERNS = [
  '/auth/',           // All /api/auth/* endpoints (login, logout, refresh, etc.)
  '/magic-link/',     // All Magic-Link endpoints
  '/passwordless/',   // Legacy passwordless endpoints
  '/otp/',            // OTP endpoints (any plugin)
  '/login',           // Any login endpoint
  '/register',        // Any register endpoint
  '/forgot-password', // Password reset
  '/reset-password',  // Password reset
  '/admin/',          // Admin panel endpoints (have their own auth)
];

/**
 * Checks if path is an auth-related endpoint that should skip session validation
 * @param {string} path - The request path
 * @returns {boolean} True if path should be excluded
 */
function isAuthEndpoint(path) {
  return AUTH_PATTERNS.some(pattern => path.includes(pattern));
}

/**
 * LRU-like cache for numeric ID -> documentId mapping to reduce DB queries
 * TTL: 5 minutes, Max size: 1000 entries
 */
const userIdCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX_SIZE = 1000;

/**
 * Gets documentId from numeric id, with caching and size limit
 * @param {object} strapi - Strapi instance
 * @param {number} numericId - Numeric user ID
 * @returns {Promise<string|null>} documentId or null
 */
async function getDocumentIdFromNumericId(strapi, numericId) {
  const cacheKey = `user_${numericId}`;
  const cached = userIdCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.documentId;
  }
  
  // Evict expired or excess entries when cache grows too large
  if (userIdCache.size >= CACHE_MAX_SIZE) {
    const now = Date.now();
    for (const [key, value] of userIdCache) {
      if (now - value.timestamp >= CACHE_TTL) {
        userIdCache.delete(key);
      }
    }
    // If still over limit after TTL eviction, remove oldest 25%
    if (userIdCache.size >= CACHE_MAX_SIZE) {
      const keysToDelete = [...userIdCache.keys()].slice(0, Math.floor(CACHE_MAX_SIZE / 4));
      keysToDelete.forEach(key => userIdCache.delete(key));
    }
  }
  
  try {
    // Use entityService to get user by numeric ID
    const user = await strapi.entityService.findOne(USER_UID, numericId, {
      fields: ['documentId'],
    });
    
    if (user?.documentId) {
      userIdCache.set(cacheKey, { documentId: user.documentId, timestamp: Date.now() });
      return user.documentId;
    }
  } catch (err) {
    strapi.log.debug('[magic-sessionmanager] Error fetching documentId:', err.message);
  }
  
  return null;
}

module.exports = ({ strapi, sessionService }) => {
  return async (ctx, next) => {
    // Skip session checking for auth-related endpoints
    // These endpoints create/manage sessions, so checking here causes chicken-and-egg problems
    if (isAuthEndpoint(ctx.path)) {
      await next();
      return;
    }

    // BEFORE processing request: Check if user's sessions are active
    // Support both documentId (Strapi v5) and numeric id (legacy/auth strategy)
    if (ctx.state.user) {
      try {
        let userDocId = ctx.state.user.documentId;
        
        // If no documentId but has numeric id, fetch documentId from DB
        if (!userDocId && ctx.state.user.id) {
          userDocId = await getDocumentIdFromNumericId(strapi, ctx.state.user.id);
        }
        
        if (userDocId) {
          // Get config - strictSessionEnforcement must be explicitly enabled to block
          const config = strapi.config.get('plugin::magic-sessionmanager') || {};
          const strictMode = config.strictSessionEnforcement === true;
          
          // Check if user has ANY active sessions
          const activeSessions = await strapi.documents(SESSION_UID).findMany({
            filters: {
              user: { documentId: userDocId },
              isActive: true,
            },
            limit: 1,
          });

          // If user has NO active sessions
          if (!activeSessions || activeSessions.length === 0) {
            // Check for inactive sessions
            const inactiveSessions = await strapi.documents(SESSION_UID).findMany({
              filters: { 
                user: { documentId: userDocId },
                isActive: false,
              },
              limit: 5,
              fields: ['documentId', 'terminatedManually', 'lastActive', 'loginTime'],
              sort: [{ lastActive: 'desc' }],
            });
            
            if (inactiveSessions && inactiveSessions.length > 0) {
              // Check if ANY session was manually terminated
              const manuallyTerminated = inactiveSessions.find(s => s.terminatedManually === true);
              
              if (manuallyTerminated) {
                // User was explicitly logged out -> BLOCK
                strapi.log.info(`[magic-sessionmanager] [BLOCKED] User ${userDocId.substring(0, 8)}... was manually logged out`);
                return ctx.unauthorized('Session has been terminated. Please login again.');
              }
              
              // Session was deactivated by timeout -> REACTIVATE most recent one
              // SECURITY: Check maxSessionAge to prevent indefinite reactivation
              const sessionToReactivate = inactiveSessions[0];
              const maxAgeDays = config.maxSessionAgeDays || 30;
              const loginTime = sessionToReactivate.loginTime 
                ? new Date(sessionToReactivate.loginTime).getTime() 
                : (sessionToReactivate.lastActive ? new Date(sessionToReactivate.lastActive).getTime() : 0);
              const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
              const isExpired = loginTime > 0 && (Date.now() - loginTime) > maxAgeMs;
              
              if (isExpired) {
                strapi.log.info(`[magic-sessionmanager] [BLOCKED] Session exceeded max age of ${maxAgeDays} days (user: ${userDocId.substring(0, 8)}...)`);
                return ctx.unauthorized('Session expired. Please login again.');
              }
              
              await strapi.documents(SESSION_UID).update({
                documentId: sessionToReactivate.documentId,
                data: {
                  isActive: true,
                  lastActive: new Date(),
                },
              });
              strapi.log.info(`[magic-sessionmanager] [REACTIVATED] Session reactivated for user ${userDocId.substring(0, 8)}...`);
              // Continue - session is now active
            } else {
              // No sessions exist at all - session was never created
              if (strictMode) {
                strapi.log.info(`[magic-sessionmanager] [BLOCKED] No session exists (user: ${userDocId.substring(0, 8)}..., strictMode)`);
                return ctx.unauthorized('No valid session. Please login again.');
              }
              
              // Non-strict mode: Allow but log warning
              strapi.log.warn(`[magic-sessionmanager] [WARN] No session for user ${userDocId.substring(0, 8)}... (allowing)`);
            }
          }
          
          // Store documentId for later use
          ctx.state.userDocumentId = userDocId;
        }
      } catch (err) {
        strapi.log.debug('[magic-sessionmanager] Error checking active sessions:', err.message);
        // On error, allow request to continue (fail-open for availability)
      }
    }

    // Process request
    await next();

    // AFTER response: Update activity timestamps if user is authenticated
    const userDocId = ctx.state.userDocumentId || ctx.state.user?.documentId;
    if (userDocId) {
      try {
        // Extract JWT token from Authorization header
        const authHeader = ctx.request.headers.authorization;
        const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

        // Call touch with rate limiting - uses tokenHash to find session
        await sessionService.touch({
          userId: userDocId,
          token, // Session service will hash this to find the matching session
        });
      } catch (err) {
        strapi.log.debug('[magic-sessionmanager] Error updating lastSeen:', err.message);
      }
    }
  };
};
