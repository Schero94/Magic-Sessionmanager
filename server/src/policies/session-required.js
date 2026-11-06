'use strict';

/**
 * Session Required Policy (opt-in)
 *
 * No plugin route attaches this policy: session revocation is enforced for
 * every Users & Permissions request by the JWT verify wrapper registered in
 * bootstrap.js. The policy is exported for projects that want an explicit,
 * per-route check on their own Content API routes, for example:
 *
 *   config: { policies: ['plugin::magic-sessionmanager.session-required'] }
 *
 * It applies the same matching rules as the JWT wrapper:
 *   - legacy JWT management: the bearer token hash must match a session row;
 *   - refresh (native) JWT management: the session row must match both the
 *     bearer token hash and the native session id verified by Strapi
 *     (`ctx.state.session.id` / `ctx.state.auth.credentials.sessionId`).
 *
 * In `strictSessionEnforcement` mode the request is rejected when the
 * identity, the token or the session cannot be verified, and when the
 * settings or the session lookup fail. In relaxed mode those cases are
 * allowed (with a warning) for compatibility. A matching inactive session is
 * rejected in both modes.
 *
 * Reactivation is intentionally NOT done here to avoid race conditions;
 * the JWT verify wrapper handles reactivation atomically.
 */

const SESSION_UID = 'plugin::magic-sessionmanager.session';
// Avoid destructuring `@strapi/utils` at require time — pack-up's
// rollup-commonjs plugin rewrites the import in a way that resolves to
// undefined at runtime for dual ESM/CJS packages. Direct property access
// after a plain require() sidesteps the rewrite.
const errors = require('@strapi/utils').errors;
const { resolveUserDocumentId } = require('../utils/resolve-user');
const { getPluginSettings } = require('../utils/settings-loader');
const { extractBearerToken } = require('../utils/extract-token');
const { hashToken } = require('../utils/encryption');

const JWT_MANAGEMENT_CONFIG = 'plugin::users-permissions.jwtManagement';

/**
 * Returns the native session id Strapi verified for this request in refresh
 * mode. Caller-supplied values are never read.
 *
 * @param {object} policyContext Strapi policy context
 * @returns {string|null} Verified native session id
 */
function getVerifiedNativeSessionId(policyContext) {
  const value =
    policyContext?.state?.session?.id ?? policyContext?.state?.auth?.credentials?.sessionId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

module.exports = async (policyContext, _policyConfig, { strapi }) => {
  if (!policyContext.state.user) {
    return true;
  }

  const user = policyContext.state.user;
  // If settings cannot be read, do not silently disable enforcement.
  let strictMode = true;

  try {
    const settings = await getPluginSettings(strapi);
    strictMode = settings.strictSessionEnforcement === true;
    let userDocId = user.documentId;

    if (!userDocId && user.id) {
      userDocId = await resolveUserDocumentId(strapi, user.id);
    }

    if (!userDocId) {
      if (strictMode) {
        throw new errors.UnauthorizedError('No valid session. Please login again.');
      }
      return true;
    }

    const token = extractBearerToken(policyContext);
    const tokenHashValue = token ? hashToken(token) : null;

    if (!tokenHashValue) {
      if (strictMode) {
        strapi.log.info('[magic-sessionmanager] [POLICY-BLOCKED] No bearer token (strictMode)');
        throw new errors.UnauthorizedError('No valid session. Please login again.');
      }
      return true;
    }

    const nativeMode = strapi.config?.get?.(JWT_MANAGEMENT_CONFIG, 'legacy-support') === 'refresh';
    const nativeSessionId = nativeMode ? getVerifiedNativeSessionId(policyContext) : null;
    if (nativeMode && !nativeSessionId) {
      if (strictMode) {
        strapi.log.info('[magic-sessionmanager] [POLICY-BLOCKED] No verified native session (strictMode)');
        throw new errors.UnauthorizedError('No valid session. Please login again.');
      }
      return true;
    }

    const thisSession = await strapi.documents(SESSION_UID).findFirst({
      filters: {
        user: { documentId: userDocId },
        tokenHash: tokenHashValue,
        ...(nativeSessionId ? { nativeSessionId } : {}),
      },
      fields: ['documentId', 'isActive', 'terminatedManually', 'terminationReason'],
    });

    if (thisSession) {
      if (thisSession.isActive === false || thisSession.terminatedManually === true) {
        const reason =
          thisSession.terminationReason ||
          (thisSession.terminatedManually === true ? 'manual' : 'inactive');
        strapi.log.info(`[magic-sessionmanager] [POLICY-BLOCKED] Session inactive (reason: ${reason})`);
        throw new errors.UnauthorizedError('Session terminated. Please login again.');
      }
      return true;
    }

    if (strictMode) {
      strapi.log.info('[magic-sessionmanager] [POLICY-BLOCKED] No session matches this token (strictMode)');
      throw new errors.UnauthorizedError('No valid session. Please login again.');
    }

    strapi.log.warn('[magic-sessionmanager] [POLICY-WARN] No session for token; allowing in non-strict mode');
    return true;

  } catch (err) {
    if (err instanceof errors.UnauthorizedError) {
      throw err;
    }

    strapi.log.debug('[magic-sessionmanager] Session policy check error:', err?.name || 'Error');
    if (strictMode) {
      throw new errors.UnauthorizedError('No valid session. Please login again.');
    }
    return true;
  }
};
