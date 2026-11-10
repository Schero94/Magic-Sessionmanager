'use strict';

/**
 * Validation and Query Engine filters for the paginated admin session list,
 * the session statistics and the export batches.
 *
 * Security: every value that reaches a query comes from a whitelist (status,
 * end reason, sort) or is passed as a bound parameter through the Strapi
 * Query Engine (`$containsi`, which escapes LIKE wildcards in
 * @strapi/database `where.js`). Raw field or sort names from the request are
 * never used.
 *
 * Docs: Strapi 5 Query Engine filtering, ordering and pagination
 * (docs.strapi.io/cms/api/query-engine/filtering, .../order-pagination);
 * zod 4 (`z` re-exported by @strapi/utils 5.61).
 */

const { z } = require('@strapi/utils');

/** Status filters of the dashboard (same values as the admin URL state). */
const SESSION_STATUS_FILTERS = Object.freeze(['all', 'open', 'active', 'idle', 'ended']);

/** End reasons stored on a session row. */
const RECORDED_END_REASONS = Object.freeze(['logout', 'idle', 'expired', 'manual', 'blocked']);

/** End-reason filters, including rows without a stored reason. */
const END_REASON_FILTERS = Object.freeze(['all', ...RECORDED_END_REASONS, 'unrecorded']);

/**
 * Sort keys the API accepts, mapped to Query Engine `orderBy` lists. The id
 * tie-breaker keeps pages stable when several rows share a timestamp.
 */
const SORT_ORDERS = Object.freeze({
  'loginTime:desc': [{ loginTime: 'desc' }, { id: 'desc' }],
  'loginTime:asc': [{ loginTime: 'asc' }, { id: 'asc' }],
  'lastActive:desc': [{ lastActive: 'desc' }, { id: 'desc' }],
  'lastActive:asc': [{ lastActive: 'asc' }, { id: 'asc' }],
});

const SORT_KEYS = Object.freeze(Object.keys(SORT_ORDERS));

/** Largest page an admin can request. */
const MAX_PAGE_SIZE = 100;

/** Longest accepted search text. */
const MAX_SEARCH_LENGTH = 100;

/**
 * Deepest row offset a page may start at. Deep OFFSET scans grow linearly;
 * past this window the admin narrows the filter, and the export walks every
 * row with a keyset cursor instead.
 */
const MAX_LIST_OFFSET = 50_000;

/** Rows per export batch. */
const MAX_EXPORT_BATCH = 1000;

/** Rows one export may contain in total (enforced by the admin client). */
const MAX_EXPORT_ROWS = 50_000;

/** Session columns the list reads. Token columns are never selected. */
const LIST_FIELDS = Object.freeze([
  'id',
  'documentId',
  'sessionId',
  'nativeSessionId',
  'ipAddress',
  'userAgent',
  'loginTime',
  'logoutTime',
  'lastActive',
  'isActive',
  'terminatedManually',
  'terminationReason',
  'geoLocation',
  'securityScore',
  'deviceType',
  'browserName',
  'osName',
  'createdAt',
  'updatedAt',
]);

/** User columns shown next to a session (the same the list showed before). */
const LIST_USER_FIELDS = Object.freeze(['documentId', 'email', 'username']);

const searchText = z
  .string()
  .trim()
  .max(MAX_SEARCH_LENGTH, `search must be at most ${MAX_SEARCH_LENGTH} characters`);

const filterShape = {
  status: z.enum(SESSION_STATUS_FILTERS).default('all'),
  reason: z.enum(END_REASON_FILTERS).default('all'),
  search: searchText.default(''),
};

/** Query of `GET /sessions?page=…` (paginated mode). */
const listQuerySchema = z
  .strictObject({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
    sort: z.enum(SORT_KEYS).default('loginTime:desc'),
    ...filterShape,
  })
  .refine((query) => (query.page - 1) * query.pageSize < MAX_LIST_OFFSET, {
    message: `Pages past the first ${MAX_LIST_OFFSET} sessions are not available. Narrow the filter or use the export.`,
    path: ['page'],
  });

/** Query of `GET /sessions/export`. */
const exportQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(MAX_EXPORT_BATCH).default(MAX_EXPORT_BATCH),
  cursor: z.string().max(200).optional(),
  ...filterShape,
});

/** Query of `GET /sessions/stats` (no parameters). */
const statsQuerySchema = z.strictObject({});

/**
 * Whether a request asks for the paginated list. Without `page` and
 * `pageSize` the endpoint keeps its 4.x response for existing callers.
 *
 * @param {object} query Koa query object.
 * @returns {boolean}
 */
function isPaginatedListQuery(query) {
  return Boolean(
    query &&
    (Object.prototype.hasOwnProperty.call(query, 'page') ||
      Object.prototype.hasOwnProperty.call(query, 'pageSize'))
  );
}

/**
 * Validates a query against a schema and returns the parsed value or the
 * list of problems (path + message only, no input echo).
 *
 * @template T
 * @param {import('zod').ZodType<T>} schema
 * @param {unknown} input
 * @returns {{ok: true, value: T}|{ok: false, errors: Array<{path: string, message: string}>}}
 */
function parseQuery(schema, input) {
  const result = schema.safeParse(input ?? {});
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

/**
 * Rows that were used within the inactivity timeout. Mirrors
 * `enhanceSession`: the last activity is `lastActive`, or `loginTime` when a
 * row has no `lastActive` yet.
 *
 * @param {Date} cutoff Now minus the inactivity timeout.
 * @returns {object} Query Engine condition.
 */
function usedSince(cutoff) {
  return {
    $or: [
      { lastActive: { $gt: cutoff } },
      { $and: [{ lastActive: { $null: true } }, { loginTime: { $gt: cutoff } }] },
    ],
  };
}

/**
 * Rows not used within the inactivity timeout.
 *
 * @param {Date} cutoff Now minus the inactivity timeout.
 * @returns {object} Query Engine condition.
 */
function notUsedSince(cutoff) {
  return {
    $or: [
      { lastActive: { $lte: cutoff } },
      { $and: [{ lastActive: { $null: true } }, { loginTime: { $lte: cutoff } }] },
    ],
  };
}

/**
 * Builds the Query Engine `where` for the list, stats and export filters.
 *
 * @param {{status?: string, reason?: string, search?: string}} filters Parsed filters.
 * @param {{cutoff: Date}} context Inactivity cutoff.
 * @returns {object} Query Engine `where` clause.
 */
function buildSessionWhere({ status = 'all', reason = 'all', search = '' } = {}, { cutoff }) {
  const conditions = [];

  if (status === 'open') conditions.push({ isActive: true });
  if (status === 'active') conditions.push({ isActive: true }, usedSince(cutoff));
  if (status === 'idle') conditions.push({ isActive: true }, notUsedSince(cutoff));
  if (status === 'ended') {
    conditions.push({ isActive: false });
    if (reason === 'unrecorded') {
      conditions.push({
        $or: [
          { terminationReason: { $null: true } },
          { terminationReason: { $notIn: [...RECORDED_END_REASONS] } },
        ],
      });
    } else if (RECORDED_END_REASONS.includes(reason)) {
      conditions.push({ terminationReason: reason });
    }
  }

  if (search) {
    conditions.push({
      $or: [
        { user: { email: { $containsi: search } } },
        { user: { username: { $containsi: search } } },
        { ipAddress: { $containsi: search } },
        { browserName: { $containsi: search } },
        { osName: { $containsi: search } },
        { deviceType: { $containsi: search } },
      ],
    });
  }

  return conditions.length ? { $and: conditions } : {};
}

/**
 * Encodes an export keyset cursor (last row's loginTime and id).
 *
 * @param {{loginTime: string|Date|null, id: number}} row
 * @returns {string} URL-safe cursor.
 */
function encodeExportCursor(row) {
  const time = row.loginTime ? new Date(row.loginTime).toISOString() : null;
  return Buffer.from(JSON.stringify([time, Number(row.id)])).toString('base64url');
}

/**
 * Decodes and validates an export cursor.
 *
 * @param {string|undefined} cursor
 * @returns {{loginTime: Date|null, id: number}|null|false} null without cursor, false when invalid.
 */
function decodeExportCursor(cursor) {
  if (cursor === undefined || cursor === '') return null;
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return false;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(value) || value.length !== 2) return false;
    const [time, id] = value;
    if (!Number.isSafeInteger(id) || id < 1) return false;
    if (time === null) return { loginTime: null, id };
    if (typeof time !== 'string' || Number.isNaN(Date.parse(time))) return false;
    return { loginTime: new Date(time), id };
  } catch {
    return false;
  }
}

/**
 * Keyset condition for the next export batch, ordered by loginTime desc and
 * id desc.
 *
 * @param {{loginTime: Date|null, id: number}} cursor
 * @returns {object} Query Engine condition.
 */
function afterExportCursor(cursor) {
  if (cursor.loginTime === null) return { id: { $lt: cursor.id } };
  return {
    $or: [
      { loginTime: { $lt: cursor.loginTime } },
      { $and: [{ loginTime: cursor.loginTime }, { id: { $lt: cursor.id } }] },
    ],
  };
}

module.exports = {
  SESSION_STATUS_FILTERS,
  RECORDED_END_REASONS,
  END_REASON_FILTERS,
  SORT_ORDERS,
  SORT_KEYS,
  MAX_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
  MAX_LIST_OFFSET,
  MAX_EXPORT_BATCH,
  MAX_EXPORT_ROWS,
  LIST_FIELDS,
  LIST_USER_FIELDS,
  listQuerySchema,
  exportQuerySchema,
  statsQuerySchema,
  isPaginatedListQuery,
  parseQuery,
  buildSessionWhere,
  encodeExportCursor,
  decodeExportCursor,
  afterExportCursor,
};
