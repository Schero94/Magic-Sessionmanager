import { useState, useEffect } from 'react';
import { useIntl } from 'react-intl';
import { useFetchClient } from '@strapi/strapi/admin';
import styled from 'styled-components';
import {
  Box,
  Typography,
  Flex,
  Loader,
  Badge,
  Alert,
  Button,
  EmptyStateLayout,
} from '@strapi/design-system';
import { 
  ChartBubble,
  User,
  Monitor,
  Clock,
} from '@strapi/icons';
import pluginId from '../pluginId';
import { computeSessionAnalytics } from '../utils/sessionAnalytics.mjs';
import PluginPageLayout from '../components/PluginPageLayout';
import ReadableText from '../components/ReadableText';
import { getTranslation } from '../utils/getTranslation';
import { logSafeAdminError } from '../utils/safeAdminLog.mjs';

// ================ STRAPI DESIGN SYSTEM LAYOUT ================
const Container = styled(Box)`
  width: 100%;
  min-width: 0;
`;

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr));
  gap: 12px;
  min-width: 0;
  margin-bottom: 16px;
`;

const StatCard = styled(Box)`
  background: ${(p) => p.theme.colors.neutral0};
  border: 1px solid ${(p) => p.theme.colors.neutral150};
  border-top: 3px solid ${(p) => p.theme.colors.primary600};
  border-radius: 4px;
  min-width: 0;
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;

  && > p {
    max-width: none;
    margin: 0;
    line-height: 1.25;
  }

  && > p + p {
    margin-block-start: 0;
  }
`;

const StatIcon = styled(Box)`
  width: 36px;
  height: 36px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${(p) => p.theme.colors.primary100};
  color: ${(p) => p.theme.colors.primary600};
  margin-bottom: 8px;

  svg {
    width: 20px;
    height: 20px;
  }
`;

const ChartCard = styled(Box)`
  background: ${(p) => p.theme.colors.neutral0};
  border-radius: 4px;
  border: 1px solid ${(p) => p.theme.colors.neutral150};
  min-width: 0;
  padding: 20px;
`;

const BarChart = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
`;

const BarRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
`;

const BarContainer = styled.div`
  flex: 1;
  min-width: 0;
  height: 28px;
  background: ${(p) => p.theme.colors.neutral100};
  border-radius: 4px;
  overflow: hidden;
  position: relative;
`;

const BarFill = styled.div`
  height: 100%;
  width: ${props => `${Math.max(0, Math.min(100, props.$percentage || 0))}%`};
  background: ${(p) => p.theme.colors.primary600};
  border-radius: 4px;
`;

const LoadingOverlay = styled(Flex)`
  min-height: 240px;
  align-items: center;
  justify-content: center;
`;

const AnalyticsPage = () => {
  const { formatMessage } = useIntl();
  const { get } = useFetchClient();
  const t = (id, defaultMessage, values) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
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
      const sessions = data.data || [];
      setAnalytics(computeSessionAnalytics(sessions));
    } catch (err) {
      setLoadError(true);
      logSafeAdminError('analytics.load', err);
    } finally {
      setLoading(false);
    }
  };

  // Loading analytics data
  if (loading) {
    return (
      <PluginPageLayout
        headingId="magic-sessionmanager-analytics-title"
        title={t('analytics.title', 'Session Analytics')}
        subtitle={t('analytics.subtitle', 'Session activity and device trends')}
      >
        <LoadingOverlay>
          <Loader>{t('analytics.loading', 'Loading analytics data...')}</Loader>
        </LoadingOverlay>
      </PluginPageLayout>
    );
  }

  if (loadError) {
    return (
      <PluginPageLayout
        headingId="magic-sessionmanager-analytics-title"
        title={t('analytics.title', 'Session Analytics')}
        subtitle={t('analytics.subtitle', 'Session activity and device trends')}
      >
        <Alert
          variant="danger"
          title={t('analytics.error.title', 'Analytics could not be loaded')}
          closeLabel={t('common.close', 'Close')}
          action={<Button variant="secondary" onClick={fetchAnalytics}>{t('common.retry', 'Retry')}</Button>}
        >
          <ReadableText variant="pi" textColor="neutral700" tag="span">
            {t('analytics.error.description', 'Try again. If the problem continues, check session API access and permissions.')}
          </ReadableText>
        </Alert>
      </PluginPageLayout>
    );
  }

  const maxDevices = Math.max(...Object.values(analytics?.devices || {}), 1);
  const maxBrowsers = Math.max(...Object.values(analytics?.browsers || {}), 1);
  const hasSessions = Number(analytics?.totalSessions) > 0;

  return (
    <PluginPageLayout
      headingId="magic-sessionmanager-analytics-title"
      title={t('analytics.title', 'Session Analytics')}
      subtitle={t('analytics.subtitle', 'Session activity and device trends')}
    >
      <Container>
      {/* Overview Stats */}
      <StatsGrid>
        <StatCard padding={4} background="neutral0">
          <StatIcon aria-hidden="true">
            <ChartBubble />
          </StatIcon>
          <Typography variant="delta" fontWeight="semiBold" tag="p">{analytics?.totalSessions || 0}</Typography>
          <Typography variant="pi" textColor="neutral600" tag="p">{t('analytics.stats.total', 'Total sessions')}</Typography>
        </StatCard>

        <StatCard padding={4} background="neutral0">
          <StatIcon aria-hidden="true">
            <User />
          </StatIcon>
          <Typography variant="delta" fontWeight="semiBold" tag="p">{analytics?.activeSessions || 0}</Typography>
          <Typography variant="pi" textColor="neutral600" tag="p">{t('analytics.stats.active', 'Online now')}</Typography>
        </StatCard>

        <StatCard padding={4} background="neutral0">
          <StatIcon aria-hidden="true">
            <Clock />
          </StatIcon>
          <Typography variant="delta" fontWeight="semiBold" tag="p">{analytics?.todayLogins || 0}</Typography>
          <Typography variant="pi" textColor="neutral600" tag="p">{t('analytics.stats.today', 'Logins today')}</Typography>
        </StatCard>

        <StatCard padding={4} background="neutral0">
          <StatIcon aria-hidden="true">
            <Clock />
          </StatIcon>
          <Typography variant="delta" fontWeight="semiBold" tag="p">{analytics?.weekLogins || 0}</Typography>
          <Typography variant="pi" textColor="neutral600" tag="p">{t('analytics.stats.week', 'Logins this week')}</Typography>
        </StatCard>
      </StatsGrid>

      {hasSessions ? (
        <>
      {/* Charts Row */}
      <Flex gap={4} wrap="wrap" style={{ marginBottom: '28px' }}>
        {/* Devices Chart */}
        <Box style={{ flex: '1 1 320px', minWidth: 0 }}>
          <ChartCard>
            <Flex gap={2} alignItems="center" style={{ marginBottom: 16 }}>
              <Monitor />
              <Typography variant="epsilon" fontWeight="semiBold" tag="h2">
                {t('analytics.devices.title', 'Devices')}
              </Typography>
            </Flex>
            <BarChart>
              {analytics?.devices && Object.entries(analytics.devices)
                .sort(([, a], [, b]) => b - a)
                .map(([device, count]) => (
                  <BarRow key={device}>
                    <Typography variant="pi" textColor="neutral700" style={{ flex: '0 0 96px', minWidth: 0, overflowWrap: 'anywhere' }}>{device}</Typography>
                    <BarContainer>
                      <BarFill 
                        $percentage={(count / maxDevices) * 100}
                      >
                      </BarFill>
                      <Typography variant="pi" fontWeight="semiBold" textColor="neutral800" style={{ position: 'absolute', top: '50%', right: 8, transform: 'translateY(-50%)', fontVariantNumeric: 'tabular-nums' }}>{count}</Typography>
                    </BarContainer>
                  </BarRow>
                ))}
            </BarChart>
          </ChartCard>
        </Box>

        {/* Browsers Chart */}
        <Box style={{ flex: '1 1 320px', minWidth: 0 }}>
          <ChartCard>
            <Flex gap={2} alignItems="center" style={{ marginBottom: 16 }}>
              <Monitor />
              <Typography variant="epsilon" fontWeight="semiBold" tag="h2">
                {t('analytics.browsers.title', 'Browsers')}
              </Typography>
            </Flex>
            <BarChart>
              {analytics?.browsers && Object.entries(analytics.browsers)
                .sort(([, a], [, b]) => b - a)
                .map(([browser, count]) => (
                  <BarRow key={browser}>
                    <Typography variant="pi" textColor="neutral700" style={{ flex: '0 0 96px', minWidth: 0, overflowWrap: 'anywhere' }}>{browser}</Typography>
                    <BarContainer>
                      <BarFill 
                        $percentage={(count / maxBrowsers) * 100}
                      >
                      </BarFill>
                      <Typography variant="pi" fontWeight="semiBold" textColor="neutral800" style={{ position: 'absolute', top: '50%', right: 8, transform: 'translateY(-50%)', fontVariantNumeric: 'tabular-nums' }}>{count}</Typography>
                    </BarContainer>
                  </BarRow>
                ))}
            </BarChart>
          </ChartCard>
        </Box>
      </Flex>

      {/* Average Session Duration */}
      <ChartCard>
        <Flex alignItems="center" justifyContent="space-between">
          <Flex gap={2} alignItems="center">
            <Clock />
            <Typography variant="epsilon" fontWeight="semiBold" tag="h2">
              {t('analytics.duration.title', 'Average session duration')}
            </Typography>
          </Flex>
          <Badge variant="primary" size="M">
            {t('analytics.duration.minutes', '{count} min', { count: analytics?.avgSessionDuration || 0 })}
          </Badge>
        </Flex>
        
        {analytics?.avgSessionDuration > 0 && (
          <Box marginTop={4} padding={4} background="neutral100" hasRadius>
            <ReadableText variant="pi" textColor="neutral700" tag="p">
              {t('analytics.duration.description', 'Average time between login and last activity. Higher values can indicate idle or abandoned sessions.')}
            </ReadableText>
          </Box>
        )}
      </ChartCard>
        </>
      ) : (
        <EmptyStateLayout
          icon={<ChartBubble aria-hidden="true" />}
          content={t('analytics.empty', 'Session analytics will appear here after end users sign in.')}
        />
      )}
      </Container>
    </PluginPageLayout>
  );
};

export default AnalyticsPage;
