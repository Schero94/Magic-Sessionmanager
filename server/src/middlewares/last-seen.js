'use strict';

/**
 * lastSeen Middleware
 * Validates that the SPECIFIC session (by JWT token) is still active
 * Updates session lastActive on each authenticated request
 * Rate-limited to prevent DB write noise (default: 30 seconds)
 * 
 * SECURITY: This middleware ensures terminated sessions are immediately blocked,
 * even though JWT tokens are stateless and cannot be invalidated directly.
 * 
 * [SUCCESS] Migrated to strapi.documents() API (Strapi v5 Best Practice)
 * [FIX] Now updates activity on ALL requests with valid JWT, not just when ctx.state.user is set
 */

const SESSION_UID = 'plugin::magic-sessionmanager.session';
const { decryptToken } = require('../utils/encryption');

// In-memory cache for rate limiting (per session)
const lastTouchCache = new Map();

module.exports = ({ strapi, sessionService }) => {
  return async (ctx, next) => {
    // Get JWT token from Authorization header
    const currentToken = ctx.request.headers.authorization?.replace('Bearer ', '');
    
    // Skip if no token provided
    if (!currentToken) {
      await next();
      return;
    }
    
    // Skip internal/admin routes that don't need session tracking
    const skipPaths = ['/admin', '/_health', '/favicon.ico'];
    if (skipPaths.some(p => ctx.path.startsWith(p))) {
      await next();
      return;
    }

    let matchingSession = null;
    let userId = null;

    // BEFORE processing request: Validate the SPECIFIC session is still active
    try {
      // Try to get userId from ctx.state.user first (if already authenticated)
      if (ctx.state.user && ctx.state.user.documentId) {
        userId = ctx.state.user.documentId;
        
        // Get all active sessions for this user
        const activeSessions = await strapi.documents(SESSION_UID).findMany({
          filters: {
            user: { documentId: userId },
            isActive: true,
          },
        });

        // If user has NO active sessions at all, reject immediately
        if (!activeSessions || activeSessions.length === 0) {
          strapi.log.info(`[magic-sessionmanager] [BLOCKED] User ${userId} has no active sessions`);
          return ctx.unauthorized('All sessions have been terminated. Please login again.');
        }

        // Find the session that matches this specific JWT token
        for (const session of activeSessions) {
          if (!session.token) continue;
          try {
            const decrypted = decryptToken(session.token);
            if (decrypted === currentToken) {
              matchingSession = session;
              break;
            }
          } catch (err) {
            // Ignore decryption errors, continue checking other sessions
          }
        }

        // If THIS specific session is not found or not active -> BLOCK!
        if (!matchingSession) {
          strapi.log.info(`[magic-sessionmanager] [BLOCKED] Session for user ${userId} has been terminated`);
          return ctx.unauthorized('This session has been terminated. Please login again.');
        }
      } else {
        // User not yet authenticated by Strapi - find session directly by token
        // This handles cases where JWT is valid but ctx.state.user isn't set yet
        const allActiveSessions = await strapi.documents(SESSION_UID).findMany({
          filters: { isActive: true },
          populate: { user: { fields: ['documentId'] } },
          limit: 500, // Reasonable limit for performance
        });

        for (const session of allActiveSessions) {
          if (!session.token) continue;
          try {
            const decrypted = decryptToken(session.token);
            if (decrypted === currentToken) {
              matchingSession = session;
              userId = session.user?.documentId;
              break;
            }
          } catch (err) {
            // Ignore decryption errors
          }
        }
      }

      // Store the matching session for later use
      if (matchingSession) {
        ctx.state.sessionId = matchingSession.documentId;
        ctx.state.currentSession = matchingSession;
      }
        
    } catch (err) {
      strapi.log.debug('[magic-sessionmanager] Error checking session:', err.message);
      // On error, allow request to continue (fail-open for availability)
    }

    // Process request
    await next();

    // AFTER response: Update activity timestamps if we found a valid session
    if (matchingSession) {
      try {
        // Rate limiting: Check in-memory cache first (faster than DB)
        const config = strapi.config.get('plugin::magic-sessionmanager') || {};
        const rateLimit = config.lastSeenRateLimit || 30000; // 30 seconds default
        const now = Date.now();
        const lastTouch = lastTouchCache.get(matchingSession.documentId) || 0;
        
        if (now - lastTouch > rateLimit) {
          // Update cache
          lastTouchCache.set(matchingSession.documentId, now);
          
          // Update database
          await strapi.documents(SESSION_UID).update({
            documentId: matchingSession.documentId,
            data: { lastActive: new Date() },
          });
          
          strapi.log.debug(`[magic-sessionmanager] [TOUCH] Session ${matchingSession.documentId} activity updated`);
        }
      } catch (err) {
        strapi.log.debug('[magic-sessionmanager] Error updating lastSeen:', err.message);
      }
    }
  };
};
