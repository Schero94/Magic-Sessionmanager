import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { NavLink } from 'react-router-dom';
import { Page, useFetchClient } from '@strapi/strapi/admin';
import styled from 'styled-components';
import {
  Button,
  EmptyStateLayout,
  Flex,
  LinkButton,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { ArrowClockwise, Calendar, ChartBubble, Clock, User } from '@strapi/icons';
import { EmptyDocuments } from '@strapi/icons/symbols';
import pluginId from '../pluginId';
import {
  ANALYTICS_UNKNOWN_KEY,
  computeSessionAnalytics,
  getAnalyticsBarRows,
} from '../utils/sessionAnalytics.mjs';
import { getDeviceTypeMessage } from '../utils/devicePresentation.mjs';
import { requireSessionList } from '../utils/adminResponse.mjs';
import { useSessionFormatters } from '../utils/useSessionFormatters';
import { PageShell, SectionCard, StatGrid, StatCard, EqualGrid } from '../components/ui';
import Alert from '../components/PersistentAlert';
import ReadableText from '../components/ReadableText';
import { getTranslation } from '../utils/getTranslation';
import { logSafeAdminError } from '../utils/safeAdminLog.mjs';

// ================ BAR LIST ================
// Label, track and count are three grid cells. The count never overlaps the
// fill, so its contrast is the card's body-text contrast in both themes
// (UX-02, F4). In a narrow list the track moves under the label.

/**
 * Inline size of the bar list from which label, track and count share one
 * line. It is the list's own width, not the viewport: at 768 px the two cards
 * sit side by side but are only about 18rem wide inside. Units follow the DS
 * convention of the Strapi admin (root font size ten pixels).
 */
const BAR_ROW_INLINE_REM = 24;

const BarList = styled.ul`
  container-type: inline-size;
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spaces[3]};
  min-width: 0;
`;

const BarRow = styled.li`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 6ch;
  grid-template-areas:
    'label count'
    'track track';
  column-gap: ${({ theme }) => theme.spaces[3]};
  row-gap: ${({ theme }) => theme.spaces[1]};
  align-items: center;
  min-width: 0;

  @container (min-width: ${BAR_ROW_INLINE_REM}rem) {
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) 6ch;
    grid-template-areas: 'label track count';
  }

  & > [data-bar-label] {
    grid-area: label;
    min-width: 0;
    overflow-wrap: break-word;
  }

  & > [data-bar-count] {
    grid-area: count;
    text-align: end;
    font-variant-numeric: tabular-nums;
  }
`;

const BarTrack = styled.span`
  grid-area: track;
  display: block;
  height: ${({ theme }) => theme.spaces[2]};
  background: ${({ theme }) => theme.colors.neutral150};
  border-radius: ${({ theme }) => theme.borderRadius};
  overflow: hidden;
`;

const BarFill = styled.span`
  display: block;
  height: 100%;
  background: ${({ theme }) => theme.colors.primary600};
  border-radius: inherit;
`;

/** Session list route of the main menu page (IA C: "Open Session Manager"). */
const SESSION_MANAGER_PATH = `/plugins/${pluginId}`;

/**
 * Whether a failed request was refused for missing permissions.
 *
 * @param {unknown} error Fetch error.
 * @returns {boolean} True for a 403 response.
 */
const isForbidden = (error) => error?.status === 403 || error?.response?.status === 403;

/**
 * One horizontal bar list. Labels are resolved by the caller, so translated
 * bucket names (device types, "Unknown") and proper names (browsers) share
 * one rendering.
 *
 * @param {{rows: Array<{key: string, count: number, percent: number}>, label: string,
 *   getLabel: (key: string) => string, countLabel: (count: number) => string,
 *   formatCount: (count: number) => string}} props Bar data.
 * @returns {import('react').ReactElement} Accessible bar list.
 */
const AnalyticsBars = ({ rows, label, getLabel, countLabel, formatCount }) => (
  <BarList aria-label={label}>
    {rows.map((row) => (
      <BarRow key={row.key}>
        <Typography data-bar-label="" variant="omega" textColor="neutral800" tag="span">
          {getLabel(row.key)}
        </Typography>
        <BarTrack aria-hidden="true">
          <BarFill style={{ width: `${row.percent}%` }} />
        </BarTrack>
        <Typography
          data-bar-count=""
          variant="omega"
          fontWeight="semiBold"
          textColor="neutral800"
          tag="span"
        >
          <span aria-hidden="true">{formatCount(row.count)}</span>
          <VisuallyHidden>{countLabel(row.count)}</VisuallyHidden>
        </Typography>
      </BarRow>
    ))}
  </BarList>
);

const AnalyticsPage = () => {
  const { formatMessage, formatNumber } = useIntl();
  const { formatDate } = useSessionFormatters();
  const { get } = useFetchClient();
  const t = (id, defaultMessage, values) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const translate = (descriptor) =>
    formatMessage({
      id: getTranslation(descriptor.messageId),
      defaultMessage: descriptor.defaultMessage,
    });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [analytics, setAnalytics] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const requestPendingRef = useRef(false);

  /**
   * Loads the session collection and derives analytics locally. Only the first
   * load shows the page loader; a refresh keeps the page, its focus and scroll
   * position mounted. A failed refresh keeps the last data and shows the error
   * above it. Failures are logged without response data. `get` is stable, so
   * the callback is created once.
   *
   * @returns {Promise<void>}
   */
  const fetchAnalytics = useCallback(async () => {
    if (requestPendingRef.current) return;
    requestPendingRef.current = true;
    try {
      const { data } = await get(`/${pluginId}/sessions`);
      const sessions = requireSessionList(data);
      setAnalytics(computeSessionAnalytics(sessions));
      setTruncated(data?.meta?.truncated === true);
      setUpdatedAt(Date.now());
      setLoadError(false);
    } catch (err) {
      logSafeAdminError('analytics.load', err);
      if (isForbidden(err)) setForbidden(true);
      setLoadError(true);
    } finally {
      requestPendingRef.current = false;
      setRefreshing(false);
      setLoading(false);
    }
  }, [get]);

  /**
   * Refresh and "Try again": marks the button busy, then reloads in place.
   *
   * @returns {void}
   */
  const handleRefresh = () => {
    if (requestPendingRef.current) return;
    setRefreshing(true);
    void fetchAnalytics();
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state updates run after await; the compiler cannot see through the callback
    void fetchAnalytics();
  }, [fetchAnalytics]);

  if (loading) {
    return <Page.Loading />;
  }

  if (forbidden) {
    return <Page.NoPermissions />;
  }

  const title = t('analytics.title', 'Analytics');
  const totalSessions = Number(analytics?.totalSessions) || 0;
  // The load time belongs to the header metadata, next to what was loaded,
  // instead of a lonely line between the header and the KPIs. A non-string
  // subtitle is rendered as-is by Layouts.Header, so it carries the header's
  // own subtitle typography (epsilon, neutral600, <p>).
  const subtitle = analytics ? (
    <Typography variant="epsilon" textColor="neutral600" tag="p">
      {t(
        'analytics.subtitle',
        '{count, plural, =0 {No sessions are loaded yet.} one {Based on the latest # loaded session.} other {Based on the latest # loaded sessions.}}',
        { count: totalSessions }
      )}
      {updatedAt ? (
        <>
          {' '}
          <span aria-live="polite" data-analytics-updated="">
            {t('analytics.lastUpdated', 'Last updated {time}', {
              time: formatDate(updatedAt, { timeStyle: 'short' }),
            })}
          </span>
        </>
      ) : null}
    </Typography>
  ) : undefined;

  const headerActions = (
    <Flex gap={2} wrap="wrap" justifyContent="flex-end">
      <LinkButton tag={NavLink} to={SESSION_MANAGER_PATH} variant="tertiary">
        {t('analytics.openSessionManager', 'Open Session Manager')}
      </LinkButton>
      <Button
        variant="secondary"
        startIcon={<ArrowClockwise aria-hidden />}
        onClick={handleRefresh}
        aria-busy={refreshing}
      >
        {t('analytics.refresh', 'Refresh')}
      </Button>
    </Flex>
  );

  const errorAlert = loadError ? (
    <Alert
      variant="danger"
      closeLabel={t('common.close', 'Close')}
      action={
        <Button variant="secondary" onClick={handleRefresh} aria-busy={refreshing}>
          {t('analytics.error.retry', 'Try again')}
        </Button>
      }
    >
      <ReadableText variant="omega" textColor="neutral800" tag="span">
        {t('analytics.error.title', 'Analytics could not be loaded.')}
      </ReadableText>
    </Alert>
  ) : null;

  if (!analytics) {
    return (
      <PageShell
        headingId="magic-sessionmanager-analytics-title"
        title={title}
        primaryAction={headerActions}
      >
        {errorAlert}
      </PageShell>
    );
  }

  const hasSessions = totalSessions > 0;
  const deviceRows = getAnalyticsBarRows(analytics.devices);
  const browserRows = getAnalyticsBarRows(analytics.browsers);
  const devicesTitle = t('analytics.devices.title', 'Devices');
  const browsersTitle = t('analytics.browsers.title', 'Browsers');
  const unknownLabel = t('analytics.bucket.unknown', 'Unknown');
  const countLabel = (count) =>
    t('analytics.bar.sessions', '{count, plural, one {# session} other {# sessions}}', { count });
  const deviceLabel = (key) =>
    key === ANALYTICS_UNKNOWN_KEY ? unknownLabel : translate(getDeviceTypeMessage(key));
  const browserLabel = (key) => (key === ANALYTICS_UNKNOWN_KEY ? unknownLabel : key);

  return (
    <PageShell
      headingId="magic-sessionmanager-analytics-title"
      title={title}
      subtitle={subtitle}
      primaryAction={headerActions}
    >
      {errorAlert}

      {truncated ? (
        <Alert variant="default" closeLabel={t('common.close', 'Close')}>
          <ReadableText variant="omega" textColor="neutral800" tag="span">
            {t(
              'analytics.truncated',
              'Only the latest {count, number} sessions are loaded. Counts, filters and exports cover these sessions only.',
              { count: totalSessions }
            )}
          </ReadableText>
        </Alert>
      ) : null}

      {hasSessions ? (
        <>
          <StatGrid label={t('analytics.stats.label', 'Session overview')} alignValues>
            <StatCard
              icon={ChartBubble}
              tone="primary"
              label={t('analytics.stats.total', 'All sessions')}
              value={formatNumber(analytics.totalSessions)}
            />
            <StatCard
              icon={User}
              tone="success"
              label={t('analytics.stats.active', 'Active sessions')}
              value={formatNumber(analytics.activeSessions)}
            />
            <StatCard
              icon={Clock}
              tone="primary"
              label={t('analytics.stats.last24Hours', 'Sign-ins in the last 24 hours')}
              value={formatNumber(analytics.signInsLast24Hours)}
            />
            <StatCard
              icon={Calendar}
              tone="primary"
              label={t('analytics.stats.last7Days', 'Sign-ins in the last 7 days')}
              value={formatNumber(analytics.signInsLast7Days)}
            />
          </StatGrid>

          <Flex direction="column" alignItems="stretch" gap={2}>
            <EqualGrid columns={2} stackBelow="medium">
              <SectionCard
                fill
                title={devicesTitle}
                subtitle={t('analytics.devices.subtitle', 'Sessions by device type')}
              >
                <AnalyticsBars
                  rows={deviceRows}
                  label={devicesTitle}
                  getLabel={deviceLabel}
                  countLabel={countLabel}
                  formatCount={formatNumber}
                />
              </SectionCard>
              <SectionCard
                fill
                title={browsersTitle}
                subtitle={t('analytics.browsers.subtitle', 'Sessions by browser')}
              >
                <AnalyticsBars
                  rows={browserRows}
                  label={browsersTitle}
                  getLabel={browserLabel}
                  countLabel={countLabel}
                  formatCount={formatNumber}
                />
              </SectionCard>
            </EqualGrid>
            <ReadableText variant="pi" textColor="neutral600" tag="p">
              {t(
                'analytics.detection.note',
                'Detected from the browser\'s user agent. Sessions without a user agent, for example Strapi sessions, appear as "Unknown".'
              )}
            </ReadableText>
          </Flex>

          <SectionCard
            title={t('analytics.duration.title', 'Average session length')}
            subtitle={t(
              'analytics.duration.description',
              'From sign-in to the end of the session, or to its last activity while it is still open. Sessions that timed out include the unused time before they were closed.'
            )}
          >
            <Typography variant="alpha" textColor="neutral800" tag="p">
              {t('analytics.duration.minutes', '{count} min', {
                count: formatNumber(analytics.avgSessionDuration),
              })}
            </Typography>
          </SectionCard>
        </>
      ) : (
        <EmptyStateLayout
          icon={<EmptyDocuments width="16rem" height="8.8rem" aria-hidden="true" />}
          content={t(
            'analytics.empty',
            'No sessions to analyse yet. Analytics appear after the first sign-ins.'
          )}
        />
      )}
    </PageShell>
  );
};

export default AnalyticsPage;
