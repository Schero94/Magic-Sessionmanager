'use strict';

/**
 * Session Required Policy
 * 
 * This policy checks if the authenticated user has an active session.
 * If not, the request is rejected even if the JWT is valid.
 * 
 * Usage: Apply this policy globally or per-route to enforce session validation.
 */

const SESSION_UID = 'plugin::magic-sessionmanager.session';
const { errors } = require('@strapi/utils');

module.exports = async (policyContext, config, { strapi }) => {
  // If no user is authenticated, let the normal auth flow handle it
  if (!policyContext.state.user) {
    return true;
  }

  const user = policyContext.state.user;

  try {
    // Get user documentId (support both numeric id and documentId)
    let userDocId = user.documentId;

    if (!userDocId && user.id) {
      // Fetch documentId from DB if not available
      const fullUser = await strapi.entityService.findOne(
        'plugin::users-permissions.user',
        user.id,
        { fields: ['documentId'] }
      );
      userDocId = fullUser?.documentId;
    }

    if (!userDocId) {
      // Can't verify session without user ID - allow through
      return true;
    }

    // Check if user has ANY active session
    const activeSessions = await strapi.documents(SESSION_UID).findMany({
      filters: {
        user: { documentId: userDocId },
        isActive: true,
      },
      limit: 1,
    });

    // If NO active sessions, reject the request
    if (!activeSessions || activeSessions.length === 0) {
      strapi.log.info(
        `[magic-sessionmanager] [POLICY-BLOCKED] JWT valid but no active session (user: ${userDocId.substring(0, 8)}...)`
      );
      
      throw new errors.UnauthorizedError('Session terminated. Please login again.');
    }

    // Session exists - allow through
    return true;

  } catch (err) {
    // If it's our own UnauthorizedError, rethrow it
    if (err instanceof errors.UnauthorizedError) {
      throw err;
    }
    
    strapi.log.debug('[magic-sessionmanager] Session policy check error:', err.message);
    // On other errors, allow request through (fail-open for availability)
    return true;
  }
};
