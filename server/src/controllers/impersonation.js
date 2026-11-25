'use strict';

/**
 * Impersonation endpoints (4.20). Admin routes are in routes/admin.js, the
 * hand-off exchange in routes/content-api.js. Errors use the Strapi error
 * envelope; messages are fixed and never echo input.
 */

const { DOCUMENT_ID_PATTERN } = require('../utils/impersonation-rules');
const { ImpersonationError } = require('../services/impersonation');
const { sendServerError } = require('../utils/http-errors');

const IMPERSONATE_USERS_ACTION = 'plugin::magic-sessionmanager.impersonate.users';
const IMPERSONATE_ADMINS_ACTION = 'plugin::magic-sessionmanager.impersonate.admins';

/**
 * Whether the caller's ability holds an action.
 *
 * @param {any} ctx Koa context.
 * @param {string} action Action id.
 * @returns {boolean}
 */
function callerCan(ctx, action) {
  try {
    return ctx?.state?.userAbility?.can?.(action) === true;
  } catch {
    return false;
  }
}

/**
 * Target types the caller may see and end.
 *
 * @param {any} ctx Koa context.
 * @returns {Array<'user'|'admin'>}
 */
function visibleTargetTypes(ctx) {
  return [
    ...(callerCan(ctx, IMPERSONATE_USERS_ACTION) ? ['user'] : []),
    ...(callerCan(ctx, IMPERSONATE_ADMINS_ACTION) ? ['admin'] : []),
  ];
}

/** `ctx` helper per expected status (Strapi's error envelope). */
const REPLY = Object.freeze({ 400: 'badRequest', 403: 'forbidden', 404: 'notFound' });

/**
 * Runs a handler and answers expected refusals with Strapi's `ctx` helpers
 * and anything else with a fixed 500.
 *
 * @param {any} ctx Koa context.
 * @param {string} operation Name for the log line.
 * @param {() => Promise<void>} handler Handler body.
 * @returns {Promise<unknown>}
 */
async function respond(ctx, operation, handler) {
  try {
    return await handler();
  } catch (err) {
    if (err instanceof ImpersonationError && REPLY[err.status]) {
      return ctx[REPLY[err.status]](err.message, err.details);
    }
    strapi.log.error(
      `[magic-sessionmanager/impersonation] ${operation} failed:`,
      err?.name || 'Error'
    );
    return sendServerError(ctx, 500, 'Impersonation request failed');
  }
}

/**
 * Refuses callers that are not a person in the admin panel: admin API
 * tokens cannot impersonate.
 *
 * @param {any} ctx Koa context.
 * @param {'user'|'admin'} targetType Target type of the refused start.
 * @param {unknown} targetId Target id.
 * @returns {void}
 * @throws {ImpersonationError} 403 for any strategy other than `admin`.
 */
function requirePerson(ctx, targetType, targetId) {
  if (ctx.state?.auth?.strategy?.name === 'admin') return;
  const service = strapi.plugin('magic-sessionmanager').service('impersonation');
  service.recordRefused({
    actorId: ctx.state?.user?.id,
    targetType,
    targetId,
    reason: 'api-token',
    via: 'admin-token',
  });
  throw new ImpersonationError(403, 'API tokens cannot impersonate', { reason: 'api-token' });
}

module.exports = ({ strapi: app }) => {
  const service = () => app.plugin('magic-sessionmanager').service('impersonation');

  return {
    /**
     * Feature state for the admin UI.
     *
     * @route GET /magic-sessionmanager/impersonation/status
     * @auth Admin JWT or admin API token; `access`.
     * @returns {Promise<void>} `{ data: { enabled, handoff, frontendOrigin, durations, mode } }`.
     */
    async status(ctx) {
      ctx.body = { data: await service().status() };
    },

    /**
     * Starts an impersonation of an app user.
     *
     * @route POST /magic-sessionmanager/impersonation/users/:userId
     * @auth Admin JWT only (admin API tokens are refused); `access` + `impersonate.users`.
     * @param {any} ctx Body `{ reason: string(3..255), durationMinutes: 15|30|60, notifyUser?: boolean }`.
     * @returns {Promise<void>} 201 `{ data: { impersonation, handoff } }`; `handoff` is either
     *   `{ type: 'frontend', url, field, code, codeExpiresAt }` or `{ type: 'token', jwt,
     *   refreshToken?, expiresAt }`, shown once.
     * Answers 400 for an invalid body, user id or a blocked account, 403 when the feature is
     * off, for API tokens or when one is already active, 404 for an unknown user.
     * @sideeffect Creates the impersonation and, for the token hand-off, its session; logs
     *   `impersonation.started` or `.refused`; may email the user.
     */
    async startUser(ctx) {
      ctx.set('Cache-Control', 'no-store');
      return respond(ctx, 'start', async () => {
        const { userId } = ctx.params;
        requirePerson(ctx, 'user', userId);
        const result = await service().startForUser({
          actor: ctx.state.user,
          userDocumentId: userId,
          body: ctx.request.body,
          ctx,
        });
        ctx.status = 201;
        ctx.body = { data: result };
      });
    },

    /**
     * Active impersonations the caller may see: app users with
     * `impersonate.users`, admin previews with `impersonate.admins`. Admin
     * names need `admin::users.read`, as in the Admin panel view.
     *
     * @route GET /magic-sessionmanager/impersonation/active
     * @auth Admin JWT or admin API token; `access` + one of the impersonate actions.
     * @returns {Promise<void>} `{ data: Impersonation[] }` (at most 100).
     */
    async listActive(ctx) {
      return respond(ctx, 'list', async () => {
        const data = await service().listActive({
          targetTypes: visibleTargetTypes(ctx),
          viewer: ctx.state.user,
          canReadAdmins: callerCan(ctx, 'admin::users.read'),
        });
        ctx.body = { data };
      });
    },

    /**
     * Ends an active impersonation now.
     *
     * @route POST /magic-sessionmanager/impersonation/:id/end
     * @auth Admin JWT or admin API token; `access` + the impersonate action of its kind
     *   (`impersonate.users` for app users, `impersonate.admins` for admin previews).
     * @returns {Promise<void>} `{ data: { ended: boolean } }`.
     * Answers 404 for an unknown id or a kind the caller may not see.
     * @sideeffect Revokes the credential; logs `impersonation.ended`.
     */
    async end(ctx) {
      return respond(ctx, 'end', async () => {
        const { id } = ctx.params;
        if (typeof id !== 'string' || !DOCUMENT_ID_PATTERN.test(id)) {
          throw new ImpersonationError(404, 'Impersonation not found');
        }
        const row = await app.db
          .query('plugin::magic-sessionmanager.impersonation')
          .findOne({ where: { documentId: id }, select: ['documentId', 'targetType', 'state'] });
        if (!row || !visibleTargetTypes(ctx).includes(row.targetType)) {
          throw new ImpersonationError(404, 'Impersonation not found');
        }
        const ended =
          row.state === 'active'
            ? await service().end(id, { reason: 'ended', endedBy: ctx.state.user.id })
            : false;
        ctx.body = { data: { ended } };
      });
    },

    /**
     * Starts a read-only permission preview of another admin ("View as
     * admin"): which content types and actions they can use. No session or
     * token is created.
     *
     * @route POST /magic-sessionmanager/impersonation/admins/:adminId/preview
     * @auth Admin JWT only (admin API tokens are refused); `access` + `impersonate.admins`.
     * @param {any} ctx Body `{ reason: string(3..255), durationMinutes: 15|30 }`.
     * @returns {Promise<void>} 201 `{ data: { impersonation, preview } }`. Answers 403 with
     *   `details.reason` `disabled`, `api-token`, `self`, `super-admin` or `not-subset`,
     *   400 for an invalid body and 404 for an unknown admin.
     * @sideeffect Creates a preview row; logs `impersonation.started` or `.refused`.
     */
    async previewAdmin(ctx) {
      ctx.set('Cache-Control', 'no-store');
      return respond(ctx, 'preview', async () => {
        const { adminId } = ctx.params;
        requirePerson(ctx, 'admin', adminId);
        const result = await service().previewAdmin({
          actor: ctx.state.user,
          adminId,
          body: ctx.request.body,
          canReadAdmins: callerCan(ctx, 'admin::users.read'),
        });
        ctx.status = 201;
        ctx.body = { data: result };
      });
    },

    /**
     * Reads a running admin preview; only the admin who started it.
     *
     * @route GET /magic-sessionmanager/impersonation/previews/:id
     * @auth Admin JWT or admin API token; `access` + `impersonate.admins`.
     * @returns {Promise<void>} `{ data: { impersonation, preview } }`; 404 when unknown, ended,
     *   expired or started by someone else.
     */
    async getPreview(ctx) {
      ctx.set('Cache-Control', 'no-store');
      return respond(ctx, 'preview', async () => {
        ctx.body = {
          data: await service().getPreview({
            id: ctx.params.id,
            viewer: ctx.state.user,
            canReadAdmins: callerCan(ctx, 'admin::users.read'),
          }),
        };
      });
    },

    /**
     * Exchanges a one-time hand-off code for the impersonation credential.
     * Public on purpose: the code is the credential (32 random bytes, stored
     * hashed, valid 60 seconds, single use). Every invalid, used or expired
     * code gets the same 400.
     *
     * @route POST /api/magic-sessionmanager/impersonation/exchange
     * @auth None (rate-limited per IP address).
     * @param {any} ctx Body `{ code: string }`.
     * @returns {Promise<void>} `{ data: { jwt, refreshToken?, expiresAt, user, impersonation } }`.
     * Answers 400 for any unusable code.
     * @sideeffect Consumes the code; creates the credential and its session.
     */
    async exchange(ctx) {
      const body = ctx.request.body;
      const valid =
        body &&
        typeof body === 'object' &&
        !Array.isArray(body) &&
        Object.keys(body).length === 1 &&
        typeof body.code === 'string';
      ctx.set('Cache-Control', 'no-store');
      return respond(ctx, 'exchange', async () => {
        const result = valid ? await service().exchange(body.code, ctx) : null;
        if (!result) throw new ImpersonationError(400, 'Invalid or expired code');
        ctx.body = { data: result };
      });
    },
  };
};

module.exports.IMPERSONATE_USERS_ACTION = IMPERSONATE_USERS_ACTION;
module.exports.IMPERSONATE_ADMINS_ACTION = IMPERSONATE_ADMINS_ACTION;
