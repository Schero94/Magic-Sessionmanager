'use strict';

/**
 * Global guard for requests made with an impersonation credential (4.20).
 *
 * Mounted with `strapi.server.use` in bootstrap, so it runs before routing
 * and before the plugin's sign-in interceptors. Only Content API paths
 * (`api.rest.prefix`) and the GraphQL endpoint are inspected; admin panel
 * requests pass untouched.
 *
 * For a request whose bearer token (or, on `POST /auth/refresh`, refresh
 * token) belongs to an impersonation it:
 * - answers 401 once the impersonation ended or expired (and ends an expired
 *   one at once, revoking its credential);
 * - refuses with 403 what an impersonation may not do: credential, email and
 *   account changes, signing in or out, ending or listing-and-ending
 *   sessions, the data export and "This wasn't me" links (see
 *   `classifyRestrictedRequest`); every GraphQL mutation is refused inside
 *   Apollo (`utils/graphql-impersonation-guard.js`), because the request
 *   body of the GraphQL endpoint is not parsed at this point;
 * - sets `X-Magic-Impersonation: true` on every response, also exposed to
 *   cross-origin JavaScript when CORS answered the request.
 *
 * A token is classified from its own claims and the stored session marker;
 * Strapi verifies the signature afterwards, so a forged token can only add
 * restrictions. When the lookup fails the request fails closed with 503.
 */

const { extractBearerToken } = require('../utils/extract-token');
const { getIncomingRefreshToken, getRefreshCookieName } = require('../utils/refresh-token');
const {
  IMPERSONATION_HEADER,
  classifyRestrictedRequest,
  isRestrictedGraphqlRequest,
  normalizePath,
} = require('../utils/impersonation-rules');

/**
 * Writes the Strapi error envelope.
 *
 * @param {any} ctx Koa context.
 * @param {number} status HTTP status.
 * @param {string} name Error name.
 * @param {string} message Fixed message.
 * @param {string} reason Machine-readable reason.
 * @returns {void}
 */
function reply(ctx, status, name, message, reason) {
  ctx.status = status;
  ctx.body = { data: null, error: { status, name, message, details: { reason } } };
}

/**
 * Marks the response as made by an impersonation.
 *
 * @param {any} ctx Koa context.
 * @returns {void}
 */
function markResponse(ctx) {
  ctx.set(IMPERSONATION_HEADER, 'true');
  if (!ctx.response.get('Access-Control-Allow-Origin')) return;
  const exposed = ctx.response.get('Access-Control-Expose-Headers');
  const list = exposed ? exposed.split(',').map((item) => item.trim()) : [];
  if (!list.some((item) => item.toLowerCase() === IMPERSONATION_HEADER.toLowerCase())) {
    ctx.set('Access-Control-Expose-Headers', [...list, IMPERSONATION_HEADER].join(', '));
  }
}

/**
 * @param {object} _config Unused middleware config.
 * @param {{strapi: any}} deps Strapi.
 * @returns {(ctx: any, next: () => Promise<void>) => Promise<void>} Middleware.
 */
module.exports = (_config, { strapi }) => {
  const service = () => strapi.plugin('magic-sessionmanager').service('impersonation');

  return async function impersonationGuard(ctx, next) {
    const prefix = normalizePath(strapi.config.get('api.rest.prefix', '/api') || '/api');
    const path = normalizePath(ctx.path);
    const graphqlEndpoint = normalizePath(
      strapi.plugin('graphql')?.config?.('endpoint') || '/graphql'
    );
    const isGraphql = path === graphqlEndpoint;
    const base = prefix === '/' ? '' : prefix;
    const isContentApi = path === base || path.startsWith(`${base}/`);
    if (!isGraphql && !isContentApi) return next();

    let impersonationId = null;
    try {
      const bearer = extractBearerToken(ctx);
      if (bearer) impersonationId = await service().impersonationOfToken(bearer);
      if (!impersonationId && ctx.method === 'POST' && path === `${base}/auth/refresh`) {
        const refreshToken = getIncomingRefreshToken(ctx, getRefreshCookieName(strapi));
        if (refreshToken) impersonationId = await service().impersonationOfToken(refreshToken);
      }
    } catch {
      return reply(
        ctx,
        503,
        'ServiceUnavailableError',
        'Session check unavailable',
        'impersonation-check'
      );
    }
    if (!impersonationId) return next();

    markResponse(ctx);
    let impersonation;
    try {
      impersonation = await service().loadForGuard(impersonationId);
    } catch {
      return reply(
        ctx,
        503,
        'ServiceUnavailableError',
        'Session check unavailable',
        'impersonation-check'
      );
    }
    if (!impersonation || impersonation.state !== 'active') {
      return reply(ctx, 401, 'UnauthorizedError', 'Impersonation ended', 'impersonation-ended');
    }
    if (Date.now() >= impersonation.expiresAt) {
      try {
        await service().end(impersonation.id, { reason: 'expired' });
      } catch {
        // The sweep ends it; the request is refused either way.
      }
      return reply(ctx, 401, 'UnauthorizedError', 'Impersonation ended', 'impersonation-expired');
    }

    const restricted = isGraphql
      ? isRestrictedGraphqlRequest(ctx.request?.body, ctx.query?.query)
        ? 'credentials'
        : null
      : classifyRestrictedRequest(ctx.method, path, prefix);
    if (restricted) {
      service().recordRefusedCall(impersonation, restricted);
      return reply(
        ctx,
        403,
        'ForbiddenError',
        'Not allowed while impersonating',
        `impersonation-${restricted}`
      );
    }

    // Read by the GraphQL guard (utils/graphql-impersonation-guard.js), which
    // refuses every mutation once Apollo has resolved the operation.
    ctx.state.magicImpersonation = {
      id: impersonation.id,
      actorId: impersonation.actorId,
      targetId: impersonation.targetId || null,
    };
    try {
      await next();
    } finally {
      markResponse(ctx);
    }
  };
};
