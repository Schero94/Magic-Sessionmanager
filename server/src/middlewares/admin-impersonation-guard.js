'use strict';

/**
 * Global guard for admin API requests made while signed in as another
 * admin (4.23).
 *
 * Mounted with `strapi.server.use` in bootstrap, before routing. Content API
 * and GraphQL requests are left to `impersonation-guard.js`. For a request
 * whose bearer token is a validly signed Strapi admin access token of an
 * impersonation session it:
 * - answers 401 once the impersonation ended or expired (and ends an
 *   expired one, deleting its session);
 * - answers `POST /admin/logout` itself by ending the impersonation, so
 *   Strapi's logout, which deletes every session of the signed-in admin
 *   when no device id is sent, never runs for the target;
 * - lets reads through; refuses every other request with 403 unless "Allow
 *   changes" was chosen; refuses identity, admin-account, token and plugin
 *   changes always (`classifyAdminImpersonationRequest`);
 * - records every allowed change with the real admin as the actor;
 * - sets `X-Magic-Impersonation: true` and exposes the impersonation to the
 *   plugin's own self routes as `ctx.state.magicAdminImpersonation`.
 *
 * When the lookup fails the request fails closed with 503.
 */

const { extractBearerToken } = require('../utils/extract-token');
const { IMPERSONATION_HEADER, normalizePath } = require('../utils/impersonation-rules');
const { classifyAdminImpersonationRequest, recordedPath } = require('../utils/admin-sign-in-rules');

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
 * @param {object} _config Unused middleware config.
 * @param {{strapi: any}} deps Strapi.
 * @returns {(ctx: any, next: () => Promise<void>) => Promise<void>} Middleware.
 */
module.exports = (_config, { strapi }) => {
  const service = () => strapi.plugin('magic-sessionmanager').service('impersonation');

  return async function adminImpersonationGuard(ctx, next) {
    const prefix = normalizePath(strapi.config.get('api.rest.prefix', '/api') || '/api');
    const path = normalizePath(ctx.path);
    const base = prefix === '/' ? '' : prefix;
    if (base && (path === base || path.startsWith(`${base}/`))) return next();
    const bearer = extractBearerToken(ctx);
    if (!bearer) return next();

    let impersonationId;
    let impersonation;
    try {
      impersonationId = await service().adminImpersonationOfToken(bearer);
      if (!impersonationId) return next();
      impersonation =
        impersonationId === 'unknown' ? null : await service().loadAdminForGuard(impersonationId);
    } catch {
      return reply(
        ctx,
        503,
        'ServiceUnavailableError',
        'Session check unavailable',
        'impersonation-check'
      );
    }
    ctx.set(IMPERSONATION_HEADER, 'true');
    const kind = classifyAdminImpersonationRequest(ctx.method, path);

    if (!impersonation || impersonation.state !== 'active') {
      if (kind === 'logout') {
        ctx.body = { data: {} };
        return undefined;
      }
      return reply(ctx, 401, 'UnauthorizedError', 'Impersonation ended', 'impersonation-ended');
    }
    if (Date.now() >= impersonation.expiresAt) {
      try {
        await service().end(impersonation.id, { reason: 'expired' });
      } catch {
        // The sweep ends it; the request is refused either way.
      }
      if (kind === 'logout') {
        ctx.body = { data: {} };
        return undefined;
      }
      return reply(ctx, 401, 'UnauthorizedError', 'Impersonation ended', 'impersonation-expired');
    }

    if (kind === 'logout') {
      // Ends this impersonation only; the target's other sessions stay.
      await service().end(impersonation.id, { reason: 'ended', endedBy: impersonation.actorId });
      ctx.body = { data: {} };
      return undefined;
    }

    const method = String(ctx.method).toUpperCase();
    const recorded = recordedPath(ctx.path);
    if (kind === 'identity' || (kind === 'write' && !impersonation.allowChanges)) {
      const reason = kind === 'identity' ? 'identity' : 'read-only';
      service().recordRefusedAdminCall(impersonation, reason, { method, path: recorded });
      return reply(
        ctx,
        403,
        'ForbiddenError',
        kind === 'identity'
          ? 'Not allowed while signed in as another admin'
          : 'Read-only: changes were not allowed for this sign-in',
        `impersonation-${reason}`
      );
    }

    ctx.state.magicAdminImpersonation = {
      id: impersonation.id,
      actorId: impersonation.actorId,
      targetId: impersonation.targetId,
      allowChanges: impersonation.allowChanges,
      expiresAt: impersonation.expiresAt,
    };
    let failedStatus = 0;
    try {
      await next();
    } catch (err) {
      failedStatus = Number(/** @type {any} */ (err)?.status) || 500;
      throw err;
    } finally {
      ctx.set(IMPERSONATION_HEADER, 'true');
      if (kind === 'write') {
        service().recordAdminWrite(impersonation, {
          method,
          path: recorded,
          status: failedStatus || Number(ctx.status) || 0,
        });
      }
    }
    return undefined;
  };
};
