import { useState, useEffect } from 'react';
import styled from 'styled-components';
import {
  Modal,
  Box,
  Flex,
  Typography,
  Button,
  Badge,
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
  Crown,
  Earth,
  Shield,
} from '@strapi/icons';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import parseUserAgent from '../utils/parseUserAgent';
import pluginId from '../pluginId';
import { useLicense } from '../hooks/useLicense';

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
  color: #374151;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 2px solid #e5e7eb;
  display: block;
`;

const Section = styled(Box)`
  margin-bottom: 24px;
`;

const SessionDetailModal = ({ session, onClose, onSessionTerminated }) => {
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const { isPremium, loading: licenseLoading } = useLicense();
  const [terminating, setTerminating] = useState(false);
  const [showUserAgent, setShowUserAgent] = useState(false);
  const [geoData, setGeoData] = useState(null);
  const [geoLoading, setGeoLoading] = useState(false);

  if (!session) return null;

  const deviceInfo = parseUserAgent(session.userAgent);
  const isOnline = session.isTrulyActive;

  // Fetch real geolocation data if premium
  useEffect(() => {
    if (isPremium && session.ipAddress && !geoData) {
      fetchGeolocationData();
    }
  }, [isPremium, session.ipAddress]);

  const fetchGeolocationData = async () => {
    setGeoLoading(true);
    try {
      const { data } = await get(`/${pluginId}/geolocation/${session.ipAddress}`);
      setGeoData(data.data);
    } catch (err) {
      console.error('[SessionDetailModal] Error fetching geolocation:', err);
      // Fallback to mock data if API fails
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
    } finally {
      setGeoLoading(false);
    }
  };
  
  // Use real data if available, otherwise fallback
  const premiumData = geoData || {
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
    if (!confirm('Are you sure you want to terminate this session?')) {
      return;
    }

    setTerminating(true);
    try {
      await post(`/${pluginId}/sessions/${session.id}/terminate`);
      
      toggleNotification({
        type: 'success',
        message: 'Session terminated successfully',
      });
      
      onSessionTerminated();
      onClose();
    } catch (err) {
      console.error('[SessionDetailModal] Error:', err);
      toggleNotification({
        type: 'danger',
        message: 'Failed to terminate session',
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
          background: '#f3f4f6',
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
              background: isOnline ? '#dcfce7' : '#f3f4f6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <DeviceIcon width="24px" height="24px" />
            </Box>
            <Flex direction="column" alignItems="flex-start">
              <Typography variant="beta" fontWeight="bold">
                Session Details
              </Typography>
              <Typography variant="pi" textColor="neutral600">
                ID: {session.id}
              </Typography>
            </Flex>
          </Flex>
        </Modal.Header>

        <Modal.Body>
          <Box padding={6}>
            {/* Status Badge */}
            <Flex justifyContent="center" style={{ marginBottom: '24px' }}>
              <Badge 
                backgroundColor={isOnline ? 'success600' : 'neutral600'}
                textColor="neutral0"
                size="M"
                style={{ fontSize: '14px', padding: '8px 20px', fontWeight: '600' }}
              >
                {isOnline ? 'ONLINE' : 'OFFLINE'}
              </Badge>
            </Flex>

            <Divider style={{ marginBottom: '24px' }} />

            {/* Two Column Layout */}
            <TwoColumnGrid>
              {/* Left Column: User & Device */}
              <Box>
                {/* User Information */}
                <Section>
                  <SectionTitle>
                    User
                  </SectionTitle>
                  
                  <DetailRow compact icon={Check} label="Username" value={session.user?.username || 'N/A'} />
                  <DetailRow compact icon={Information} label="Email" value={session.user?.email || 'N/A'} />
                  <DetailRow compact icon={Information} label="User ID" value={session.user?.id || 'N/A'} />
                </Section>

                {/* Device Information */}
                <Section>
                  <SectionTitle>
                    Device
                  </SectionTitle>
                  
                  <DetailRow compact icon={DeviceIcon} label="Device" value={deviceInfo.device} />
                  <DetailRow compact icon={Monitor} label="Browser" value={`${deviceInfo.browser} ${deviceInfo.browserVersion || ''}`} />
                  <DetailRow compact icon={Server} label="OS" value={deviceInfo.os} />
                  <DetailRow compact icon={Information} label="IP" value={session.ipAddress} />
                </Section>
              </Box>

              {/* Right Column: Timeline */}
              <Box>
                <Section>
                  <SectionTitle>
                    Timeline
                  </SectionTitle>
                
                <DetailRow 
                  compact 
                  icon={Clock} 
                  label="Login" 
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
                  label="Last Active" 
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
                  label="Idle Time" 
                  value={`${session.minutesSinceActive} min`} 
                />
                {session.logoutTime && (
                  <DetailRow 
                    compact 
                    icon={Cross} 
                    label="Logout" 
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

            {/* PREMIUM: Geolocation & Security Information */}
            {isPremium ? (
              <Section>
                <SectionTitle>
                  Location and Security
                </SectionTitle>
                
                {geoLoading ? (
                  <Box padding={4} style={{ textAlign: 'center' }}>
                    <Typography variant="pi" textColor="neutral600">
                      Loading location data...
                    </Typography>
                  </Box>
                ) : (
                  <TwoColumnGrid>
                    <Box>
                      <DetailRow 
                        compact 
                        icon={Earth} 
                        label="Country" 
                        value={`${premiumData.country_flag || ''} ${premiumData.country}`.trim()} 
                      />
                      <DetailRow compact icon={Earth} label="City" value={premiumData.city} />
                      <DetailRow compact icon={Clock} label="Timezone" value={premiumData.timezone} />
                    </Box>
                    <Box>
                      <DetailRow 
                        compact 
                        icon={Shield} 
                        label="Security" 
                        value={`${premiumData.securityScore}/100 (${premiumData.riskLevel})`} 
                      />
                      <DetailRow 
                        compact 
                        icon={Shield} 
                        label="VPN" 
                        value={premiumData.isVpn ? '[WARNING] Yes' : 'No'} 
                      />
                      <DetailRow 
                        compact 
                        icon={Shield} 
                        label="Proxy" 
                        value={premiumData.isProxy ? '[WARNING] Yes' : 'No'} 
                      />
                    </Box>
                  </TwoColumnGrid>
                )}
              </Section>
            ) : (
              <Section>
                <Box
                  padding={5}
                  style={{
                    background: 'linear-gradient(135deg, #fef3c7 0%, #fed7aa 100%)',
                    borderRadius: '12px',
                    border: '2px solid #fbbf24',
                    textAlign: 'center',
                  }}
                >
                  <Flex direction="column" alignItems="center" gap={3}>
                    <Crown style={{ width: '40px', height: '40px', color: '#d97706' }} />
                    <Typography variant="beta" style={{ color: '#92400e', fontWeight: '700' }}>
                      Location and Security Analysis
                    </Typography>
                    <Typography variant="omega" style={{ color: '#78350f', fontSize: '14px', lineHeight: '1.6' }}>
                      Unlock premium features to get IP geolocation, security scoring, and VPN/Proxy detection for every session
                    </Typography>
                    <Button
                      variant="secondary"
                      size="M"
                      onClick={() => window.open('https://magicapi.fitlex.me', '_blank')}
                      style={{
                        background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                        color: 'white',
                        border: 'none',
                        fontWeight: '600',
                        marginTop: '8px',
                        boxShadow: '0 4px 12px rgba(245, 158, 11, 0.3)',
                      }}
                    >
                      Upgrade to Premium
                    </Button>
                  </Flex>
                </Box>
              </Section>
            )}

            {/* User Agent - Collapsible */}
            <Section>
              <Flex justifyContent="space-between" alignItems="center" style={{ marginBottom: '12px' }}>
                <SectionTitle style={{ marginBottom: 0, paddingBottom: 0, border: 'none' }}>
                  Technical Details
                </SectionTitle>
                <Button
                  variant="tertiary"
                  size="S"
                  onClick={() => setShowUserAgent(!showUserAgent)}
                  style={{ fontSize: '12px' }}
                >
                  {showUserAgent ? '▲ Hide Details' : '▼ Show Details'}
                </Button>
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
            <Button onClick={onClose} variant="tertiary">
              Close
            </Button>
            <Button 
              onClick={handleTerminate}
              variant="danger"
              disabled={!session.isActive || terminating}
              loading={terminating}
              startIcon={<Cross />}
            >
              Terminate Session
            </Button>
          </Flex>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default SessionDetailModal;

