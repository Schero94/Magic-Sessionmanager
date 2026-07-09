import { useState, useEffect } from 'react';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import {
  Modal,
  Box,
  Flex,
  Typography,
  Divider,
} from '@strapi/design-system';
import {
  Monitor,
  Phone,
  Server,
  Cross,
  Check,
  Clock,
  Information,
  Earth,
  Shield,
} from '@strapi/icons';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import parseUserAgent from '../utils/parseUserAgent';
import pluginId from '../pluginId';
import { getTranslation } from '../utils/getTranslation';
import {
  TertiaryButton,
  DangerButton,
  ShowHideButton,
} from './StyledButtons';

const TwoColumnGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;

  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`;

const SectionTitle = styled(Typography)`
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-size: 11px;
  font-weight: 700;
  color: var(--colors-neutral800);
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 2px solid rgba(128, 128, 128, 0.2);
  display: block;
`;

const Section = styled(Box)`
  margin-bottom: 24px;
`;

// Status Badge - pill-shaped with gradient
const ModalStatusBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 24px;
  border-radius: 24px;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;

  ${props => props.$online && `
    background: linear-gradient(135deg, rgba(22, 163, 74, 0.12) 0%, rgba(34, 197, 94, 0.3) 100%);
    color: var(--colors-success600, #166534);
    border: 2px solid rgba(34, 197, 94, 0.3);
    box-shadow: 0 4px 12px rgba(34, 197, 94, 0.2);
  `}

  ${props => !props.$online && `
    background: linear-gradient(135deg, rgba(128, 128, 128, 0.08) 0%, rgba(128, 128, 128, 0.2) 100%);
    color: var(--colors-neutral600);
    border: 2px solid rgba(128, 128, 128, 0.2);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  `}
`;

const StatusDot = styled.span`
  width: 10px;
  height: 10px;
  border-radius: 50%;

  ${props => props.$online && `
    background: var(--colors-success600, #22C55E);
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.6);
    animation: pulse-green 2s ease-in-out infinite;
  `}

  ${props => !props.$online && `
    background: var(--colors-neutral500);
  `}

	  @keyframes pulse-green {
	    0%, 100% { opacity: 1; transform: scale(1); }
	    50% { opacity: 0.7; transform: scale(1.15); }
	  }
	`;

const getStoredGeoData = (session) => {
  let geoLocation = session?.geoLocation;
  if (typeof geoLocation === 'string') {
    try {
      geoLocation = JSON.parse(geoLocation);
    } catch {
      geoLocation = null;
    }
  }

  if (!geoLocation || typeof geoLocation !== 'object') return null;
  if (!geoLocation.country && !geoLocation.country_code && !geoLocation.city) return null;

  return {
    country_flag: geoLocation.country_flag || '',
    country: geoLocation.country || geoLocation.country_code || 'Unknown',
    city: geoLocation.city || 'Unknown',
    timezone: geoLocation.timezone || 'Unknown',
    securityScore: typeof session.securityScore === 'number' ? session.securityScore : 100,
    riskLevel: typeof session.securityScore === 'number' && session.securityScore < 50 ? 'High' : 'Low',
    isVpn: false,
    isProxy: false,
  };
};

const SessionDetailModal = ({ session, onClose, onSessionTerminated }) => {
  const { formatMessage } = useIntl();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [terminating, setTerminating] = useState(false);
  const [showUserAgent, setShowUserAgent] = useState(false);
  const [geoData, setGeoData] = useState(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const t = (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values);

  useEffect(() => {
    let cancelled = false;
    const ipAddress = session?.ipAddress;
    const storedGeoData = getStoredGeoData(session);

    if (!ipAddress) {
      setGeoData(null);
      setGeoLoading(false);
      return () => {
        cancelled = true;
      };
    }

    if (storedGeoData) {
      setGeoData(storedGeoData);
      setGeoLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const fetchGeolocationData = async () => {
      setGeoData(null);
      setGeoLoading(true);
      try {
        const { data } = await get(`/${pluginId}/geolocation/${encodeURIComponent(ipAddress)}`);
        if (!cancelled) {
          setGeoData(data.data);
        }
      } catch (err) {
        console.error('[SessionDetailModal] Error fetching geolocation:', err);
        if (!cancelled) {
          setGeoData({
            country_flag: '',
            country: 'Unknown',
            city: 'Unknown',
            timezone: 'Unknown',
            securityScore: 50,
            riskLevel: 'Unknown',
            isVpn: false,
            isProxy: false,
          });
        }
      } finally {
        if (!cancelled) {
          setGeoLoading(false);
        }
      }
    };

    fetchGeolocationData();

    return () => {
      cancelled = true;
    };
  }, [get, session]);

  if (!session) return null;

  const deviceInfo = parseUserAgent(session.userAgent);
  const isOnline = session.isTrulyActive;

  // Use real data if available, otherwise fallback
  const securityData = geoData || {
    country_flag: '',
    country: 'Loading...',
    city: 'Loading...',
    timezone: 'Loading...',
    securityScore: 0,
    riskLevel: 'Unknown',
    isVpn: false,
    isProxy: false,
  };

  const getDeviceIcon = (deviceType) => {
    if (deviceType === 'Mobile' || deviceType === 'Tablet') return Phone;
    if (deviceType === 'Desktop' || deviceType === 'Laptop') return Monitor;
    return Server;
  };

  const DeviceIcon = getDeviceIcon(deviceInfo.device);

  const handleTerminate = async () => {
    if (!confirm(t('modal.confirm.terminate', 'Are you sure you want to terminate this session?'))) {
      return;
    }

    setTerminating(true);
    try {
      await post(`/${pluginId}/sessions/${session.id}/terminate`);

      toggleNotification({
        type: 'success',
        message: t('notifications.success.terminated', 'Session terminated successfully'),
      });

      onSessionTerminated();
      onClose();
    } catch (err) {
      console.error('[SessionDetailModal] Error:', err);
      toggleNotification({
        type: 'danger',
        message: t('notifications.error.terminate', 'Failed to terminate session'),
      });
    } finally {
      setTerminating(false);
    }
  };

  const DetailRow = ({ label, value, icon: Icon, compact }) => (
    <Flex gap={3} alignItems="flex-start" style={{ marginBottom: compact ? '12px' : '16px' }}>
      {Icon && (
        <Box style={{
          width: '36px',
          height: '36px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--colors-neutral100)',
          borderRadius: '8px',
          flexShrink: 0,
        }}>
          <Icon width="18px" height="18px" />
        </Box>
      )}
      <Flex direction="column" alignItems="flex-start" style={{ flex: 1, minWidth: 0 }}>
        <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', fontWeight: '600', marginBottom: '4px' }}>
          {label}
        </Typography>
        <Typography variant="omega" textColor="neutral800" style={{ fontSize: '14px', fontWeight: '500' }}>
          {value}
        </Typography>
      </Flex>
    </Flex>
  );

  return (
    <Modal.Root open onOpenChange={onClose}>
      <Modal.Content style={{ maxWidth: '900px' }}>
        <Modal.Header>
          <Flex gap={3} alignItems="center">
            <Box style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: isOnline ? 'rgba(22, 163, 74, 0.12)' : 'var(--colors-neutral100)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <DeviceIcon width="24px" height="24px" />
            </Box>
            <Flex direction="column" alignItems="flex-start">
              <Typography variant="beta" fontWeight="bold">
                {t('modal.title', 'Session Details')}
              </Typography>
              <Typography variant="pi" textColor="neutral600">
                {t('modal.id', 'ID: {id}', { id: session.id })}
              </Typography>
            </Flex>
          </Flex>
        </Modal.Header>

        <Modal.Body>
          <Box padding={6}>
            {/* Status Badge */}
            <Flex justifyContent="center" style={{ marginBottom: '24px' }}>
              <ModalStatusBadge $online={isOnline}>
                <StatusDot $online={isOnline} />
                {isOnline ? t('modal.status.online', 'ONLINE') : t('modal.status.offline', 'OFFLINE')}
              </ModalStatusBadge>
            </Flex>

            <Divider style={{ marginBottom: '24px' }} />

            {/* Two Column Layout */}
            <TwoColumnGrid>
              {/* Left Column: User & Device */}
              <Box>
                {/* User Information */}
                <Section>
                  <SectionTitle>
                    {t('modal.section.user', 'User')}
                  </SectionTitle>

                  <DetailRow compact icon={Check} label={t('modal.user.username', 'Username')} value={session.user?.username || t('modal.user.na', 'N/A')} />
                  <DetailRow compact icon={Information} label={t('modal.user.email', 'Email')} value={session.user?.email || t('modal.user.na', 'N/A')} />
                  <DetailRow compact icon={Information} label={t('modal.user.id', 'User ID')} value={session.user?.id || t('modal.user.na', 'N/A')} />
                </Section>

                {/* Device Information */}
                <Section>
                  <SectionTitle>
                    {t('modal.section.device', 'Device')}
                  </SectionTitle>

                  <DetailRow compact icon={DeviceIcon} label={t('modal.device.device', 'Device')} value={deviceInfo.device} />
                  <DetailRow compact icon={Monitor} label={t('modal.device.browser', 'Browser')} value={`${deviceInfo.browser} ${deviceInfo.browserVersion || ''}`} />
                  <DetailRow compact icon={Server} label={t('modal.device.os', 'OS')} value={deviceInfo.os} />
                  <DetailRow compact icon={Information} label={t('modal.device.ip', 'IP')} value={session.ipAddress} />
                </Section>
              </Box>

              {/* Right Column: Timeline */}
              <Box>
                <Section>
                  <SectionTitle>
                    {t('modal.section.timeline', 'Timeline')}
                  </SectionTitle>

                <DetailRow
                  compact
                  icon={Clock}
                  label={t('modal.timeline.login', 'Login')}
                  value={new Date(session.loginTime).toLocaleString('de-DE', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                />
                <DetailRow
                  compact
                  icon={Clock}
                  label={t('modal.timeline.lastActive', 'Last Active')}
                  value={new Date(session.lastActive || session.loginTime).toLocaleString('de-DE', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                />
                <DetailRow
                  compact
                  icon={Clock}
                  label={t('modal.timeline.idleTime', 'Idle Time')}
                  value={t('modal.timeline.minutes', '{minutes} min', { minutes: session.minutesSinceActive })}
                />
                {session.logoutTime && (
                  <DetailRow
                    compact
                    icon={Cross}
                    label={t('modal.timeline.logout', 'Logout')}
                    value={new Date(session.logoutTime).toLocaleString('de-DE', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  />
                )}
                </Section>
              </Box>
            </TwoColumnGrid>

            {/* Geolocation & Security Information */}
            <Section>
              <SectionTitle>
                {t('modal.section.security', 'Location and Security')}
              </SectionTitle>

              {geoLoading ? (
                <Box padding={4} style={{ textAlign: 'center' }}>
                  <Typography variant="pi" textColor="neutral600">
                    {t('modal.security.loading', 'Loading location data...')}
                  </Typography>
                </Box>
              ) : (
                <TwoColumnGrid>
                  <Box>
                    <DetailRow
                      compact
                      icon={Earth}
                      label={t('modal.security.country', 'Country')}
                      value={`${securityData.country_flag || ''} ${securityData.country}`.trim()}
                    />
                    <DetailRow compact icon={Earth} label={t('modal.security.city', 'City')} value={securityData.city} />
                    <DetailRow compact icon={Clock} label={t('modal.security.timezone', 'Timezone')} value={securityData.timezone} />
                  </Box>
                  <Box>
                    <DetailRow
                      compact
                      icon={Shield}
                      label={t('modal.security.score', 'Security')}
                      value={`${securityData.securityScore}/100 (${securityData.riskLevel})`}
                    />
                    <DetailRow
                      compact
                      icon={Shield}
                      label={t('modal.security.vpn', 'VPN')}
                      value={securityData.isVpn ? t('modal.security.vpnWarning', '[WARNING] Yes') : t('modal.security.no', 'No')}
                    />
                    <DetailRow
                      compact
                      icon={Shield}
                      label={t('modal.security.proxy', 'Proxy')}
                      value={securityData.isProxy ? t('modal.security.vpnWarning', '[WARNING] Yes') : t('modal.security.no', 'No')}
                    />
                  </Box>
                </TwoColumnGrid>
              )}
            </Section>

            {/* User Agent - Collapsible */}
            <Section>
              <Flex justifyContent="space-between" alignItems="center" style={{ marginBottom: '12px' }}>
                <SectionTitle style={{ marginBottom: 0, paddingBottom: 0, border: 'none' }}>
                  {t('modal.section.technical', 'Technical Details')}
                </SectionTitle>
                <ShowHideButton
                  size="S"
                  onClick={() => setShowUserAgent(!showUserAgent)}
                >
                  {showUserAgent ? t('modal.technical.hide', 'Hide Details') : t('modal.technical.show', 'Show Details')}
                </ShowHideButton>
              </Flex>

              {showUserAgent && (
                <Box
                  padding={3}
                  background="neutral100"
                  hasRadius
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '10px',
                    wordBreak: 'break-all',
                    maxHeight: '80px',
                    overflow: 'auto',
                    marginTop: '8px',
                    animation: 'fadeIn 0.3s ease-in-out',
                  }}
                >
                  <Typography variant="pi" textColor="neutral600" style={{ lineHeight: '1.6' }}>
                    {session.userAgent}
                  </Typography>
                </Box>
              )}
            </Section>
          </Box>
        </Modal.Body>

        <Modal.Footer>
          <Flex justifyContent="space-between" style={{ width: '100%' }}>
            <TertiaryButton onClick={onClose}>
              {t('modal.actions.close', 'Close')}
            </TertiaryButton>
            <DangerButton
              onClick={handleTerminate}
              disabled={!session.isActive || terminating}
              loading={terminating}
              startIcon={<Cross />}
            >
              {t('modal.actions.terminate', 'Terminate Session')}
            </DangerButton>
          </Flex>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default SessionDetailModal;
