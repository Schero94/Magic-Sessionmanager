import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Badge,
  Flex,
  Alert,
  Button,
  Loader,
  Accordion,
} from '@strapi/design-system';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import { 
  ArrowClockwise, 
  Key, 
  User, 
  Shield,
  Sparkle,
  ChartBubble,
  Duplicate,
  Download,
} from '@strapi/icons';
import styled, { keyframes } from 'styled-components';
import pluginId from '../pluginId';

// ================ THEME ================
const theme = {
  colors: {
    primary: { 600: '#0284C7', 100: '#E0F2FE', 50: '#F0F9FF' },
    success: { 600: '#16A34A', 50: '#DCFCE7' },
    warning: { 50: '#FEF3C7' },
    danger: { 50: '#FEE2E2' },
    neutral: { 0: '#FFFFFF', 100: '#F3F4F6', 200: '#E5E7EB', 600: '#4B5563', 800: '#1F2937' }
  },
  shadows: { sm: '0 1px 3px rgba(0,0,0,0.1)' },
  borderRadius: { lg: '12px' }
};

// ================ ANIMATIONS ================
const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
`;

const shimmer = keyframes`
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
`;

// ================ STYLED COMPONENTS ================
const Container = styled(Box)`
  animation: ${fadeIn} 0.5s;
  max-width: 1400px;
  margin: 0 auto;
`;

const StickySaveBar = styled(Box)`
  position: sticky;
  top: 0;
  z-index: 10;
  background: white;
  border-bottom: 1px solid ${theme.colors.neutral[200]};
  box-shadow: ${theme.shadows.sm};
`;

const LicenseKeyBanner = styled(Box)`
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: ${theme.borderRadius.lg};
  padding: 28px 32px;
  color: white;
  position: relative;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(102, 126, 234, 0.25);
  margin-bottom: 24px;
  
  &::after {
    content: '';
    position: absolute;
    top: -50%;
    right: -50%;
    width: 200%;
    height: 200%;
    background: linear-gradient(
      45deg,
      transparent,
      rgba(255, 255, 255, 0.08),
      transparent
    );
    animation: ${shimmer} 3s infinite;
    pointer-events: none;
    z-index: 0;
  }
  
  & > * {
    position: relative;
    z-index: 1;
  }
`;

const LoaderContainer = styled(Flex)`
  min-height: 400px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 16px;
`;

// ================ MAIN COMPONENT ================
const LicensePage = () => {
  const { get } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [loading, setLoading] = useState(true);
  const [licenseData, setLicenseData] = useState(null);
  const [error, setError] = useState(null);

  const fetchLicenseStatus = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await get(`/${pluginId}/license/status`);
      setLicenseData(response.data);
    } catch (err) {
      console.error('[magic-sessionmanager/License] Error fetching license:', err);
      setError('Failed to load license information');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLicenseKey = async () => {
    try {
      await navigator.clipboard.writeText(licenseData?.data?.licenseKey || '');
      toggleNotification({
        type: 'success',
        message: 'License key copied to clipboard!',
      });
    } catch (err) {
      toggleNotification({
        type: 'danger',
        message: 'Failed to copy license key',
      });
    }
  };

  const handleDownloadLicenseKey = () => {
    try {
      const data = licenseData?.data || {};
      const licenseKey = data.licenseKey || '';
      const email = data.email || 'N/A';
      const firstName = data.firstName || '';
      const lastName = data.lastName || '';
      const fullName = `${firstName} ${lastName}`.trim() || 'N/A';
      
      const content = `Magic Session Manager - License Key
═══════════════════════════════════════

License Key: ${licenseKey}

License Holder Information:
──────────────────────────────────────
Name:        ${fullName}
Email:       ${email}

License Status:
──────────────────────────────────────
Status:      ${data.isActive ? 'ACTIVE' : 'INACTIVE'}
Expires:     ${data.expiresAt ? new Date(data.expiresAt).toLocaleDateString() : 'Never'}

Features:
──────────────────────────────────────
Premium:     ${data.features?.premium ? 'Enabled' : 'Disabled'}
Advanced:    ${data.features?.advanced ? 'Enabled' : 'Disabled'}
Enterprise:  ${data.features?.enterprise ? 'Enabled' : 'Disabled'}

═══════════════════════════════════════
Generated:   ${new Date().toLocaleString()}
`;
      
      const blob = new Blob([content], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `session-manager-license-${licenseKey.substring(0, 8)}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toggleNotification({
        type: 'success',
        message: 'License key downloaded successfully!',
      });
    } catch (err) {
      toggleNotification({
        type: 'danger',
        message: 'Failed to download license key',
      });
    }
  };

  useEffect(() => {
    fetchLicenseStatus();
  }, []);

  if (loading) {
    return (
      <Container>
        <LoaderContainer>
          <Loader>Loading license information...</Loader>
        </LoaderContainer>
      </Container>
    );
  }

  if (error) {
    return (
      <Container>
        <Box padding={8}>
          <Alert variant="danger" title="Error" closeLabel="Close">
            {error}
          </Alert>
        </Box>
      </Container>
    );
  }

  const isValid = licenseData?.valid;
  const isDemo = licenseData?.demo;
  const data = licenseData?.data || {};

  return (
    <Container>
      {/* Sticky Header */}
      <StickySaveBar paddingTop={5} paddingBottom={5} paddingLeft={6} paddingRight={6}>
        <Flex justifyContent="space-between" alignItems="center">
          <Flex direction="column" gap={1}>
            <Typography variant="alpha" fontWeight="bold">
              License Management
            </Typography>
            <Typography variant="epsilon" textColor="neutral600">
              View your Session Manager plugin license
            </Typography>
          </Flex>
          <Button
            startIcon={<ArrowClockwise />}
            onClick={fetchLicenseStatus}
            size="L"
            style={{
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              fontWeight: '600',
              border: 'none',
            }}
          >
            Refresh Status
          </Button>
        </Flex>
      </StickySaveBar>

      {/* Content */}
      <Box paddingTop={6} paddingLeft={6} paddingRight={6} paddingBottom={10}>
        {/* Status Alert */}
        {isDemo ? (
          <Alert variant="warning" title="Demo Mode" closeLabel="Close">
            You're using the demo version. Create a license to unlock all features.
          </Alert>
        ) : isValid ? (
          <Alert variant="success" title="License Active" closeLabel="Close">
            Your license is active and all features are unlocked.
          </Alert>
        ) : (
          <Alert variant="danger" title="License Issue" closeLabel="Close">
            There's an issue with your license. Please check your license status.
          </Alert>
        )}

        {/* License Key */}
        {data.licenseKey && (
          <Box marginTop={6}>
            <LicenseKeyBanner>
              <Flex justifyContent="space-between" alignItems="flex-start">
                <Box style={{ flex: 1 }}>
                  <Typography variant="pi" style={{ color: 'rgba(255,255,255,0.8)', marginBottom: '12px', textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.5px', display: 'block' }}>
                    License Key
                  </Typography>
                  <Typography style={{ color: 'white', fontFamily: 'monospace', fontSize: '28px', fontWeight: 'bold', wordBreak: 'break-all', marginBottom: '16px' }}>
                    {data.licenseKey}
                  </Typography>
                  <Flex gap={2}>
                    <Button
                      onClick={handleCopyLicenseKey}
                      startIcon={<Duplicate />}
                      size="S"
                      variant="secondary"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.2)',
                        color: 'white',
                        border: '1px solid rgba(255,255,255,0.3)',
                        fontWeight: '600',
                      }}
                    >
                      Copy Key
                    </Button>
                    <Button
                      onClick={handleDownloadLicenseKey}
                      startIcon={<Download />}
                      size="S"
                      variant="secondary"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.2)',
                        color: 'white',
                        border: '1px solid rgba(255,255,255,0.3)',
                        fontWeight: '600',
                      }}
                    >
                      Download as TXT
                    </Button>
                  </Flex>
                </Box>
                <Badge
                  backgroundColor={data.isActive ? "success100" : "danger100"}
                  textColor={data.isActive ? "success700" : "danger700"}
                  style={{ fontSize: '11px', fontWeight: '700', padding: '6px 12px', marginLeft: '16px', flexShrink: 0 }}
                >
                  {data.isActive ? 'ACTIVE' : 'INACTIVE'}
                </Badge>
              </Flex>
            </LicenseKeyBanner>
          </Box>
        )}

        {/* Details Section */}
        <Box marginTop={6}>
          <Accordion.Root defaultValue="account" collapsible>
            {/* Account Information */}
            <Accordion.Item value="account">
              <Accordion.Header>
                <Accordion.Trigger icon={User}>
                  Account Information
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content>
                <Box padding={6}>
                  <Flex gap={8} wrap="wrap">
                    <Box style={{ flex: '1', minWidth: '200px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        Email Address
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold">
                        {data.email || 'Not provided'}
                      </Typography>
                    </Box>
                    <Box style={{ flex: '1', minWidth: '200px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        License Holder
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold">
                        {data.firstName && data.lastName 
                          ? `${data.firstName} ${data.lastName}`
                          : 'Not specified'
                        }
                      </Typography>
                    </Box>
                  </Flex>
                </Box>
              </Accordion.Content>
            </Accordion.Item>

            {/* License Details */}
            <Accordion.Item value="details">
              <Accordion.Header>
                <Accordion.Trigger icon={Shield}>
                  License Details
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content>
                <Box padding={6}>
                  <Flex gap={8} wrap="wrap">
                    <Box style={{ flex: '1', minWidth: '180px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        {data.isExpired ? 'Expired On' : 'Expires On'}
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold">
                        {data.expiresAt 
                          ? new Date(data.expiresAt).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                            })
                          : 'Never'}
                      </Typography>
                    </Box>
                    <Box style={{ flex: '1', minWidth: '180px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        Device Name
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold">
                        {data.deviceName || 'Unknown'}
                      </Typography>
                    </Box>
                    <Box style={{ flex: '1', minWidth: '180px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        IP Address
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold">
                        {data.ipAddress || 'Not detected'}
                      </Typography>
                    </Box>
                  </Flex>
                </Box>
              </Accordion.Content>
            </Accordion.Item>

            {/* Features - Beautiful Visual Display */}
            <Accordion.Item value="features">
              <Accordion.Header>
                <Accordion.Trigger icon={Sparkle}>
                  Features & Capabilities
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content>
                <Box padding={6}>
                  {/* Feature Tier Badges */}
                  <Flex gap={3} style={{ marginBottom: '32px' }}>
                    <Badge
                      backgroundColor={data.features?.premium ? "success100" : "neutral100"}
                      textColor={data.features?.premium ? "success700" : "neutral600"}
                      style={{ 
                        fontSize: '13px', 
                        fontWeight: '700', 
                        padding: '8px 16px',
                        border: data.features?.premium ? '2px solid #dcfce7' : '2px solid #e5e7eb'
                      }}
                    >
                      {data.features?.premium ? '✓' : '✗'} PREMIUM FEATURES
                    </Badge>
                    <Badge
                      backgroundColor={data.features?.advanced ? "primary100" : "neutral100"}
                      textColor={data.features?.advanced ? "primary700" : "neutral600"}
                      style={{ 
                        fontSize: '13px', 
                        fontWeight: '700', 
                        padding: '8px 16px',
                        border: data.features?.advanced ? '2px solid #bae6fd' : '2px solid #e5e7eb'
                      }}
                    >
                      {data.features?.advanced ? '✓' : '✗'} ADVANCED FEATURES
                    </Badge>
                    <Badge
                      backgroundColor={data.features?.enterprise ? "secondary100" : "neutral100"}
                      textColor={data.features?.enterprise ? "secondary700" : "neutral600"}
                      style={{ 
                        fontSize: '13px', 
                        fontWeight: '700', 
                        padding: '8px 16px',
                        border: data.features?.enterprise ? '2px solid #ddd6fe' : '2px solid #e5e7eb'
                      }}
                    >
                      {data.features?.enterprise ? '✓' : '✗'} ENTERPRISE FEATURES
                    </Badge>
                  </Flex>
                  
                  {/* Premium Features List */}
                  {data.features?.premium && (
                    <Box marginBottom={5} padding={5} background="success50" hasRadius style={{ border: '2px solid #dcfce7' }}>
                      <Typography variant="delta" fontWeight="bold" textColor="success700" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        ✨ Premium Features Active
                      </Typography>
                      <Flex direction="column" gap={2}>
                        <Typography variant="omega" textColor="success700" style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          ✓ IP Geolocation Tracking (Country, City, Timezone)
                        </Typography>
                        <Typography variant="omega" textColor="success700" style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          ✓ Security Risk Scoring (0-100)
                        </Typography>
                        <Typography variant="omega" textColor="success700" style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          ✓ VPN Detection
                        </Typography>
                        <Typography variant="omega" textColor="success700" style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          ✓ Proxy Detection
                        </Typography>
                        <Typography variant="omega" textColor="success700" style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          ✓ Threat Analysis
                        </Typography>
                        <Typography variant="omega" textColor="success700" style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          ✓ Advanced Session Analytics
                        </Typography>
                      </Flex>
                    </Box>
                  )}
                  
                  {/* Advanced Features List */}
                  {data.features?.advanced && (
                    <Box marginBottom={5} padding={5} background="primary50" hasRadius style={{ border: '2px solid #bae6fd' }}>
                      <Typography variant="delta" fontWeight="bold" textColor="primary700" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        🚀 Advanced Features Active
                      </Typography>
                      <Flex direction="column" gap={2}>
                        <Typography variant="omega" textColor="primary700" style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          ✓ Email Notifications & Alerts
                        </Typography>
                        <Typography variant="omega" textColor="primary700" style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          ✓ Webhook Integration (Discord/Slack)
                        </Typography>
                        <Typography variant="omega" textColor="primary700" style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          ✓ Auto-blocking Suspicious Sessions
                        </Typography>
                        <Typography variant="omega" textColor="primary700" style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          ✓ Geo-fencing (Country-based Access Control)
                        </Typography>
                        <Typography variant="omega" textColor="primary700" style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          ✓ Enhanced Analytics Dashboard
                        </Typography>
                      </Flex>
                    </Box>
                  )}
                  
                  {/* Enterprise Features List */}
                  {data.features?.enterprise && (
                    <Box padding={5} background="secondary50" hasRadius style={{ border: '2px solid #ddd6fe' }}>
                      <Typography variant="delta" fontWeight="bold" textColor="secondary700" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        🏢 Enterprise Features Active
                      </Typography>
                      <Flex direction="column" gap={2}>
                        <Typography variant="omega" textColor="secondary700" style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          ✓ Multi-tenant Support
                        </Typography>
                        <Typography variant="omega" textColor="secondary700" style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          ✓ Compliance Reports (GDPR, SOC2)
                        </Typography>
                        <Typography variant="omega" textColor="secondary700" style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          ✓ Custom Security Rules Engine
                        </Typography>
                        <Typography variant="omega" textColor="secondary700" style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          ✓ ML-based Anomaly Detection
                        </Typography>
                        <Typography variant="omega" textColor="secondary700" style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          ✓ Priority Support
                        </Typography>
                      </Flex>
                    </Box>
                  )}
                </Box>
              </Accordion.Content>
            </Accordion.Item>

            {/* System Status */}
            <Accordion.Item value="status">
              <Accordion.Header>
                <Accordion.Trigger icon={ChartBubble}>
                  System Status
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content>
                <Box padding={6}>
                  <Flex gap={8} wrap="wrap">
                    <Box style={{ flex: '1', minWidth: '150px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        License Status
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold">
                        {data.isActive ? 'Active' : 'Inactive'}
                      </Typography>
                    </Box>
                    <Box style={{ flex: '1', minWidth: '150px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        Connection
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold">
                        {data.isOnline ? 'Online' : 'Offline'}
                      </Typography>
                    </Box>
                    <Box style={{ flex: '1', minWidth: '150px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        Last Sync
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold">
                        {data.lastPingAt 
                          ? new Date(data.lastPingAt).toLocaleTimeString()
                          : 'Never'}
                      </Typography>
                    </Box>
                    <Box style={{ flex: '1', minWidth: '150px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        Device Limit
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold">
                        {data.currentDevices || 0} / {data.maxDevices || 1}
                      </Typography>
                    </Box>
                  </Flex>
                </Box>
              </Accordion.Content>
            </Accordion.Item>
          </Accordion.Root>
        </Box>
      </Box>
    </Container>
  );
};

export default LicensePage;
