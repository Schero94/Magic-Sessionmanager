'use strict';

/**
 * lastSeen Middleware
 *
 * Runs on every authenticated request. Responsibilities:
 *   1. Validates that the user's JWT corresponds to an ACTIVE session
 *      (the JWT verify wrapper does most of the work; this is a safety net).
 *   2. In strict mode, blocks requests when no session exists.
 *   3. Updates `lastActive` on the matching session (rate-limited).
 *
 * Reactivation is intentionally handled by the JWT verify wrapper (which can
 * atomically reactivate based on tokenHash). This middleware NEVER reactivates
 * sessions without tokenHash match to avoid the "concurrent-reactivates-
 * multiple-sessions" race condition.
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
 * Returns true if the given path should skip session enforcement.
 * Session/auth endpoints bootstrap sessions themselves and cannot depend on
 * their existence.
 *
 * @param {string} path
 * @returns {boolean}
 */
function isAuthEndpoint(path) {
  if (!path) return false;
  return AUTH_PATH_PREFIXES.some(prefix => path.startsWith(prefix));
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
      await next();
      return;
    }

    if (ctx.state.user) {
      try {
        let userDocId = ctx.state.user.documentId;

        if (!userDocId && ctx.state.user.id) {
          userDocId = await resolveUserDocumentId(strapi, ctx.state.user.id);
        }

        if (userDocId) {
          const settings = await getPluginSettings(strapi);
          const strictMode = settings.strictSessionEnforcement === true;

          const token = extractBearerToken(ctx);
          const tokenHashValue = token ? hashToken(token) : null;

          const thisSession = tokenHashValue
            ? await strapi.documents(SESSION_UID).findFirst({
                filters: { user: { documentId: userDocId }, tokenHash: tokenHashValue },
                fields: ['documentId', 'isActive', 'terminatedManually'],
              })
            : null;

          if (thisSession) {
            if (thisSession.terminatedManually === true) {
              strapi.log.info(`[magic-sessionmanager] [BLOCKED] Session was manually terminated (user: ${userDocId.substring(0, 8)}...)`);
              return ctx.unauthorized('Session terminated. Please login again.');
            }
            ctx.state.userDocumentId = userDocId;
            ctx.state.__magicSessionId = thisSession.documentId;
            await next();

            if (thisSession.isActive) {
              try {
                await sessionService.touch({
                  userId: userDocId,
                  sessionId: thisSession.documentId,
                });
              } catch (err) {
                strapi.log.debug('[magic-sessionmanager] Error updating lastSeen:', err.message);
              }
            }
            return;
          }

          if (strictMode) {
            strapi.log.info(`[magic-sessionmanager] [BLOCKED] No session matches this token (user: ${userDocId.substring(0, 8)}..., strictMode)`);
            return ctx.unauthorized('No valid session. Please login again.');
          }

          strapi.log.warn(`[magic-sessionmanager] [WARN] No session for token (user: ${userDocId.substring(0, 8)}...) - allowing in non-strict mode`);
          ctx.state.userDocumentId = userDocId;
        }
      } catch (err) {
        strapi.log.debug('[magic-sessionmanager] Error checking active sessions:', err.message);
      }
    }

    await next();

    const userDocId = ctx.state.userDocumentId || ctx.state.user?.documentId;
    const sessionId = ctx.state.__magicSessionId;
    if (userDocId && sessionId) {
      try {
        await sessionService.touch({ userId: userDocId, sessionId });
      } catch (err) {
        strapi.log.debug('[magic-sessionmanager] Error updating lastSeen:', err.message);
      }
    }
  };
};
