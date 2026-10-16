import { useState, useEffect } from 'react';
import { useIntl } from 'react-intl';
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
import styled from 'styled-components';
import pluginId from '../pluginId';
import PluginPageLayout from '../components/PluginPageLayout';
import ReadableText from '../components/ReadableText';
import { getTranslation } from '../utils/getTranslation';
import { logSafeAdminError } from '../utils/safeAdminLog.mjs';
import { maskSensitiveValue } from '../utils/maskSensitiveValue.mjs';
import { copyText } from '../utils/copyText.mjs';

// ================ LAYOUT ================
const Container = styled(Box)`
  width: 100%;
  min-width: 0;
`;

const LicenseKeyBanner = styled(Box)`
  background: ${(p) => p.theme.colors.neutral0};
  border: 1px solid ${(p) => p.theme.colors.neutral150};
  border-radius: 4px;
  min-width: 0;
  padding: 20px;
  margin-bottom: 16px;
`;

const FeaturePanel = styled(Box)`
  border: 1px solid ${(p) => p.theme.colors.neutral150};
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
  const { formatMessage, locale } = useIntl();
  const { get } = useFetchClient();
  const { toggleNotification } = useNotification();
  const t = (id, defaultMessage, values) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const [loading, setLoading] = useState(true);
  const [licenseData, setLicenseData] = useState(null);
  const [showLicenseKey, setShowLicenseKey] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Reloads optional activation status from the protected plugin endpoint.
   *
   * @returns {Promise<void>}
   */
  const fetchLicenseStatus = async () => {
    setLoading(true);
    setShowLicenseKey(false);
    setError(null);
    
    try {
      const response = await get(`/${pluginId}/license/status`);
      setLicenseData(response.data);
    } catch (err) {
      logSafeAdminError('activation.load', err);
      setError(t('license.error.load', 'Activation information could not be loaded.'));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Copies the locally stored activation key when one is available.
   *
   * @returns {Promise<void>}
   */
  const handleCopyLicenseKey = async () => {
    try {
      await copyText(licenseData?.data?.licenseKey || '');
      toggleNotification({
        type: 'success',
        message: t('license.success.copied', 'Activation key copied to clipboard.'),
      });
    } catch (err) {
      logSafeAdminError('activation.copyKey', err);
      toggleNotification({
        type: 'danger',
        message: t('license.error.copy', 'Could not copy the activation key.'),
      });
    }
  };

  /**
   * Downloads a text file containing the activation key and holder details.
   *
   * @returns {void}
   */
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
      link.download = 'session-manager-activation.txt';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toggleNotification({
        type: 'success',
        message: t('license.success.downloaded', 'Activation key downloaded.'),
      });
    } catch (err) {
      toggleNotification({
        type: 'danger',
        message: t('license.error.download', 'Could not download the activation key.'),
      });
    }
  };

  useEffect(() => {
    fetchLicenseStatus();
  }, []);

  if (loading) {
    return (
      <PluginPageLayout
        headingId="magic-sessionmanager-activation-title"
        title={t('license.title', 'Optional activation')}
        subtitle={t('license.subtitle', 'An activation key is optional. All features remain available without one.')}
      >
        <LoaderContainer>
          <Loader>{t('license.loading', 'Loading activation information...')}</Loader>
        </LoaderContainer>
      </PluginPageLayout>
    );
  }

  if (error) {
    return (
      <PluginPageLayout
        headingId="magic-sessionmanager-activation-title"
        title={t('license.title', 'Optional activation')}
        subtitle={t('license.subtitle', 'An activation key is optional. All features remain available without one.')}
      >
        <Box padding={8}>
          <Alert
            variant="danger"
            title={t('common.error', 'Error')}
            closeLabel={t('common.close', 'Close')}
            action={(
              <Button variant="secondary" onClick={fetchLicenseStatus}>
                {t('common.retry', 'Retry')}
              </Button>
            )}
          >
            <ReadableText variant="pi" textColor="neutral700" tag="span">
              {error}
            </ReadableText>
          </Alert>
        </Box>
      </PluginPageLayout>
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
    <PluginPageLayout
      headingId="magic-sessionmanager-activation-title"
      title={t('license.title', 'Optional activation')}
      subtitle={t('license.subtitle', 'An activation key is optional. All features remain available without one.')}
      primaryAction={(
        <Button startIcon={<ArrowClockwise />} onClick={fetchLicenseStatus} variant="secondary">
          {t('license.refresh', 'Refresh status')}
        </Button>
      )}
    >
      <Container>
      <Box>
        {/* Status Alert */}
        {!hasKey ? (
          <Alert variant="default" title={t('license.status.noKey.title', 'No activation key stored')} closeLabel={t('common.close', 'Close')}>
            <ReadableText variant="pi" textColor="neutral700" tag="span">
              {t('license.status.noKey.description', 'All Session Manager features are available. An activation key is optional and only used for install tracking or display.')}
            </ReadableText>
          </Alert>
        ) : isValid ? (
          <Alert variant="success" title={t('license.status.stored.title', 'Activation key stored')} closeLabel={t('common.close', 'Close')}>
            <ReadableText variant="pi" textColor="neutral700" tag="span">
              {t('license.status.stored.description', 'Your optional activation key is stored. All features remain available with or without this key.')}
            </ReadableText>
          </Alert>
        ) : (
          <Alert variant="warning" title={t('license.status.failed.title', 'Activation check failed')} closeLabel={t('common.close', 'Close')}>
            <ReadableText variant="pi" textColor="neutral700" tag="span">
              {t('license.status.failed.description', 'The activation server could not verify this key. The plugin still keeps all features available.')}
            </ReadableText>
          </Alert>
        )}

        {/* Activation Key */}
        {data.licenseKey && (
          <Box marginTop={6}>
            <LicenseKeyBanner>
              <Flex justifyContent="space-between" alignItems="flex-start" gap={4} wrap="wrap">
                <Box style={{ flex: '1 1 240px', minWidth: 0 }}>
                  <Typography variant="sigma" textColor="neutral600" style={{ marginBottom: '8px', display: 'block' }}>
                    {t('license.key.label', 'Activation key')}
                  </Typography>
                  <Flex alignItems="center" gap={2} wrap="wrap" style={{ marginBottom: '16px' }}>
                    <Typography
                      variant="epsilon"
                      fontWeight="semiBold"
                      style={{ fontFamily: 'monospace', overflowWrap: 'anywhere', minWidth: 0 }}
                    >
                      {showLicenseKey ? data.licenseKey : maskSensitiveValue(data.licenseKey)}
                    </Typography>
                    <Button
                      type="button"
                      variant="tertiary"
                      size="S"
                      aria-label={t(
                        showLicenseKey ? 'license.key.hide' : 'license.key.show',
                        showLicenseKey ? 'Hide key' : 'Show key'
                      )}
                      onClick={() => setShowLicenseKey((visible) => !visible)}
                    >
                      {t(showLicenseKey ? 'license.key.hide' : 'license.key.show', showLicenseKey ? 'Hide key' : 'Show key')}
                    </Button>
                  </Flex>
                  <Flex gap={2} wrap="wrap">
                    <Button
                      onClick={handleCopyLicenseKey}
                      startIcon={<Duplicate />}
                      size="S"
                      variant="secondary"
                    >
                      {t('license.key.copy', 'Copy key')}
                    </Button>
                    <Button
                      onClick={handleDownloadLicenseKey}
                      startIcon={<Download />}
                      size="S"
                      variant="secondary"
                    >
                      {t('license.key.download', 'Download as TXT')}
                    </Button>
                  </Flex>
                </Box>
                <Badge variant={data.isActive ? 'success' : 'neutral'} size="S">
                  {data.isActive ? t('license.active', 'Active') : t('license.inactive', 'Inactive')}
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
                  {t('license.account.title', 'Account information')}
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content>
                <Box padding={6}>
                  <Flex gap={8} wrap="wrap">
                    <Box style={{ flex: '1', minWidth: '200px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        {t('license.account.email', 'Email address')}
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold">
                        {data.email || t('license.value.notProvided', 'Not provided')}
                      </Typography>
                    </Box>
                    <Box style={{ flex: '1', minWidth: '200px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        {t('license.account.holder', 'Activation holder')}
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold">
                        {data.firstName && data.lastName 
                          ? `${data.firstName} ${data.lastName}`
                          : t('license.value.notSpecified', 'Not specified')
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
                  {t('license.details.title', 'Activation details')}
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content>
                <Box padding={6}>
                  <Flex gap={8} wrap="wrap">
                    <Box style={{ flex: '1', minWidth: '180px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        {data.isExpired
                          ? t('license.details.expiredOn', 'Expired on')
                          : t('license.details.expiresOn', 'Expires on')}
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold">
                        {data.expiresAt 
                          ? new Date(data.expiresAt).toLocaleDateString(locale, {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                            })
                          : t('license.value.never', 'Never')}
                      </Typography>
                    </Box>
                    <Box style={{ flex: '1', minWidth: '180px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        {t('license.details.deviceName', 'Device name')}
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold">
                        {data.deviceName || t('license.value.unknown', 'Unknown')}
                      </Typography>
                    </Box>
                    <Box style={{ flex: '1', minWidth: '180px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        {t('license.details.ipAddress', 'IP address')}
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold">
                        {data.ipAddress || t('license.value.notDetected', 'Not detected')}
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
                  {t('license.features.title', 'Features and capabilities')}
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content>
                <Box padding={6}>
                  <FeaturePanel padding={5} background="neutral0" hasRadius>
                    <Typography variant="delta" fontWeight="semiBold" textColor="neutral800" style={{ marginBottom: '16px', display: 'block' }}>
                      {t('license.features.included', 'All features included')}
                    </Typography>
                    <Flex direction="column" gap={0}>
                      <ReadableText variant="pi" textColor="neutral700" tag="p">
                        {t('license.features.geolocation', 'IP geolocation with country, city, and timezone')}
                      </ReadableText>
                      <ReadableText variant="pi" textColor="neutral700" tag="p">
                        {t('license.features.security', 'Security scoring, VPN and proxy detection, and threat analysis')}
                      </ReadableText>
                      <ReadableText variant="pi" textColor="neutral700" tag="p">
                        {t('license.features.analytics', 'Session analytics, CSV and JSON export, and real-time monitoring')}
                      </ReadableText>
                      <ReadableText variant="pi" textColor="neutral700" tag="p">
                        {t('license.features.alerts', 'Email alerts, Discord and Slack webhooks, and geofencing')}
                      </ReadableText>
                    </Flex>
                  </FeaturePanel>
                </Box>
              </Accordion.Content>
            </Accordion.Item>

            {/* System Status */}
            <Accordion.Item value="status">
              <Accordion.Header>
                <Accordion.Trigger icon={ChartBubble}>
                  {t('license.system.title', 'System status')}
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content>
                <Box padding={6}>
                  <Flex gap={8} wrap="wrap">
                    <Box style={{ flex: '1', minWidth: '150px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        {t('license.system.activation', 'Activation status')}
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold">
                        {data.isActive ? t('license.active', 'Active') : t('license.inactive', 'Inactive')}
                      </Typography>
                    </Box>
                    <Box style={{ flex: '1', minWidth: '150px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        {t('license.system.connection', 'Connection')}
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold">
                        {data.isOnline ? t('license.system.online', 'Online') : t('license.system.offline', 'Offline')}
                      </Typography>
                    </Box>
                    <Box style={{ flex: '1', minWidth: '150px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        {t('license.system.lastSync', 'Last sync')}
                      </Typography>
                      <Typography variant="omega" fontWeight="semiBold">
                        {data.lastPingAt 
                          ? new Date(data.lastPingAt).toLocaleTimeString(locale)
                          : t('license.value.never', 'Never')}
                      </Typography>
                    </Box>
                    <Box style={{ flex: '1', minWidth: '150px' }}>
                      <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ marginBottom: '8px', display: 'block' }}>
                        {t('license.system.deviceLimit', 'Device limit')}
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
    </PluginPageLayout>
  );
};

export default LicensePage;
