import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { Box, Button, Flex, Loader, Typography } from '@strapi/design-system';
import { Clock, Lightning, Lock, User, WarningCircle } from '@strapi/icons';
import * as StrapiAdmin from '@strapi/strapi/admin';
import { useFetchClient } from '@strapi/strapi/admin';
import ReadableText from './ReadableText';
import { MissingValue } from './ui';
import { getTranslation } from '../utils/getTranslation';
import { requireSessionList } from '../utils/adminResponse.mjs';
import { normalizeUserCounts } from '../utils/onlineStats.mjs';
import { computeWidgetStats } from '../utils/widgetStats.mjs';
import { isCancelledRequest, logSafeAdminError } from '../utils/safeAdminLog.mjs';

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
 * 2 x 2 tile grid in the style of Strapi's "Key statistics" widget. The frame
 * clips the grid, which is 1px larger than the frame on the right and bottom:
 * every tile draws its own right and bottom line, and the lines of the last
 * column and row fall outside the frame, so the cell lines are correct without
 * an off-scale 1px grid gap. The grid is always 2 x 2 like the native tiles:
 * one stacked column would be taller than the fixed widget height and cut off
 * the last tile. The frame is a size container; below 28rem (280px, the admin
 * root font size is 10px), i.e. on 320px screens, the decorative icons hide, so the labels keep enough width and
 * nothing overflows (F10). All rows share one height, so the tiles are equal.
 */
const TileFrame = styled.div`
  width: 100%;
  min-width: 0;
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  overflow: hidden;
  container-type: inline-size;

  @container (max-width: 28rem) {
    & [data-tile-icon] {
      display: none;
    }
  }
`;

const TileGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: 1fr;
  gap: 0;
  min-width: 0;
  margin: 0 -1px -1px 0;

  & > [data-widget-tile] {
    border-right: 1px solid ${({ theme }) => theme.colors.neutral200};
    border-bottom: 1px solid ${({ theme }) => theme.colors.neutral200};
    overflow-wrap: anywhere;
  }
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
 * @param {{
 *   icon: import('react').ComponentType<any>,
 *   tone: string,
 *   label: string,
 *   value: string|null,
 *   detail?: string|null,
 * }} props Tile content; a null value renders the shared missing marker.
 * @returns {import('react').ReactElement} Tile.
 */
const StatTile = ({ icon: Icon, tone, label, value, detail }) => (
  <Box background="neutral0" padding={3} minWidth={0} height="100%" data-widget-tile="">
    <Flex gap={2} alignItems="flex-start" minWidth={0}>
      <TileIcon
        $tone={tone}
        background={`${tone}100`}
        hasRadius
        padding={2}
        shrink={0}
        justifyContent="center"
        alignItems="center"
        aria-hidden
        data-tile-icon=""
      >
        <Icon aria-hidden focusable={false} />
      </TileIcon>
      <Flex direction="column" alignItems="flex-start" minWidth={0}>
        <Typography variant="pi" fontWeight="bold" textColor="neutral600">
          {label}
        </Typography>
        {value === null ? (
          <MissingValue variant="omega" textColor="neutral800" />
        ) : (
          <Typography variant="omega" fontWeight="bold" textColor="neutral800">
            {value}
          </Typography>
        )}
        {detail ? (
          <Typography variant="pi" textColor="neutral600">
            {detail}
          </Typography>
        ) : null}
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

/** Centres the text of Widget.Error, which aligns it to the start when it wraps. */
const CenteredText = styled(Box)`
  text-align: center;
`;

/**
 * Error state with a retry action. Uses Widget.Error when available. That
 * helper fills the widget height, so it sits in an auto-height box and the
 * retry button stays directly under the message.
 *
 * @param {{message: string, retryLabel: string, onRetry: () => void}} props Copy and retry handler.
 * @returns {import('react').ReactElement} Error state.
 */
const ErrorState = ({ message, retryLabel, onRetry }) => (
  <Flex
    direction="column"
    alignItems="center"
    justifyContent="center"
    gap={4}
    height="100%"
    role="alert"
  >
    {hasNativeState('Error') ? (
      <CenteredText>
        <NativeWidget.Error>{message}</NativeWidget.Error>
      </CenteredText>
    ) : (
      <Flex direction="column" alignItems="center" gap={2}>
        <TileIcon $tone="danger" aria-hidden>
          <WarningCircle aria-hidden focusable={false} />
        </TileIcon>
        <ReadableText variant="omega" textColor="neutral800" tag="p" textAlign="center">
          {message}
        </ReadableText>
      </Flex>
    )}
    <Button variant="secondary" size="S" onClick={onRetry}>
      {retryLabel}
    </Button>
  </Flex>
);

/**
 * Empty state when no user has signed in yet. Uses Widget.NoData when available.
 *
 * @param {{label: string}} props Message.
 * @returns {import('react').ReactElement} Empty state.
 */
const EmptyState = ({ label }) => {
  if (hasNativeState('NoData')) return <NativeWidget.NoData>{label}</NativeWidget.NoData>;
  return (
    <Flex height="100%" justifyContent="center" alignItems="center" padding={4}>
      <ReadableText variant="omega" textColor="neutral700" tag="p" textAlign="center">
        {label}
      </ReadableText>
    </Flex>
  );
};

/**
 * Homepage widget "Online users" (IA D4): who is online right now.
 * Tiles: Online users (of all registered users), Active sessions, Idle
 * sessions, Blocked users. "Online" follows the configured inactivity timeout
 * through the server's `isTrulyActive` flag (decision I.2-2). The link to the
 * dashboard is registered with the widget (admin/src/index.js) and rendered in
 * the widget header.
 */
const OnlineUsersWidget = () => {
  const { formatMessage, formatNumber } = useIntl();
  const { get } = useFetchClient();
  const t = (id, defaultMessage, values) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const [stats, setStats] = useState(null);
  const [userCounts, setUserCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const requestInProgress = useRef(false);

  /**
   * Loads the sessions and the count-only user totals in parallel. A failed
   * refresh keeps the last values; a failed first session load shows the
   * error state. When only the user totals fail, the session tiles still show.
   *
   * The loading state starts as true and "Try again" sets it before calling,
   * so this function only clears it.
   *
   * @param {{showLoading?: boolean}} [options] Whether this load owns the loading and error state.
   * @returns {Promise<void>}
   */
  const fetchStats = useCallback(
    async ({ showLoading = true } = {}) => {
      if (requestInProgress.current) return;
      requestInProgress.current = true;

      try {
        const [sessionResult, countResult] = await Promise.allSettled([
          get('/magic-sessionmanager/sessions'),
          get('/magic-sessionmanager/users/stats'),
        ]);
        if (sessionResult.status === 'rejected') throw sessionResult.reason;
        setStats(computeWidgetStats(requireSessionList(sessionResult.value?.data)));
        setLoadError(false);

        const counts =
          countResult.status === 'fulfilled' ? normalizeUserCounts(countResult.value?.data) : null;
        if (counts) {
          setUserCounts(counts);
        } else {
          logSafeAdminError(
            'onlineUsers.loadUserCounts',
            countResult.status === 'rejected' ? countResult.reason : null
          );
          if (showLoading) setUserCounts(null);
        }
      } catch (error) {
        // A request aborted because the widget unmounted is not a failure.
        if (isCancelledRequest(error)) return;
        logSafeAdminError('onlineUsers.loadSessions', error);
        if (showLoading) setLoadError(true);
      } finally {
        if (showLoading) setLoading(false);
        requestInProgress.current = false;
      }
    },
    [get]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state updates run after await; the compiler cannot see through the callback
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
        message={t('widget.error.message', 'Online users could not be loaded.')}
        retryLabel={t('common.tryAgain', 'Try again')}
        onRetry={() => {
          setLoading(true);
          void fetchStats();
        }}
      />
    );
  }

  if (stats.sessionCount === 0) {
    return <EmptyState label={t('widget.empty.noSignIns', 'No users have signed in yet.')} />;
  }

  const onlineUsersDetail = userCounts
    ? t(
        'widget.stats.registeredUsers',
        '{total, plural, one {of # registered user} other {of # registered users}}',
        { total: userCounts.totalUsers }
      )
    : t('widget.stats.userTotalsError', 'User totals could not be loaded.');

  const tiles = [
    {
      key: 'onlineUsers',
      icon: User,
      tone: 'success',
      label: t('widget.stats.onlineUsers', 'Online users'),
      value: formatNumber(stats.onlineUsers),
      detail: onlineUsersDetail,
    },
    {
      key: 'activeSessions',
      icon: Lightning,
      tone: 'primary',
      label: t('widget.stats.activeSessions', 'Active sessions'),
      value: formatNumber(stats.activeSessions),
    },
    {
      key: 'idleSessions',
      icon: Clock,
      tone: 'warning',
      label: t('widget.stats.idleSessions', 'Idle sessions'),
      value: formatNumber(stats.idleSessions),
    },
    {
      key: 'blockedUsers',
      icon: Lock,
      tone: 'neutral',
      label: t('widget.stats.blockedUsers', 'Blocked users'),
      value: userCounts ? formatNumber(userCounts.blockedUsers) : null,
    },
  ];

  return (
    <TileFrame>
      <TileGrid role="group" aria-label={t('widget.online-users.title', 'Online users')}>
        {tiles.map((tile) => (
          <StatTile
            key={tile.key}
            icon={tile.icon}
            tone={tile.tone}
            label={tile.label}
            value={tile.value}
            detail={tile.detail}
          />
        ))}
      </TileGrid>
    </TileFrame>
  );
};

export default OnlineUsersWidget;
