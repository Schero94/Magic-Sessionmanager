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

// Cache cleanup settings
const CACHE_MAX_SIZE = 10000; // Max entries before cleanup
const CACHE_CLEANUP_AGE = 60 * 60 * 1000; // Remove entries older than 1 hour

/**
 * Periodically clean up old cache entries to prevent memory leaks
 * Called lazily when cache grows too large
 */
function cleanupOldCacheEntries() {
  if (lastTouchCache.size < CACHE_MAX_SIZE) return;
  
  const now = Date.now();
  const cutoff = now - CACHE_CLEANUP_AGE;
  
  for (const [key, timestamp] of lastTouchCache.entries()) {
    if (timestamp < cutoff) {
      lastTouchCache.delete(key);
    }
  }
}

module.exports = ({ strapi }) => {
  return async (ctx, next) => {
    // Get JWT token from Authorization header
    const currentToken = ctx.request.headers.authorization?.replace('Bearer ', '');
    
    // Skip if no token provided
    if (!currentToken) {
      await next();
      return;
    }
    
    // Skip routes that don't need session validation
    const skipPaths = [
      '/admin',           // Admin panel routes (have their own auth)
      '/_health',         // Health check
      '/favicon.ico',     // Static assets
      '/api/auth/local',  // Login endpoint
      '/api/auth/register', // Registration endpoint
      '/api/auth/forgot-password', // Password reset
      '/api/auth/reset-password',  // Password reset
      '/api/auth/logout', // Logout endpoint (handled separately)
      '/api/auth/refresh', // Refresh token (has own validation in bootstrap.js)
      '/api/connect',     // OAuth providers
      '/api/magic-link',  // Magic link auth (if using magic-link plugin)
    ];
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
        // Token exists but no active session found
        // CRITICAL: We have a valid-looking JWT token but NO active session
        // This means the session was terminated - MUST block the request!
        // 
        // Note: We cannot rely on ctx.state.user here because Strapi's JWT
        // middleware runs AFTER our plugin middleware. So ctx.state.user
        // is not yet set at this point.
        //
        // Since we have a Bearer token but no matching active session,
        // this is definitely a terminated session - block it!
        strapi.log.info(`[magic-sessionmanager] [BLOCKED] Request blocked - session terminated or invalid (token hash: ${currentTokenHash.substring(0, 8)}...)`);
        return ctx.unauthorized('This session has been terminated. Please login again.');
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
          
          // Lazy cleanup: Remove old entries if cache grows too large
          cleanupOldCacheEntries();
          
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
