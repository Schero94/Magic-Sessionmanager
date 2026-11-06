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
 * `rateLimitWriteMax` / `rateLimitWindowSeconds` settings apply at runtime:
 * the read profile can be RELAXED, the write profile can only be TIGHTENED
 * (lower max, longer window), so the destructive endpoints keep their floor.
 *
 * Buckets are keyed on the matched route template plus the caller identity,
 * never on the raw request path, so varying path parameters, letter case or
 * a trailing slash cannot open a fresh bucket.
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
  const tokenId = ctx.state?.auth?.credentials?.id ?? ctx.state?.auth?.credentials?.token ?? null;
  if (tokenId) return `t:${String(tokenId).slice(-16)}`;
  return `ip:${ctx.request.ip || ctx.ip || 'unknown'}`;
};

/**
 * Returns the bucket identity of the matched route. Strapi stores the
 * matched route definition in `ctx.state.route` before route middlewares run,
 * so every concrete URL of one route template shares a bucket regardless of
 * path parameters, letter case or a trailing slash (Strapi's router matches
 * all of those to the same handler).
 *
 * Without route information the request path is normalised the same way the
 * router matches it; this fallback only applies outside Strapi's router.
 *
 * @param {object} ctx Koa context
 * @returns {string} Route identity
 */
const routeKey = (ctx) => {
  const route = ctx.state?.route;
  const method = String(route?.method || ctx.method || '').toUpperCase();
  if (route && typeof route.path === 'string') {
    const plugin = route.info?.pluginName || route.plugin || '';
    const handler = typeof route.handler === 'string' ? route.handler : '';
    return `${method} ${plugin}:${handler}:${route.path.toLowerCase()}`;
  }
  const rawPath = String(ctx.path || '').toLowerCase();
  const normalizedPath = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') || '/' : rawPath;
  return `${method} path:${normalizedPath}`;
};

/**
 * Short TTL cache for the per-process effective limit so we don't re-read
 * settings on every request. Settings changes are picked up after the TTL.
 * Entries are keyed by profile and route ceiling so routes with different
 * hard limits never share a resolved value.
 */
const RESOLVED_TTL_MS = 30_000;
const resolvedCache = new Map();

/**
 * Resolves the effective { max, windowMs } for a given profile by
 * combining the route-level ceiling with the admin-configurable settings.
 *
 * - read: admins may RELAX the limit (higher max, any allowed window).
 * - write: admins may only TIGHTEN it. The max is the lower of both values
 *   and the window the longer of both, so max/window can never exceed the
 *   route's own rate (API-5).
 *
 * @param {{profile: 'read'|'write', routeMax: number, routeWindowMs: number, strapi: object}} input
 * @returns {Promise<{max: number, windowMs: number}>}
 */
async function resolveLimits({ profile, routeMax, routeWindowMs, strapi }) {
  const now = Date.now();
  const cacheKey = `${profile}:${routeMax}:${routeWindowMs}`;
  const cachedEntry = resolvedCache.get(cacheKey);
  if (cachedEntry && now - cachedEntry.at < RESOLVED_TTL_MS) {
    return { max: cachedEntry.max, windowMs: cachedEntry.windowMs };
  }

  let settings = {};
  try {
    settings = await getPluginSettings(strapi);
  } catch {
    settings = {};
  }

  const settingsWindowMs = Number.isFinite(settings.rateLimitWindowSeconds)
    ? Math.max(10_000, settings.rateLimitWindowSeconds * 1000)
    : routeWindowMs;

  let resolved;
  if (profile === 'write') {
    resolved = {
      max: Math.min(
        routeMax,
        Number.isFinite(settings.rateLimitWriteMax) ? settings.rateLimitWriteMax : routeMax
      ),
      windowMs: Math.max(routeWindowMs, settingsWindowMs),
    };
  } else if (profile === 'read') {
    resolved = {
      max: Math.max(
        routeMax,
        Number.isFinite(settings.rateLimitReadMax) ? settings.rateLimitReadMax : routeMax
      ),
      windowMs: settingsWindowMs,
    };
  } else {
    resolved = { max: routeMax, windowMs: routeWindowMs };
  }

  resolvedCache.set(cacheKey, { ...resolved, at: now });
  return resolved;
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

    const key = `${routeKey(ctx)}::${callerKey(ctx)}`;
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
      strapi.log.warn('[magic-sessionmanager] Content API rate limit exceeded');
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

/**
 * Test-only access to the limiter internals. `reset` clears all buckets and
 * resolved limits so tests do not depend on execution order.
 */
rateLimit.__private = {
  resolveLimits,
  routeKey,
  reset() {
    buckets.clear();
    resolvedCache.clear();
  },
};

module.exports = rateLimit;
