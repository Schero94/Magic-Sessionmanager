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
  User, 
  Shield,
  Sparkle,
  ChartBubble,
  Duplicate,
  Download,
} from '@strapi/icons';
import styled, { keyframes, css } from 'styled-components';
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
  ${css`animation: ${fadeIn} 0.5s;`}
  max-width: 1400px;
  margin: 0 auto;
`;

const StickySaveBar = styled(Box)`
  position: sticky;
  top: 0;
  z-index: 10;
  background: ${(p) => p.theme.colors.neutral0};
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
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
    ${css`animation: ${shimmer} 3s infinite;`}
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
      setError('Failed to load activation information');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLicenseKey = async () => {
    try {
      await navigator.clipboard.writeText(licenseData?.data?.licenseKey || '');
      toggleNotification({
        type: 'success',
        message: 'Activation key copied to clipboard!',
      });
    } catch (err) {
      toggleNotification({
        type: 'danger',
        message: 'Failed to copy activation key',
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
      
      const content = `Magic Session Manager - Optional Activation Key
=======================================

Activation Key: ${licenseKey}

Activation Holder Information:
---------------------------------------
Name:        ${fullName}
Email:       ${email}

Activation Status:
---------------------------------------
Status:      ${data.isActive ? 'ACTIVE' : 'INACTIVE'}
Expires:     ${data.expiresAt ? new Date(data.expiresAt).toLocaleDateString() : 'Never'}

Features:
---------------------------------------
All Session Manager features are included without a paid key.

=======================================
Generated:   ${new Date().toLocaleString()}
`;
      
      const blob = new Blob([content], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `session-manager-activation-${licenseKey.substring(0, 8)}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toggleNotification({
        type: 'success',
        message: 'Activation key downloaded successfully!',
      });
    } catch (err) {
      toggleNotification({
        type: 'danger',
        message: 'Failed to download activation key',
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
          <Loader>Loading activation information...</Loader>
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
  // `hasKey` is the authoritative "is a key stored" signal from the controller.
  // The old `demo` flag is now always false, so branching on it left the
  // "no key stored" state unreachable and showed a green "key stored" banner
  // on a fresh install. Fall back to inspecting the returned key for older
  // responses that predate the `hasKey` field.
  const data = licenseData?.data || {};
  const hasKey = licenseData?.hasKey ?? Boolean(data.licenseKey);

  return (
    <Container>
      {/* Sticky Header */}
      <StickySaveBar paddingTop={5} paddingBottom={5} paddingLeft={6} paddingRight={6}>
        <Flex justifyContent="space-between" alignItems="center">
          <Flex direction="column" gap={1}>
            <Typography variant="alpha" fontWeight="bold">
              Optional Activation
            </Typography>
            <Typography variant="epsilon" textColor="neutral600">
              Store and inspect an optional activation key. All features work without one.
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
        {!hasKey ? (
          <Alert variant="default" title="No Activation Key Stored" closeLabel="Close">
            All Session Manager features are available. An activation key is optional and only used for install tracking or display.
          </Alert>
        ) : isValid ? (
          <Alert variant="success" title="Activation Key Stored" closeLabel="Close">
            Your optional activation key is stored. All features remain available with or without this key.
          </Alert>
        ) : (
          <Alert variant="warning" title="Activation Check Failed" closeLabel="Close">
            The activation server could not verify this key. The plugin still keeps all features available.
          </Alert>
        )}

        {/* Activation Key */}
        {data.licenseKey && (
          <Box marginTop={6}>
            <LicenseKeyBanner>
              <Flex justifyContent="space-between" alignItems="flex-start">
                <Box style={{ flex: 1 }}>
                  <Typography variant="pi" style={{ color: 'rgba(255,255,255,0.8)', marginBottom: '12px', textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.5px', display: 'block' }}>
                    Activation Key
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
                        Activation Holder
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

            {/* Activation Details */}
            <Accordion.Item value="details">
              <Accordion.Header>
                <Accordion.Trigger icon={Shield}>
                  Activation Details
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

            {/* Features */}
            <Accordion.Item value="features">
              <Accordion.Header>
                <Accordion.Trigger icon={Sparkle}>
                  Features & Capabilities
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content>
                <Box padding={6}>
                  <Box padding={5} background="success50" hasRadius style={{ border: '2px solid rgba(34, 197, 94, 0.3)' }}>
                    <Typography variant="delta" fontWeight="bold" textColor="success700" style={{ marginBottom: '16px', display: 'block' }}>
                      All Features Included
                    </Typography>
                    <Flex direction="column" gap={2}>
                      <Typography variant="omega" textColor="success700" style={{ fontSize: '14px' }}>
                        IP geolocation tracking with country, city, and timezone
                      </Typography>
                      <Typography variant="omega" textColor="success700" style={{ fontSize: '14px' }}>
                        Security scoring, VPN/proxy detection, and threat analysis
                      </Typography>
                      <Typography variant="omega" textColor="success700" style={{ fontSize: '14px' }}>
                        Session analytics, CSV/JSON export, and real-time monitoring
                      </Typography>
                      <Typography variant="omega" textColor="success700" style={{ fontSize: '14px' }}>
                        Email alerts, Discord/Slack webhooks, and geofencing
                      </Typography>
                    </Flex>
                  </Box>
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
                        Activation Status
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
