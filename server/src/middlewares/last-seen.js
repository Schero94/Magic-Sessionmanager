'use strict';

/**
 * lastSeen Middleware
 *
 * Runs after each ordinary request and updates `lastActive` on the exact
 * authenticated session when the response succeeded. Session validation,
 * inactivity enforcement and legacy reactivation live in the wrapped
 * users-permissions JWT verifier, where they run after Strapi authenticates
 * the token and before the controller is allowed to execute.
 */

const { resolveUserDocumentId } = require('../utils/resolve-user');
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

const SELF_TERMINATING_PATHS = new Set([
  '/api/magic-sessionmanager/logout',
  '/api/magic-sessionmanager/logout-all',
]);

/**
 * @param {string} path
 * @returns {boolean}
 */
function isAuthEndpoint(path) {
  if (!path) return false;
  return AUTH_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isSelfTerminatingEndpoint(path) {
  return SELF_TERMINATING_PATHS.has(path);
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

    // Strapi authenticates inside the matched route. Global middleware runs
    // before that route, so ctx.state.user only becomes available after next().
    await next();

    if (isSelfTerminatingEndpoint(ctx.path) || (ctx.status || 200) >= 400) {
      return;
    }

    if (!ctx.state.user) {
      return;
    }

    let userDocId = ctx.state.user.documentId;
    if (!userDocId && ctx.state.user.id) {
      try {
        userDocId = await resolveUserDocumentId(strapi, ctx.state.user.id);
      } catch (err) {
        strapi.log.debug('[magic-sessionmanager] user doc-id lookup failed:', err.message);
        return;
      }
    }

    if (!userDocId) {
      return;
    }

    const token = extractBearerToken(ctx);
    const tokenHashValue = token ? hashToken(token) : null;

    if (!tokenHashValue) {
      return;
    }

    let thisSession = null;
    try {
      thisSession = await strapi.documents(SESSION_UID).findFirst({
        filters: { user: { documentId: userDocId }, tokenHash: tokenHashValue },
        fields: ['documentId', 'isActive'],
      });
    } catch (err) {
      strapi.log.debug('[magic-sessionmanager] session lookup failed:', err.message);
      return;
    }

    if (!thisSession || thisSession.isActive !== true) return;

    ctx.state.userDocumentId = userDocId;
    ctx.state.__magicSessionId = thisSession.documentId;

    try {
      await sessionService.touch({
        userId: userDocId,
        sessionId: thisSession.documentId,
      });
    } catch (err) {
      strapi.log.debug('[magic-sessionmanager] Error updating lastSeen:', err.message);
    }
  };
};
