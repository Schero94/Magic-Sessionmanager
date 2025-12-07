import { useState, useEffect } from 'react';
import { useIntl } from 'react-intl';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import styled, { keyframes, css } from 'styled-components';
import { getTranslation } from '../utils/getTranslation';
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
import SessionDetailModal from '../components/SessionDetailModal';
import { useLicense } from '../hooks/useLicense';

// ================ ANIMATIONS ================
const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
`;

const shimmer = keyframes`
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
`;

const float = keyframes`
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-5px); }
`;

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
`;

const FloatingEmoji = styled.div`
  position: absolute;
  bottom: 40px;
  right: 40px;
  font-size: 72px;
  opacity: 0.08;
  ${css`animation: ${float} 4s ease-in-out infinite;`}
`;

// ================ RESPONSIVE BREAKPOINTS ================
const breakpoints = {
  mobile: '768px',
  tablet: '1024px',
};

// ================ STYLED COMPONENTS ================
const Container = styled(Box)`
  ${css`animation: ${fadeIn} ${theme.transitions.slow};`}
  min-height: 100vh;
  max-width: 1440px;
  margin: 0 auto;
  padding: ${theme.spacing.xl} ${theme.spacing.lg} 0;
  
  @media screen and (max-width: ${breakpoints.mobile}) {
    padding: 16px 12px 0;
  }
`;

const Header = styled(Box)`
  background: linear-gradient(135deg, 
    ${theme.colors.primary[600]} 0%, 
    ${theme.colors.secondary[600]} 100%
  );
  border-radius: ${theme.borderRadius.xl};
  padding: ${theme.spacing.xl} ${theme.spacing['2xl']};
  margin-bottom: ${theme.spacing.xl};
  position: relative;
  overflow: hidden;
  box-shadow: ${theme.shadows.xl};
  
  @media screen and (max-width: ${breakpoints.mobile}) {
    padding: 24px 20px;
    border-radius: 12px;
  }
  
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 200%;
    height: 100%;
    background: linear-gradient(
      90deg, 
      transparent, 
      rgba(255, 255, 255, 0.15), 
      transparent
    );
    ${css`animation: ${shimmer} 3s infinite;`}
  }
  
  &::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    width: 100%;
    height: 100%;
    background-image: radial-gradient(circle at 20% 80%, transparent 50%, rgba(255, 255, 255, 0.1) 50%);
    background-size: 15px 15px;
    opacity: 0.3;
  }
`;

const HeaderContent = styled(Flex)`
  position: relative;
  z-index: 1;
`;

const Title = styled(Typography)`
  color: white;
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: -0.025em;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  gap: ${theme.spacing.sm};
  
  svg {
    width: 28px;
    height: 28px;
    ${css`animation: ${float} 3s ease-in-out infinite;`}
  }
  
  @media screen and (max-width: ${breakpoints.mobile}) {
    font-size: 1.5rem;
    
    svg {
      width: 22px;
      height: 22px;
    }
  }
`;

const Subtitle = styled(Typography)`
  color: rgba(255, 255, 255, 0.95);
  font-size: 0.95rem;
  font-weight: 400;
  margin-top: ${theme.spacing.xs};
  letter-spacing: 0.01em;
  
  @media screen and (max-width: ${breakpoints.mobile}) {
    font-size: 0.85rem;
  }
`;

const StatsGrid = styled.div`
  margin-bottom: ${theme.spacing.xl};
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: ${theme.spacing.lg};
  justify-content: center;
  max-width: 1200px;
  margin-left: auto;
  margin-right: auto;
  
  @media screen and (max-width: ${breakpoints.mobile}) {
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    margin-bottom: 24px;
  }
`;

const StatCard = styled(Box)`
  background: ${props => props.theme.colors.neutral0};
  border-radius: ${theme.borderRadius.lg};
  padding: 28px ${theme.spacing.lg};
  position: relative;
  overflow: hidden;
  transition: all ${theme.transitions.normal};
  ${css`animation: ${fadeIn} ${theme.transitions.slow} backwards;`}
  animation-delay: ${props => props.$delay || '0s'};
  box-shadow: ${theme.shadows.sm};
  border: 1px solid ${props => props.theme.colors.neutral200};
  min-width: 200px;
  flex: 1;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  
  @media screen and (max-width: ${breakpoints.mobile}) {
    min-width: unset;
    padding: 20px 12px;
    
    &:hover {
      transform: none;
    }
  }
  
  &:hover {
    transform: translateY(-6px);
    box-shadow: ${theme.shadows.xl};
    border-color: ${props => props.$color || props.theme.colors.primary600};
    
    .stat-icon {
      transform: scale(1.15) rotate(5deg);
    }
    
    .stat-value {
      transform: scale(1.08);
      color: ${props => props.$color || props.theme.colors.primary600};
    }
  }
`;

const StatIcon = styled(Box)`
  width: 68px;
  height: 68px;
  border-radius: ${theme.borderRadius.lg};
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${props => props.$bg || props.theme.colors.primary100};
  transition: all ${theme.transitions.normal};
  margin: 0 auto 20px;
  box-shadow: ${theme.shadows.sm};
  
  svg {
    width: 34px;
    height: 34px;
    color: ${props => props.$color || props.theme.colors.primary600};
  }
  
  @media screen and (max-width: ${breakpoints.mobile}) {
    width: 48px;
    height: 48px;
    margin-bottom: 12px;
    
    svg {
      width: 24px;
      height: 24px;
    }
  }
`;

const StatValue = styled(Typography)`
  font-size: 2.75rem;
  font-weight: 700;
  color: ${props => props.theme.colors.neutral800};
  line-height: 1;
  margin-bottom: 10px;
  transition: all ${theme.transitions.normal};
  text-align: center;
  
  @media screen and (max-width: ${breakpoints.mobile}) {
    font-size: 2rem;
    margin-bottom: 6px;
  }
`;

const StatLabel = styled(Typography)`
  font-size: 0.95rem;
  color: ${props => props.theme.colors.neutral600};
  font-weight: 500;
  letter-spacing: 0.025em;
  text-align: center;
  
  @media screen and (max-width: ${breakpoints.mobile}) {
    font-size: 0.8rem;
  }
`;

const DataTable = styled(Box)`
  background: ${props => props.theme.colors.neutral0};
  border-radius: ${theme.borderRadius.lg};
  overflow: hidden;
  box-shadow: ${theme.shadows.sm};
  border: 1px solid ${props => props.theme.colors.neutral200};
  margin-bottom: ${theme.spacing.xl};
`;

const StyledTable = styled(Table)`
  thead {
    background: ${props => props.theme.colors.neutral100};
    border-bottom: 2px solid ${props => props.theme.colors.neutral200};
    
    th {
      font-weight: 600;
      color: ${props => props.theme.colors.neutral800};
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.025em;
      padding: ${theme.spacing.lg} ${theme.spacing.lg};
    }
  }
  
  tbody tr {
    transition: all ${theme.transitions.fast};
    border-bottom: 1px solid ${props => props.theme.colors.neutral150};
    
    &:last-child {
      border-bottom: none;
    }
    
    &:hover {
      background: ${props => props.theme.colors.primary100};
      
      .action-buttons {
        opacity: 1;
      }
    }
    
    td {
      padding: ${theme.spacing.lg} ${theme.spacing.lg};
      color: ${props => props.theme.colors.neutral800};
      vertical-align: middle;
    }
  }
`;

const OnlineIndicator = styled.div`
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: ${props => props.$online ? theme.colors.success[500] : props.theme.colors.neutral400};
  display: inline-block;
  margin-right: 8px;
  ${css`animation: ${props => props.$online ? pulse : 'none'} 2s ease-in-out infinite;`}
`;

const FilterBar = styled(Flex)`
  background: ${props => props.theme.colors.neutral0};
  padding: ${theme.spacing.md} ${theme.spacing.lg};
  border-radius: ${theme.borderRadius.lg};
  margin-bottom: ${theme.spacing.lg};
  box-shadow: ${theme.shadows.sm};
  border: 1px solid ${props => props.theme.colors.neutral200};
  gap: ${theme.spacing.md};
  align-items: center;
`;

const SearchInputWrapper = styled.div`
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
`;

const SearchIcon = styled(Search)`
  position: absolute;
  left: 12px;
  width: 16px;
  height: 16px;
  color: ${props => props.theme.colors.neutral600};
  pointer-events: none;
`;

const StyledSearchInput = styled.input`
  width: 100%;
  padding: ${theme.spacing.sm} ${theme.spacing.sm} ${theme.spacing.sm} 36px;
  border: 1px solid ${props => props.theme.colors.neutral200};
  border-radius: ${theme.borderRadius.md};
  font-size: 0.875rem;
  transition: all ${theme.transitions.fast};
  background: ${props => props.theme.colors.neutral0};
  color: ${props => props.theme.colors.neutral800};
  
  &:focus {
    outline: none;
    border-color: ${props => props.theme.colors.primary600};
    box-shadow: 0 0 0 3px ${props => props.theme.colors.primary100};
  }
  
  &::placeholder {
    color: ${props => props.theme.colors.neutral500};
  }
`;

const ActionButtons = styled(Flex)`
  opacity: 0.7;
  transition: all ${theme.transitions.fast};
  gap: ${theme.spacing.xs};
  justify-content: flex-end;
`;

const ClickableRow = styled(Tr)`
  cursor: pointer;
  
  &:hover {
    background: ${props => props.theme.colors.primary100} !important;
  }
`;

// Empty state background that works in dark mode
const EmptyStateBox = styled(Box)`
  background: ${props => props.theme.colors.neutral0};
  border-radius: ${theme.borderRadius.xl};
  border: 2px dashed ${props => props.theme.colors.neutral300};
  padding: 80px 32px;
  text-align: center;
  position: relative;
  overflow: hidden;
  min-height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const EmptyStateGradient = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, ${theme.colors.primary[50]} 0%, ${theme.colors.secondary[50]} 100%);
  opacity: 0.3;
  z-index: 0;
`;

const HomePage = () => {
  const { formatMessage } = useIntl();
  const { get, post, del } = useFetchClient();
  const { toggleNotification } = useNotification();
  const { isPremium } = useLicense();
  const t = (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('active'); // Default: Active Only
  const [entriesPerPage, setEntriesPerPage] = useState('25');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSession, setSelectedSession] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

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

    const fetchSessions = async () => {
    setLoading(true);
      try {
      const { data } = await get(`/${pluginId}/sessions`);
        setSessions(data.data || []);
      } catch (err) {
      console.error('[SessionManager] Error fetching sessions:', err);
      } finally {
        setLoading(false);
      }
    };

  const handleTerminateSession = async (sessionId) => {
    if (!confirm(t('homepage.confirm.terminate', 'Are you sure you want to terminate this session?\n\nThis will set isActive to false (user will be logged out).'))) {
      return;
    }

    try {
      await post(`/${pluginId}/sessions/${sessionId}/terminate`);
      fetchSessions();
    } catch (err) {
      console.error('[SessionManager] Error terminating session:', err);
    }
  };

  const handleDeleteSession = async (sessionId) => {
    if (!confirm(t('homepage.confirm.delete', '[WARNING] This will PERMANENTLY delete this session from the database!\n\nThis action cannot be undone.\n\nAre you sure?'))) {
      return;
    }

    try {
      await del(`/${pluginId}/sessions/${sessionId}`);
      fetchSessions();
      toggleNotification({
        type: 'success',
        message: t('notifications.success.deleted', 'Session permanently deleted'),
      });
    } catch (err) {
      console.error('[SessionManager] Error deleting session:', err);
      toggleNotification({
        type: 'danger',
        message: t('notifications.error.delete', 'Failed to delete session'),
      });
    }
  };

  const handleExportCSV = () => {
    if (!isPremium) {
      toggleNotification({
        type: 'warning',
        message: t('notifications.warning.premiumRequired', 'Premium license required for export functionality'),
      });
      return;
    }

    try {
      // CSV Header
      const headers = ['ID', 'Status', 'User Email', 'Username', 'Device', 'Browser', 'OS', 'IP Address', 'Login Time', 'Last Active', 'Logout Time', 'Minutes Idle'];
      
      // CSV Rows
      const rows = filteredSessions.map(session => {
        const deviceInfo = parseUserAgent(session.userAgent);
        const status = getSessionStatus(session);
        
        return [
          session.id,
          status,
          session.user?.email || '',
          session.user?.username || '',
          deviceInfo.device,
          deviceInfo.browser,
          deviceInfo.os,
          session.ipAddress,
          new Date(session.loginTime).toISOString(),
          new Date(session.lastActive || session.loginTime).toISOString(),
          session.logoutTime ? new Date(session.logoutTime).toISOString() : '',
          session.minutesSinceActive,
        ];
      });
      
      // Create CSV content
      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n');
      
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
      console.error('[SessionManager] Export error:', err);
      toggleNotification({
        type: 'danger',
        message: t('notifications.error.export', 'Failed to export sessions'),
      });
    }
  };

  const handleExportJSON = () => {
    if (!isPremium) {
      toggleNotification({
        type: 'warning',
        message: t('notifications.warning.premiumRequired', 'Premium license required for export functionality'),
      });
      return;
    }

    try {
      const exportData = {
        exportedAt: new Date().toISOString(),
        filter: filterStatus,
        totalSessions: sessions.length,
        exportedSessions: filteredSessions.length,
        sessions: filteredSessions.map(session => {
          const deviceInfo = parseUserAgent(session.userAgent);
          return {
            id: session.id,
            status: getSessionStatus(session),
            user: {
              id: session.user?.id,
              email: session.user?.email,
              username: session.user?.username,
            },
            device: {
              type: deviceInfo.device,
              browser: deviceInfo.browser,
              browserVersion: deviceInfo.browserVersion,
              os: deviceInfo.os,
            },
            ipAddress: session.ipAddress,
            loginTime: session.loginTime,
            lastActive: session.lastActive,
            logoutTime: session.logoutTime,
            minutesSinceActive: session.minutesSinceActive,
            isActive: session.isActive,
            isTrulyActive: session.isTrulyActive,
          };
        }),
      };
      
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `sessions-export-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      
      toggleNotification({
        type: 'success',
        message: t('notifications.success.exported', 'Exported {count} sessions to {format}', { count: filteredSessions.length, format: 'JSON' }),
      });
    } catch (err) {
      console.error('[SessionManager] Export error:', err);
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
  const idleSessions = sessions.filter(s => s.isActive && !s.isTrulyActive);
  const loggedOutSessions = sessions.filter(s => !s.isActive && s.logoutTime);
  const terminatedSessions = sessions.filter(s => !s.isActive && !s.logoutTime);

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

  // Helper function to get session status
  const getSessionStatus = (session) => {
    if (!session.isActive) {
      return session.logoutTime ? 'loggedout' : 'terminated';
    }
    return session.isTrulyActive ? 'active' : 'idle';
  };

  // Filter sessions
  const filteredSessions = sessions
    .filter(session => {
      // Filter by status
      const sessionStatus = getSessionStatus(session);
      if (filterStatus === 'active' && sessionStatus !== 'active') return false;
      if (filterStatus === 'idle' && sessionStatus !== 'idle') return false;
      if (filterStatus === 'loggedout' && sessionStatus !== 'loggedout') return false;
      if (filterStatus === 'terminated' && sessionStatus !== 'terminated') return false;
      
      // Filter by search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesUser = session.user?.email?.toLowerCase().includes(query) ||
                           session.user?.username?.toLowerCase().includes(query);
        const matchesIp = session.ipAddress?.toLowerCase().includes(query);
        const deviceInfo = parseUserAgent(session.userAgent);
        const matchesDevice = deviceInfo.device?.toLowerCase().includes(query) ||
                             deviceInfo.browser?.toLowerCase().includes(query) ||
                             deviceInfo.os?.toLowerCase().includes(query);
        
        return matchesUser || matchesIp || matchesDevice;
  }
      
      return true;
    })
    .slice(0, parseInt(entriesPerPage));

  return (
    <Container padding={8}>
      {/* Gradient Header */}
      <Header>
        <HeaderContent justifyContent="space-between" alignItems="center">
          <Flex direction="column" alignItems="flex-start" gap={2}>
            <Title>
              <Monitor /> {t('homepage.title', 'Session Manager')}
            </Title>
            <Subtitle>
              {t('homepage.subtitle', 'Monitor and manage user sessions in real-time')}
            </Subtitle>
          </Flex>
      
          {isPremium && filteredSessions.length > 0 && (
            <Flex gap={2}>
              <Button
                onClick={handleExportCSV}
                startIcon={<Download />}
                size="M"
                variant="secondary"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.2)',
                  color: 'white',
                  border: '1px solid rgba(255,255,255,0.3)',
                  fontWeight: '600',
                }}
              >
                {t('homepage.export.csv', 'Export CSV')}
              </Button>
              <Button
                onClick={handleExportJSON}
                startIcon={<Download />}
                size="M"
                variant="secondary"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.2)',
                  color: 'white',
                  border: '1px solid rgba(255,255,255,0.3)',
                  fontWeight: '600',
                }}
              >
                {t('homepage.export.json', 'Export JSON')}
              </Button>
            </Flex>
          )}
        </HeaderContent>
      </Header>
      
      {/* Stats Cards */}
      <StatsGrid>
        <StatCard $delay="0.1s" $color={theme.colors.success[500]}>
          <StatIcon className="stat-icon" $bg={theme.colors.success[100]} $color={theme.colors.success[600]}>
            <Check />
          </StatIcon>
          <StatValue className="stat-value">{activeSessions.length}</StatValue>
          <StatLabel>{t('homepage.stats.active', 'Active')}</StatLabel>
        </StatCard>

        <StatCard $delay="0.2s" $color={theme.colors.warning[500]}>
          <StatIcon className="stat-icon" $bg={theme.colors.warning[100]} $color={theme.colors.warning[600]}>
            <Clock />
          </StatIcon>
          <StatValue className="stat-value">{idleSessions.length}</StatValue>
          <StatLabel>{t('homepage.stats.idle', 'Idle')}</StatLabel>
        </StatCard>

        <StatCard $delay="0.3s" $color={theme.colors.danger[500]}>
          <StatIcon className="stat-icon" $bg={theme.colors.danger[100]} $color={theme.colors.danger[600]}>
            <Cross />
          </StatIcon>
          <StatValue className="stat-value">{loggedOutSessions.length}</StatValue>
          <StatLabel>{t('homepage.stats.loggedOut', 'Logged Out')}</StatLabel>
        </StatCard>

        <StatCard $delay="0.4s" $color="#4B5563">
          <StatIcon className="stat-icon" $bg="#F3F4F6" $color="#4B5563">
            <Cross />
          </StatIcon>
          <StatValue className="stat-value">{terminatedSessions.length}</StatValue>
          <StatLabel>{t('homepage.stats.terminated', 'Terminated')}</StatLabel>
        </StatCard>

        <StatCard $delay="0.5s" $color="#A855F7">
          <StatIcon className="stat-icon" $bg="#EDE9FE" $color="#9333EA">
            <User />
          </StatIcon>
          <StatValue className="stat-value">{sessions.length}</StatValue>
          <StatLabel>{t('homepage.stats.total', 'Total')}</StatLabel>
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
            {/* Search Input */}
            <SearchInputWrapper>
              <SearchIcon />
              <StyledSearchInput
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('homepage.search.placeholder', 'Search by user, IP address, or device...')}
                type="text"
              />
            </SearchInputWrapper>
            
            {/* Status Filter */}
            <Box style={{ minWidth: '180px' }}>
              <SingleSelect
                value={filterStatus}
                onChange={setFilterStatus}
                placeholder="Filter"
                size="S"
              >
                <SingleSelectOption value="all">{t('homepage.filter.all', 'All Sessions')}</SingleSelectOption>
                <SingleSelectOption value="active">{t('homepage.filter.active', 'Active (less than 15 min)')}</SingleSelectOption>
                <SingleSelectOption value="idle">{t('homepage.filter.idle', 'Idle (more than 15 min)')}</SingleSelectOption>
                <SingleSelectOption value="loggedout">{t('homepage.filter.loggedout', 'Logged Out')}</SingleSelectOption>
                <SingleSelectOption value="terminated">{t('homepage.filter.terminated', 'Terminated')}</SingleSelectOption>
              </SingleSelect>
            </Box>
            
            {/* Entries per page */}
            <Box style={{ minWidth: '130px' }}>
              <SingleSelect
                value={entriesPerPage}
                onChange={setEntriesPerPage}
                placeholder="Entries"
                size="S"
              >
                <SingleSelectOption value="10">{t('homepage.entries.10', '10 entries')}</SingleSelectOption>
                <SingleSelectOption value="25">{t('homepage.entries.25', '25 entries')}</SingleSelectOption>
                <SingleSelectOption value="50">{t('homepage.entries.50', '50 entries')}</SingleSelectOption>
                <SingleSelectOption value="100">{t('homepage.entries.100', '100 entries')}</SingleSelectOption>
              </SingleSelect>
            </Box>
          </FilterBar>
          
          {/* Results count */}
          <Box style={{ marginBottom: theme.spacing.md }}>
            <Typography variant="pi" textColor="neutral600">
              {searchQuery 
                ? t('homepage.showingFiltered', 'Showing {count} of {total} sessions (filtered by "{query}")', { count: filteredSessions.length, total: sessions.length, query: searchQuery })
                : t('homepage.showing', 'Showing {count} of {total} sessions', { count: filteredSessions.length, total: sessions.length })
              }
            </Typography>
          </Box>
          
          {/* Table or No Results */}
          {filteredSessions.length > 0 ? (
          <DataTable>
            <StyledTable>
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
                {filteredSessions.map((session) => {
                  const deviceInfo = parseUserAgent(session.userAgent);
                  const DeviceIcon = getDeviceIcon(deviceInfo.device);
                  const sessionStatus = getSessionStatus(session);
                  
                  // Status colors and labels
                  const statusConfig = {
                    active: { 
                      bg: theme.colors.success[50], 
                      badgeColor: 'success600', 
                      label: t('homepage.status.active', 'Active'),
                      indicator: true 
                    },
                    idle: { 
                      bg: theme.colors.warning[50], 
                      badgeColor: 'warning600', 
                      label: t('homepage.status.idle', 'Idle'),
                      indicator: false 
                    },
                    loggedout: { 
                      bg: theme.colors.danger[50], 
                      badgeColor: 'danger600', 
                      label: t('homepage.status.loggedOut', 'Logged Out'),
                      indicator: false,
                      opacity: 0.7 
                    },
                    terminated: { 
                      bg: '#F3F4F6', 
                      badgeColor: 'neutral600', 
                      label: t('homepage.status.terminated', 'Terminated'),
                      indicator: false,
                      opacity: 0.6 
                    },
                  };
                  
                  const config = statusConfig[sessionStatus];
                  
                  return (
                    <ClickableRow 
                      key={session.id} 
                      onClick={() => handleSessionClick(session)}
                      style={{ 
                        background: config.bg,
                        opacity: config.opacity || 1,
                      }}
                    >
                      {/* Status */}
                      <Td>
                        <Flex alignItems="center" gap={2}>
                          <OnlineIndicator $online={config.indicator} />
                          <Badge 
                            backgroundColor={config.badgeColor}
                            textColor="neutral0"
                            size="S"
                          >
                            {config.label}
                          </Badge>
                        </Flex>
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
                          <DeviceIcon width="18px" height="18px" />
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
                          {session.ipAddress}
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
                            variant="secondary"
                            size="S"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSessionClick(session);
                            }}
                            title={t('homepage.actions.viewDetails', 'View Details')}
                          >
                            <Eye />
                          </Button>
                          <Button
                            variant="danger-light"
                            size="S"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTerminateSession(session.id);
                            }}
                            disabled={sessionStatus !== 'active' && sessionStatus !== 'idle'}
                            title={session.isActive ? t('homepage.actions.terminate', 'Terminate (Logout)') : t('homepage.actions.alreadyInactive', 'Already inactive')}
                          >
                            <Cross />
                          </Button>
                          <Button
                            variant="danger"
                            size="S"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSession(session.id);
                            }}
                            title={t('homepage.actions.deletePermanently', 'Delete Permanently')}
                          >
                            <Trash />
                          </Button>
                        </ActionButtons>
                      </Td>
                    </ClickableRow>
                  );
                })}
              </Tbody>
            </StyledTable>
          </DataTable>
          ) : (
            /* No results found */
        <Box
          background="neutral0"
          style={{
            borderRadius: theme.borderRadius.xl,
            border: '2px dashed #E5E7EB',
            padding: '60px 32px',
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
            minHeight: '300px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Background Gradient */}
          <Box
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: `linear-gradient(135deg, ${theme.colors.primary[50]} 0%, ${theme.colors.secondary[50]} 100%)`,
              opacity: 0.3,
              zIndex: 0,
            }}
          />
          
          {/* Floating Emoji */}
          <FloatingEmoji>
            🔍
          </FloatingEmoji>
          
          {/* Content */}
          <Flex direction="column" alignItems="center" gap={4} style={{ position: 'relative', zIndex: 1 }}>
            {/* Icon Circle */}
            <Box
              style={{
                width: '100px',
                height: '100px',
                borderRadius: '50%',
                background: `linear-gradient(135deg, ${theme.colors.primary[100]} 0%, ${theme.colors.secondary[100]} 100%)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: theme.shadows.xl,
              }}
            >
              <Search style={{ width: '50px', height: '50px', color: '#0284C7' }} />
            </Box>
            
            <Typography 
              variant="alpha" 
              textColor="neutral800"
              style={{ 
                fontSize: '1.5rem',
                fontWeight: '700',
                marginBottom: '4px',
              }}
            >
              {t('homepage.noResults.title', 'No sessions found')}
            </Typography>
            
            <Typography 
              variant="omega" 
              textColor="neutral600"
              style={{
                fontSize: '1rem',
                maxWidth: '400px',
                lineHeight: '1.6',
              }}
            >
              {t('homepage.noResults.description', 'Try adjusting your search query or filters to find sessions')}
            </Typography>
          </Flex>
        </Box>
          )}
        </Box>
      )}

      {/* Empty State */}
      {!loading && sessions.length === 0 && (
        <Box
          background="neutral0"
          style={{
            borderRadius: theme.borderRadius.xl,
            border: '2px dashed #E5E7EB',
            padding: '80px 32px',
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
            minHeight: '400px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Background Gradient */}
          <Box
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: `linear-gradient(135deg, ${theme.colors.primary[50]} 0%, ${theme.colors.secondary[50]} 100%)`,
              opacity: 0.3,
              zIndex: 0,
            }}
          />
          
          {/* Floating Icon (removed emoji) */}
          
          <Flex direction="column" alignItems="center" gap={6} style={{ position: 'relative', zIndex: 1 }}>
            <Box
              style={{
                width: '120px',
                height: '120px',
                borderRadius: '50%',
                background: `linear-gradient(135deg, ${theme.colors.primary[100]} 0%, ${theme.colors.secondary[100]} 100%)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: theme.shadows.xl,
              }}
            >
              <Monitor style={{ width: '60px', height: '60px', color: '#0284C7' }} />
            </Box>
            
            <Typography 
              variant="alpha" 
              textColor="neutral800"
              style={{ 
                fontSize: '1.75rem',
                fontWeight: '700',
                marginBottom: '8px',
              }}
            >
              {t('homepage.empty.title', 'No sessions yet')}
            </Typography>
            
            <Typography 
              variant="omega" 
              textColor="neutral600"
              style={{
                fontSize: '1rem',
                maxWidth: '500px',
                lineHeight: '1.6',
              }}
            >
              {t('homepage.empty.description', 'Sessions will appear here when users log in to your application')}
            </Typography>
          </Flex>
        </Box>
      )}

      {/* Session Detail Modal */}
      {showDetailModal && selectedSession && (
        <SessionDetailModal
          session={selectedSession}
          onClose={handleModalClose}
          onSessionTerminated={handleSessionTerminated}
        />
      )}
    </Container>
  );
};

export default HomePage;
