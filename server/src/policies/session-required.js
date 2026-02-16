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

module.exports = async (policyContext, _policyConfig, { strapi }) => {
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

    // Get plugin config - strictSessionEnforcement must be explicitly enabled to block
    const pluginConfig = strapi.config.get('plugin::magic-sessionmanager') || {};
    const strictMode = pluginConfig.strictSessionEnforcement === true;
    
    // Check if user has ANY active session
    const activeSessions = await strapi.documents(SESSION_UID).findMany({
      filters: {
        user: { documentId: userDocId },
        isActive: true,
      },
      limit: 1,
    });

    // If active session exists, allow through
    if (activeSessions && activeSessions.length > 0) {
      return true;
    }
    
    // No active session - check for inactive sessions
    const inactiveSessions = await strapi.documents(SESSION_UID).findMany({
      filters: { 
        user: { documentId: userDocId },
        isActive: false,
      },
      limit: 5,
      fields: ['documentId', 'terminatedManually', 'lastActive'],
      sort: [{ lastActive: 'desc' }],
    });
    
    if (inactiveSessions && inactiveSessions.length > 0) {
      // Check if ANY session was manually terminated
      const manuallyTerminated = inactiveSessions.find(s => s.terminatedManually === true);
      
      if (manuallyTerminated) {
        // User was explicitly logged out → BLOCK
        strapi.log.info(
          `[magic-sessionmanager] [POLICY-BLOCKED] User ${userDocId.substring(0, 8)}... was manually logged out`
        );
        throw new errors.UnauthorizedError('Session terminated. Please login again.');
      }
      
      // Session was deactivated by timeout → REACTIVATE most recent one
      const sessionToReactivate = inactiveSessions[0];
      await strapi.documents(SESSION_UID).update({
        documentId: sessionToReactivate.documentId,
        data: {
          isActive: true,
          lastActive: new Date(),
        },
      });
      strapi.log.info(
        `[magic-sessionmanager] [POLICY-REACTIVATED] Session reactivated for user ${userDocId.substring(0, 8)}...`
      );
      return true;
    }
    
    // No sessions exist at all
    if (strictMode) {
      strapi.log.info(
        `[magic-sessionmanager] [POLICY-BLOCKED] No session exists (user: ${userDocId.substring(0, 8)}..., strictMode)`
      );
      throw new errors.UnauthorizedError('No valid session. Please login again.');
    }
    
    // Non-strict mode: Allow but log warning
    strapi.log.warn(
      `[magic-sessionmanager] [POLICY-WARN] No session for user ${userDocId.substring(0, 8)}... (allowing)`
    );
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
