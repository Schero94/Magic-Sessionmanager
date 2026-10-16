import { useState, useEffect, useCallback, useRef } from 'react';
import { useIntl } from 'react-intl';
import { Alert, Box, Button, Typography, Flex, Grid } from '@strapi/design-system';
import ReadableText from './ReadableText';
import { Check, Cross, Clock, User } from '@strapi/icons';
import { useFetchClient } from '@strapi/strapi/admin';
import { getTranslation } from '../utils/getTranslation';
import { computeOnlineUserStats, normalizeUserCounts } from '../utils/onlineStats.mjs';
import { logSafeAdminError } from '../utils/safeAdminLog.mjs';

/**
 * Online Users Widget - Dashboard widget showing user activity statistics
 * Styled exactly like Project Statistics
 */
const OnlineUsersWidget = () => {
  const { formatMessage } = useIntl();
  const { get } = useFetchClient();
  const t = (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const [stats, setStats] = useState({
    onlineNow: 0,
    offline: null,
    last15min: 0,
    last30min: 0,
    totalUsers: null,
    blocked: null,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [userCountsUnavailable, setUserCountsUnavailable] = useState(false);
  const requestInProgress = useRef(false);

  /**
   * Loads session activity and aggregate end-user counts for the dashboard.
   * User counts remain unavailable when their API request fails; they are
   * never represented as zero unless the server returned a valid zero.
   *
   * @param {{showLoading?: boolean}} [options] Whether to show the initial or retry loading state
   * @returns {Promise<void>}
   */
  const fetchStats = useCallback(async ({ showLoading = true } = {}) => {
    if (requestInProgress.current) return;
    requestInProgress.current = true;
    if (showLoading) setLoading(true);

    try {
      const { data: sessionResponse } = await get('/magic-sessionmanager/sessions');
      const sessions = sessionResponse?.data;
      if (!Array.isArray(sessions)) throw new Error('Invalid session response');

      let userCounts = null;
      let countsUnavailable = false;
      try {
        const { data: userStatsResponse } = await get('/magic-sessionmanager/users/stats');
        userCounts = normalizeUserCounts(userStatsResponse);
        if (!userCounts) throw new Error('Invalid user statistics response');
      } catch (error) {
        logSafeAdminError('onlineUsers.userCounts', error);
        countsUnavailable = true;
      }

      setStats(computeOnlineUserStats(sessions, userCounts || {}));
      setUserCountsUnavailable(countsUnavailable);
      setLoadError(false);
    } catch (error) {
      logSafeAdminError('onlineUsers.loadSessions', error);
      setLoadError(true);
    } finally {
      if (showLoading) setLoading(false);
      requestInProgress.current = false;
    }
  }, [get]);

  useEffect(() => {
    void fetchStats();

    const interval = setInterval(() => {
      void fetchStats({ showLoading: false });
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  // Stat Card - styled like Project Statistics items
  const StatCard = ({ icon: Icon, label, value, color }) => (
    <Box
      padding={4}
      background="neutral0"
      hasRadius
      shadow="tableShadow"
      style={{
        textDecoration: 'none',
        cursor: 'default',
        transition: 'box-shadow 0.2s',
        border: '1px solid rgba(128, 128, 128, 0.1)',
      }}
    >
      <Flex justifyContent="space-between" alignItems="flex-start">
        <Flex gap={3} alignItems="center">
          <Box
            padding={2}
            background={`${color}100`}
            hasRadius
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon width="16px" height="16px" fill={`${color}600`} />
          </Box>
          <Flex direction="column" gap={1} alignItems="flex-start">
            <Typography variant="pi" textColor="neutral600">
              {label}
            </Typography>
            <Typography variant="delta" fontWeight="bold" textColor="neutral800">
              {value ?? t('common.unavailable', 'Unavailable')}
            </Typography>
          </Flex>
        </Flex>
      </Flex>
    </Box>
  );

  if (loading) {
    return (
      <Box padding={4}>
        <ReadableText variant="pi" textColor="neutral600" tag="p">{t('common.loading', 'Loading...')}</ReadableText>
      </Box>
    );
  }

  if (loadError) {
    return (
      <Box padding={4} role="alert">
        <Alert
          variant="danger"
          title={t('widget.error.title', 'Session statistics could not be loaded')}
          closeLabel=""
          action={(
            <Button variant="secondary" onClick={() => { void fetchStats(); }}>
              {t('common.retry', 'Retry')}
            </Button>
          )}
        >
          <ReadableText variant="pi" textColor="neutral700" tag="span">
            {t('widget.error.description', 'Try again. If the problem continues, check Session Manager API access.')}
          </ReadableText>
        </Alert>
      </Box>
    );
  }

  return (
    <Box padding={0}>
      <Flex direction="column" gap={3}>
        {userCountsUnavailable && (
          <Box role="status">
            <Alert
              variant="warning"
              title={t('widget.partial.title', 'Some user counts are unavailable')}
              closeLabel=""
            >
              <ReadableText variant="pi" textColor="neutral700" tag="span">
                {t('widget.partial.description', 'Session activity is shown, but total and blocked user counts could not be loaded.')}
              </ReadableText>
            </Alert>
          </Box>
        )}
        <Grid.Root gap={3} gridCols={2}>
          <Grid.Item col={1}>
            <StatCard 
              icon={Check} 
              label={t('widget.stats.onlineNow', 'Online Now')}
              value={stats.onlineNow}
              color="success"
            />
          </Grid.Item>
          
          <Grid.Item col={1}>
            <StatCard 
              icon={Cross} 
              label={t('widget.stats.offline', 'Offline')}
              value={stats.offline}
              color="neutral"
            />
          </Grid.Item>
          
          <Grid.Item col={1}>
            <StatCard 
              icon={Clock} 
              label={t('widget.stats.last15min', 'Last 15 min')}
              value={stats.last15min}
              color="primary"
            />
          </Grid.Item>
          
          <Grid.Item col={1}>
            <StatCard 
              icon={Clock} 
              label={t('widget.stats.last30min', 'Last 30 min')}
              value={stats.last30min}
              color="secondary"
            />
          </Grid.Item>
          
          <Grid.Item col={1}>
            <StatCard 
              icon={User} 
              label={t('widget.stats.totalUsers', 'Total Users')}
              value={stats.totalUsers}
              color="neutral"
            />
          </Grid.Item>
          
          <Grid.Item col={1}>
            <StatCard 
              icon={Cross} 
              label={t('widget.stats.blocked', 'Blocked')}
              value={stats.blocked}
              color="danger"
            />
          </Grid.Item>
        </Grid.Root>
      </Flex>
    </Box>
  );
};

export default OnlineUsersWidget;
