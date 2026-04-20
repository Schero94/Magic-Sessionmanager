'use strict';

/**
 * Decorates 401 responses with a structured hint so the client can tell
 * *why* the session was rejected.
 *
 * Runs on every request, after `next()`. When the response status is 401
 * AND the request's JWT hash has a rejection reason cached by the
 * JWT-verify wrapper, it:
 *   - sets `X-Session-Terminated-Reason: <reason>`
 *   - merges `{ reason }` into the existing Strapi error envelope
 *     (or wraps a string body into one) so frontend code can read it
 *     from `error.details.reason` without parsing headers.
 *
 * The reason is consumed from the cache so it cannot leak across
 * subsequent requests with the same token hash.
 */

const { extractBearerToken } = require('../utils/extract-token');
const { hashToken } = require('../utils/encryption');
const { consumeSessionRejectionReason } = require('../utils/rejection-cache');

const HEADER = 'X-Session-Terminated-Reason';

/**
 * Human-readable translation table for rejection reasons. Kept in sync
 * with the enum values on the Session content type.
 */
const REASON_MESSAGES = {
  manual: 'Your session was terminated. Please log in again.',
  idle: 'Your session expired due to inactivity. Please log in again.',
  expired: 'Your session has reached its maximum age. Please log in again.',
  blocked: 'Your account has been blocked. Contact support.',
};

/**
 * @param {object} _config
 * @param {{strapi: object}} _deps
 * @returns {import('koa').Middleware}
 */
const middleware = () => async (ctx, next) => {
  await next();

  // Only relevant for unauthorized responses.
  if (ctx.status !== 401) return;

  // Best-effort: if no token was presented, there is nothing to match.
  const token = extractBearerToken(ctx);
  if (!token) return;

  const reason = consumeSessionRejectionReason(hashToken(token));
  if (!reason) return;

  ctx.set(HEADER, reason);

  // Merge into the existing Strapi error envelope if present, otherwise
  // build one. Never overwrite an existing `reason` — the JWT-verify
  // wrapper's reason is authoritative but the controller may have
  // already added more specific context.
  const existing = ctx.body;
  const friendlyMessage = REASON_MESSAGES[reason] || 'Session invalid. Please log in again.';

  if (existing && typeof existing === 'object' && existing.error) {
    existing.error.details = existing.error.details || {};
    if (!existing.error.details.reason) {
      existing.error.details.reason = reason;
    }
    if (!existing.error.message || existing.error.message === 'Unauthorized') {
      existing.error.message = friendlyMessage;
    }
    return;
  }

  ctx.body = {
    data: null,
    error: {
      status: 401,
      name: 'UnauthorizedError',
      message: friendlyMessage,
      details: { reason },
    },
  };
};

module.exports = middleware;
