import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { Link } from 'react-router-dom';
import { Pagination, useFetchClient, useNotification, useQueryParams } from '@strapi/strapi/admin';
import {
  Box,
  Button,
  EmptyStateLayout,
  Flex,
  IconButton,
  LinkButton,
  Loader,
  MenuItem,
  SimpleMenu,
  SingleSelect,
  SingleSelectOption,
  Tooltip,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import {
  ArrowClockwise,
  ChartBubble,
  Check,
  Clock,
  Cog,
  Cross,
  Download,
  User,
} from '@strapi/icons';
import { EmptyDocuments } from '@strapi/icons/symbols';
import styled from 'styled-components';
import pluginId from '../pluginId';
import { getTranslation } from '../utils/getTranslation';
import { isCancelledRequest, logSafeAdminError } from '../utils/safeAdminLog.mjs';
import { getSessionStatus } from '../utils/sessionStatus.mjs';
import { requireSessionList } from '../utils/adminResponse.mjs';
import { restoreDialogFocus } from '../utils/restoreDialogFocus.mjs';
import { END_REASON_FILTER_OPTIONS, SESSION_FILTER_OPTIONS } from '../utils/sessionFilters.mjs';
import {
  EMPTY_SESSION_STATS,
  MAX_EXPORT_ROWS,
  buildListParams,
  buildExportParams,
  readSessionPage,
  readSessionStats,
} from '../utils/sessionListApi.mjs';
import { buildSessionCsv, buildSessionJson } from '../utils/sessionExports.mjs';
import { useSessionFormatters } from '../utils/useSessionFormatters';
import { useBreakpoint } from '../utils/useBreakpoint';
import { useElementWidth } from '../utils/useElementWidth';
import { PageShell, StatCard, StatGrid } from '../components/ui';
import SessionDetailModal from '../components/SessionDetailModal';
import Alert from '../components/PersistentAlert';
import ReadableText from '../components/ReadableText';
import SessionTable from './Dashboard/SessionTable';
import SessionCardList from './Dashboard/SessionCardList';
import SessionSearch from './Dashboard/SessionSearch';
import HowSessionsWork from './Dashboard/HowSessionsWork';
import UntrackedSessionsNotice from './Dashboard/UntrackedSessionsNotice';
import {
  AUTO_REFRESH_INTERVAL_MS,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  encodeSearchQuery,
  getErrorStatus,
  getExportDeviceInfo,
  hasActiveFilters,
  parseDashboardQuery,
  pickFocusSessionId,
  shouldUseCompactTable,
} from './Dashboard/dashboardModel.mjs';

/** How often the "Last updated" relative time is re-rendered. */
const CLOCK_TICK_MS = 30 * 1000;

/** Settings pages of this plugin (relative to the admin root). */
const ANALYTICS_PATH = `/settings/${pluginId}/analytics`;
const CONFIGURATION_PATH = `/settings/${pluginId}/general`;

/**
 * Footer around the native Strapi pagination. DS page links are 30 px wide;
 * the wrapper raises them to the 32 px touch target without changing their
 * look. The native footer row does not wrap, so at 320 px "Entries per page"
 * and three page links ran past the viewport; here the links wrap to a
 * second row instead and the label stays on one line.
 */
const PaginationTargets = styled.div`
  nav a {
    min-width: 3.2rem;
  }

  & > div {
    flex-wrap: wrap;
    gap: ${({ theme }) => theme.spaces[2]} ${({ theme }) => theme.spaces[4]};
  }

  & > div > div > span {
    white-space: nowrap;
  }
`;

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
 * Sessions dashboard (IA D1): which sessions exist, and which need action?
 * Header with Export and links to Analytics and Settings, truncation alert,
 * "How sessions work" legend, four clickable state cards, a visible search
 * with Status and End reason filters, a polite caption, the session table
 * (cards below the DS medium breakpoint) and native pagination. Filters,
 * search, page and page size live in the URL.
 *
 * @returns {import('react').ReactElement} Dashboard page.
 */
const HomePage = () => {
  const { formatMessage } = useIntl();
  const { get, post, del } = useFetchClient();
  const { toggleNotification } = useNotification();
  const formatters = useSessionFormatters();
  const { isBelowSmall, isBelowMedium, isBelowLarge } = useBreakpoint();
  const [listWidthRef, listWidth] = useElementWidth();
  const [{ query }, setQuery] = useQueryParams();
  const t = (id, defaultMessage, values) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const dashboard = parseDashboardQuery(query);

  const [sessions, setSessions] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, pageCount: 1 });
  const [stats, setStats] = useState(EMPTY_SESSION_STATS);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [hasData, setHasData] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [selectedSession, setSelectedSession] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [terminatingSessionId, setTerminatingSessionId] = useState(null);
  const [deletingSessionId, setDeletingSessionId] = useState(null);
  const openerRef = useRef(null);
  const dashboardRef = useRef(null);
  const listHeadingRef = useRef(null);
  const hasLoadedRef = useRef(false);
  const requestIdRef = useRef(0);
  const visibleIdsRef = useRef([]);
  const mutationSnapshotRef = useRef([]);
  const listHeadingId = `session-list-caption-${useId().replace(/:/g, '')}`;
  const mutationPending = Boolean(terminatingSessionId || deletingSessionId);
  const listQuery = useMemo(
    () => ({
      page: dashboard.page,
      pageSize: dashboard.pageSize,
      status: dashboard.status,
      reason: dashboard.reason,
      search: dashboard.search,
    }),
    [dashboard.page, dashboard.pageSize, dashboard.status, dashboard.reason, dashboard.search]
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  /**
   * Loads the current page (filtered, searched, sorted and paginated on the
   * server, exact totals) and the count-only statistics in parallel. Only
   * the first load shows the page loader;
   * later loads (Refresh, auto refresh, after an action) keep the list
   * mounted so keyboard focus and scroll position survive (DUX-02, DASH-17).
   * A failed refresh keeps the last data and shows the error above it.
   * `get` is stable, so the callback is created once.
   *
   * @returns {Promise<void>}
   */
  const fetchSessions = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (hasLoadedRef.current) setRefreshing(true);
    else setLoading(true);

    try {
      const [listResponse, statsResponse] = await Promise.all([
        get(`/${pluginId}/sessions`, { params: buildListParams(listQuery) }),
        get(`/${pluginId}/sessions/stats`),
      ]);
      const page = readSessionPage(listResponse.data);
      const nextStats = readSessionStats(statsResponse.data);
      if (requestId !== requestIdRef.current) return;
      setSessions(page.rows);
      setPagination(page.pagination);
      setStats(nextStats);
      setLoadError(false);
      setHasData(true);
      setLastUpdated(Date.now());
      setNow(Date.now());
      hasLoadedRef.current = true;
    } catch (err) {
      // A request aborted because the page unmounted is not a failure.
      if (requestId !== requestIdRef.current || isCancelledRequest(err)) return;
      setLoadError(true);
      logSafeAdminError('dashboard.loadSessions', err);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [get, listQuery]);

  useEffect(() => {
    // The first load: loading is already true and hasLoadedRef is false, so
    // fetchSessions sets state only after its request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state updates run after await; the compiler cannot see through the callback
    fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    // Silent background update every 10 minutes, paused while the detail
    // dialog is open or an action is running so nothing moves under the user.
    if (showDetailModal || mutationPending) return undefined;
    const interval = setInterval(() => {
      fetchSessions();
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [showDetailModal, mutationPending, fetchSessions]);

  /**
   * Ends one session after ConfirmAction confirmed it (IA E.1), then
   * refreshes the list in place. A 404 means the session is already gone:
   * the list is refreshed and the dialog closes. Other failures rethrow so
   * the confirmation stays open for a retry.
   *
   * @param {object} session Session row.
   * @returns {Promise<void>}
   */
  const handleTerminateSession = async (session) => {
    if (terminatingSessionId || deletingSessionId) return;
    const sessionId = session.id;
    mutationSnapshotRef.current = visibleIdsRef.current;
    setTerminatingSessionId(sessionId);
    try {
      await post(`/${pluginId}/sessions/${sessionId}/terminate`);
      await fetchSessions();
      toggleNotification({
        type: 'success',
        message: t('notifications.success.sessionEnded', 'Session ended.'),
      });
    } catch (err) {
      logSafeAdminError('dashboard.terminateSession', err);
      if (getErrorStatus(err) === 404) {
        await fetchSessions();
        toggleNotification({
          type: 'warning',
          message: t(
            'notifications.error.sessionGone',
            'This session no longer exists. The list was refreshed.'
          ),
        });
        return;
      }
      toggleNotification({
        type: 'danger',
        message: t(
          'notifications.error.endSession',
          'The session could not be ended. Please try again.'
        ),
      });
      throw err;
    } finally {
      setTerminatingSessionId(null);
    }
  };

  /**
   * Deletes one session record after ConfirmAction confirmed it (IA E.1).
   * The server writes a revocation entry first, so the token stays revoked;
   * an open session also ends.
   *
   * @param {object} session Session row.
   * @returns {Promise<void>}
   */
  const handleDeleteSession = async (session) => {
    if (terminatingSessionId || deletingSessionId) return;
    const sessionId = session.id;
    mutationSnapshotRef.current = visibleIdsRef.current;
    setDeletingSessionId(sessionId);
    try {
      await del(`/${pluginId}/sessions/${sessionId}`);
      await fetchSessions();
      toggleNotification({
        type: 'success',
        message: t(
          'notifications.success.recordDeleted',
          'Session record deleted. Its token stays revoked.'
        ),
      });
    } catch (err) {
      logSafeAdminError('dashboard.deleteSession', err);
      if (getErrorStatus(err) === 404) {
        await fetchSessions();
        toggleNotification({
          type: 'warning',
          message: t(
            'notifications.error.sessionGone',
            'This session no longer exists. The list was refreshed.'
          ),
        });
        return;
      }
      toggleNotification({
        type: 'danger',
        message: t(
          'notifications.error.deleteRecord',
          'The record could not be deleted. Please try again.'
        ),
      });
      throw err;
    } finally {
      setDeletingSessionId(null);
    }
  };

  // The server filters and paginates; this is the visible page.
  const pageSize = Number(dashboard.pageSize);
  const pageResult = {
    items: sessions,
    total: pagination.total,
    pageCount: pagination.pageCount,
    startIndex: pagination.total > 0 ? (dashboard.page - 1) * pageSize + 1 : 0,
    endIndex: pagination.total > 0 ? (dashboard.page - 1) * pageSize + sessions.length : 0,
  };
  const visibleIds = pageResult.items.map((session) => String(session.id));
  // Handlers read the ids of the rows on screen after the latest commit.
  useLayoutEffect(() => {
    visibleIdsRef.current = visibleIds;
  });

  /**
   * Reads every session matching the current filters in batches of 1000
   * (keyset cursor on the server), up to MAX_EXPORT_ROWS, newest first.
   *
   * @returns {Promise<{rows: object[], capped: boolean}>}
   */
  const fetchExportRows = async () => {
    const rows = [];
    let cursor = null;
    do {
      const { data } = await get(`/${pluginId}/sessions/export`, {
        params: buildExportParams(listQuery, cursor),
      });
      rows.push(...requireSessionList(data));
      cursor = typeof data?.meta?.nextCursor === 'string' ? data.meta.nextCursor : null;
    } while (cursor && rows.length < MAX_EXPORT_ROWS);
    const capped =
      rows.length > MAX_EXPORT_ROWS || (Boolean(cursor) && rows.length >= MAX_EXPORT_ROWS);
    return { rows: rows.slice(0, MAX_EXPORT_ROWS), capped };
  };

  /**
   * Downloads CSV or JSON for every session matching the current filters,
   * not only the rows on the current page. Columns and values are stable
   * machine data (see sessionExports.mjs), independent of the admin
   * language, and never contain tokens. The download itself is the feedback;
   * an export that reached the row limit says so.
   *
   * @param {'csv'|'json'} format Export format.
   * @returns {Promise<void>}
   */
  const handleExport = async (format) => {
    if (exporting) return;
    setExporting(true);
    try {
      const { rows, capped } = await fetchExportRows();
      if (format === 'csv') {
        const csvContent = buildSessionCsv(rows, {
          unavailableValue: '',
          getDeviceInfo: getExportDeviceInfo,
          getSessionStatus,
        });
        downloadFile(csvContent, 'text/csv;charset=utf-8;', 'csv');
      } else {
        const jsonContent = buildSessionJson(rows, {
          filterStatus: dashboard.status,
          totalSessions: stats.total,
          exportedAt: new Date().toISOString(),
          unavailableValue: '',
          getDeviceInfo: getExportDeviceInfo,
          getSessionStatus,
          truncated: capped,
        });
        downloadFile(jsonContent, 'application/json', 'json');
      }
      if (capped) {
        toggleNotification({
          type: 'warning',
          message: t(
            'homepage.export.capped',
            'The export contains the newest {limit, number} sessions. Narrow the filter to export the rest.',
            { limit: MAX_EXPORT_ROWS }
          ),
        });
      }
    } catch (err) {
      if (isCancelledRequest(err)) return;
      logSafeAdminError(format === 'csv' ? 'dashboard.exportCsv' : 'dashboard.exportJson', err);
      toggleNotification({
        type: 'danger',
        message: t('notifications.error.exportFailed', 'The export could not be created.'),
      });
    } finally {
      setExporting(false);
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
    restoreDialogFocus(event, openerRef.current, listHeadingRef.current || dashboardRef.current);
  };

  /**
   * Focus target used by ConfirmAction when a row's trigger disappeared after
   * an action: the same row's View button, else the next or previous row,
   * else the table caption (IA E). Resolved lazily, after the rows render.
   *
   * @param {string} sessionId Row whose action ran.
   * @returns {{readonly current: HTMLElement|null}} Ref-like getter.
   */
  const getFocusFallback = useCallback(
    (sessionId) => ({
      get current() {
        const targetId = pickFocusSessionId(
          mutationSnapshotRef.current,
          visibleIdsRef.current,
          sessionId
        );
        const root = dashboardRef.current;
        if (targetId && root) {
          const escaped =
            typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(targetId) : targetId;
          const button = root.querySelector(`[data-session-view="${escaped}"]`);
          if (button) return button;
        }
        return listHeadingRef.current;
      },
    }),
    []
  );

  // Keep the URL page inside the result range after filtering or removals.
  useEffect(() => {
    if (!loading && !refreshing && dashboard.page > pageResult.pageCount) {
      setQuery({ page: String(pageResult.pageCount) }, 'push', true);
    }
  }, [loading, refreshing, dashboard.page, pageResult.pageCount, setQuery]);

  const handleStatusChange = (value) => {
    const status = String(value);
    setQuery({ status: status === 'all' ? undefined : status, reason: undefined, page: '1' });
  };

  const handleReasonChange = (value) => {
    const reason = String(value);
    setQuery({ reason: reason === 'all' ? undefined : reason, page: '1' });
  };

  const handleSearch = useCallback(
    (value) => {
      setQuery({ search: encodeSearchQuery(value), _q: undefined, page: '1' }, 'push', true);
    },
    [setQuery]
  );

  const handleClearFilters = () => {
    setQuery({ search: undefined, _q: undefined, status: undefined, reason: undefined, page: '1' });
    listHeadingRef.current?.focus();
  };

  const showSessionData = !loading && hasData;
  const showToolbar = showSessionData && stats.total > 0;
  const canExport = showSessionData && pageResult.total > 0 && !exporting;
  const filtersActive = hasActiveFilters(dashboard);
  const exportValues = { count: Math.min(pageResult.total, MAX_EXPORT_ROWS) };

  const exportMenu = (
    <SimpleMenu
      label={t('homepage.export.label', 'Export')}
      variant="secondary"
      startIcon={<Download />}
      disabled={!canExport}
    >
      <MenuItem onSelect={() => void handleExport('csv')}>
        {t(
          'homepage.export.csv',
          '{count, plural, one {Export # session as CSV} other {Export # sessions as CSV}}',
          exportValues
        )}
      </MenuItem>
      <MenuItem onSelect={() => void handleExport('json')}>
        {t(
          'homepage.export.json',
          '{count, plural, one {Export # session as JSON} other {Export # sessions as JSON}}',
          exportValues
        )}
      </MenuItem>
    </SimpleMenu>
  );

  const exportAction =
    canExport || !showSessionData ? (
      exportMenu
    ) : (
      <Tooltip label={t('homepage.export.disabledHint', 'No sessions match the current filter.')}>
        <span>{exportMenu}</span>
      </Tooltip>
    );

  // Header actions sit together on the right, as in native Strapi list views
  // (Media Library: secondary actions left of the primary one). The links are
  // tertiary so Export stays the strongest action. Below the DS small
  // breakpoint the three labelled buttons no longer fit one row (and wrap
  // into a two-row sticky header), so the links become labelled 32 px icon
  // links, like the native header doc link.
  const analyticsLabel = t('homepage.links.analytics', 'Analytics');
  const settingsLabel = t('homepage.links.settings', 'Settings');
  const primaryAction = (
    <Flex gap={2} wrap="wrap" justifyContent="flex-end">
      {isBelowSmall ? (
        <IconButton tag={Link} to={ANALYTICS_PATH} label={analyticsLabel} variant="tertiary">
          <ChartBubble />
        </IconButton>
      ) : (
        <LinkButton
          tag={Link}
          to={ANALYTICS_PATH}
          variant="tertiary"
          size="S"
          startIcon={<ChartBubble />}
        >
          {analyticsLabel}
        </LinkButton>
      )}
      {isBelowSmall ? (
        <IconButton tag={Link} to={CONFIGURATION_PATH} label={settingsLabel} variant="tertiary">
          <Cog />
        </IconButton>
      ) : (
        <LinkButton
          tag={Link}
          to={CONFIGURATION_PATH}
          variant="tertiary"
          size="S"
          startIcon={<Cog />}
        >
          {settingsLabel}
        </LinkButton>
      )}
      {exportAction}
    </Flex>
  );

  // Action bar (IA D1.5): search left, Status / End reason / Refresh right.
  // Below the medium breakpoint the search is full width and the filters wrap
  // to the next row.
  // Below medium the selects share the row with Refresh (in proportion to their
  // labels, so "All reasons" is not cut while "Ended" has room to spare), so
  // Refresh never wraps onto a row of its own (320 px with End reason).
  const filterSlot = isBelowMedium ? { flex: '1 1 auto', minWidth: 0 } : undefined;
  const filterControls = (
    <Flex gap={2} alignItems="center" wrap={isBelowMedium ? 'nowrap' : 'wrap'} shrink={0}>
      <Box {...filterSlot}>
        <SingleSelect
          size="S"
          aria-label={t('homepage.filter.label', 'Status')}
          value={dashboard.status}
          onChange={handleStatusChange}
        >
          {SESSION_FILTER_OPTIONS.map((option) => (
            <SingleSelectOption key={option} value={option}>
              {option === 'all' && t('homepage.filter.all', 'All sessions')}
              {option === 'open' && t('homepage.filter.open', 'Open')}
              {option !== 'all' && option !== 'open' && formatters.statusLabel(option)}
            </SingleSelectOption>
          ))}
        </SingleSelect>
      </Box>
      {dashboard.status === 'ended' ? (
        <Box {...filterSlot}>
          <SingleSelect
            size="S"
            aria-label={t('homepage.filter.reasonLabel', 'End reason')}
            value={dashboard.reason}
            onChange={handleReasonChange}
          >
            {END_REASON_FILTER_OPTIONS.map((option) => (
              <SingleSelectOption key={option} value={option}>
                {option === 'all'
                  ? t('homepage.filter.allReasons', 'All reasons')
                  : formatters.endReasonLabel(option)}
              </SingleSelectOption>
            ))}
          </SingleSelect>
        </Box>
      ) : null}
      <IconButton
        label={t('homepage.actions.refresh', 'Refresh sessions')}
        onClick={() => fetchSessions()}
      >
        <ArrowClockwise />
      </IconButton>
    </Flex>
  );

  const toolbar = (
    <Flex direction="column" alignItems="stretch" gap={2} data-session-toolbar="">
      <Flex
        direction={{ initial: 'column', medium: 'row' }}
        alignItems={{ initial: 'stretch', medium: 'center' }}
        gap={2}
      >
        <Flex flex="1 1 auto" minWidth={0} direction="column" alignItems="stretch">
          <SessionSearch value={dashboard.search} onSearch={handleSearch} />
        </Flex>
        {filterControls}
      </Flex>
    </Flex>
  );

  // "Last updated" sits on the caption row, right-aligned under Refresh.
  const lastUpdatedLine = lastUpdated ? (
    <Flex gap={2} alignItems="center" wrap="wrap" justifyContent="flex-end">
      {refreshing ? (
        <Loader small role="status" aria-live="polite">
          {t('homepage.refreshing', 'Updating sessions')}
        </Loader>
      ) : null}
      <Typography variant="pi" textColor="neutral600" data-last-updated="">
        {t('homepage.lastUpdated', 'Last updated {time}', {
          time: formatters.formatRelativeTime(lastUpdated, now),
        })}
      </Typography>
    </Flex>
  ) : null;

  const listProps = {
    sessions: pageResult.items,
    labelledBy: listHeadingId,
    busy: refreshing,
    onView: handleSessionClick,
    onEnd: handleTerminateSession,
    onDelete: handleDeleteSession,
    mutationPending,
    getFocusFallback,
  };

  const statusCard = (status) => ({
    onClick: () => handleStatusChange(status),
    pressed: dashboard.status === status,
  });

  return (
    <PageShell
      headingId="magic-sessionmanager-dashboard-title"
      title={t('homepage.title', 'Sessions')}
      subtitle={t(
        'homepage.subtitle',
        'Sign-ins of your app’s users (Users & Permissions). Strapi administrators are not listed.'
      )}
      primaryAction={primaryAction}
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
            closeLabel={t('common.close', 'Close')}
            action={
              <Button size="S" variant="secondary" onClick={fetchSessions}>
                {t('common.tryAgain', 'Try again')}
              </Button>
            }
          >
            <ReadableText variant="omega" textColor="neutral800" tag="span">
              {t('homepage.error.load', 'Sessions could not be loaded.')}
            </ReadableText>
          </Alert>
        ) : null}

        {showSessionData && stats.nativeOnly > 0 ? (
          <UntrackedSessionsNotice
            stats={stats}
            onChanged={fetchSessions}
            fallbackFocusRef={dashboardRef}
          />
        ) : null}

        {loading ? (
          <Flex justifyContent="center" padding={8}>
            <Loader>{t('homepage.loading', 'Loading sessions')}</Loader>
          </Flex>
        ) : null}

        {showSessionData && stats.total > 0 ? <HowSessionsWork /> : null}

        {showSessionData && (
          <Flex direction="column" alignItems="stretch" gap={2}>
            <VisuallyHidden>
              <Typography tag="h2">{t('homepage.stats.label', 'Session statistics')}</Typography>
            </VisuallyHidden>
            <StatGrid label={t('homepage.stats.label', 'Session statistics')}>
              <StatCard
                icon={Check}
                tone="success"
                label={t('homepage.stats.active', 'Active sessions')}
                value={stats.active}
                description={t(
                  'homepage.stats.usersOnline',
                  '{count, plural, one {# user online} other {# users online}}',
                  {
                    count: stats.usersOnline,
                  }
                )}
                {...statusCard('active')}
              />
              <StatCard
                icon={Clock}
                tone="warning"
                label={t('homepage.stats.idle', 'Idle sessions')}
                value={stats.idle}
                {...statusCard('idle')}
              />
              <StatCard
                icon={Cross}
                tone="neutral"
                label={t('homepage.stats.ended', 'Ended sessions')}
                value={stats.ended}
                description={t(
                  'homepage.stats.endedBreakdown',
                  '{loggedOut, number} logged out · {timedOut, number} timed out · {other, number} other reasons',
                  {
                    loggedOut: stats.loggedOut,
                    timedOut: stats.timedOut,
                    other: stats.otherReasons,
                  }
                )}
                {...statusCard('ended')}
              />
              <StatCard
                icon={User}
                tone="primary"
                label={t('homepage.stats.total', 'All sessions')}
                value={stats.total}
                {...statusCard('all')}
              />
            </StatGrid>
          </Flex>
        )}

        {showToolbar && (
          <Flex ref={listWidthRef} direction="column" alignItems="stretch" gap={4} minWidth={0}>
            <VisuallyHidden>
              <Typography variant="delta" tag="h2">
                {t('homepage.list.heading', 'Session list')}
              </Typography>
            </VisuallyHidden>
            {toolbar}
            <Flex justifyContent="space-between" alignItems="center" gap={4} wrap="wrap">
              <Typography
                id={listHeadingId}
                ref={listHeadingRef}
                tabIndex={-1}
                variant="pi"
                textColor="neutral600"
                aria-live="polite"
                data-session-caption=""
              >
                {pageResult.total > 0
                  ? t(
                      'homepage.caption',
                      '{from, number}–{to, number} of {total, plural, one {# session} other {# sessions}}',
                      {
                        from: pageResult.startIndex,
                        to: pageResult.endIndex,
                        total: pageResult.total,
                      }
                    )
                  : t('homepage.captionNone', '0 sessions')}
              </Typography>
              {lastUpdatedLine}
            </Flex>

            {pageResult.total > 0 ? (
              <>
                {isBelowMedium ? (
                  <SessionCardList {...listProps} />
                ) : (
                  <SessionTable
                    {...listProps}
                    compact={shouldUseCompactTable(listWidth, isBelowLarge)}
                  />
                )}
                <PaginationTargets>
                  <Pagination.Root
                    pageCount={pageResult.pageCount}
                    total={pageResult.total}
                    defaultPageSize={Number(DEFAULT_PAGE_SIZE)}
                  >
                    <Pagination.PageSize options={[...PAGE_SIZE_OPTIONS]} />
                    <Pagination.Links />
                  </Pagination.Root>
                </PaginationTargets>
              </>
            ) : (
              <EmptyStateLayout
                icon={<EmptyDocuments width="16rem" height="8.8rem" aria-hidden="true" />}
                content={t(
                  'homepage.noResults.description',
                  'No sessions match your search or filter.'
                )}
                action={
                  filtersActive ? (
                    <Button variant="secondary" onClick={handleClearFilters}>
                      {t('homepage.noResults.reset', 'Clear filters')}
                    </Button>
                  ) : null
                }
              />
            )}
          </Flex>
        )}

        {showSessionData && stats.total === 0 && (
          <EmptyStateLayout
            icon={<EmptyDocuments width="16rem" height="8.8rem" aria-hidden="true" />}
            content={t(
              'homepage.empty.description',
              'No sessions yet. Sessions appear here when users of your app sign in.'
            )}
          />
        )}

        {showDetailModal && selectedSession && (
          <SessionDetailModal
            session={selectedSession}
            now={now}
            onClose={handleModalClose}
            onCloseAutoFocus={handleCloseAutoFocus}
            onEndSession={handleTerminateSession}
          />
        )}
      </Flex>
    </PageShell>
  );
};

export default HomePage;
