/**
 * Request parameters and response guards for the paginated admin session
 * list (`GET /sessions?page=…`), the count-only statistics
 * (`GET /sessions/stats`) and the export batches (`GET /sessions/export`).
 */

/** Rows one export contains at most; the server sends batches of 1000. */
export const MAX_EXPORT_ROWS = 50000;

/** Rows per export request. */
export const EXPORT_BATCH_SIZE = 1000;

/** Statistics shown before the first response arrives. */
export const EMPTY_SESSION_STATS = Object.freeze({
  total: 0,
  open: 0,
  active: 0,
  idle: 0,
  ended: 0,
  loggedOut: 0,
  timedOut: 0,
  otherReasons: 0,
  usersOnline: 0,
  nativeOnly: 0,
  nativeOnlyAfterTracking: null,
});

/** Statistics that must be whole, non-negative counts. */
const COUNT_KEYS = Object.freeze(
  Object.keys(EMPTY_SESSION_STATS).filter((key) => key !== 'nativeOnlyAfterTracking')
);

/**
 * Filter parameters shared by the list and the export. Defaults are left
 * out so the URLs stay short; `reason` only applies to ended sessions.
 *
 * @param {{status?: string, reason?: string, search?: string}} query Dashboard state.
 * @returns {Record<string, string>}
 */
function filterParams(query) {
  const params = {};
  if (query.status && query.status !== 'all') params.status = query.status;
  if (query.status === 'ended' && query.reason && query.reason !== 'all') {
    params.reason = query.reason;
  }
  const search = typeof query.search === 'string' ? query.search.trim().slice(0, 100) : '';
  if (search) params.search = search;
  return params;
}

/**
 * Query parameters of one list page.
 *
 * @param {{page: number, pageSize: string|number, status?: string, reason?: string, search?: string}} query
 * @returns {Record<string, string>}
 */
export function buildListParams(query) {
  return {
    page: String(Math.max(1, Number(query.page) || 1)),
    pageSize: String(query.pageSize),
    ...filterParams(query),
  };
}

/**
 * Query parameters of one export batch.
 *
 * @param {{status?: string, reason?: string, search?: string}} query
 * @param {string|null} cursor Cursor from the previous batch.
 * @returns {Record<string, string>}
 */
export function buildExportParams(query, cursor) {
  return {
    limit: String(EXPORT_BATCH_SIZE),
    ...filterParams(query),
    ...(cursor ? { cursor } : {}),
  };
}

const isCount = (value) => Number.isInteger(value) && value >= 0;

/**
 * Reads a paginated list response.
 *
 * @param {unknown} payload `{ data: object[], meta: { pagination: { total, pageCount } } }`
 * @returns {{rows: object[], pagination: {total: number, pageCount: number}}}
 * @throws {Error} When the payload does not have that shape.
 */
export function readSessionPage(payload) {
  const body = /** @type {any} */ (payload);
  const pagination = body?.meta?.pagination;
  if (
    !Array.isArray(body?.data) ||
    !isCount(pagination?.total) ||
    !isCount(pagination?.pageCount)
  ) {
    throw new Error('Invalid session page response');
  }
  return {
    rows: body.data,
    pagination: { total: pagination.total, pageCount: Math.max(1, pagination.pageCount) },
  };
}

/**
 * Reads the count-only statistics response.
 *
 * @param {unknown} payload `{ data: { total, active, ... } }`
 * @returns {typeof EMPTY_SESSION_STATS}
 * @throws {Error} When a count is missing or not a non-negative integer.
 */
export function readSessionStats(payload) {
  const data = /** @type {any} */ (payload)?.data;
  const stats = { ...EMPTY_SESSION_STATS };
  for (const key of COUNT_KEYS) {
    if (!isCount(data?.[key])) throw new Error('Invalid session statistics response');
    stats[key] = data[key];
  }
  // Unknown (null) when the server has no tracking start date, or on 4.x servers.
  stats.nativeOnlyAfterTracking = isCount(data?.nativeOnlyAfterTracking)
    ? data.nativeOnlyAfterTracking
    : null;
  return stats;
}
