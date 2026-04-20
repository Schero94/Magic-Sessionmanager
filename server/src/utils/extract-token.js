'use strict';

// JWT size bounds. A minimal 3-segment JWT with no custom claims is ~100 chars,
// and modern JWTs carrying user-context payloads (e.g. magic-link context)
// frequently exceed 4 KB. We allow up to 8 KB to avoid false negatives while
// still rejecting obviously oversized headers that could indicate abuse.
const MIN_TOKEN_LENGTH = 40;
const MAX_TOKEN_LENGTH = 8192;

/**
 * Extracts a Bearer token from a Koa context, handling case-insensitive scheme
 * and both `ctx.request.headers` and `ctx.request.header` accessors.
 *
 * @param {object} ctx - Koa context
 * @returns {string|null} The raw JWT token, or null if absent/malformed
 */
function extractBearerToken(ctx) {
  const headers = ctx?.request?.headers || ctx?.request?.header || {};
  const raw = headers.authorization || headers.Authorization;
  if (!raw || typeof raw !== 'string') return null;

  const match = raw.match(/^\s*Bearer\s+(\S+)\s*$/i);
  if (!match) return null;

  const token = match[1];
  if (!token || token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) return null;

  return token;
}

module.exports = { extractBearerToken };
