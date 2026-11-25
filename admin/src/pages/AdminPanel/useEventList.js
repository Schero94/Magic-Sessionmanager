import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useFetchClient } from '@strapi/strapi/admin';
import { getTranslation } from '../../utils/getTranslation';
import { isCancelledRequest, logSafeAdminError } from '../../utils/safeAdminLog.mjs';
import { MAX_EVENT_EXPORT_ROWS, toExportParams } from './adminActivityModel.mjs';
import { withEventAdminNames } from './adminPanelModel.mjs';

/**
 * Loads a paged security-event list (sign-in history or activity) with
 * "Show more": the first page replaces the rows, later pages append. A
 * changed query starts again at its first page (`params.page`, default 1:
 * the full "Sign-in activity" page keeps its page in the URL and shows one
 * page at a time); an outdated or cancelled response sets no state.
 *
 * @param {object} options
 * @param {string} options.path Admin API path of the list.
 * @param {Record<string, string|number>} options.params Query; `page` is the first page to load.
 * @param {string} options.logKey Key for the safe error log.
 * @returns {{rows: object[], meta: object|null, loading: boolean, loadingMore: boolean,
 *   error: boolean, hasMore: boolean, loadMore: () => void, reload: () => void,
 *   exportAll: () => Promise<{rows: object[], capped: boolean}>}} List state.
 */
export function useEventList({ path, params, logKey }) {
  const { get } = useFetchClient();
  const { formatMessage } = useIntl();
  /** Hidden admin names (no `admin::users.read`, 4.17) read "Admin #id". */
  const fillNames = useCallback(
    (list) =>
      list.map((row) =>
        withEventAdminNames(row, (id) =>
          formatMessage(
            {
              id: getTranslation('adminPanel.identity.placeholder'),
              defaultMessage: 'Admin #{id}',
            },
            { id }
          )
        )
      ),
    [formatMessage]
  );
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const requestRef = useRef(0);
  const key = JSON.stringify(params);
  const firstPage = Number(params?.page) > 0 ? Number(params.page) : 1;

  const load = useCallback(
    async (nextPage) => {
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      if (nextPage === firstPage) setLoading(true);
      else setLoadingMore(true);
      try {
        const response = await get(path, { params: { ...JSON.parse(key), page: nextPage } });
        if (requestId !== requestRef.current) return;
        const body = response?.data || {};
        const data = fillNames(Array.isArray(body.data) ? body.data : []);
        setRows((current) => (nextPage === firstPage ? data : [...current, ...data]));
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
    [get, path, key, logKey, fillNames, firstPage]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state updates run after await; the compiler cannot see through the callback
    load(firstPage);
    return () => {
      requestRef.current += 1;
    };
  }, [load, firstPage]);

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
      all.push(...fillNames(body.data));
      cursor = typeof body.meta?.nextCursor === 'string' ? body.meta.nextCursor : null;
    } while (cursor && all.length < MAX_EVENT_EXPORT_ROWS);
    return {
      rows: all.slice(0, MAX_EVENT_EXPORT_ROWS),
      capped: all.length > MAX_EVENT_EXPORT_ROWS || Boolean(cursor),
    };
  }, [get, path, key, fillNames]);

  return {
    rows,
    meta,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore: () => load(page + 1),
    reload: () => load(firstPage),
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
