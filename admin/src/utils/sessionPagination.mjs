/**
 * Returns a bounded page and its display range from a filtered session list.
 * Invalid page numbers and page sizes are normalized so callers never render
 * an out-of-range slice.
 *
 * @param {Array<unknown>} sessions Complete filtered result set.
 * @param {number|string} currentPage Requested one-based page number.
 * @param {number|string} pageSize Requested number of rows per page.
 * @returns {{items: Array<unknown>, page: number, pageCount: number, startIndex: number, endIndex: number, total: number}}
 *   Page items and one-based range indexes, or a zero range when empty.
 */
export function paginateSessions(sessions = [], currentPage = 1, pageSize = 25) {
  const items = Array.isArray(sessions) ? sessions : [];
  const requestedSize = Number(pageSize);
  const normalizedSize = Number.isFinite(requestedSize) && requestedSize > 0
    ? Math.floor(requestedSize)
    : 1;
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / normalizedSize));
  const requestedPage = Number(currentPage);
  const page = Math.min(
    pageCount,
    Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1)
  );
  const offset = (page - 1) * normalizedSize;

  return {
    items: items.slice(offset, offset + normalizedSize),
    page,
    pageCount,
    startIndex: total === 0 ? 0 : offset + 1,
    endIndex: Math.min(total, offset + normalizedSize),
    total,
  };
}
