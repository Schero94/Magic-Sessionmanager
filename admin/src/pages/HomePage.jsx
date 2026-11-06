import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Pagination,
  SearchInput,
  useFetchClient,
  useNotification,
  useQueryParams,
} from '@strapi/strapi/admin';
import {
  Button,
  EmptyStateLayout,
  Flex,
  IconButton,
  Loader,
  MenuItem,
  SimpleMenu,
  SingleSelect,
  SingleSelectOption,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { ArrowClockwise, Check, Clock, Cross, Download, Monitor, Search, User } from '@strapi/icons';
import pluginId from '../pluginId';
import { getTranslation } from '../utils/getTranslation';
import { logSafeAdminError } from '../utils/safeAdminLog.mjs';
import { getSessionStatus } from '../utils/sessionStatus.mjs';
import { requireSessionList } from '../utils/adminResponse.mjs';
import { restoreDialogFocus } from '../utils/restoreDialogFocus.mjs';
import {
  SESSION_FILTER_OPTIONS,
  filterSessionsBySearch,
  filterSessionsByStatus,
} from '../utils/sessionFilters.mjs';
import { paginateSessions } from '../utils/sessionPagination.mjs';
import { buildSessionCsv, buildSessionJson } from '../utils/sessionExports.mjs';
import { useSessionFormatters } from '../utils/useSessionFormatters';
import { useBreakpoint } from '../utils/useBreakpoint';
import { PageShell, StatCard, StatGrid } from '../components/ui';
import SessionDetailModal from '../components/SessionDetailModal';
import Alert from '../components/PersistentAlert';
import ReadableText from '../components/ReadableText';
import SessionTable from './Dashboard/SessionTable';
import SessionCardList from './Dashboard/SessionCardList';
import {
  AUTO_REFRESH_INTERVAL_MS,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  getExportDeviceInfo,
  getSessionStats,
  hasActiveFilters,
  parseDashboardQuery,
  pickFocusSessionId,
} from './Dashboard/dashboardModel.mjs';

/**
 * Starts a browser download for generated export text.
 *
 * @param {string} content File content.
 * @param {string} type MIME type.
 * @param {string} extension File extension without dot.
 * @returns {void}
 */
const downloadFile = (content, type, extension) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `sessions-export-${new Date().toISOString().split('T')[0]}.${extension}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

/**
 * Session Manager dashboard: native Strapi list view with KPI cards, URL-backed
 * search/filter/pagination, a DS table (cards below the large breakpoint),
 * confirmed row actions and the session detail modal.
 *
 * @returns {import('react').ReactElement} Dashboard page.
 */
const HomePage = () => {
  const { formatMessage } = useIntl();
  const { get, post, del } = useFetchClient();
  const { toggleNotification } = useNotification();
  const formatters = useSessionFormatters();
  const { isBelowLarge } = useBreakpoint();
  const [{ query }, setQuery] = useQueryParams();
  const t = (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const dashboard = parseDashboardQuery(query);

  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [terminatingSessionId, setTerminatingSessionId] = useState(null);
  const [deletingSessionId, setDeletingSessionId] = useState(null);
  const [searchResetKey, setSearchResetKey] = useState(0);
  const openerRef = useRef(null);
  const dashboardRef = useRef(null);
  const listHeadingRef = useRef(null);
  const hasLoadedRef = useRef(false);
  const requestIdRef = useRef(0);
  const visibleIdsRef = useRef([]);
  const mutationSnapshotRef = useRef([]);
  const listHeadingId = `session-list-heading-${useId().replace(/:/g, '')}`;
  const mutationPending = Boolean(terminatingSessionId || deletingSessionId);

  useEffect(() => {
    fetchSessions();
  }, []);

  /**
   * Loads the complete admin session collection for dashboard filtering,
   * pagination, detail views and exports. Only the first load shows the page
   * loader; later loads (refresh button, auto refresh, after a mutation) keep
   * the list mounted so keyboard focus and scroll position survive (DUX-02,
   * DASH-17). A failed load hides the stale rows behind the error alert.
   *
   * @returns {Promise<void>}
   */
  const fetchSessions = async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (hasLoadedRef.current) setRefreshing(true);
    else setLoading(true);

    try {
      const { data } = await get(`/${pluginId}/sessions`);
      const list = requireSessionList(data);
      if (requestId !== requestIdRef.current) return;
      setSessions(list);
      setLoadError(null);
      hasLoadedRef.current = true;
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setLoadError(t('homepage.error.load', 'Session data could not be loaded. Try again.'));
      logSafeAdminError('dashboard.loadSessions', err);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    // Silent background update every 10 minutes, paused while the detail
    // dialog is open or a mutation is running so nothing moves under the user.
    if (showDetailModal || mutationPending) return undefined;
    const interval = setInterval(() => {
      fetchSessions();
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [showDetailModal, mutationPending]);

  /**
   * Logs out one session after ConfirmAction confirmed it, then refreshes the
   * list in place. Rethrows on failure so the confirmation stays open for a
   * retry; the notification explains the failure.
   *
   * @param {string} sessionId Session ID accepted by the admin API.
   * @returns {Promise<void>}
   */
  const handleTerminateSession = async (sessionId) => {
    if (terminatingSessionId || deletingSessionId) return;
    mutationSnapshotRef.current = visibleIdsRef.current;
    setTerminatingSessionId(sessionId);
    try {
      await post(`/${pluginId}/sessions/${sessionId}/terminate`);
      await fetchSessions();
      toggleNotification({
        type: 'success',
        message: t('notifications.success.terminated', 'Session terminated successfully'),
      });
    } catch (err) {
      logSafeAdminError('dashboard.terminateSession', err);
      toggleNotification({
        type: 'danger',
        message: t('notifications.error.terminate', 'Failed to terminate session'),
      });
      throw err;
    } finally {
      setTerminatingSessionId(null);
    }
  };

  /**
   * Removes one session's details after ConfirmAction confirmed it. The
   * confirmation and result explain that token denial remains in force until
   * any unexpired access token reaches its expiry.
   *
   * @param {string} sessionId Session documentId
   * @returns {Promise<void>}
   */
  const handleDeleteSession = async (sessionId) => {
    if (terminatingSessionId || deletingSessionId) return;
    mutationSnapshotRef.current = visibleIdsRef.current;
    setDeletingSessionId(sessionId);
    try {
      await del(`/${pluginId}/sessions/${sessionId}`);
      await fetchSessions();
      toggleNotification({
        type: 'success',
        message: t('notifications.success.deleted', 'Session details removed. The access-token hash remains blocked until expiry.'),
      });
    } catch (err) {
      logSafeAdminError('dashboard.deleteSession', err);
      toggleNotification({
        type: 'danger',
        message: t('notifications.error.delete', 'Failed to delete session'),
      });
      throw err;
    } finally {
      setDeletingSessionId(null);
    }
  };

  // Filter the complete collection before deriving the visible page. Exports
  // intentionally consume this full result set, not just the current page.
  const filteredSessions = useMemo(
    () =>
      filterSessionsBySearch(
        filterSessionsByStatus(sessions, dashboard.status),
        dashboard.search,
        formatters.deviceTypeLabel
      ),
    [sessions, dashboard.status, dashboard.search, formatters]
  );
  const pageResult = paginateSessions(filteredSessions, dashboard.page, dashboard.pageSize);
  visibleIdsRef.current = pageResult.items.map((session) => String(session.id));

  /**
   * Downloads CSV for every session matching the current filters, not only the
   * rows visible on the current page. Columns and values are stable machine
   * data (see sessionExports.mjs), independent of the admin language.
   *
   * @returns {void}
   */
  const handleExportCSV = () => {
    try {
      const csvContent = buildSessionCsv(filteredSessions, {
        unavailableValue: '',
        getDeviceInfo: getExportDeviceInfo,
        getSessionStatus,
      });
      downloadFile(csvContent, 'text/csv;charset=utf-8;', 'csv');
      toggleNotification({
        type: 'success',
        message: t('notifications.success.exported', 'Exported {count} sessions to {format}', { count: filteredSessions.length, format: 'CSV' }),
      });
    } catch (err) {
      logSafeAdminError('dashboard.exportCsv', err);
      toggleNotification({
        type: 'danger',
        message: t('notifications.error.export', 'Failed to export sessions'),
      });
    }
  };

  /**
   * Downloads JSON for every session matching the current filters, not only
   * the rows visible on the current page.
   *
   * @returns {void}
   */
  const handleExportJSON = () => {
    try {
      const jsonContent = buildSessionJson(filteredSessions, {
        filterStatus: dashboard.status,
        totalSessions: sessions.length,
        exportedAt: new Date().toISOString(),
        unavailableValue: '',
        getDeviceInfo: getExportDeviceInfo,
        getSessionStatus,
      });
      downloadFile(jsonContent, 'application/json', 'json');
      toggleNotification({
        type: 'success',
        message: t('notifications.success.exported', 'Exported {count} sessions to {format}', { count: filteredSessions.length, format: 'JSON' }),
      });
    } catch (err) {
      logSafeAdminError('dashboard.exportJson', err);
      toggleNotification({
        type: 'danger',
        message: t('notifications.error.export', 'Failed to export sessions'),
      });
    }
  };

  const handleSessionClick = (session, opener) => {
    openerRef.current = opener;
    setSelectedSession(session);
    setShowDetailModal(true);
  };

  const handleModalClose = () => {
    setShowDetailModal(false);
    setSelectedSession(null);
  };

  /** Restore focus after the native dialog releases its focus trap. */
  const handleCloseAutoFocus = (event) => {
    restoreDialogFocus(event, openerRef.current, dashboardRef.current);
  };

  const handleSessionTerminated = () => {
    fetchSessions();
  };

  /**
   * Focus target used by ConfirmAction when a row's trigger disappeared after
   * a mutation refresh: the same row's View button, else the next or previous
   * row, else the list heading. Resolved lazily, after the refreshed rows render.
   *
   * @param {string} sessionId Row whose action ran.
   * @returns {{readonly current: HTMLElement|null}} Ref-like getter.
   */
  const getFocusFallback = useCallback((sessionId) => ({
    get current() {
      const targetId = pickFocusSessionId(mutationSnapshotRef.current, visibleIdsRef.current, sessionId);
      const root = dashboardRef.current;
      if (targetId && root) {
        const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(targetId) : targetId;
        const button = root.querySelector(`[data-session-view="${escaped}"]`);
        if (button) return button;
      }
      return listHeadingRef.current;
    },
  }), []);

  // Keep the URL page inside the result range after filtering or removals.
  useEffect(() => {
    if (!loading && dashboard.page > pageResult.pageCount) {
      setQuery({ page: String(pageResult.pageCount) }, 'push', true);
    }
  }, [loading, dashboard.page, pageResult.pageCount, setQuery]);

  const handleStatusChange = (value) => {
    setQuery({ status: value === 'all' ? undefined : value, page: '1' });
  };

  const handleClearFilters = () => {
    setQuery({ _q: undefined, status: undefined, page: '1' });
    setSearchResetKey((key) => key + 1);
    listHeadingRef.current?.focus();
  };

  const stats = getSessionStats(sessions);
  const showSessionData = !loading && !loadError;
  const showToolbar = showSessionData && sessions.length > 0;
  const canExport = showSessionData && filteredSessions.length > 0;
  const filtersActive = hasActiveFilters(dashboard);

  const exportActions = (
    <SimpleMenu
      label={t('homepage.export.label', 'Export')}
      variant="secondary"
      startIcon={<Download />}
      disabled={!canExport}
    >
      <MenuItem onSelect={handleExportCSV}>{t('homepage.export.csv', 'Export CSV')}</MenuItem>
      <MenuItem onSelect={handleExportJSON}>{t('homepage.export.json', 'Export JSON')}</MenuItem>
    </SimpleMenu>
  );

  const startActions = showToolbar ? (
    <SearchInput
      key={searchResetKey}
      label={t('homepage.search.label', 'Search sessions')}
      placeholder={t('homepage.search.placeholder', 'Search sessions')}
    />
  ) : null;

  const endActions = showToolbar ? (
    <Flex gap={2} alignItems="center">
      {refreshing ? (
        <Loader small role="status" aria-live="polite">
          {t('homepage.refreshing', 'Updating sessions')}
        </Loader>
      ) : null}
      <SingleSelect
        size="S"
        aria-label={t('homepage.filter.label', 'Filter sessions by status')}
        value={dashboard.status}
        onChange={handleStatusChange}
      >
        {SESSION_FILTER_OPTIONS.map((option) => (
          <SingleSelectOption key={option} value={option}>
            {option === 'all' ? t('homepage.filter.all', 'All statuses') : formatters.statusLabel(option)}
          </SingleSelectOption>
        ))}
      </SingleSelect>
      <IconButton label={t('homepage.actions.refresh', 'Refresh sessions')} onClick={() => fetchSessions()}>
        <ArrowClockwise />
      </IconButton>
    </Flex>
  ) : null;

  const listProps = {
    sessions: pageResult.items,
    labelledBy: listHeadingId,
    busy: refreshing,
    onView: handleSessionClick,
    onLogOut: handleTerminateSession,
    onRemove: handleDeleteSession,
    mutationPending,
    getFocusFallback,
  };

  return (
    <PageShell
      headingId="magic-sessionmanager-dashboard-title"
      title={t('homepage.title', 'Session Manager')}
      subtitle={t('homepage.subtitle', 'Monitor and manage end-user sessions')}
      primaryAction={exportActions}
      startActions={startActions}
      endActions={endActions}
    >
      <Flex
        ref={dashboardRef}
        tabIndex={-1}
        direction="column"
        alignItems="stretch"
        gap={6}
        minWidth={0}
      >
        {!loading && loadError ? (
          <Alert
            variant="danger"
            title={t('homepage.error.title', 'Unable to load sessions')}
            closeLabel={t('common.close', 'Close')}
            action={(
              <Button size="S" variant="secondary" onClick={fetchSessions}>
                {t('common.retry', 'Retry')}
              </Button>
            )}
          >
            <ReadableText variant="pi" textColor="neutral700" tag="span">
              {loadError}
            </ReadableText>
          </Alert>
        ) : null}

        {loading ? (
          <Flex justifyContent="center" padding={8}>
            <Loader>{t('homepage.loading', 'Loading sessions...')}</Loader>
          </Flex>
        ) : null}

        {showSessionData && (
          <Flex direction="column" alignItems="stretch" gap={2}>
            <VisuallyHidden>
              <Typography tag="h2">{t('homepage.stats.label', 'Session statistics')}</Typography>
            </VisuallyHidden>
            <StatGrid label={t('homepage.stats.label', 'Session statistics')}>
              <StatCard icon={Check} tone="success" label={t('homepage.stats.active', 'Active')} value={stats.active} />
              <StatCard icon={Clock} tone="warning" label={t('homepage.stats.idle', 'Idle')} value={stats.idle} />
              <StatCard
                icon={Cross}
                tone="neutral"
                label={t('homepage.stats.ended', 'Ended')}
                value={stats.ended}
                description={t('homepage.stats.endedBreakdown', '{loggedOut} logged out · {terminated} terminated', {
                  loggedOut: stats.loggedOut,
                  terminated: stats.terminated,
                })}
              />
              <StatCard icon={User} tone="primary" label={t('homepage.stats.total', 'Total')} value={stats.total} />
            </StatGrid>
          </Flex>
        )}

        {showSessionData && sessions.length > 0 && (
          <Flex direction="column" alignItems="stretch" gap={4} minWidth={0}>
            <Flex direction="column" alignItems="flex-start" gap={1}>
              <Typography
                id={listHeadingId}
                ref={listHeadingRef}
                tabIndex={-1}
                variant="delta"
                tag="h2"
                textColor="neutral800"
              >
                {t('homepage.allSessions', 'All sessions')}
              </Typography>
              <Typography variant="pi" textColor="neutral600" aria-live="polite">
                {dashboard.search
                  ? t(
                      'homepage.pagination.filteredRange',
                      'Showing {start}-{end} of {count} matching sessions (filtered by "{query}")',
                      { start: pageResult.startIndex, end: pageResult.endIndex, count: pageResult.total, query: dashboard.search }
                    )
                  : t(
                      'homepage.pagination.range',
                      'Showing {start}-{end} of {count} sessions',
                      { start: pageResult.startIndex, end: pageResult.endIndex, count: pageResult.total }
                    )}
              </Typography>
            </Flex>

            {filteredSessions.length > 0 ? (
              <>
                {isBelowLarge ? <SessionCardList {...listProps} /> : <SessionTable {...listProps} />}
                <Pagination.Root
                  pageCount={pageResult.pageCount}
                  total={pageResult.total}
                  defaultPageSize={Number(DEFAULT_PAGE_SIZE)}
                >
                  <Pagination.PageSize options={[...PAGE_SIZE_OPTIONS]} />
                  <Pagination.Links />
                </Pagination.Root>
              </>
            ) : (
              <EmptyStateLayout
                icon={<Search aria-hidden="true" />}
                content={t('homepage.noResults.description', 'Try adjusting your search or status filter.')}
                action={filtersActive ? (
                  <Button variant="secondary" onClick={handleClearFilters}>
                    {t('homepage.noResults.reset', 'Clear filters')}
                  </Button>
                ) : null}
              />
            )}
          </Flex>
        )}

        {showSessionData && sessions.length === 0 && (
          <EmptyStateLayout
            icon={<Monitor aria-hidden="true" />}
            content={t('homepage.empty.description', 'Sessions will appear here when end users log in.')}
          />
        )}

        {showDetailModal && selectedSession && (
          <SessionDetailModal
            session={selectedSession}
            onClose={handleModalClose}
            onCloseAutoFocus={handleCloseAutoFocus}
            onSessionTerminated={handleSessionTerminated}
          />
        )}
      </Flex>
    </PageShell>
  );
};

export default HomePage;
