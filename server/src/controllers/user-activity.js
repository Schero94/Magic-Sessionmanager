'use strict';

// @ts-check

/** @import { Context } from 'koa' */

const { z } = require('@strapi/utils');
const { USER_ACTIVITY_FILTERS } = require('../utils/user-activity-model');
const { cursorField, handleEventQuery, periodAndPaging } = require('../utils/event-query');
const { createLogger } = require('../utils/logger');
const { callerCan } = require('../utils/settings-access');

const IMPERSONATE_USERS_ACTION = 'plugin::magic-sessionmanager.impersonate.users';

const listQuerySchema = z.strictObject({
  event: z
    .enum(/** @type {[string, ...string[]]} */ (Object.keys(USER_ACTIVITY_FILTERS)))
    .default('all'),
  userId: z
    .string()
    .regex(/^[A-Za-z0-9]{1,64}$/, 'userId must be the documentId of a user')
    .optional(),
  ...periodAndPaging(),
});

const exportQuerySchema = listQuerySchema.omit({ page: true, pageSize: true }).extend({
  cursor: cursorField,
});

/**
 * App-user security activity (4.22): the events about Users & Permissions
 * accounts in the security log. Every route is admin-only and needs
 * `plugin::magic-sessionmanager.access` plus `user-activity.read` (see
 * routes/admin.js); only Super Admins hold the new action by default.
 *
 * @param {{strapi: any}} deps Strapi instance.
 * @returns {Record<string, (ctx: Context) => Promise<unknown>>} Controller actions.
 */
module.exports = ({ strapi }) => {
  const log = createLogger(strapi);
  const service = () => strapi.plugin('magic-sessionmanager').service('security-log');

  /**
   * The reader as the service needs it: the ability (user identities through
   * the Content Manager), admin names (`admin::users.read`) and impersonation
   * reasons (`impersonate.users`).
   *
   * @param {Context} ctx Koa context.
   * @returns {{ability: any, canReadAdmins: boolean, canSeeImpersonationReason: boolean}} Viewer.
   */
  const viewerOf = (ctx) => ({
    ability: /** @type {any} */ (ctx).state?.userAbility || null,
    canReadAdmins: callerCan(ctx, 'admin::users.read'),
    canSeeImpersonationReason: callerCan(ctx, IMPERSONATE_USERS_ACTION),
  });

  /**
   * Audits a read: a list read with an admin API token (as for the admin
   * lists since 4.17), and the start of every export (admin panel or token).
   * Auditing never fails the read.
   *
   * @param {Context} ctx Koa context.
   * @param {boolean} exported Export batch.
   * @returns {void}
   */
  const audit = (ctx, exported) => {
    const state = /** @type {any} */ (ctx).state;
    const viaToken = state?.auth?.strategy?.name === 'admin-token';
    if (!viaToken && !exported) return;
    try {
      service().recordLogRead({
        adminId: state?.user?.id,
        tokenId: viaToken ? state?.auth?.credentials?.id : null,
        list: 'user-activity',
        exported,
        via: viaToken ? 'admin-token' : 'admin-panel',
      });
    } catch {
      // Auditing must not fail the read.
    }
  };

  /**
   * @param {Context} ctx Koa context.
   * @param {import('zod').ZodType<any>} schema Query schema.
   * @param {(query: any) => Promise<unknown>} run Handler.
   * @param {string} operation Name for the log line.
   * @returns {Promise<unknown>} Response body.
   */
  const handle = (ctx, schema, run, operation) =>
    handleEventQuery(ctx, schema, run, {
      log,
      logPrefix: 'User activity',
      operation,
      failureMessage: 'Security activity could not be loaded.',
    });

  return {
    /**
     * One page of the app-user security activity, newest first.
     *
     * @route GET /magic-sessionmanager/user-activity
     * @auth Admin JWT or admin API token; admin::hasPermissions access + user-activity.read;
     *   read rate limit.
     * @param {Context} ctx Reads `ctx.query.event` (`all`|`failed`|`lockouts`|`suspicious`|
     *   `sessions`|`privacy`|`impersonation`), `userId` (documentId of a Users & Permissions
     *   user), `from`/`to` (ISO dates), `page`, `pageSize` (1..100, default 20). Unknown keys
     *   are a 400.
     * @returns {Promise<unknown>} 200 `{ data: UserEventRow[], meta: { pagination, recording,
     *   identity } }`; 400 ValidationError with field errors; 500 fixed message. Rows hold the
     *   event, time, the user (`{ id, documentId, email, username }`, email and username empty
     *   unless the caller may read that user in the Content Manager), the admin who acted
     *   (name empty without `admin::users.read`), the event's facts (numbers and codes; the
     *   impersonation reason only with `impersonate.users`), IP address as the current
     *   switches allow it, location, browser, OS and the stored user agent. Rows older than
     *   the retention period are left out.
     * @sideeffect A read with an admin API token queues a `security-log.read` event.
     */
    async list(ctx) {
      return handle(
        ctx,
        listQuerySchema,
        (query) => {
          audit(ctx, false);
          return service().listUserActivity(query, viewerOf(ctx));
        },
        'list'
      );
    },

    /**
     * One export batch (500 rows, keyset cursor) of the app-user security activity.
     *
     * @route GET /magic-sessionmanager/user-activity/export
     * @auth As list.
     * @param {Context} ctx Same filters as the list, plus `cursor` from the previous batch.
     * @returns {Promise<unknown>} 200 `{ data, meta: { nextCursor } }`; 400; 500.
     * @sideeffect The first batch of an export (no `cursor`) queues a `security-log.read` event
     *   with `list: 'user-activity'`, `exported: true` and `via` (`admin-panel` or
     *   `admin-token`).
     */
    async export(ctx) {
      return handle(
        ctx,
        exportQuerySchema,
        (query) => {
          if (!query.cursor) audit(ctx, true);
          return service().exportBatch('user-activity', query, query.cursor || null, viewerOf(ctx));
        },
        'export'
      );
    },
  };
};
