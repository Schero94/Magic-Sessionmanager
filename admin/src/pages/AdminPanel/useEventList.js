import { useCallback, useEffect, useRef, useState } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';
import { isCancelledRequest, logSafeAdminError } from '../../utils/safeAdminLog.mjs';
import { MAX_EVENT_EXPORT_ROWS, toExportParams } from './adminActivityModel.mjs';

/**
 * Loads a paged security-event list (sign-in history or activity) with
 * "Show more": the first page replaces the rows, later pages append. A
 * changed query starts again at page 1; an outdated or cancelled response
 * sets no state.
 *
 * @param {object} options
 * @param {string} options.path Admin API path of the list.
 * @param {Record<string, string|number>} options.params Query without the page.
 * @param {string} options.logKey Key for the safe error log.
 * @returns {{rows: object[], meta: object|null, loading: boolean, loadingMore: boolean,
 *   error: boolean, hasMore: boolean, loadMore: () => void, reload: () => void,
 *   exportAll: () => Promise<{rows: object[], capped: boolean}>}} List state.
 */
export function useEventList({ path, params, logKey }) {
  const { get } = useFetchClient();
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const requestRef = useRef(0);
  const key = JSON.stringify(params);

  const load = useCallback(
    async (nextPage) => {
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      if (nextPage === 1) setLoading(true);
      else setLoadingMore(true);
      try {
        const response = await get(path, { params: { ...JSON.parse(key), page: nextPage } });
        if (requestId !== requestRef.current) return;
        const body = response?.data || {};
        const data = Array.isArray(body.data) ? body.data : [];
        setRows((current) => (nextPage === 1 ? data : [...current, ...data]));
        setMeta(body.meta || null);
        setPage(nextPage);
        setError(false);
      } catch (err) {
        if (requestId !== requestRef.current || isCancelledRequest(err)) return;
        setError(true);
        logSafeAdminError(logKey, err);
      } finally {
        if (requestId === requestRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [get, path, key, logKey]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state updates run after await; the compiler cannot see through the callback
    load(1);
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  const pagination = meta?.pagination;
  const hasMore = Boolean(pagination && page < pagination.pageCount);

  /**
   * Reads every row matching the filters in export batches (keyset cursor),
   * up to MAX_EVENT_EXPORT_ROWS.
   *
   * @returns {Promise<{rows: object[], capped: boolean}>} Rows and whether the cap was hit.
   */
  const exportAll = useCallback(async () => {
    const all = [];
    let cursor = null;
    do {
      const response = await get(`${path}/export`, {
        params: toExportParams(JSON.parse(key), cursor),
      });
      const body = response?.data || {};
      if (!Array.isArray(body.data)) throw new Error('Invalid export response');
      all.push(...body.data);
      cursor = typeof body.meta?.nextCursor === 'string' ? body.meta.nextCursor : null;
    } while (cursor && all.length < MAX_EVENT_EXPORT_ROWS);
    return {
      rows: all.slice(0, MAX_EVENT_EXPORT_ROWS),
      capped: all.length > MAX_EVENT_EXPORT_ROWS || Boolean(cursor),
    };
  }, [get, path, key]);

  return {
    rows,
    meta,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore: () => load(page + 1),
    reload: () => load(1),
    exportAll,
  };
}

/**
 * Starts a browser download of generated CSV text.
 *
 * @param {string} content CSV text.
 * @param {string} name File name prefix.
 * @returns {void}
 */
export function downloadCsv(content, name) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}-${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
