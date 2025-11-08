'use strict';

/**
 * lastSeen Middleware
 * Updates user lastSeen and session lastActive on each authenticated request
 * Rate-limited to prevent DB write noise (default: 30 seconds)
 */
module.exports = ({ strapi, sessionService }) => {
  return async (ctx, next) => {
    // BEFORE processing request: Check if user's sessions are active
    if (ctx.state.user && ctx.state.user.id) {
      try {
        const userId = ctx.state.user.id;
        
        // Check if user has ANY active sessions
        const activeSessions = await strapi.entityService.findMany('api::session.session', {
          filters: {
            user: { id: userId },
            isActive: true,
          },
          limit: 1,
        });

        // If user has NO active sessions, reject the request
        if (!activeSessions || activeSessions.length === 0) {
          strapi.log.info(`[magic-sessionmanager] 🚫 Blocked request - User ${userId} has no active sessions`);
          return ctx.unauthorized('All sessions have been terminated. Please login again.');
        }
      } catch (err) {
        strapi.log.debug('[magic-sessionmanager] Error checking active sessions:', err.message);
        // On error, allow request to continue (fail-open for availability)
      }
    }

    // Process request
    await next();

    // AFTER response: Update activity timestamps if user is authenticated
    if (ctx.state.user && ctx.state.user.id) {
      try {
        const userId = ctx.state.user.id;

        // Try to find or extract sessionId from context
        const sessionId = ctx.state.sessionId;

        // Call touch with rate limiting
        await sessionService.touch({
          userId,
          sessionId,
        });
      } catch (err) {
        strapi.log.debug('[magic-sessionmanager] Error updating lastSeen:', err.message);
      }
    }
  };
};
