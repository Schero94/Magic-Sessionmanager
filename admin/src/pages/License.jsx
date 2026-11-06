import { useState, useEffect, useRef } from 'react';
import { useIntl } from 'react-intl';
import {
  Box,
  Badge,
  Flex,
  Button,
  Field,
  IconButton,
  Loader,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { useClipboard, useFetchClient, useNotification } from '@strapi/strapi/admin';
import {
  ArrowClockwise,
  Check,
  Duplicate,
  Download,
  Eye,
  EyeStriked,
} from '@strapi/icons';
import pluginId from '../pluginId';
import { PageShell, SectionCard, PropertyList, EqualGrid } from '../components/ui';
import Alert from '../components/PersistentAlert';
import ReadableText from '../components/ReadableText';
import { getTranslation } from '../utils/getTranslation';
import { logSafeAdminError } from '../utils/safeAdminLog.mjs';
import { maskSensitiveValue } from '../utils/maskSensitiveValue.mjs';
import { buildActivationSummary } from '../utils/activationSummary.mjs';
import { useSessionFormatters } from '../utils/useSessionFormatters';

const FEATURE_MESSAGES = [
  ['license.features.geolocation', 'IP geolocation with country, city, and timezone'],
  ['license.features.security', 'Security scoring, VPN and proxy detection, and threat analysis'],
  ['license.features.analytics', 'Session analytics, CSV and JSON export, and real-time monitoring'],
  ['license.features.alerts', 'Email alerts, Discord and Slack webhooks, and geofencing'],
];

// ================ MAIN COMPONENT ================
const LicensePage = () => {
  const { formatMessage } = useIntl();
  const { get } = useFetchClient();
  const { toggleNotification } = useNotification();
  const { copy } = useClipboard();
  const { formatDate } = useSessionFormatters();
  const t = (id, defaultMessage, values) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const translate = (descriptor) =>
    formatMessage({ id: getTranslation(descriptor.messageId), defaultMessage: descriptor.defaultMessage });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [licenseData, setLicenseData] = useState(null);
  const [showLicenseKey, setShowLicenseKey] = useState(false);
  const [error, setError] = useState(null);
  const hasLoadedRef = useRef(false);
  const requestPendingRef = useRef(false);

  /**
   * Reloads optional activation status from the protected plugin endpoint.
   * Only the very first load shows the full-page loader; later refreshes keep
   * the page, its focus and the revealed/masked key state mounted (F8). A
   * failed refresh keeps the last known status and reports the error.
   *
   * @param {{announce?: boolean}} [options] Announce a successful refresh.
   * @returns {Promise<void>}
   */
  const fetchLicenseStatus = async ({ announce = false } = {}) => {
    if (requestPendingRef.current) return;
    requestPendingRef.current = true;
    setRefreshing(true);

    try {
      const response = await get(`/${pluginId}/license/status`);
      setLicenseData(response.data);
      setError(null);
      hasLoadedRef.current = true;
      if (announce) {
        toggleNotification({
          type: 'success',
          message: t('license.success.refreshed', 'Activation status updated.'),
        });
      }
    } catch (err) {
      logSafeAdminError('activation.load', err);
      const message = t('license.error.load', 'Activation information could not be loaded.');
      if (hasLoadedRef.current) {
        toggleNotification({ type: 'danger', message });
      } else {
        setError(message);
      }
    } finally {
      requestPendingRef.current = false;
      setRefreshing(false);
      setLoading(false);
    }
  };

  const handleRefresh = () => fetchLicenseStatus({ announce: true });

  /**
   * Copies the locally stored activation key with Strapi's clipboard helper.
   *
   * @returns {Promise<void>}
   */
  const handleCopyLicenseKey = async () => {
    try {
      const copied = await copy(licenseData?.data?.licenseKey || '');
      if (!copied) throw new Error('clipboard_unavailable');
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
   * Downloads a text summary of the activation key and holder details in the
   * admin language, with dates in the admin locale.
   *
   * @returns {void}
   */
  const handleDownloadLicenseKey = () => {
    try {
      const content = buildActivationSummary({
        data: licenseData?.data || {},
        translate,
        formatDate,
        generatedAt: Date.now(),
      });

      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
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
      logSafeAdminError('activation.download', err);
      toggleNotification({
        type: 'danger',
        message: t('license.error.download', 'Could not download the activation key.'),
      });
    }
  };

  useEffect(() => {
    fetchLicenseStatus();
  }, []);

  const title = t('license.title', 'Optional activation');
  const subtitle = t('license.subtitle', 'An activation key is optional. All features remain available without one.');

  if (loading) {
    return (
      <PageShell headingId="magic-sessionmanager-activation-title" title={title} subtitle={subtitle}>
        <Flex justifyContent="center" padding={8}>
          <Loader>{t('license.loading', 'Loading activation information...')}</Loader>
        </Flex>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell headingId="magic-sessionmanager-activation-title" title={title} subtitle={subtitle}>
        <Alert
          variant="danger"
          title={t('common.error', 'Error')}
          closeLabel={t('common.close', 'Close')}
          action={(
            <Button variant="secondary" onClick={() => fetchLicenseStatus()} loading={refreshing}>
              {t('common.retry', 'Retry')}
            </Button>
          )}
        >
          <ReadableText variant="omega" textColor="neutral800" tag="span">
            {error}
          </ReadableText>
        </Alert>
      </PageShell>
    );
  }

  const isValid = licenseData?.valid;
  // `hasKey` is the authoritative "is a key stored" signal from the controller.
  // Fall back to inspecting the returned key for older responses without it.
  const data = licenseData?.data || {};
  const hasKey = licenseData?.hasKey ?? Boolean(data.licenseKey);
  const keyState = !hasKey
    ? {
      variant: 'neutral',
      label: t('license.status.noKey.title', 'No activation key stored'),
      description: t('license.status.noKey.description', 'All Session Manager features are available. An activation key is optional and only used for install tracking or display.'),
    }
    : isValid
      ? {
        variant: 'success',
        label: t('license.status.stored.title', 'Activation key stored'),
        description: t('license.status.stored.description', 'Your optional activation key is stored. All features remain available with or without this key.'),
      }
      : {
        variant: 'warning',
        label: t('license.status.failed.title', 'Activation check failed'),
        description: t('license.status.failed.description', 'The activation server could not verify this key. The plugin still keeps all features available.'),
      };
  const activeLabel = data.isActive ? t('license.active', 'Active') : t('license.inactive', 'Inactive');
  const holderName = [data.firstName, data.lastName].filter(Boolean).join(' ');

  const statusItems = [
    {
      id: 'key-status',
      label: t('license.status.label', 'Key status'),
      render: <Badge variant={keyState.variant}>{keyState.label}</Badge>,
    },
    {
      id: 'feature-access',
      label: t('license.status.featureAccess', 'Feature access'),
      value: t('license.features.included', 'All features included'),
    },
    ...(hasKey
      ? [
        {
          id: 'activation',
          label: t('license.system.activation', 'Activation status'),
          render: <Badge variant={data.isActive ? 'success' : 'neutral'}>{activeLabel}</Badge>,
        },
        {
          id: 'connection',
          label: t('license.system.connection', 'Connection'),
          value: data.isOnline ? t('license.system.online', 'Online') : t('license.system.offline', 'Offline'),
        },
        {
          id: 'last-sync',
          label: t('license.system.lastSync', 'Last sync'),
          value: data.lastPingAt ? formatDate(data.lastPingAt) : t('license.value.never', 'Never'),
        },
      ]
      : []),
  ];

  return (
    <PageShell
      headingId="magic-sessionmanager-activation-title"
      title={title}
      subtitle={subtitle}
      primaryAction={(
        <Flex gap={2} wrap="wrap">
          {hasKey ? (
            <Button variant="secondary" startIcon={<Download aria-hidden />} onClick={handleDownloadLicenseKey}>
              {t('license.key.download', 'Download as TXT')}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            startIcon={<ArrowClockwise aria-hidden />}
            onClick={handleRefresh}
            aria-busy={refreshing}
          >
            {t('license.refresh', 'Refresh status')}
          </Button>
        </Flex>
      )}
    >
      <SectionCard title={t('license.status.title', 'Activation status')} subtitle={keyState.description}>
        <PropertyList items={statusItems} />
        {hasKey ? (
          <Field.Root
            name="activation-key"
            id="magic-sessionmanager-activation-key"
            hint={t('license.key.hint', 'The key stays masked until you reveal it.')}
          >
            <Field.Label>{t('license.key.label', 'Activation key')}</Field.Label>
            <TextInput
              readOnly
              autoComplete="off"
              spellCheck={false}
              value={showLicenseKey ? data.licenseKey : maskSensitiveValue(data.licenseKey)}
              endAction={(
                <Flex gap={1}>
                  <IconButton
                    variant="ghost"
                    label={t(showLicenseKey ? 'license.key.hide' : 'license.key.show', showLicenseKey ? 'Hide key' : 'Show key')}
                    onClick={() => setShowLicenseKey((visible) => !visible)}
                  >
                    {showLicenseKey ? <EyeStriked aria-hidden /> : <Eye aria-hidden />}
                  </IconButton>
                  <IconButton
                    variant="ghost"
                    label={t('license.key.copy', 'Copy key')}
                    onClick={handleCopyLicenseKey}
                  >
                    <Duplicate aria-hidden />
                  </IconButton>
                </Flex>
              )}
            />
            <Field.Hint />
          </Field.Root>
        ) : null}
      </SectionCard>

      {hasKey ? (
        <EqualGrid columns={2} stackBelow="medium">
          <SectionCard fill title={t('license.account.title', 'Account information')}>
            <PropertyList
              columns={1}
              items={[
                { id: 'email', kind: 'email', label: t('license.account.email', 'Email address'), value: data.email },
                { id: 'holder', label: t('license.account.holder', 'Activation holder'), value: holderName },
              ]}
            />
          </SectionCard>
          <SectionCard fill title={t('license.details.title', 'Activation details')}>
            <PropertyList
              columns={1}
              items={[
                {
                  id: 'expires',
                  label: data.isExpired
                    ? t('license.details.expiredOn', 'Expired on')
                    : t('license.details.expiresOn', 'Expires on'),
                  value: data.expiresAt
                    ? formatDate(data.expiresAt, { dateStyle: 'long' })
                    : t('license.value.never', 'Never'),
                },
                { id: 'device-name', label: t('license.details.deviceName', 'Device name'), value: data.deviceName },
                { id: 'ip', kind: 'id', label: t('license.details.ipAddress', 'IP address'), value: data.ipAddress },
                {
                  id: 'device-limit',
                  label: t('license.system.deviceLimit', 'Device limit'),
                  value: t('license.system.deviceLimitValue', '{current} of {max}', {
                    current: data.currentDevices || 0,
                    max: data.maxDevices || 1,
                  }),
                },
              ]}
            />
          </SectionCard>
        </EqualGrid>
      ) : null}

      <SectionCard title={t('license.features.title', 'Features and capabilities')}>
        <Flex tag="ul" direction="column" alignItems="stretch" gap={2} margin={0} padding={0}>
          {FEATURE_MESSAGES.map(([id, defaultMessage]) => (
            <Flex key={id} tag="li" gap={2} alignItems="flex-start">
              <Box color="success600" shrink={0} aria-hidden>
                <Check aria-hidden focusable={false} />
              </Box>
              <Typography variant="omega" textColor="neutral800">
                {t(id, defaultMessage)}
              </Typography>
            </Flex>
          ))}
        </Flex>
      </SectionCard>
    </PageShell>
  );
};

export default LicensePage;
