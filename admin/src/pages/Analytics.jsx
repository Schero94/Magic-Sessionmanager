import { useState, useEffect } from 'react';
import { useIntl } from 'react-intl';
import { useFetchClient } from '@strapi/strapi/admin';
import styled from 'styled-components';
import {
  Box,
  Typography,
  Flex,
  Loader,
  Button,
  EmptyStateLayout,
  VisuallyHidden,
} from '@strapi/design-system';
import { ChartBubble, User, Clock, Calendar } from '@strapi/icons';
import pluginId from '../pluginId';
import {
  ANALYTICS_OTHER_KEY,
  computeSessionAnalytics,
  getAnalyticsBarRows,
} from '../utils/sessionAnalytics.mjs';
import { getDeviceTypeMessage } from '../utils/devicePresentation.mjs';
import { requireSessionList } from '../utils/adminResponse.mjs';
import { PageShell, SectionCard, StatGrid, StatCard, EqualGrid } from '../components/ui';
import Alert from '../components/PersistentAlert';
import ReadableText from '../components/ReadableText';
import { getTranslation } from '../utils/getTranslation';
import { logSafeAdminError } from '../utils/safeAdminLog.mjs';

// ================ BAR LIST ================
// Label, track and count are three grid cells. The count never overlaps the
// fill, so its contrast is the card's body-text contrast in both themes
// (UX-02, F4). Below the DS small breakpoint the track moves under the label.

const BarList = styled.ul`
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

  ${({ theme }) => theme.breakpoints.small} {
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) 6ch;
    grid-template-areas: 'label track count';
  }

  & > [data-bar-label] {
    grid-area: label;
    min-width: 0;
    overflow-wrap: anywhere;
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

// ================ LOGIN TIMELINE ================

const TimelineColumns = styled.div`
  display: grid;
  grid-template-columns: repeat(24, minmax(0, 1fr));
  gap: ${({ theme }) => theme.spaces[1]};
  align-items: end;
  height: calc(${({ theme }) => theme.spaces[8]} * 4);
`;

const TimelineBar = styled.span`
  display: block;
  min-height: ${({ theme, $empty }) => ($empty ? '0' : theme.spaces[1])};
  background: ${({ theme, $peak }) => ($peak ? theme.colors.primary600 : theme.colors.primary200)};
  border-radius: ${({ theme }) => `${theme.borderRadius} ${theme.borderRadius} 0 0`};
`;

const TimelineAxis = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: ${({ theme }) => theme.spaces[1]};
`;

const AXIS_HOURS = [0, 6, 12, 18];

/**
 * Formats an hour of the day (0-23) with the admin locale ("14:00", "2 PM").
 *
 * @param {number} hour Hour of the day.
 * @param {string} locale Admin locale.
 * @returns {string} Localized hour.
 */
const formatHour = (hour, locale) => {
  const date = new Date(2000, 0, 1, hour, 0, 0);
  try {
    return new Intl.DateTimeFormat(locale || 'en', { hour: 'numeric', minute: '2-digit' }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(date);
  }
};

/**
 * One horizontal bar list. Labels are resolved by the caller, so translated
 * bucket names (device types, "Other or unknown") and proper names (browsers)
 * share one rendering.
 *
 * @param {{rows: Array<{key: string, count: number, percent: number}>, label: string,
 *   getLabel: (key: string) => string, countLabel: (count: number) => string}} props Bar data.
 * @returns {import('react').ReactElement} Accessible bar list.
 */
const AnalyticsBars = ({ rows, label, getLabel, countLabel }) => (
  <BarList aria-label={label}>
    {rows.map((row) => (
      <BarRow key={row.key}>
        <Typography data-bar-label="" variant="omega" textColor="neutral800" tag="span">
          {getLabel(row.key)}
        </Typography>
        <BarTrack aria-hidden="true">
          <BarFill style={{ width: `${row.percent}%` }} />
        </BarTrack>
        <Typography data-bar-count="" variant="omega" fontWeight="semiBold" textColor="neutral800" tag="span">
          <span aria-hidden="true">{row.count}</span>
          <VisuallyHidden>{countLabel(row.count)}</VisuallyHidden>
        </Typography>
      </BarRow>
    ))}
  </BarList>
);

const AnalyticsPage = () => {
  const { formatMessage, locale } = useIntl();
  const { get } = useFetchClient();
  const t = (id, defaultMessage, values) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const translate = (descriptor) =>
    formatMessage({ id: getTranslation(descriptor.messageId), defaultMessage: descriptor.defaultMessage });
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  /**
   * Loads the session collection and derives analytics locally. Failures switch
   * the page to its retry state without exposing response data in the console.
   *
   * @returns {Promise<void>}
   */
  const fetchAnalytics = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const { data } = await get(`/${pluginId}/sessions`);
      const sessions = requireSessionList(data);
      setAnalytics(computeSessionAnalytics(sessions));
    } catch (err) {
      setLoadError(true);
      logSafeAdminError('analytics.load', err);
    } finally {
      setLoading(false);
    }
  };

  const title = t('analytics.title', 'Session analytics');
  const subtitle = t('analytics.subtitle', 'Session activity and device trends');

  if (loading) {
    return (
      <PageShell headingId="magic-sessionmanager-analytics-title" title={title} subtitle={subtitle}>
        <Flex justifyContent="center" padding={8}>
          <Loader>{t('analytics.loading', 'Loading analytics data...')}</Loader>
        </Flex>
      </PageShell>
    );
  }

  if (loadError) {
    return (
      <PageShell headingId="magic-sessionmanager-analytics-title" title={title} subtitle={subtitle}>
        <Alert
          variant="danger"
          title={t('analytics.error.title', 'Analytics could not be loaded')}
          closeLabel={t('common.close', 'Close')}
          action={<Button variant="secondary" onClick={fetchAnalytics}>{t('common.retry', 'Retry')}</Button>}
        >
          <ReadableText variant="omega" textColor="neutral800" tag="span">
            {t('analytics.error.description', 'Try again. If the problem continues, check session API access and permissions.')}
          </ReadableText>
        </Alert>
      </PageShell>
    );
  }

  const hasSessions = Number(analytics?.totalSessions) > 0;
  const deviceRows = getAnalyticsBarRows(analytics?.devices);
  const browserRows = getAnalyticsBarRows(analytics?.browsers);
  const loginHours = analytics?.loginHours || [];
  const maxLogins = Math.max(0, ...loginHours);
  const peakHour = analytics?.peakHour;
  const devicesTitle = t('analytics.devices.title', 'Devices');
  const browsersTitle = t('analytics.browsers.title', 'Browsers');
  const countLabel = (count) =>
    t('analytics.bar.sessions', '{count, plural, one {# session} other {# sessions}}', { count });
  const deviceLabel = (key) =>
    translate(getDeviceTypeMessage(key === ANALYTICS_OTHER_KEY ? '' : key));
  const browserLabel = (key) =>
    key === ANALYTICS_OTHER_KEY ? t('analytics.browser.other', 'Other or unknown') : key;
  const timelineSummary = peakHour === null || peakHour === undefined
    ? t('analytics.timeline.empty', 'No login times recorded yet.')
    : t(
      'analytics.timeline.summary',
      'Most logins start between {start} and {end} ({count, plural, one {# login} other {# logins}}).',
      {
        start: formatHour(peakHour, locale),
        end: formatHour((peakHour + 1) % 24, locale),
        count: maxLogins,
      }
    );

  return (
    <PageShell headingId="magic-sessionmanager-analytics-title" title={title} subtitle={subtitle}>
      <StatGrid label={t('analytics.stats.label', 'Session overview')}>
        <StatCard
          icon={ChartBubble}
          tone="primary"
          label={t('analytics.stats.total', 'Total sessions')}
          value={analytics?.totalSessions || 0}
        />
        <StatCard
          icon={User}
          tone="success"
          label={t('analytics.stats.active', 'Online now')}
          value={analytics?.activeSessions || 0}
        />
        <StatCard
          icon={Clock}
          tone="primary"
          label={t('analytics.stats.today', 'Logins in the last 24 hours')}
          value={analytics?.todayLogins || 0}
        />
        <StatCard
          icon={Calendar}
          tone="primary"
          label={t('analytics.stats.week', 'Logins in the last 7 days')}
          value={analytics?.weekLogins || 0}
        />
      </StatGrid>

      {hasSessions ? (
        <>
          <EqualGrid columns={2} stackBelow="medium">
            <SectionCard
              fill
              title={devicesTitle}
              subtitle={t('analytics.devices.subtitle', 'Sessions by device type')}
            >
              <AnalyticsBars rows={deviceRows} label={devicesTitle} getLabel={deviceLabel} countLabel={countLabel} />
            </SectionCard>
            <SectionCard
              fill
              title={browsersTitle}
              subtitle={t('analytics.browsers.subtitle', 'Sessions by browser')}
            >
              <AnalyticsBars rows={browserRows} label={browsersTitle} getLabel={browserLabel} countLabel={countLabel} />
            </SectionCard>
          </EqualGrid>

          <SectionCard
            title={t('analytics.timeline.title', 'Logins by hour of day')}
            subtitle={t('analytics.timeline.subtitle', 'Login times in your browser time zone.')}
          >
            <Flex direction="column" alignItems="stretch" gap={2}>
              <TimelineColumns aria-hidden="true">
                {loginHours.map((count, hour) => (
                  <TimelineBar
                    key={hour}
                    $empty={count === 0}
                    $peak={count > 0 && count === maxLogins}
                    style={{ height: maxLogins > 0 ? `${Math.round((count / maxLogins) * 100)}%` : '0%' }}
                  />
                ))}
              </TimelineColumns>
              <TimelineAxis aria-hidden="true">
                {AXIS_HOURS.map((hour) => (
                  <Typography key={hour} variant="pi" textColor="neutral600">
                    {formatHour(hour, locale)}
                  </Typography>
                ))}
              </TimelineAxis>
              <Typography variant="omega" textColor="neutral800" tag="p">
                {timelineSummary}
              </Typography>
            </Flex>
          </SectionCard>

          <SectionCard
            title={t('analytics.duration.title', 'Average session duration')}
            subtitle={t(
              'analytics.duration.description',
              'Time from login to the last recorded activity, or to logout when the user logged out. Time a session spent idle before it was cleaned up is not counted.'
            )}
          >
            <Box>
              <Typography variant="alpha" textColor="neutral800" tag="p">
                {t('analytics.duration.minutes', '{count} min', { count: analytics?.avgSessionDuration || 0 })}
              </Typography>
            </Box>
          </SectionCard>
        </>
      ) : (
        <EmptyStateLayout
          icon={<ChartBubble aria-hidden="true" />}
          content={t('analytics.empty', 'Session analytics will appear here after end users sign in.')}
        />
      )}
    </PageShell>
  );
};

export default AnalyticsPage;
