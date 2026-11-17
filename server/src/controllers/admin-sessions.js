'use strict';

// @ts-check

/** @import { Context } from 'koa' */

const {
  AdminSignOutError,
  adminParamsSchema,
  listAdminSessions,
  listAdmins,
  listQuerySchema,
  parseInput,
  sessionParamsSchema,
  signOutAdmin,
} = require('../utils/admin-sessions');
const { sendServerError, sendValidationError } = require('../utils/http-errors');
const { createLogger } = require('../utils/logger');

/**
 * The caller as the admin-session helpers need it: id, roles and the session
 * that backs this request (set by Strapi's `admin` auth strategy).
 *
 * @param {Context} ctx Koa context.
 * @returns {{id: any, roles: any[], sessionId: string|null}} Caller.
 */
function actorFrom(ctx) {
  const user = ctx.state?.user || {};
  const session = ctx.state?.session;
  return {
    id: user.id,
    roles: Array.isArray(user.roles) ? user.roles : [],
    sessionId: typeof session?.id === 'string' ? session.id : null,
  };
}

/**
 * Picks the named route parameters. Koa's router can add positional keys
 * (for example `0`) to `ctx.params`, so the strict schemas see only the
 * parameters this route declares.
 *
 * @param {Context} ctx Koa context.
 * @param {string[]} names Declared parameter names.
 * @returns {Record<string, unknown>} Named parameters.
 */
function routeParams(ctx, names) {
  /** @type {Record<string, unknown>} */
  const out = {};
  const params = /** @type {any} */ (ctx).params || {};
  for (const name of names) out[name] = params[name];
  return out;
}

/**
 * Admin panel session endpoints. Every route is admin-only and gated by
 * `plugin::magic-sessionmanager.access` plus `admin-sessions.read`; the
 * sign-out routes also need `admin-sessions.revoke` (see routes/admin.js).
 *
 * @param {{strapi: any}} deps Strapi instance.
 * @returns {Record<string, (ctx: Context) => Promise<unknown>>} Controller actions.
 */
module.exports = ({ strapi }) => {
  const log = createLogger(strapi);

  /**
   * Maps a failure to the response. Known sign-out errors keep their status
   * and fixed message; anything else is a 500 without details.
   *
   * @param {Context} ctx Koa context.
   * @param {unknown} error Thrown value.
   * @param {string} operation Name for the log line.
   * @returns {unknown} Response helper result.
   */
  const fail = (ctx, error, operation) => {
    if (error instanceof AdminSignOutError) {
      if (error.status === 404) return ctx.notFound(error.message);
      if (error.status === 403) return ctx.forbidden(error.message, { reason: error.reason });
      return sendServerError(ctx, 503, error.message);
    }
    log.error(`Admin sessions: ${operation} failed`, /** @type {any} */ (error)?.name || 'Error');
    return sendServerError(ctx, 500, 'Admin sessions could not be processed.');
  };

  return {
    /**
     * Lists admin users with their live admin-panel sessions summary.
     *
     * @route GET /magic-sessionmanager/admin-sessions/admins
     * @auth Admin JWT or admin API token; admin::hasPermissions access + admin-sessions.read;
     *   read rate limit.
     * @param {Context} ctx Reads `ctx.query.page` (1..1e6), `pageSize` (1..100), `search`
     *   (<= 100 chars, name or email) and `filter` (`all`|`signed-in`|`not-signed-in`).
     * @returns {Promise<unknown>} 200 `{ data: AdminRow[], meta: { supported, pagination, stats,
     *   policy, truncated } }`; 400 ValidationError with field errors; 500 fixed message.
     */
    async listAdmins(ctx) {
      const parsed = parseInput(listQuerySchema, ctx.query);
      if (!parsed.ok) return sendValidationError(ctx, 'Invalid query', parsed.errors);
      try {
        ctx.body = await listAdmins(strapi, parsed.value, actorFrom(ctx));
        return ctx.body;
      } catch (error) {
        return fail(ctx, error, 'list');
      }
    },

    /**
     * Lists the live sessions (one per signed-in browser) of one admin.
     *
     * @route GET /magic-sessionmanager/admin-sessions/admins/:adminId/sessions
     * @auth Admin JWT or admin API token; admin::hasPermissions access + admin-sessions.read;
     *   read rate limit.
     * @param {Context} ctx Reads `ctx.params.adminId` (positive integer).
     * @returns {Promise<unknown>} 200 `{ data: SessionRow[], meta: { supported, admin, policy } }`;
     *   400 invalid id; 404 unknown admin; 500 fixed message. No tokens, device ids or hashes.
     */
    async listAdminSessions(ctx) {
      const parsed = parseInput(adminParamsSchema, routeParams(ctx, ['adminId']));
      if (!parsed.ok) return sendValidationError(ctx, 'Invalid parameters', parsed.errors);
      try {
        const body = await listAdminSessions(strapi, parsed.value.adminId, actorFrom(ctx));
        if (!body) return ctx.notFound('Admin not found');
        ctx.body = body;
        return ctx.body;
      } catch (error) {
        return fail(ctx, error, 'sessions');
      }
    },

    /**
     * Signs one admin out of one browser.
     *
     * @route POST /magic-sessionmanager/admin-sessions/admins/:adminId/sessions/:sessionId/sign-out
     * @auth Admin JWT only (admin API tokens get 403); admin::hasPermissions access +
     *   admin-sessions.read + admin-sessions.revoke; write rate limit (10/min per admin).
     *   A Super Admin can only be signed out by a Super Admin or themselves.
     * @param {Context} ctx Reads `ctx.params.adminId` and `ctx.params.sessionId` (32 hex chars).
     * @returns {Promise<unknown>} 200 `{ data: { ended, signedOutSelf } }`; 400 invalid params;
     *   403 not a browser session or Super Admin guard; 404 unknown admin, or a session that is
     *   not a live session of that admin; 503 no session manager; 500 fixed message.
     * @sideeffect Deletes the target browser's `admin::session` rows; writes an audit log line.
     */
    async signOutSession(ctx) {
      if (ctx.state?.auth?.strategy?.name !== 'admin') {
        return ctx.forbidden('Sign in to the admin panel to sign admins out.', {
          reason: 'browser-session-required',
        });
      }
      const parsed = parseInput(sessionParamsSchema, routeParams(ctx, ['adminId', 'sessionId']));
      if (!parsed.ok) return sendValidationError(ctx, 'Invalid parameters', parsed.errors);
      try {
        const result = await signOutAdmin(strapi, {
          actor: actorFrom(ctx),
          adminId: parsed.value.adminId,
          sessionId: parsed.value.sessionId,
        });
        ctx.body = { data: { ended: result.ended, signedOutSelf: result.signedOutSelf } };
        return ctx.body;
      } catch (error) {
        return fail(ctx, error, 'sign-out');
      }
    },

    /**
     * Signs one admin out of every browser.
     *
     * @route POST /magic-sessionmanager/admin-sessions/admins/:adminId/sign-out-everywhere
     * @auth Admin JWT only (admin API tokens get 403); admin::hasPermissions access +
     *   admin-sessions.read + admin-sessions.revoke; write rate limit (10/min per admin).
     *   A Super Admin can only be signed out by a Super Admin or themselves.
     * @param {Context} ctx Reads `ctx.params.adminId`.
     * @returns {Promise<unknown>} 200 `{ data: { ended, signedOutSelf } }`; 400 invalid id;
     *   403 not a browser session or Super Admin guard; 404 unknown admin; 503 no session
     *   manager; 500 fixed message.
     * @sideeffect Deletes every `admin::session` row of the target admin; writes an audit log line.
     */
    async signOutEverywhere(ctx) {
      if (ctx.state?.auth?.strategy?.name !== 'admin') {
        return ctx.forbidden('Sign in to the admin panel to sign admins out.', {
          reason: 'browser-session-required',
        });
      }
      const parsed = parseInput(adminParamsSchema, routeParams(ctx, ['adminId']));
      if (!parsed.ok) return sendValidationError(ctx, 'Invalid parameters', parsed.errors);
      try {
        const result = await signOutAdmin(strapi, {
          actor: actorFrom(ctx),
          adminId: parsed.value.adminId,
        });
        ctx.body = { data: { ended: result.ended, signedOutSelf: result.signedOutSelf } };
        return ctx.body;
      } catch (error) {
        return fail(ctx, error, 'sign-out-everywhere');
      }
    },
  };
};
