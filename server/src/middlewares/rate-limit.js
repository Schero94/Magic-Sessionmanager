'use strict';

/**
 * In-memory per-caller rate limiter for session-manager Content-API endpoints.
 *
 * The primary purpose is to contain abuse of /logout and /logout-all from
 * a compromised JWT: while those endpoints are "soft" (they mark the DB
 * row) they still do a write per call and an attacker could otherwise
 * drown the DB by spamming them.
 *
 * Single-process only — see middlewares/last-seen.js comment for the
 * multi-instance trade-off and the preferred Redis-backed upgrade path.
 *
 * Route-level config shape:
 *   { name: 'plugin::magic-sessionmanager.rate-limit',
 *     config: { max: 20, window: 60000 } }
 */

const buckets = new Map();

const prune = (now) => {
  for (const [key, entry] of buckets) {
    if (entry.expiresAt <= now) buckets.delete(key);
  }
};

/**
 * Returns a stable key identifying the caller: user id when authenticated,
 * API-token id otherwise, then the socket IP as last resort.
 * @param {object} ctx
 * @returns {string}
 */
const callerKey = (ctx) => {
  const userId = ctx.state?.user?.id;
  if (userId) return `u:${userId}`;
  const tokenId =
    ctx.state?.auth?.credentials?.id ??
    ctx.state?.auth?.credentials?.token ??
    null;
  if (tokenId) return `t:${String(tokenId).slice(-16)}`;
  return `ip:${ctx.request.ip || ctx.ip || 'unknown'}`;
};

/**
 * @param {{ max?: number, window?: number }} cfg
 */
const rateLimit = (cfg = {}, { strapi }) => {
  const max = Number.isFinite(cfg.max) ? cfg.max : 30;
  const windowMs = Number.isFinite(cfg.window) ? cfg.window : 60_000;

  return async (ctx, next) => {
    const key = `${ctx.path}::${callerKey(ctx)}`;
    const now = Date.now();

    if (buckets.size > 5000) prune(now);

    let entry = buckets.get(key);
    if (!entry || entry.expiresAt <= now) {
      entry = { count: 0, expiresAt: now + windowMs };
      buckets.set(key, entry);
    }

    entry.count += 1;

    if (entry.count > max) {
      const retryAfterSec = Math.ceil((entry.expiresAt - now) / 1000);
      ctx.set('Retry-After', String(retryAfterSec));
      strapi.log.warn(
        `[magic-sessionmanager] Rate limit exceeded on ${ctx.path} for ${callerKey(ctx)} (${entry.count}/${max})`
      );
      ctx.status = 429;
      ctx.body = {
        data: null,
        error: {
          status: 429,
          name: 'TooManyRequestsError',
          message: 'Too many requests. Please slow down.',
          details: { retryAfter: retryAfterSec },
        },
      };
      return;
    }

    await next();
  };
};

module.exports = rateLimit;
