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
 * Route-level config shape (hard ceiling):
 *   { name: 'plugin::magic-sessionmanager.rate-limit',
 *     config: { profile: 'read' | 'write', max: 20, window: 60000 } }
 *
 * If a `profile` is supplied, the admin-facing `rateLimitReadMax` /
 * `rateLimitWriteMax` / `rateLimitWindowSeconds` settings can RELAX the
 * limit at runtime — never tighten below the route-level value. This lets
 * a power user expand their polling budget without being able to
 * paper over the write-side safeguards.
 */

const { getPluginSettings } = require('../utils/settings-loader');

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
 * Short TTL cache for the per-process effective limit so we don't re-read
 * settings on every request. Settings changes are picked up after the TTL.
 */
const RESOLVED_TTL_MS = 30_000;
let resolvedCache = null;
let resolvedAt = 0;

/**
 * Resolves the effective { max, windowMs } for a given profile by
 * combining the route-level hard ceiling with the admin-configurable
 * soft ceiling. Returns the LOOSER of the two for read profile (admins
 * can raise read limits), the STRICTER for write (we never allow
 * loosening destructive endpoints).
 */
async function resolveLimits({ profile, routeMax, routeWindowMs, strapi }) {
  const now = Date.now();
  if (resolvedCache && now - resolvedAt < RESOLVED_TTL_MS) {
    const p = resolvedCache[profile];
    if (p) {
      return { max: p.max, windowMs: p.windowMs };
    }
  }

  let settings = {};
  try {
    settings = await getPluginSettings(strapi);
  } catch {
    settings = {};
  }

  const windowSec = Number.isFinite(settings.rateLimitWindowSeconds)
    ? settings.rateLimitWindowSeconds
    : Math.round(routeWindowMs / 1000);
  const windowMs = Math.max(10_000, windowSec * 1000);

  const resolvedWrite = {
    max: Math.min(routeMax, Number.isFinite(settings.rateLimitWriteMax) ? settings.rateLimitWriteMax : routeMax),
    windowMs,
  };
  const resolvedRead = {
    max: Math.max(routeMax, Number.isFinite(settings.rateLimitReadMax) ? settings.rateLimitReadMax : routeMax),
    windowMs,
  };

  resolvedCache = { read: resolvedRead, write: resolvedWrite };
  resolvedAt = now;

  if (profile === 'read') return resolvedRead;
  if (profile === 'write') return resolvedWrite;
  return { max: routeMax, windowMs };
}

/**
 * @param {{ max?: number, window?: number, profile?: 'read'|'write' }} cfg
 */
const rateLimit = (cfg = {}, { strapi }) => {
  const routeMax = Number.isFinite(cfg.max) ? cfg.max : 30;
  const routeWindowMs = Number.isFinite(cfg.window) ? cfg.window : 60_000;
  const profile = cfg.profile === 'read' || cfg.profile === 'write' ? cfg.profile : null;

  return async (ctx, next) => {
    const { max, windowMs } = profile
      ? await resolveLimits({ profile, routeMax, routeWindowMs, strapi })
      : { max: routeMax, windowMs: routeWindowMs };

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
