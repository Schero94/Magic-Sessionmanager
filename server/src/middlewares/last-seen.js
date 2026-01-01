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
 * [OPTIMIZED] Uses tokenHash for O(1) session lookup instead of decrypting all tokens
 */

const SESSION_UID = 'plugin::magic-sessionmanager.session';
const { hashToken } = require('../utils/encryption');

// In-memory cache for rate limiting (per session documentId)
const lastTouchCache = new Map();

module.exports = ({ strapi }) => {
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

    // BEFORE processing request: Validate the SPECIFIC session is still active
    try {
      // Generate hash of current token for O(1) lookup
      const currentTokenHash = hashToken(currentToken);
      
      // Find session by tokenHash - O(1) DB lookup instead of O(n) decrypt loop!
      matchingSession = await strapi.documents(SESSION_UID).findFirst({
        filters: {
          tokenHash: currentTokenHash,
          isActive: true,
        },
        populate: { user: { fields: ['documentId'] } },
      });

      if (matchingSession) {
        // Store session info for use in request handlers
        ctx.state.sessionId = matchingSession.documentId;
        ctx.state.currentSession = matchingSession;
        
        // Also set userId if available
        if (matchingSession.user?.documentId) {
          ctx.state.sessionUserId = matchingSession.user.documentId;
        }
      } else {
        // Token exists but no active session found - check if user is authenticated
        // Only block if we know this is an authenticated request
        if (ctx.state.user && ctx.state.user.documentId) {
          strapi.log.info(`[magic-sessionmanager] [BLOCKED] Session terminated for user ${ctx.state.user.documentId}`);
          return ctx.unauthorized('This session has been terminated. Please login again.');
        }
        // If ctx.state.user not set, this might be a public route or JWT validation hasn't run yet
        // Let the request continue - Strapi's auth will handle it
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
