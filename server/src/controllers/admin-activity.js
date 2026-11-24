'use strict';

// @ts-check

/** @import { Context } from 'koa' */

const { z } = require('@strapi/utils');
const { CONTENT_ACTIONS, SIGN_IN_FILTERS } = require('../utils/security-log-model');
const { parseInput } = require('../utils/admin-sessions');
const { sendServerError, sendValidationError } = require('../utils/http-errors');
const { createLogger } = require('../utils/logger');

/** Largest page of either list. */
const MAX_PAGE_SIZE = 100;

const adminIdField = z
  .string()
  .regex(/^[1-9][0-9]{0,11}$/, 'adminId must be a positive integer')
  .transform(Number)
  .optional();

const dateField = (name) =>
  z
    .string()
    .max(40, `${name} must be an ISO 8601 date`)
    .refine((value) => !Number.isNaN(Date.parse(value)), `${name} must be an ISO 8601 date`)
    .transform((value) => new Date(value))
    .optional();

const common = {
  adminId: adminIdField,
  from: dateField('from'),
  to: dateField('to'),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
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

const cursorField = z
  .string()
  .regex(/^[1-9][0-9]{0,15}$/, 'cursor must be a positive integer')
  .transform(Number)
  .optional();

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
   * Validates a query, runs the handler and maps failures to a fixed 500.
   *
   * @param {Context} ctx Koa context.
   * @param {import('zod').ZodType<any>} schema Query schema.
   * @param {(query: any) => Promise<unknown>} run Handler.
   * @param {string} operation Name for the log line.
   * @returns {Promise<unknown>} Response body.
   */
  const handle = async (ctx, schema, run, operation) => {
    const parsed = parseInput(schema, ctx.query);
    if (!parsed.ok) return sendValidationError(ctx, 'Invalid query', parsed.errors);
    const query = parsed.value;
    if (query.from && query.to && query.from > query.to) {
      return sendValidationError(ctx, 'Invalid query', [
        { path: ['from'], message: 'from must not be after to' },
      ]);
    }
    try {
      ctx.body = await run(query);
      return ctx.body;
    } catch (error) {
      log.error(`Admin activity: ${operation} failed`, /** @type {any} */ (error)?.name || 'Error');
      return sendServerError(ctx, 500, 'Admin activity could not be loaded.');
    }
  };

  return {
    /**
     * One page of the admin sign-in history: sign-ins, failed attempts,
     * lockouts and sign-outs, newest first.
     *
     * @route GET /magic-sessionmanager/admin-activity/sign-ins
     * @auth Admin JWT or admin API token; admin::hasPermissions access + admin-activity.read;
     *   read rate limit.
     * @param {Context} ctx Reads `ctx.query.adminId` (optional positive integer), `event`
     *   (`all`|`succeeded`|`failed`|`signed-out`), `from`/`to` (ISO dates), `page`, `pageSize`
     *   (1..100, default 20).
     * @returns {Promise<unknown>} 200 `{ data: SignInRow[], meta: { pagination, recording } }`;
     *   400 ValidationError with field errors; 500 fixed message. Rows hold IP address
     *   (possibly anonymised), location, browser, OS and session state; never the device id,
     *   a typed email or a token.
     */
    async listSignIns(ctx) {
      return handle(ctx, signInQuerySchema, (query) => service().listSignIns(query), 'sign-ins');
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
     *   contentTypes, contentManagerAccess? } }`; 400; 500 fixed message.
     */
    async listContentActivity(ctx) {
      return handle(
        ctx,
        activityQuerySchema,
        (query) => service().listContentActivity(query),
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
        (query) => service().exportBatch('sign-ins', query, query.cursor || null),
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
        (query) => service().exportBatch('content', query, query.cursor || null),
        'activity export'
      );
    },
  };
};
