import { useState, useEffect, useRef } from 'react';
import { useIntl } from 'react-intl';
import {
  Badge,
  Button,
  Field,
  Flex,
  IconButton,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { Page, useClipboard, useFetchClient, useNotification } from '@strapi/strapi/admin';
import {
  ArrowClockwise,
  Duplicate,
  Download,
  Eye,
  EyeStriked,
} from '@strapi/icons';
import pluginId from '../pluginId';
import { PageShell, SectionCard, PropertyList } from '../components/ui';
import Alert from '../components/PersistentAlert';
import ReadableText from '../components/ReadableText';
import { getTranslation } from '../utils/getTranslation';
import { logSafeAdminError } from '../utils/safeAdminLog.mjs';
import { maskSensitiveValue } from '../utils/maskSensitiveValue.mjs';
import { buildLicenseSummary, getLicenseHolderName } from '../utils/activationSummary.mjs';
import {
  LICENSE_EXPIRY_DATE_OPTIONS,
  LICENSE_FEATURES_MESSAGE,
  describeLicenseState,
  getLicenseState,
} from '../utils/licenseStatus.mjs';
import { useSessionFormatters } from '../utils/useSessionFormatters';

/**
 * Whether a failed request was refused for missing permissions.
 *
 * @param {unknown} error Fetch error.
 * @returns {boolean} True for a 403 response.
 */
const isForbidden = (error) => error?.status === 403 || error?.response?.status === 403;

// ================ MAIN COMPONENT ================
const LicensePage = () => {
  const { formatMessage } = useIntl();
  const { get } = useFetchClient();
  const { toggleNotification } = useNotification();
  const { copy } = useClipboard();
  const { formatDate } = useSessionFormatters();
  const t = (id, defaultMessage, values) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const translate = (descriptor, values) =>
    formatMessage({ id: getTranslation(descriptor.messageId), defaultMessage: descriptor.defaultMessage }, values);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [licenseData, setLicenseData] = useState(null);
  const [showLicenseKey, setShowLicenseKey] = useState(false);
  const [error, setError] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const requestPendingRef = useRef(false);

  /**
   * Loads the license status from the protected plugin endpoint. Only the
   * very first load shows the page loader; "Check again" keeps the page, its
   * focus and the revealed/masked key state mounted (F8). A failed check keeps
   * the last known status and shows the error inside the status card.
   *
   * @param {{announce?: boolean}} [options] Announce a successful check.
   * @returns {Promise<void>}
   */
  const fetchLicenseStatus = async ({ announce = false } = {}) => {
    if (requestPendingRef.current) return;
    requestPendingRef.current = true;
    setRefreshing(true);

    try {
      const response = await get(`/${pluginId}/license/status`);
      setLicenseData(response.data);
      setError(false);
      if (announce) {
        toggleNotification({
          type: 'success',
          message: t('license.success.refreshed', 'License status checked.'),
        });
      }
    } catch (err) {
      logSafeAdminError('license.load', err);
      if (isForbidden(err)) setForbidden(true);
      setError(true);
    } finally {
      requestPendingRef.current = false;
      setRefreshing(false);
      setLoading(false);
    }
  };

  const handleRefresh = () => fetchLicenseStatus({ announce: true });

  /**
   * Copies the stored license key with Strapi's clipboard helper.
   *
   * @returns {Promise<void>}
   */
  const handleCopyLicenseKey = async () => {
    try {
      const copied = await copy(licenseData?.data?.licenseKey || '');
      if (!copied) throw new Error('clipboard_unavailable');
      toggleNotification({
        type: 'success',
        message: t('license.success.copied', 'Copied.'),
      });
    } catch (err) {
      logSafeAdminError('license.copyKey', err);
      toggleNotification({
        type: 'danger',
        message: t('license.error.copy', 'The key could not be copied.'),
      });
    }
  };

  /**
   * Downloads the license key and details as a text file in the admin
   * language, with dates in the admin locale (F18).
   *
   * @returns {void}
   */
  const handleDownloadLicenseKey = () => {
    try {
      const content = buildLicenseSummary({
        response: licenseData,
        translate,
        formatDate,
        generatedAt: Date.now(),
      });

      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'session-manager-license.txt';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toggleNotification({
        type: 'success',
        message: t('license.success.downloaded', 'License details downloaded.'),
      });
    } catch (err) {
      logSafeAdminError('license.download', err);
      toggleNotification({
        type: 'danger',
        message: t('license.error.download', 'The file could not be created.'),
      });
    }
  };

  useEffect(() => {
    fetchLicenseStatus();
  }, []);

  if (loading) {
    return <Page.Loading />;
  }

  if (forbidden) {
    return <Page.NoPermissions />;
  }

  const licenseState = licenseData ? getLicenseState(licenseData) : null;
  const hasKey = licenseState?.hasKey === true;
  const data = licenseState?.data || {};
  const statusMessage = licenseState ? describeLicenseState(licenseState, formatDate) : null;
  const yesNo = (value) => (value ? t('common.yes', 'Yes') : t('common.no', 'No'));

  const detailItems = [
    { id: 'holder', label: t('license.details.holder', 'Holder'), value: getLicenseHolderName(data) },
    { id: 'email', kind: 'email', label: t('license.account.email', 'Email address'), value: data.email },
    {
      id: 'expires',
      label: t('license.details.expires', 'Expires'),
      value: licenseState?.expiresAt
        ? formatDate(licenseState.expiresAt, LICENSE_EXPIRY_DATE_OPTIONS)
        : t('license.details.noExpiry', 'No expiry date'),
    },
    { id: 'device-name', label: t('license.details.deviceName', 'Device name'), value: data.deviceName },
    { id: 'ip', kind: 'id', label: t('license.details.ipAddress', 'IP address'), value: data.ipAddress },
    {
      id: 'last-check',
      label: t('license.details.lastCheck', 'Last check'),
      value: data.lastPingAt ? formatDate(data.lastPingAt) : null,
    },
    {
      id: 'device-limit',
      label: t('license.system.deviceLimit', 'Device limit'),
      value: t('license.system.deviceLimitValue', '{current} of {max}', {
        current: Number(data.currentDevices) || 0,
        max: Number(data.maxDevices) || 1,
      }),
    },
    {
      id: 'server-reachable',
      label: t('license.details.serverReachable', 'License server reachable'),
      render: <Badge>{yesNo(licenseState?.serverReachable)}</Badge>,
    },
  ];

  return (
    <PageShell
      headingId="magic-sessionmanager-license-title"
      title={t('license.title', 'License')}
      subtitle={t('license.subtitle', 'Optional license key for this installation.')}
      primaryAction={(
        <Flex gap={2} wrap="wrap" justifyContent="flex-end">
          {hasKey ? (
            <Button variant="secondary" startIcon={<Download aria-hidden />} onClick={handleDownloadLicenseKey}>
              {t('license.key.download', 'Download as text')}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            startIcon={<ArrowClockwise aria-hidden />}
            onClick={handleRefresh}
            aria-busy={refreshing}
          >
            {t('license.refresh', 'Check again')}
          </Button>
        </Flex>
      )}
    >
      <SectionCard title={t('license.status.title', 'License status')}>
        {error ? (
          <Alert
            variant="danger"
            closeLabel={t('common.close', 'Close')}
            action={(
              <Button variant="secondary" onClick={() => fetchLicenseStatus()} aria-busy={refreshing}>
                {t('license.error.retry', 'Try again')}
              </Button>
            )}
          >
            <ReadableText variant="omega" textColor="neutral800" tag="span">
              {t('license.error.load', 'The license status could not be checked.')}
            </ReadableText>
          </Alert>
        ) : null}
        <Flex direction="column" alignItems="stretch" gap={1} aria-live="polite">
          {statusMessage ? (
            <Typography variant="delta" tag="p" textColor="neutral800" fontWeight="semiBold">
              {translate(statusMessage, statusMessage.values)}
            </Typography>
          ) : null}
          <ReadableText variant="omega" textColor="neutral600" tag="p">
            {translate(LICENSE_FEATURES_MESSAGE)}
          </ReadableText>
        </Flex>
      </SectionCard>

      {hasKey ? (
        <SectionCard title={t('license.details.title', 'License details')}>
          <PropertyList items={detailItems} />
        </SectionCard>
      ) : null}

      {hasKey ? (
        <SectionCard title={t('license.key.title', 'License key')}>
          <Field.Root
            name="license-key"
            id="magic-sessionmanager-license-key"
            hint={t('license.key.hint', 'The key stays masked until you reveal it.')}
          >
            <Field.Label>{t('license.key.label', 'Stored key')}</Field.Label>
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
        </SectionCard>
      ) : null}
    </PageShell>
  );
};

export default LicensePage;
