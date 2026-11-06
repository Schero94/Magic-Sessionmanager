import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { Box, Button, Flex, Loader, Typography } from '@strapi/design-system';
import { Calendar, Clock, ClockCounterClockwise, Lightning, WarningCircle } from '@strapi/icons';
import * as StrapiAdmin from '@strapi/strapi/admin';
import { useFetchClient } from '@strapi/strapi/admin';
import ReadableText from './ReadableText';
import { getTranslation } from '../utils/getTranslation';
import { computeWidgetStats } from '../utils/widgetStats.mjs';
import { logSafeAdminError } from '../utils/safeAdminLog.mjs';

const REFRESH_INTERVAL_MS = 30000;

/**
 * Strapi's homepage widget state helpers (Widget.Loading/Error/NoData) exist
 * only in newer 5.x releases. The peer range is ^5.0.0, so they are looked up
 * at runtime and a local Design System fallback is used when they are missing.
 *
 * @param {string} name Export name.
 * @returns {any} The export or undefined.
 */
const pickAdminExport = (name) => {
  try {
    return StrapiAdmin[name];
  } catch {
    return undefined;
  }
};

const NativeWidget = pickAdminExport('Widget');
const hasNativeState = (state) => typeof NativeWidget?.[state] === 'function';

/**
 * 2 x 2 tile grid in the style of Strapi's "Key statistics" widget. The 1px
 * grid gap on a neutral200 background draws the cell borders for any column
 * count. Each column is at least half the width, so there are never more than
 * two columns; below 14rem per column the tiles stack into one column, so
 * nothing overflows at 320px (F10).
 */
const TileGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, max(14rem, calc((100% - 1px) / 2))), 1fr));
  gap: 1px;
  width: 100%;
  min-width: 0;
  background: ${({ theme }) => theme.colors.neutral200};
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  overflow: hidden;
`;

const TileIcon = styled(Flex)`
  svg path {
    fill: ${({ theme, $tone }) => theme.colors[`${$tone}600`]};
  }
`;

/**
 * One stat tile. Declared at module scope so the 30-second refresh updates the
 * tiles instead of remounting them (UX-12). The icon is decorative (UX-10).
 *
 * @param {{icon: import('react').ComponentType<any>, tone: string, label: string, value: string}} props Tile content.
 * @returns {import('react').ReactElement} Tile.
 */
const StatTile = ({ icon: Icon, tone, label, value }) => (
  <Box background="neutral0" padding={3} minWidth={0} height="100%" data-widget-tile="">
    <Flex gap={2} alignItems="center" minWidth={0}>
      <TileIcon
        $tone={tone}
        background={`${tone}100`}
        hasRadius
        padding={2}
        shrink={0}
        justifyContent="center"
        alignItems="center"
        aria-hidden
      >
        <Icon aria-hidden focusable={false} />
      </TileIcon>
      <Flex direction="column" alignItems="flex-start" minWidth={0}>
        <Typography variant="pi" fontWeight="bold" textColor="neutral600">
          {label}
        </Typography>
        <Typography variant="omega" fontWeight="bold" textColor="neutral800">
          {value}
        </Typography>
      </Flex>
    </Flex>
  </Box>
);

/**
 * Local fallback for Widget.Loading on Strapi versions without widget helpers.
 *
 * @param {{label: string}} props Accessible loading label.
 * @returns {import('react').ReactElement} Centered loader.
 */
const LoadingState = ({ label }) => {
  if (hasNativeState('Loading')) return <NativeWidget.Loading>{label}</NativeWidget.Loading>;
  return (
    <Flex height="100%" justifyContent="center" alignItems="center" padding={4}>
      <Loader small>{label}</Loader>
    </Flex>
  );
};

/**
 * Error state with a retry action. Uses Widget.Error when available.
 *
 * @param {{title: string, description: string, retryLabel: string, onRetry: () => void}} props Copy and retry handler.
 * @returns {import('react').ReactElement} Error state.
 */
const ErrorState = ({ title, description, retryLabel, onRetry }) => (
  <Flex direction="column" alignItems="center" justifyContent="center" gap={4} height="100%" role="alert">
    {hasNativeState('Error') ? (
      <NativeWidget.Error>{description}</NativeWidget.Error>
    ) : (
      <Flex direction="column" alignItems="center" gap={2}>
        <TileIcon $tone="danger" aria-hidden>
          <WarningCircle aria-hidden focusable={false} />
        </TileIcon>
        <Typography variant="delta" tag="p" textAlign="center">
          {title}
        </Typography>
        <ReadableText variant="omega" textColor="neutral600" tag="p" textAlign="center">
          {description}
        </ReadableText>
      </Flex>
    )}
    <Button variant="secondary" size="S" onClick={onRetry}>
      {retryLabel}
    </Button>
  </Flex>
);

/**
 * Empty state when no session has been recorded yet. Uses Widget.NoData when available.
 *
 * @param {{label: string}} props Message.
 * @returns {import('react').ReactElement} Empty state.
 */
const EmptyState = ({ label }) => {
  if (hasNativeState('NoData')) return <NativeWidget.NoData>{label}</NativeWidget.NoData>;
  return (
    <Flex height="100%" justifyContent="center" alignItems="center" padding={4}>
      <ReadableText variant="omega" textColor="neutral600" tag="p" textAlign="center">
        {label}
      </ReadableText>
    </Flex>
  );
};

/**
 * Homepage widget "Online users": unique users online now, in the last 15
 * minutes, the last hour and today. The link to the dashboard is registered
 * with the widget (admin/src/index.js) and rendered in the widget header.
 */
const OnlineUsersWidget = () => {
  const { formatMessage, formatNumber } = useIntl();
  const { get } = useFetchClient();
  const t = (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const requestInProgress = useRef(false);

  /**
   * Loads the session list and derives the tile values. A failed refresh
   * keeps showing the last values; a failed first load shows the error state.
   *
   * @param {{showLoading?: boolean}} [options] Whether to show the loading state.
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
      setStats(computeWidgetStats(sessions));
      setLoadError(false);
    } catch (error) {
      logSafeAdminError('onlineUsers.loadSessions', error);
      if (showLoading) setLoadError(true);
    } finally {
      if (showLoading) setLoading(false);
      requestInProgress.current = false;
    }
  }, [get]);

  useEffect(() => {
    void fetchStats();
    const interval = setInterval(() => {
      void fetchStats({ showLoading: false });
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStats]);

  if (loading) {
    return <LoadingState label={t('widget.loading', 'Loading online users')} />;
  }

  if (loadError || !stats) {
    return (
      <ErrorState
        title={t('widget.error.title', 'Session statistics could not be loaded')}
        description={t('widget.error.description', 'Try again. If the problem continues, check Session Manager API access.')}
        retryLabel={t('common.retry', 'Retry')}
        onRetry={() => { void fetchStats(); }}
      />
    );
  }

  if (stats.sessionCount === 0) {
    return <EmptyState label={t('widget.empty', 'No sessions recorded yet.')} />;
  }

  const tiles = [
    { key: 'onlineNow', icon: Lightning, tone: 'success', label: t('widget.stats.onlineNow', 'Online now') },
    { key: 'last15min', icon: Clock, tone: 'primary', label: t('widget.stats.last15min', 'Last 15 min') },
    { key: 'lastHour', icon: ClockCounterClockwise, tone: 'secondary', label: t('widget.stats.lastHour', 'Last hour') },
    { key: 'today', icon: Calendar, tone: 'alternative', label: t('widget.stats.today', 'Today') },
  ];

  return (
    <TileGrid role="group" aria-label={t('widget.online-users.title', 'Online users')}>
      {tiles.map((tile) => (
        <StatTile
          key={tile.key}
          icon={tile.icon}
          tone={tile.tone}
          label={tile.label}
          value={formatNumber(stats[tile.key])}
        />
      ))}
    </TileGrid>
  );
};


export default OnlineUsersWidget;
