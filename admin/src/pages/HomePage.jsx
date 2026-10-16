import { useState, useEffect } from 'react';
import { useIntl } from 'react-intl';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import styled from 'styled-components';
import { getTranslation } from '../utils/getTranslation';
import { logSafeAdminError } from '../utils/safeAdminLog.mjs';
import { theme } from '../utils/theme';
import {
  Box,
  Button,
  Flex,
  Typography,
  Loader,
  Table,
  Thead,
  Tbody,
  Tr,
  Td,
  Th,
  Badge,
  TextInput,
  Alert,
  EmptyStateLayout,
  SingleSelect,
  SingleSelectOption,
} from '@strapi/design-system';
import { 
  Check,
  Cross,
  Clock,
  User,
  Monitor,
  Phone,
  Server,
  Sparkle,
  Trash,
  Search,
  Eye,
  Download,
} from '@strapi/icons';
import pluginId from '../pluginId';
import parseUserAgent from '../utils/parseUserAgent';
import { getSessionStatus } from '../utils/sessionStatus.mjs';
import { DEFAULT_SESSION_FILTER, filterSessionsByStatus } from '../utils/sessionFilters.mjs';
import { paginateSessions } from '../utils/sessionPagination.mjs';
import { buildSessionCsv, buildSessionJson } from '../utils/sessionExports.mjs';
import SessionDetailModal from '../components/SessionDetailModal';
import PluginPageLayout from '../components/PluginPageLayout';
import FormField from '../components/FormField';
import ReadableText from '../components/ReadableText';

// ================ RESPONSIVE BREAKPOINTS ================
const breakpoints = {
  mobile: '768px',
  tablet: '1024px',
};

/**
 * Parses available device metadata without treating missing native fields as a desktop device.
 * @param {object} session Normalized Magic or native session row.
 * @param {string} unavailableValue Localized fallback for missing details.
 * @returns {{device: string, browser: string, browserVersion: string, os: string, hasDeviceType: boolean}}
 */
const getSessionDeviceInfo = (session, unavailableValue) => {
  const normalize = (value) =>
    typeof value === 'string' && value.trim() && value.trim().toLowerCase() !== 'unknown'
      ? value.trim()
      : '';
  const userAgent = typeof session?.userAgent === 'string' ? session.userAgent.trim() : '';
  if (userAgent && userAgent.toLowerCase() !== 'unknown') {
    const parsed = parseUserAgent(userAgent);
    const device = normalize(parsed.device);
    return {
      device: device || unavailableValue,
      browser: normalize(parsed.browser) || unavailableValue,
      browserVersion: '',
      os: normalize(parsed.os) || unavailableValue,
      hasDeviceType: Boolean(device),
    };
  }

  const deviceName = normalize(session?.deviceName);
  const deviceType = normalize(session?.deviceType);
  const browserName = normalize(session?.browserName);
  const osName = normalize(session?.osName);

  return {
    device: deviceName || deviceType || unavailableValue,
    browser: browserName || unavailableValue,
    browserVersion: '',
    os: osName || unavailableValue,
    hasDeviceType: Boolean(deviceType),
  };
};

/**
 * Returns the same accessible badge presentation for table rows and mobile cards.
 * @param {string} status Normalized session status.
 * @param {(id: string, fallback: string) => string} translate Translation helper.
 * @returns {{variant: string, label: string}} Strapi badge presentation.
 */
const getStatusPresentation = (status, translate) => {
  const labels = {
    active: ['success', 'homepage.status.active', 'Active'],
    idle: ['warning', 'homepage.status.idle', 'Idle'],
    loggedout: ['neutral', 'homepage.status.loggedOut', 'Logged Out'],
    terminated: ['neutral', 'homepage.status.terminated', 'Terminated'],
  };
  const [variant, id, fallback] = labels[status] || labels.terminated;
  return { variant, label: translate(id, fallback) };
};

// ================ STYLED COMPONENTS ================
const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr));
  gap: ${theme.spacing.md};
  width: 100%;
  min-width: 0;
  margin-bottom: ${theme.spacing.lg};
`;

const StatCard = styled.div`
  background: ${(p) => p.theme.colors.neutral0};
  border: 1px solid ${(p) => p.theme.colors.neutral150};
  border-top: 3px solid ${(p) => p.theme.colors.primary600};
  border-radius: 4px;
  min-width: 0;
  padding: ${theme.spacing.md};
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-height: 112px;
`;

const StatIcon = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${(p) => p.theme.colors.primary100};
  color: ${(p) => p.theme.colors.primary600};
  margin-bottom: ${theme.spacing.sm};
  
  svg {
    width: 20px;
    height: 20px;
  }
`;

const DataTable = styled.div`
  background: ${(p) => p.theme.colors.neutral0};
  border-radius: 4px;
  overflow: auto;
  border: 1px solid ${(p) => p.theme.colors.neutral150};
  min-width: 0;
  max-width: 100%;
  margin-bottom: ${theme.spacing.xl};
`;

const FilterBar = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: start;
  background: ${(p) => p.theme.colors.neutral0};
  padding: ${theme.spacing.md} ${theme.spacing.lg};
  border-radius: 4px;
  margin-bottom: ${theme.spacing.lg};
  border: 1px solid ${(p) => p.theme.colors.neutral150};
  gap: ${theme.spacing.md};
  min-width: 0;

  @media screen and (max-width: ${breakpoints.mobile}) {
    grid-template-columns: minmax(0, 1fr);
    padding: ${theme.spacing.md};
  }
`;

const ActionButtons = styled.div`
  display: flex;
  gap: ${theme.spacing.xs};
  justify-content: flex-end;
`;

const DesktopSessionTable = styled.div`
  display: block;
  min-width: 0;

  @media screen and (max-width: ${breakpoints.mobile}) {
    display: none;
  }
`;

const MobileSessionCards = styled.div`
  display: none;
  min-width: 0;

  @media screen and (max-width: ${breakpoints.mobile}) {
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing.md};
    margin-bottom: ${theme.spacing.lg};
  }
`;

const MobileSessionCard = styled.div`
  background: ${(p) => p.theme.colors.neutral0};
  min-width: 0;
  border: 1px solid ${(p) => p.theme.colors.neutral150};
  border-radius: 4px;
  overflow-wrap: anywhere;
  padding: ${theme.spacing.md};
`;

const HomePage = () => {
  const { formatMessage } = useIntl();
  const { get, post, del } = useFetchClient();
  const { toggleNotification } = useNotification();
  const t = (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const unavailableValue = t('homepage.user.unknown', 'Unavailable');
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [filterStatus, setFilterStatus] = useState(DEFAULT_SESSION_FILTER);
  const [entriesPerPage, setEntriesPerPage] = useState('25');
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSession, setSelectedSession] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [terminatingSessionId, setTerminatingSessionId] = useState(null);
  const [deletingSessionId, setDeletingSessionId] = useState(null);

  useEffect(() => {
    fetchSessions();
    
    // Auto-refresh every 10 minutes (silent background update)
    // But ONLY if modal is not open (to avoid interrupting user)
    const interval = setInterval(() => {
      if (!showDetailModal) {
        fetchSessions();
      }
    }, 10 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, [showDetailModal]);

  /**
   * Loads the complete admin session collection for dashboard filtering,
   * pagination, detail views and exports.
   *
   * @returns {Promise<void>}
   */
  const fetchSessions = async () => {
    setLoading(true);
    setLoadError(null);
      try {
      const { data } = await get(`/${pluginId}/sessions`);
        setSessions(data.data || []);
      } catch (err) {
      setLoadError(t('homepage.error.load', 'Session data could not be loaded. Try again.'));
      logSafeAdminError('dashboard.loadSessions', err);
      } finally {
        setLoading(false);
      }
    };

  /**
   * Confirms and requests termination of one session, then refreshes the list.
   *
   * @param {string} sessionId Session ID accepted by the admin API.
   * @returns {Promise<void>}
   */
  const handleTerminateSession = async (sessionId) => {
    if (terminatingSessionId || deletingSessionId) return;
    if (!confirm(t('homepage.confirm.terminate', 'Are you sure you want to terminate this session?\n\nThis will set isActive to false (user will be logged out).'))) {
      return;
    }

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
    } finally {
      setTerminatingSessionId(null);
    }
  };

  /**
   * Confirms removal of session details and reports that token denial remains
   * in force until any unexpired access token reaches its expiry.
   *
   * @param {string} sessionId Session documentId
   * @returns {Promise<void>}
   */
  const handleDeleteSession = async (sessionId) => {
    if (terminatingSessionId || deletingSessionId) return;
    if (!confirm(t(
      'homepage.confirm.delete',
      "Remove this session's details? Any unexpired access token remains blocked until it expires."
    ))) {
      return;
    }

    setDeletingSessionId(sessionId);
    try {
      await del(`/${pluginId}/sessions/${sessionId}`);
      await fetchSessions();
      toggleNotification({
        type: 'success',
        message: t('notifications.success.deleted', 'Session details removed. Token revocation remains until expiry.'),
      });
    } catch (err) {
      logSafeAdminError('dashboard.deleteSession', err);
      toggleNotification({
        type: 'danger',
        message: t('notifications.error.delete', 'Failed to delete session'),
      });
    } finally {
      setDeletingSessionId(null);
    }
  };

  /**
   * Downloads CSV for every session matching the current filters, not only the
   * rows visible on the current page.
   *
   * @returns {void}
   */
  const handleExportCSV = () => {
    try {
      const csvContent = buildSessionCsv(filteredSessions, {
        unavailableValue,
        getDeviceInfo: getSessionDeviceInfo,
        getSessionStatus,
      });
      
      // Download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `sessions-export-${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      
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
        filterStatus,
        totalSessions: sessions.length,
        exportedAt: new Date().toISOString(),
        unavailableValue,
        getDeviceInfo: getSessionDeviceInfo,
        getSessionStatus,
      });

      const blob = new Blob([jsonContent], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `sessions-export-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      
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

  const getDeviceIcon = (deviceType) => {
    if (deviceType === 'Mobile' || deviceType === 'Tablet') return Phone;
    if (deviceType === 'Desktop' || deviceType === 'Laptop') return Monitor;
    return Server;
  };

  // Calculate stats based on new 4-status logic
  const activeSessions = sessions.filter(s => s.isActive && s.isTrulyActive);
  const idleSessions = sessions.filter(s => getSessionStatus(s) === 'idle');
  const loggedOutSessions = sessions.filter(s => getSessionStatus(s) === 'loggedout');
  const terminatedSessions = sessions.filter(s => getSessionStatus(s) === 'terminated');

  const handleSessionClick = (session) => {
    setSelectedSession(session);
    setShowDetailModal(true);
  };

  const handleModalClose = () => {
    setShowDetailModal(false);
    setSelectedSession(null);
  };

  const handleSessionTerminated = () => {
    fetchSessions();
  };

  // Filter the complete collection before deriving the visible page. Exports
  // intentionally consume this full result set, not just the current page.
  const filteredSessions = filterSessionsByStatus(sessions, filterStatus)
    .filter((session) => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesUser = session.user?.email?.toLowerCase().includes(query) ||
                           session.user?.username?.toLowerCase().includes(query);
        const matchesIp = session.ipAddress?.toLowerCase().includes(query);
        const deviceInfo = getSessionDeviceInfo(session, unavailableValue);
        const matchesDevice = deviceInfo.device?.toLowerCase().includes(query) ||
                             deviceInfo.browser?.toLowerCase().includes(query) ||
                             deviceInfo.os?.toLowerCase().includes(query);
        
        return matchesUser || matchesIp || matchesDevice;
  }

      return true;
    });
  const pageResult = paginateSessions(filteredSessions, currentPage, entriesPerPage);

  const exportActions = filteredSessions.length > 0 ? (
    <Flex gap={2} wrap="wrap">
      <Button onClick={handleExportCSV} startIcon={<Download />} variant="secondary">
        {t('homepage.export.csv', 'Export CSV')}
      </Button>
      <Button onClick={handleExportJSON} startIcon={<Download />} variant="secondary">
        {t('homepage.export.json', 'Export JSON')}
      </Button>
    </Flex>
  ) : null;

  return (
    <PluginPageLayout
      headingId="magic-sessionmanager-dashboard-title"
      title={t('homepage.title', 'Session Manager')}
      subtitle={t('homepage.subtitle', 'Monitor and manage end-user sessions')}
      primaryAction={exportActions}
    >
      <Box style={{ width: '100%', minWidth: 0 }}>
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

      {/* Stats Cards */}
      <StatsGrid>
        <StatCard>
          <StatIcon aria-hidden="true">
            <Check />
          </StatIcon>
          <Typography variant="delta" fontWeight="semiBold" tag="p" style={{ margin: 0 }}>{activeSessions.length}</Typography>
          <Typography variant="pi" textColor="neutral600" tag="p" style={{ margin: 0 }}>{t('homepage.stats.active', 'Active')}</Typography>
        </StatCard>

        <StatCard>
          <StatIcon aria-hidden="true">
            <Clock />
          </StatIcon>
          <Typography variant="delta" fontWeight="semiBold" tag="p" style={{ margin: 0 }}>{idleSessions.length}</Typography>
          <Typography variant="pi" textColor="neutral600" tag="p" style={{ margin: 0 }}>{t('homepage.stats.idle', 'Idle')}</Typography>
        </StatCard>

        <StatCard>
          <StatIcon aria-hidden="true">
            <Cross />
          </StatIcon>
          <Typography variant="delta" fontWeight="semiBold" tag="p" style={{ margin: 0 }}>{loggedOutSessions.length}</Typography>
          <Typography variant="pi" textColor="neutral600" tag="p" style={{ margin: 0 }}>{t('homepage.stats.loggedOut', 'Logged Out')}</Typography>
        </StatCard>

        <StatCard>
          <StatIcon aria-hidden="true">
            <Cross />
          </StatIcon>
          <Typography variant="delta" fontWeight="semiBold" tag="p" style={{ margin: 0 }}>{terminatedSessions.length}</Typography>
          <Typography variant="pi" textColor="neutral600" tag="p" style={{ margin: 0 }}>{t('homepage.stats.terminated', 'Terminated')}</Typography>
        </StatCard>

        <StatCard>
          <StatIcon aria-hidden="true">
            <User />
          </StatIcon>
          <Typography variant="delta" fontWeight="semiBold" tag="p" style={{ margin: 0 }}>{sessions.length}</Typography>
          <Typography variant="pi" textColor="neutral600" tag="p" style={{ margin: 0 }}>{t('homepage.stats.total', 'Total')}</Typography>
        </StatCard>
      </StatsGrid>

      {/* Loading */}
      {loading && (
        <Flex justifyContent="center" padding={8}>
          <Loader>{t('homepage.loading', 'Loading sessions...')}</Loader>
        </Flex>
      )}

      {/* Sessions Table */}
      {!loading && sessions.length > 0 && (
        <Box>
          <Box style={{ marginBottom: theme.spacing.md }}>
            <Typography variant="delta" textColor="neutral700" style={{ marginBottom: theme.spacing.md }}>
              {t('homepage.allSessions', 'All Sessions')}
            </Typography>
          </Box>
          
          {/* Filter Bar */}
          <FilterBar>
            <FormField
              id="session-search"
              name="sessionSearch"
              label={t('homepage.search.label', 'Search sessions')}
              description={t('homepage.search.hint', 'Search end-user sessions by username, email, IP address, or device.')}
            >
              <TextInput
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder={t('homepage.search.placeholder', 'Search by user, IP address, or device...')}
                startAction={<Search />}
              />
            </FormField>
            
            <FormField
              id="session-status-filter"
              name="sessionStatus"
              label={t('homepage.filter.label', 'Filter sessions by status')}
              description={t('homepage.filter.hint', 'Limit the list to sessions with this status.')}
            >
              <SingleSelect
                value={filterStatus}
                onChange={(value) => {
                  setFilterStatus(value);
                  setCurrentPage(1);
                }}
                size="S"
              >
                <SingleSelectOption value="all">{t('homepage.filter.all', 'All Sessions')}</SingleSelectOption>
                <SingleSelectOption value="active">{t('homepage.filter.active', 'Currently active')}</SingleSelectOption>
                <SingleSelectOption value="idle">{t('homepage.filter.idle', 'Inactive')}</SingleSelectOption>
                <SingleSelectOption value="loggedout">{t('homepage.filter.loggedout', 'Logged Out')}</SingleSelectOption>
                <SingleSelectOption value="terminated">{t('homepage.filter.terminated', 'Terminated')}</SingleSelectOption>
              </SingleSelect>
            </FormField>
            
            <FormField
              id="sessions-per-page"
              name="sessionsPerPage"
              label={t('homepage.entries.label', 'Sessions per page')}
              description={t('homepage.entries.hint', 'Choose how many sessions appear on each page.')}
            >
              <SingleSelect
                value={entriesPerPage}
                onChange={(value) => {
                  setEntriesPerPage(value);
                  setCurrentPage(1);
                }}
                size="S"
              >
                <SingleSelectOption value="10">{t('homepage.entries.10', '10 entries')}</SingleSelectOption>
                <SingleSelectOption value="25">{t('homepage.entries.25', '25 entries')}</SingleSelectOption>
                <SingleSelectOption value="50">{t('homepage.entries.50', '50 entries')}</SingleSelectOption>
                <SingleSelectOption value="100">{t('homepage.entries.100', '100 entries')}</SingleSelectOption>
              </SingleSelect>
            </FormField>
          </FilterBar>
          
          {/* Results count */}
          <Box style={{ marginBottom: theme.spacing.md }}>
            <Typography variant="pi" textColor="neutral600">
              {searchQuery
                ? t(
                    'homepage.pagination.filteredRange',
                    'Showing {start}-{end} of {count} matching sessions (filtered by "{query}")',
                    { start: pageResult.startIndex, end: pageResult.endIndex, count: pageResult.total, query: searchQuery }
                  )
                : t(
                    'homepage.pagination.range',
                    'Showing {start}-{end} of {count} sessions',
                    { start: pageResult.startIndex, end: pageResult.endIndex, count: pageResult.total }
                  )
              }
            </Typography>
          </Box>
          
          {/* Table or No Results */}
          {filteredSessions.length > 0 ? (
          <>
          <DesktopSessionTable>
          <DataTable>
            <Table style={{ minWidth: 1024 }}>
              <Thead>
                <Tr>
                  <Th>{t('homepage.table.status', 'Status')}</Th>
                  <Th>{t('homepage.table.user', 'User')}</Th>
                  <Th>{t('homepage.table.device', 'Device')}</Th>
                  <Th>{t('homepage.table.ipAddress', 'IP Address')}</Th>
                  <Th>{t('homepage.table.loginTime', 'Login Time')}</Th>
                  <Th>{t('homepage.table.lastActive', 'Last Active')}</Th>
                  <Th>{t('homepage.table.actions', 'Actions')}</Th>
                </Tr>
              </Thead>
              <Tbody>
                {pageResult.items.map((session) => {
                  const deviceInfo = getSessionDeviceInfo(session, unavailableValue);
                  const DeviceIcon = getDeviceIcon(deviceInfo.device);
                  const sessionStatus = getSessionStatus(session);
                  const config = getStatusPresentation(sessionStatus, t);
                  
                  return (
                    <Tr
                      key={session.id} 
                      tabIndex={0}
                      style={{ cursor: 'pointer' }}
                      aria-label={`${config.label}: ${session.user?.email || session.user?.username || t('homepage.user.unknown', 'Unknown')}`}
                      onClick={() => handleSessionClick(session)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          handleSessionClick(session);
                        }
                      }}
                    >
                      {/* Status */}
                      <Td>
                        <Badge variant={config.variant} size="S">
                          {config.label}
                        </Badge>
                      </Td>
                      
                      {/* User */}
                      <Td>
                        <Flex direction="column" alignItems="flex-start">
                          <Typography fontWeight="semiBold" ellipsis>
                            {session.user?.username || session.user?.email || t('homepage.user.unknown', 'Unknown')}
                          </Typography>
                          {session.user?.email && session.user?.username && (
                            <Typography variant="pi" textColor="neutral600" ellipsis>
                              {session.user.email}
                            </Typography>
                          )}
                        </Flex>
                      </Td>
                      
                      {/* Device */}
                      <Td>
                        <Flex alignItems="center" gap={2}>
                          {deviceInfo.hasDeviceType && <DeviceIcon width="18px" height="18px" />}
                          <Flex direction="column" alignItems="flex-start">
                            <Typography variant="omega" fontWeight="semiBold">
                              {deviceInfo.device}
                            </Typography>
                            <Typography variant="pi" textColor="neutral600">
                              {deviceInfo.browser} on {deviceInfo.os}
                            </Typography>
                          </Flex>
                        </Flex>
                      </Td>
                      
                      {/* IP Address */}
                      <Td>
                        <Typography variant="omega" style={{ fontFamily: 'monospace' }}>
                          {session.ipAddress || unavailableValue}
                        </Typography>
                      </Td>
                      
                      {/* Login Time */}
                      <Td>
                        <Typography variant="pi" textColor="neutral700">
                  {new Date(session.loginTime).toLocaleString()}
                        </Typography>
                      </Td>
                      
                      {/* Last Active */}
                      <Td>
                        <Flex direction="column" alignItems="flex-start">
                          <Typography variant="pi" textColor="neutral700">
                            {new Date(session.lastActive || session.loginTime).toLocaleString()}
                          </Typography>
                          <Typography variant="pi" textColor={sessionStatus === 'active' ? 'success600' : 'neutral500'}>
                            {t('homepage.time.minAgo', '{minutes} min ago', { minutes: session.minutesSinceActive })}
                          </Typography>
                        </Flex>
                      </Td>
                      
                      {/* Actions */}
                      <Td onClick={(e) => e.stopPropagation()}>
                        <ActionButtons className="action-buttons">
                          <Button
                            size="S"
                            variant="tertiary"
                            aria-label={`${t('homepage.actions.viewDetails', 'View Details')}: ${session.user?.email || session.user?.username || ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSessionClick(session);
                            }}
                            title={t('homepage.actions.viewDetails', 'View Details')}
                          >
                            <Eye />
                          </Button>
                          <Button
                            size="S"
                            variant="danger-light"
                            aria-label={`${t('homepage.actions.terminate', 'Terminate (Logout)')}: ${session.user?.email || session.user?.username || ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTerminateSession(session.id);
                            }}
                            loading={terminatingSessionId === session.id}
                            disabled={
                              !session.isActive || Boolean(terminatingSessionId) || Boolean(deletingSessionId)
                            }
                            title={session.isActive ? t('homepage.actions.terminate', 'Terminate (Logout)') : t('homepage.actions.alreadyInactive', 'Already inactive')}
                          >
                            <Cross />
                          </Button>
                          <Button
                            size="S"
                            variant="danger-light"
                            aria-label={t('homepage.actions.deletePermanently', 'Remove session details')}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSession(session.id);
                            }}
                            loading={deletingSessionId === session.id}
                            disabled={Boolean(terminatingSessionId) || Boolean(deletingSessionId)}
                            title={t('homepage.actions.deletePermanently', 'Remove Session Details')}
                          >
                            <Trash />
                          </Button>
                        </ActionButtons>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </DataTable>
          </DesktopSessionTable>

          <MobileSessionCards aria-label={t('homepage.mobileList.label', 'Session results')}>
            {pageResult.items.map((session) => {
              const deviceInfo = getSessionDeviceInfo(session, unavailableValue);
              const DeviceIcon = getDeviceIcon(deviceInfo.device);
              const presentation = getStatusPresentation(getSessionStatus(session), t);
              const userLabel = session.user?.username || session.user?.email || t('homepage.user.unknown', 'Unknown');

              return (
                <MobileSessionCard key={session.id}>
                  <Flex justifyContent="space-between" alignItems="center" gap={2} wrap="wrap">
                    <Badge variant={presentation.variant} size="S">{presentation.label}</Badge>
                    <Typography variant="pi" textColor="neutral600">
                      {new Date(session.lastActive || session.loginTime).toLocaleString()}
                    </Typography>
                  </Flex>

                  <Box marginTop={3}>
                    <Flex direction="column" alignItems="stretch" gap={1}>
                      <Typography variant="epsilon" fontWeight="semiBold">
                        {userLabel}
                      </Typography>
                      {session.user?.email && session.user?.username ? (
                        <Typography variant="pi" textColor="neutral600">
                          {session.user.email}
                        </Typography>
                      ) : null}
                    </Flex>
                  </Box>

                  <Flex direction="column" alignItems="stretch" gap={1} marginTop={3}>
                    <Flex gap={2} alignItems="center">
                      {deviceInfo.hasDeviceType ? <DeviceIcon aria-hidden="true" /> : null}
                      <Typography variant="pi" textColor="neutral700">
                        {deviceInfo.device} · {deviceInfo.browser} on {deviceInfo.os}
                      </Typography>
                    </Flex>
                    <Typography variant="pi" textColor="neutral600">
                      {t('homepage.table.ipAddress', 'IP Address')}: {session.ipAddress || unavailableValue}
                    </Typography>
                    <Typography variant="pi" textColor="neutral600">
                      {t('homepage.table.loginTime', 'Login Time')}: {new Date(session.loginTime).toLocaleString()}
                    </Typography>
                    <Typography variant="pi" textColor="neutral600">
                      {t('homepage.time.minAgo', '{minutes} min ago', {
                        minutes: Number.isFinite(session.minutesSinceActive)
                          ? session.minutesSinceActive
                          : unavailableValue,
                      })}
                    </Typography>
                  </Flex>

                  <Flex gap={2} wrap="wrap" marginTop={4}>
                    <Button
                      size="S"
                      variant="tertiary"
                      startIcon={<Eye />}
                      onClick={() => handleSessionClick(session)}
                      aria-label={`${t('homepage.actions.viewDetails', 'View Details')}: ${userLabel}`}
                    >
                      {t('homepage.actions.viewDetails', 'View Details')}
                    </Button>
                    <Button
                      size="S"
                      variant="danger-light"
                      startIcon={<Cross />}
                      onClick={() => handleTerminateSession(session.id)}
                      loading={terminatingSessionId === session.id}
                      disabled={!session.isActive || Boolean(terminatingSessionId) || Boolean(deletingSessionId)}
                    >
                      {t('homepage.actions.terminate', 'Terminate')}
                    </Button>
                    <Button
                      size="S"
                      variant="tertiary"
                      startIcon={<Trash />}
                      onClick={() => handleDeleteSession(session.id)}
                      loading={deletingSessionId === session.id}
                      disabled={Boolean(terminatingSessionId) || Boolean(deletingSessionId)}
                    >
                      {t('homepage.actions.deletePermanently', 'Remove Session Details')}
                    </Button>
                  </Flex>
                </MobileSessionCard>
              );
            })}
          </MobileSessionCards>
          {pageResult.pageCount > 1 && (
            <nav aria-label={t('homepage.pagination.label', 'Session pages')}>
              <Flex
                justifyContent="space-between"
                alignItems="center"
                gap={3}
                wrap="wrap"
                style={{ marginTop: theme.spacing.md }}
              >
                <Typography variant="pi" textColor="neutral600" aria-live="polite">
                  {t('homepage.pagination.page', 'Page {page} of {pages}', {
                    page: pageResult.page,
                    pages: pageResult.pageCount,
                  })}
                </Typography>
                <Flex gap={2}>
                  <Button
                    variant="tertiary"
                    size="S"
                    disabled={pageResult.page <= 1}
                    onClick={() => setCurrentPage(pageResult.page - 1)}
                  >
                    {t('homepage.pagination.previous', 'Previous')}
                  </Button>
                  <Button
                    variant="tertiary"
                    size="S"
                    disabled={pageResult.page >= pageResult.pageCount}
                    onClick={() => setCurrentPage(pageResult.page + 1)}
                  >
                    {t('homepage.pagination.next', 'Next')}
                  </Button>
                </Flex>
              </Flex>
            </nav>
          )}
          </>
          ) : (
            <EmptyStateLayout
              icon={<Search aria-hidden="true" />}
              content={(
                <ReadableText variant="pi" textColor="neutral700" tag="span">
                  {t('homepage.noResults.description', 'Try adjusting your search or status filter.')}
                </ReadableText>
              )}
              action={(
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearchQuery('');
                    setFilterStatus(DEFAULT_SESSION_FILTER);
                    setCurrentPage(1);
                  }}
                >
                  {t('homepage.noResults.reset', 'Clear filters')}
                </Button>
              )}
            />
          )}
        </Box>
      )}

      {/* Empty State */}
      {!loading && sessions.length === 0 && !loadError && (
        <EmptyStateLayout
          icon={<Monitor aria-hidden="true" />}
          content={(
            <ReadableText variant="pi" textColor="neutral700" tag="span">
              {t('homepage.empty.description', 'Sessions will appear here when end users log in.')}
            </ReadableText>
          )}
        />
      )}

      {/* Session Detail Modal */}
      {showDetailModal && selectedSession && (
        <SessionDetailModal
          session={selectedSession}
          onClose={handleModalClose}
          onSessionTerminated={handleSessionTerminated}
        />
      )}
      </Box>
    </PluginPageLayout>
  );
};

export default HomePage;
