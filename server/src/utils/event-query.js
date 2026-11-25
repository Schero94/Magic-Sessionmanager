'use strict';

// @ts-check

/**
 * Query schema parts shared by the security log list endpoints (admin
 * sign-in history, Content Manager activity, app-user security activity):
 * ISO dates, paging, the keyset export cursor and the common request
 * handler that validates, checks the period and maps failures to a fixed
 * 500. One definition, so every list rejects the same bad input the same way.
 */

const { z } = require('@strapi/utils');
const { parseInput } = require('./admin-sessions');
const { sendServerError, sendValidationError } = require('./http-errors');

/** Largest page of a list. */
const MAX_PAGE_SIZE = 100;

/**
 * Optional ISO 8601 date (at most 40 characters).
 *
 * @param {string} name Field name for the message.
 * @returns {import('zod').ZodType<Date|undefined>} Schema.
 */
const dateField = (name) =>
  z
    .string()
    .max(40, `${name} must be an ISO 8601 date`)
    .refine((value) => !Number.isNaN(Date.parse(value)), `${name} must be an ISO 8601 date`)
    .transform((value) => new Date(value))
    .optional();

/** Period and paging fields of every list. */
const periodAndPaging = () => ({
  from: dateField('from'),
  to: dateField('to'),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

/** Keyset cursor of an export batch: the id below which to continue. */
const cursorField = z
  .string()
  .regex(/^[1-9][0-9]{0,15}$/, 'cursor must be a positive integer')
  .transform(Number)
  .optional();

/**
 * Validates a list query, checks that `from` is not after `to`, runs the
 * handler and maps an unexpected failure to a fixed 500 (the error name is
 * logged, never its message).
 *
 * @param {any} ctx Koa context.
 * @param {import('zod').ZodType<any>} schema Query schema.
 * @param {(query: any) => Promise<unknown>} run Handler.
 * @param {{log: {error: Function}, logPrefix: string, operation: string,
 *   failureMessage: string}} options Logging and the client message.
 * @returns {Promise<unknown>} Response body.
 */
async function handleEventQuery(ctx, schema, run, { log, logPrefix, operation, failureMessage }) {
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
    log.error(`${logPrefix}: ${operation} failed`, /** @type {any} */ (error)?.name || 'Error');
    return sendServerError(ctx, 500, failureMessage);
  }
}

module.exports = {
  MAX_PAGE_SIZE,
  cursorField,
  dateField,
  handleEventQuery,
  periodAndPaging,
};
