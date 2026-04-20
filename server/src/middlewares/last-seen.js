'use strict';

/**
 * lastSeen Middleware
 *
 * Runs on every authenticated request. Responsibilities:
 *   1. Validates that the user's JWT corresponds to a still-valid session
 *      (the JWT-verify wrapper is the primary line of defense; this is a
 *      safety net for code paths that bypass the wrapper).
 *   2. In strict mode, blocks requests when no session exists AND the JWT
 *      is not inside the post-login grace window.
 *   3. Updates `lastActive` on the matching session (rate-limited,
 *      coalesced by the service).
 *
 * Reactivation is intentionally handled by the JWT verify wrapper (which
 * can atomically reactivate based on tokenHash). This middleware NEVER
 * reactivates sessions without tokenHash match to avoid the
 * "concurrent-reactivates-multiple-sessions" race.
 */

const { resolveUserDocumentId } = require('../utils/resolve-user');
const { getPluginSettings } = require('../utils/settings-loader');
const { extractBearerToken } = require('../utils/extract-token');
const { hashToken } = require('../utils/encryption');

const SESSION_UID = 'plugin::magic-sessionmanager.session';

/**
 * Path prefixes that should NOT be session-checked. Uses startsWith (not
 * includes) to prevent bypass via crafted paths like `/api/articles/my-login`.
 */
const AUTH_PATH_PREFIXES = [
  '/api/auth/',
  '/api/magic-link/',
  '/api/passwordless/',
  '/api/otp/',
  '/api/forgot-password',
  '/api/reset-password',
  '/api/register',
  '/admin/',
];

/**
 * @param {string} path
 * @returns {boolean}
 */
function isAuthEndpoint(path) {
  if (!path) return false;
  return AUTH_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Creates the last-seen Koa middleware.
 *
 * @param {{strapi: object, sessionService: object}} deps
 * @returns {import('koa').Middleware}
 */
module.exports = ({ strapi, sessionService }) => {
  return async (ctx, next) => {
    if (isAuthEndpoint(ctx.path)) {
      return next();
    }

    if (!ctx.state.user) {
      return next();
    }

    let userDocId = ctx.state.user.documentId;
    if (!userDocId && ctx.state.user.id) {
      try {
        userDocId = await resolveUserDocumentId(strapi, ctx.state.user.id);
      } catch (err) {
        strapi.log.debug('[magic-sessionmanager] user doc-id lookup failed:', err.message);
        return next();
      }
    }

    if (!userDocId) {
      return next();
    }

    const settings = await getPluginSettings(strapi).catch(() => ({}));
    const strictMode = settings.strictSessionEnforcement === true;
    const gracePeriodMs = Math.max(0, Number(settings.sessionCreationGraceMs) || 5000);

    const token = extractBearerToken(ctx);
    const tokenHashValue = token ? hashToken(token) : null;

    let thisSession = null;
    if (tokenHashValue) {
      try {
        thisSession = await strapi.documents(SESSION_UID).findFirst({
          filters: { user: { documentId: userDocId }, tokenHash: tokenHashValue },
          fields: ['documentId', 'isActive', 'terminatedManually', 'terminationReason'],
        });
      } catch (err) {
        strapi.log.debug('[magic-sessionmanager] session lookup failed:', err.message);
      }
    }

    if (thisSession) {
      // Terminated sessions are already rejected by the JWT-verify wrapper
      // via the rejection cache. This branch only runs when that wrapper
      // is somehow bypassed or the session was terminated between its
      // check and now.
      if (thisSession.isActive === false) {
        return ctx.unauthorized('Session terminated. Please login again.');
      }

      ctx.state.userDocumentId = userDocId;
      ctx.state.__magicSessionId = thisSession.documentId;

      await next();

      try {
        await sessionService.touch({
          userId: userDocId,
          sessionId: thisSession.documentId,
        });
      } catch (err) {
        strapi.log.debug('[magic-sessionmanager] Error updating lastSeen:', err.message);
      }
      return;
    }

    // No session record. If strict mode is on, reject immediately —
    // unless the JWT is inside the post-login grace window (the session
    // create-write may not be visible yet).
    if (strictMode) {
      const iat = ctx.state.user?.iat;
      if (gracePeriodMs > 0 && typeof iat === 'number') {
        const ageMs = Date.now() - iat * 1000;
        if (ageMs >= 0 && ageMs < gracePeriodMs) {
          ctx.state.userDocumentId = userDocId;
          return next();
        }
      }
      strapi.log.info(
        `[magic-sessionmanager] [BLOCKED] No session matches this token (user: ${userDocId.substring(0, 8)}..., strictMode)`
      );
      return ctx.unauthorized('No valid session. Please login again.');
    }

    strapi.log.debug(
      `[magic-sessionmanager] [WARN] No session for token (user: ${userDocId.substring(0, 8)}...) - allowing in non-strict mode`
    );
    ctx.state.userDocumentId = userDocId;
    return next();
  };
};
