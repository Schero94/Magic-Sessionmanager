'use strict';

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
  if (!token || token.length < 10 || token.length > 4096) return null;

  return token;
}

module.exports = { extractBearerToken };
