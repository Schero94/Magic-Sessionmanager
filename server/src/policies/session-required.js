'use strict';

/**
 * Session Required Policy
 *
 * Enforces that an authenticated request is tied to a valid, non-terminated
 * session. The check is based on the JWT's tokenHash (NOT "any active session
 * for the user") so manual session termination is always enforced.
 *
 * In `strictSessionEnforcement` mode, the request is rejected if no session
 * matches the token hash. In non-strict mode, the request is allowed but a
 * warning is logged.
 *
 * Reactivation is intentionally NOT done here to avoid race conditions;
 * the JWT verify wrapper handles reactivation atomically.
 */

const SESSION_UID = 'plugin::magic-sessionmanager.session';
const { errors } = require('@strapi/utils');
const { resolveUserDocumentId } = require('../utils/resolve-user');
const { getPluginSettings } = require('../utils/settings-loader');
const { extractBearerToken } = require('../utils/extract-token');
const { hashToken } = require('../utils/encryption');

module.exports = async (policyContext, _policyConfig, { strapi }) => {
  if (!policyContext.state.user) {
    return true;
  }

  const user = policyContext.state.user;

  try {
    let userDocId = user.documentId;

    if (!userDocId && user.id) {
      userDocId = await resolveUserDocumentId(strapi, user.id);
    }

    if (!userDocId) {
      return true;
    }

    const settings = await getPluginSettings(strapi);
    const strictMode = settings.strictSessionEnforcement === true;

    const token = extractBearerToken(policyContext);
    const tokenHashValue = token ? hashToken(token) : null;

    if (!tokenHashValue) {
      if (strictMode) {
        strapi.log.info(`[magic-sessionmanager] [POLICY-BLOCKED] No bearer token (user: ${userDocId.substring(0, 8)}..., strictMode)`);
        throw new errors.UnauthorizedError('No valid session. Please login again.');
      }
      return true;
    }

    const thisSession = await strapi.documents(SESSION_UID).findFirst({
      filters: { user: { documentId: userDocId }, tokenHash: tokenHashValue },
      fields: ['documentId', 'isActive', 'terminatedManually'],
    });

    if (thisSession) {
      if (thisSession.terminatedManually === true) {
        strapi.log.info(`[magic-sessionmanager] [POLICY-BLOCKED] Session was manually terminated (user: ${userDocId.substring(0, 8)}...)`);
        throw new errors.UnauthorizedError('Session terminated. Please login again.');
      }
      return true;
    }

    if (strictMode) {
      strapi.log.info(`[magic-sessionmanager] [POLICY-BLOCKED] No session matches this token (user: ${userDocId.substring(0, 8)}..., strictMode)`);
      throw new errors.UnauthorizedError('No valid session. Please login again.');
    }

    strapi.log.warn(`[magic-sessionmanager] [POLICY-WARN] No session for token (user: ${userDocId.substring(0, 8)}...) - allowing in non-strict mode`);
    return true;

  } catch (err) {
    if (err instanceof errors.UnauthorizedError) {
      throw err;
    }

    strapi.log.debug('[magic-sessionmanager] Session policy check error:', err.message);
    return true;
  }
};
