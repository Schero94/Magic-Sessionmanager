import { useState, useEffect, useCallback } from 'react';
import { useIntl } from 'react-intl';
import { Box, Typography, Flex, Grid } from '@strapi/design-system';
import { Check, Cross, Clock, User, Monitor } from '@strapi/icons';
import { useFetchClient } from '@strapi/strapi/admin';
import { getTranslation } from '../utils/getTranslation';

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
    offline: 0,
    last15min: 0,
    last30min: 0,
    totalUsers: 0,
    blocked: 0,
  });
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      const { data } = await get('/magic-sessionmanager/sessions');
        const sessions = data.data || [];
        
        const now = Date.now();
        const fifteenMin = 15 * 60 * 1000;
        const thirtyMin = 30 * 60 * 1000;
        
        const onlineNow = new Set();
        const last15min = new Set();
        const last30min = new Set();
        
        sessions.forEach(session => {
          const userId = session.user?.id;
          if (!userId) return;
          
          const lastActive = session.lastActive ? new Date(session.lastActive) : new Date(session.loginTime);
          const timeSinceActive = now - lastActive.getTime();
          
          if (timeSinceActive < fifteenMin) {
            onlineNow.add(userId);
            last15min.add(userId);
            last30min.add(userId);
          } else if (timeSinceActive < thirtyMin) {
            last15min.add(userId);
            last30min.add(userId);
          }
        });
        
        try {
          // Get total users
          const { data: usersData } = await get('/content-manager/collection-types/plugin::users-permissions.user?pageSize=1');
          const totalUsers = usersData?.pagination?.total || 0;
          
          // Get blocked users count
          const { data: blockedData } = await get('/content-manager/collection-types/plugin::users-permissions.user?filters[$and][0][blocked][$eq]=true&pageSize=1');
          const blockedUsers = blockedData?.pagination?.total || 0;
          
          setStats({
            onlineNow: onlineNow.size,
            last15min: last15min.size,
            last30min: last30min.size,
            offline: totalUsers - onlineNow.size,
            totalUsers,
            blocked: blockedUsers,
          });
        } catch (err) {
          console.error('[OnlineUsersWidget] Error fetching user count:', err);
          setStats({
            onlineNow: onlineNow.size,
            last15min: last15min.size,
            last30min: last30min.size,
            offline: 0,
            totalUsers: onlineNow.size,
            blocked: 0,
          });
      }
    } catch (err) {
      console.error('[OnlineUsersWidget] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [get]);

  useEffect(() => {
    fetchStats();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  // Stat Card - styled like Project Statistics items
  const StatCard = ({ icon: Icon, label, value, color }) => (
    <Box
      as="a"
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
              {value}
            </Typography>
          </Flex>
        </Flex>
      </Flex>
    </Box>
  );

  if (loading) {
    return (
      <Box padding={4}>
        <Typography variant="pi" textColor="neutral600">{t('common.loading', 'Loading...')}</Typography>
      </Box>
    );
  }

  return (
    <Box padding={0}>
      <Flex direction="column" gap={3}>
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
