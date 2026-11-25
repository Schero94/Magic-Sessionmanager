'use strict';

// @ts-check

/** @import { Context } from 'koa' */

const { z } = require('@strapi/utils');
const { CONTENT_ACTIONS, SIGN_IN_FILTERS } = require('../utils/security-log-model');
const { cursorField, handleEventQuery, periodAndPaging } = require('../utils/event-query');
const { createLogger } = require('../utils/logger');
const { callerCan } = require('../utils/settings-access');

const adminIdField = z
  .string()
  .regex(/^[1-9][0-9]{0,11}$/, 'adminId must be a positive integer')
  .transform(Number)
  .optional();

const common = {
  adminId: adminIdField,
  ...periodAndPaging(),
};

const signInQuerySchema = z.strictObject({
  ...common,
  event: z.enum(/** @type {[string, ...string[]]} */ (Object.keys(SIGN_IN_FILTERS))).default('all'),
});

const activityQuerySchema = z.strictObject({
  ...common,
  action: z.enum(/** @type {[string, ...string[]]} */ (['all', ...CONTENT_ACTIONS])).default('all'),
  contentType: z
    .string()
    .regex(
      /^(api|plugin)::[a-z0-9-]{1,80}\.[a-z0-9-]{1,80}$/,
      'contentType must be a content type uid'
    )
    .optional(),
});

const signInExportSchema = signInQuerySchema.omit({ page: true, pageSize: true }).extend({
  cursor: cursorField,
});
const activityExportSchema = activityQuerySchema.omit({ page: true, pageSize: true }).extend({
  cursor: cursorField,
});

/**
 * Admin sign-in history and Content Manager activity endpoints. Every route
 * is admin-only and needs `plugin::magic-sessionmanager.access` plus
 * `admin-activity.read` (see routes/admin.js); only Super Admins hold the new
 * action by default.
 *
 * @param {{strapi: any}} deps Strapi instance.
 * @returns {Record<string, (ctx: Context) => Promise<unknown>>} Controller actions.
 */
module.exports = ({ strapi }) => {
  const log = createLogger(strapi);
  const service = () => strapi.plugin('magic-sessionmanager').service('security-log');

  /**
   * The reader as the service needs it: their ability (Content Manager
   * titles) and whether they may see admin names (`admin::users.read`).
   *
   * @param {Context} ctx Koa context.
   * @returns {{ability: any, canReadAdmins: boolean}} Viewer.
   */
  const viewerOf = (ctx) => ({
    ability: /** @type {any} */ (ctx).state?.userAbility || null,
    canReadAdmins: callerCan(ctx, 'admin::users.read'),
  });

  /**
   * Records a read by an admin API token (4.17). Reads from the admin panel
   * are not recorded.
   *
   * @param {Context} ctx Koa context.
   * @param {'sign-ins'|'content'} list List read.
   * @param {boolean} exported Export batch.
   * @returns {void}
   */
  const auditTokenRead = (ctx, list, exported) => {
    const state = /** @type {any} */ (ctx).state;
    if (state?.auth?.strategy?.name !== 'admin-token') return;
    try {
      service().recordTokenRead({
        adminId: state.user?.id,
        tokenId: state.auth?.credentials?.id,
        list,
        exported,
      });
    } catch {
      // Auditing must not fail the read.
    }
  };

  /**
   * Validates a query, runs the handler and maps failures to a fixed 500.
   *
   * @param {Context} ctx Koa context.
   * @param {import('zod').ZodType<any>} schema Query schema.
   * @param {(query: any) => Promise<unknown>} run Handler.
   * @param {string} operation Name for the log line.
   * @returns {Promise<unknown>} Response body.
   */
  const handle = (ctx, schema, run, operation) =>
    handleEventQuery(ctx, schema, run, {
      log,
      logPrefix: 'Admin activity',
      operation,
      failureMessage: 'Admin activity could not be loaded.',
    });

  return {
    /**
     * One page of the admin sign-in history: sign-ins, failed attempts,
     * lockouts and sign-outs, newest first.
     *
     * @route GET /magic-sessionmanager/admin-activity/sign-ins
     * @auth Admin JWT or admin API token; admin::hasPermissions access + admin-activity.read;
     *   read rate limit.
     * @param {Context} ctx Reads `ctx.query.adminId` (optional positive integer), `event`
     *   (`all`|`succeeded`|`failed`|`signed-out`|`changes`), `from`/`to` (ISO dates), `page`, `pageSize`
     *   (1..100, default 20).
     * @returns {Promise<unknown>} 200 `{ data: SignInRow[], meta: { pagination, recording,
     *   identity } }`; 400 ValidationError with field errors; 500 fixed message. Rows hold IP
     *   address (possibly anonymised), location, browser, OS, the stored user agent (at most
     *   256 characters) and session state; `event=changes` (also part of `all` without
     *   `adminId`) lists settings changes (key names), token reads and retention runs. Never
     *   the device id, a typed email or a token. Admin names are empty without
     *   `admin::users.read` (`meta.identity.names` false).
     * @sideeffect A read with an admin API token queues a `security-log.read` event.
     */
    async listSignIns(ctx) {
      return handle(
        ctx,
        signInQuerySchema,
        (query) => {
          auditTokenRead(ctx, 'sign-ins', false);
          return service().listSignIns(query, viewerOf(ctx));
        },
        'sign-ins'
      );
    },

    /**
     * One page of Content Manager activity, newest first.
     *
     * @route GET /magic-sessionmanager/admin-activity/content
     * @auth Admin JWT or admin API token; admin::hasPermissions access + admin-activity.read;
     *   read rate limit.
     * @param {Context} ctx Reads `ctx.query.adminId`, `action` (`all` or an action),
     *   `contentType` (uid), `from`/`to`, `page`, `pageSize`.
     * @returns {Promise<unknown>} 200 `{ data: ActivityRow[], meta: { pagination, recording,
     *   identity, contentTypes, contentManagerAccess? } }`; 400; 500 fixed message. Entry titles
     *   are resolved when read, only for entries the caller may read in the Content Manager.
     * @sideeffect A read with an admin API token queues a `security-log.read` event.
     */
    async listContentActivity(ctx) {
      return handle(
        ctx,
        activityQuerySchema,
        (query) => {
          auditTokenRead(ctx, 'content', false);
          return service().listContentActivity(query, viewerOf(ctx));
        },
        'content'
      );
    },

    /**
     * One export batch (500 rows, keyset cursor) of the sign-in history.
     *
     * @route GET /magic-sessionmanager/admin-activity/sign-ins/export
     * @auth As listSignIns.
     * @param {Context} ctx Same filters as the list, plus `cursor` from the previous batch.
     * @returns {Promise<unknown>} 200 `{ data, meta: { nextCursor } }`; 400; 500.
     */
    async exportSignIns(ctx) {
      return handle(
        ctx,
        signInExportSchema,
        (query) => {
          auditTokenRead(ctx, 'sign-ins', true);
          return service().exportBatch('sign-ins', query, query.cursor || null, viewerOf(ctx));
        },
        'sign-in export'
      );
    },

    /**
     * One export batch (500 rows, keyset cursor) of Content Manager activity.
     *
     * @route GET /magic-sessionmanager/admin-activity/content/export
     * @auth As listContentActivity.
     * @param {Context} ctx Same filters as the list, plus `cursor`.
     * @returns {Promise<unknown>} 200 `{ data, meta: { nextCursor } }`; 400; 500.
     */
    async exportContentActivity(ctx) {
      return handle(
        ctx,
        activityExportSchema,
        (query) => {
          auditTokenRead(ctx, 'content', true);
          return service().exportBatch('content', query, query.cursor || null, viewerOf(ctx));
        },
        'activity export'
      );
    },
  };
};
