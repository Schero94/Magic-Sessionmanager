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
 */

const SESSION_UID = 'plugin::magic-sessionmanager.session';
const { decryptToken } = require('../utils/encryption');

module.exports = ({ strapi, sessionService }) => {
  return async (ctx, next) => {
    // BEFORE processing request: Validate the SPECIFIC session is still active
    // Strapi v5: Use documentId instead of numeric id for Document Service API
    if (ctx.state.user && ctx.state.user.documentId) {
      try {
        const userId = ctx.state.user.documentId;
        const currentToken = ctx.request.headers.authorization?.replace('Bearer ', '');
        
        if (!currentToken) {
          // No token provided, let Strapi handle auth
          await next();
          return;
        }
        
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
        let matchingSession = null;
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

        // Store the matching session ID for later use (touch, etc.)
        ctx.state.sessionId = matchingSession.documentId;
        ctx.state.currentSession = matchingSession;
        
      } catch (err) {
        strapi.log.debug('[magic-sessionmanager] Error checking session:', err.message);
        // On error, allow request to continue (fail-open for availability)
      }
    }

    // Process request
    await next();

    // AFTER response: Update activity timestamps if user is authenticated
    if (ctx.state.user && ctx.state.user.documentId && ctx.state.sessionId) {
      try {
        // Call touch with rate limiting using the validated session ID
        await sessionService.touch({
          userId: ctx.state.user.documentId,
          sessionId: ctx.state.sessionId,
        });
      } catch (err) {
        strapi.log.debug('[magic-sessionmanager] Error updating lastSeen:', err.message);
      }
    }
  };
};
