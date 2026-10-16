import { useState, useEffect } from 'react';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import {
  Modal,
  Badge,
  Button,
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
  Information,
} from '@strapi/icons';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import parseUserAgent from '../utils/parseUserAgent';
import pluginId from '../pluginId';
import { getTranslation } from '../utils/getTranslation';
import { getSessionStatus } from '../utils/sessionStatus.mjs';
import { formatSessionDateTime, getBrowserVersionFromUserAgent } from '../utils/sessionPresentation.mjs';
import { logSafeAdminError } from '../utils/safeAdminLog.mjs';
import ReadableText from './ReadableText';

const TwoColumnGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
  min-width: 0;

  & > * {
    min-width: 0;
  }

  @media (max-width: 767px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const Section = styled(Box)`
  min-width: 0;
  margin-bottom: 24px;
`;

const DetailsList = styled.dl`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 24px;
  row-gap: 0;
  width: 100%;
  min-width: 0;
  margin: 8px 0 0;

  @media (max-width: 519px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const DetailItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 10px 0 12px;
  border-bottom: 1px solid ${(props) => props.theme.colors.neutral150};
`;

const DetailLabel = styled(Typography)`
  display: block;
  width: 100%;
  min-width: 0;
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  font-weight: 600;
  text-wrap: pretty;
`;

const DetailValue = styled(Typography)`
  display: block;
  width: 100%;
  min-width: 0;
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  word-break: break-word;
`;

const ModalActions = styled(Flex)`
  width: 100%;
  min-width: 0;
  gap: 12px;
  flex-wrap: wrap;

  @media (max-width: 519px) {
    flex-direction: column;
    align-items: stretch;

    & > button {
      width: 100%;
    }
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
  if (!geoLocation.country && !geoLocation.country_code && !geoLocation.city && !geoLocation.timezone) return null;

  const hasSecurityScore = typeof session.securityScore === 'number';
  return {
    country_flag: geoLocation.country_flag || '',
    country: geoLocation.country || geoLocation.country_code || null,
    city: geoLocation.city || null,
    timezone: geoLocation.timezone || null,
    securityScore: hasSecurityScore ? session.securityScore : null,
    riskLevel: hasSecurityScore ? (session.securityScore < 50 ? 'High' : 'Low') : null,
    isVpn: typeof geoLocation.isVpn === 'boolean' ? geoLocation.isVpn : null,
    isProxy: typeof geoLocation.isProxy === 'boolean' ? geoLocation.isProxy : null,
  };
};

/**
 * Parses available device metadata without inferring a device from missing native fields.
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
      browserVersion: getBrowserVersionFromUserAgent(userAgent) || normalize(session?.browserVersion),
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
    browserVersion: normalize(session?.browserVersion),
    os: osName || unavailableValue,
    hasDeviceType: Boolean(deviceType),
  };
};

const SessionDetailModal = ({ session, onClose, onSessionTerminated }) => {
  const { formatMessage, locale } = useIntl();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const [terminating, setTerminating] = useState(false);
  const [showUserAgent, setShowUserAgent] = useState(false);
  const [geoData, setGeoData] = useState(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const t = (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const unavailableValue = t('modal.user.na', 'Unavailable');

  useEffect(() => {
    let cancelled = false;
    const ipAddress = session?.ipAddress;
    const storedGeoData = getStoredGeoData(session);

    if (storedGeoData) {
      setGeoData(storedGeoData);
      setGeoLoading(false);
      return () => {
        cancelled = true;
      };
    }

    if (!ipAddress) {
      setGeoData(null);
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
        logSafeAdminError('sessionDetails.geolocation', err);
        if (!cancelled) {
          setGeoData(null);
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

  const deviceInfo = getSessionDeviceInfo(session, unavailableValue);
  const sessionStatus = getSessionStatus(session);
  const statusVariant = {
    active: 'success',
    idle: 'warning',
    loggedout: 'neutral',
    terminated: 'neutral',
  }[sessionStatus] || 'neutral';
  const statusLabel = {
    active: t('modal.status.online', 'Active'),
    idle: t('modal.status.idle', 'Idle'),
    loggedout: t('modal.status.loggedOut', 'Logged out'),
    terminated: t('modal.status.terminated', 'Terminated'),
  }[sessionStatus] || t('modal.status.terminated', 'Terminated');

  // Do not infer location or security values when the session has no GeoIP data.
  const securityData = geoData || {
    country_flag: '',
    country: unavailableValue,
    city: unavailableValue,
    timezone: unavailableValue,
    securityScore: null,
    riskLevel: null,
    isVpn: null,
    isProxy: null,
  };

  const getDeviceIcon = (deviceType) => {
    if (deviceType === 'Mobile' || deviceType === 'Tablet') return Phone;
    if (deviceType === 'Desktop' || deviceType === 'Laptop') return Monitor;
    return Server;
  };

  const DeviceIcon = deviceInfo.hasDeviceType ? getDeviceIcon(deviceInfo.device) : Information;

  /**
   * Confirms termination and posts the selected session ID to the admin API.
   *
   * @returns {Promise<void>}
   */
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
      logSafeAdminError('sessionDetails.terminate', err);
      toggleNotification({
        type: 'danger',
        message: t('notifications.error.terminate', 'Failed to terminate session'),
      });
    } finally {
      setTerminating(false);
    }
  };

  const DetailField = ({ label, value }) => (
    <DetailItem>
      <DetailLabel variant="pi" textColor="neutral600" tag="dt">
        {label}
      </DetailLabel>
      <DetailValue variant="omega" textColor="neutral800" tag="dd">
        {value}
      </DetailValue>
    </DetailItem>
  );

  const browserValue = [deviceInfo.browser, deviceInfo.browserVersion].filter(Boolean).join(' ') || unavailableValue;
  const idleMinutes = session.minutesSinceActive;
  const idleTimeValue = idleMinutes !== null && idleMinutes !== undefined && Number.isFinite(Number(idleMinutes))
    ? t('modal.timeline.minutes', '{minutes} min', { minutes: Number(idleMinutes) })
    : unavailableValue;

  return (
    <Modal.Root open onOpenChange={onClose}>
      <Modal.Content
        style={{
          width: 'min(900px, calc(100vw - 24px))',
          maxHeight: 'calc(100vh - 24px)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Modal.Header>
          <Flex gap={3} alignItems="center" style={{ minWidth: 0 }}>
            <Box
              padding={2}
              background="neutral100"
              hasRadius
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <DeviceIcon width="24px" height="24px" />
            </Box>
            <Flex direction="column" alignItems="flex-start" style={{ minWidth: 0 }}>
              <Typography variant="beta" fontWeight="bold" style={{ overflowWrap: 'anywhere' }}>
                {t('modal.title', 'Session Details')}
              </Typography>
              <Typography variant="pi" textColor="neutral600" style={{ overflowWrap: 'anywhere' }}>
                {t('modal.id', 'ID: {id}', { id: session.id })}
              </Typography>
            </Flex>
          </Flex>
        </Modal.Header>

        <Modal.Body style={{ overflowY: 'auto', minHeight: 0 }}>
          <Box padding={{ initial: 3, small: 5 }} style={{ minWidth: 0 }}>
            {/* Status Badge */}
            <Flex justifyContent="flex-start" style={{ marginBottom: '24px' }}>
              <Badge variant={statusVariant} size="M">
                {statusLabel}
              </Badge>
            </Flex>

            <Divider style={{ marginBottom: '24px' }} />

            {/* Two Column Layout */}
            <TwoColumnGrid>
              {/* Left Column: User & Device */}
              <Box>
                {/* User Information */}
                <Section>
                  <Typography variant="epsilon" fontWeight="semiBold" textColor="neutral800" tag="h2" style={{ marginBottom: '8px' }}>
                    {t('modal.section.user', 'User')}
                  </Typography>

                  <DetailsList>
                    <DetailField label={t('modal.user.username', 'Username')} value={session.user?.username || unavailableValue} />
                    <DetailField label={t('modal.user.email', 'Email')} value={session.user?.email || unavailableValue} />
                    <DetailField label={t('modal.user.id', 'User ID')} value={session.user?.documentId || session.user?.id || unavailableValue} />
                  </DetailsList>
                </Section>

                {/* Device Information */}
                <Section>
                  <Typography variant="epsilon" fontWeight="semiBold" textColor="neutral800" tag="h2" style={{ marginBottom: '8px' }}>
                    {t('modal.section.device', 'Device')}
                  </Typography>

                  <DetailsList>
                    <DetailField label={t('modal.device.device', 'Device')} value={deviceInfo.device} />
                    <DetailField label={t('modal.device.browser', 'Browser')} value={browserValue} />
                    <DetailField label={t('modal.device.os', 'OS')} value={deviceInfo.os} />
                    <DetailField label={t('modal.device.ip', 'IP')} value={session.ipAddress || unavailableValue} />
                  </DetailsList>
                </Section>
              </Box>

              {/* Right Column: Timeline */}
              <Box>
                <Section>
                  <Typography variant="epsilon" fontWeight="semiBold" textColor="neutral800" tag="h2" style={{ marginBottom: '8px' }}>
                    {t('modal.section.timeline', 'Timeline')}
                  </Typography>

                  <DetailsList>
                    <DetailField
                      label={t('modal.timeline.login', 'Login')}
                      value={formatSessionDateTime(session.loginTime, locale, unavailableValue)}
                    />
                    <DetailField
                      label={t('modal.timeline.lastActive', 'Last Active')}
                      value={formatSessionDateTime(session.lastActive || session.loginTime, locale, unavailableValue)}
                    />
                    <DetailField label={t('modal.timeline.idleTime', 'Idle Time')} value={idleTimeValue} />
                    {session.logoutTime && (
                      <DetailField
                        label={t('modal.timeline.logout', 'Logout')}
                        value={formatSessionDateTime(session.logoutTime, locale, unavailableValue)}
                      />
                    )}
                  </DetailsList>
                </Section>
              </Box>
            </TwoColumnGrid>

            {/* Geolocation & Security Information */}
            <Section>
              <Typography variant="epsilon" fontWeight="semiBold" textColor="neutral800" tag="h2" style={{ marginBottom: '8px' }}>
                {t('modal.section.security', 'Location and Security')}
              </Typography>

              {geoLoading ? (
                <Box padding={4} style={{ textAlign: 'center' }}>
                  <Typography variant="pi" textColor="neutral600">
                    {t('modal.security.loading', 'Loading location data...')}
                  </Typography>
                </Box>
              ) : (
                <DetailsList>
                  <DetailField
                    label={t('modal.security.country', 'Country')}
                    value={[securityData.country_flag, securityData.country].filter(Boolean).join(' ') || unavailableValue}
                  />
                  <DetailField label={t('modal.security.city', 'City')} value={securityData.city || unavailableValue} />
                  <DetailField label={t('modal.security.timezone', 'Timezone')} value={securityData.timezone || unavailableValue} />
                  <DetailField
                    label={t('modal.security.score', 'Security')}
                    value={typeof securityData.securityScore === 'number'
                      ? `${securityData.securityScore}/100 (${securityData.riskLevel || unavailableValue})`
                      : unavailableValue}
                  />
                  <DetailField
                    label={t('modal.security.vpn', 'VPN')}
                    value={typeof securityData.isVpn === 'boolean'
                      ? (securityData.isVpn ? t('modal.security.vpnWarning', 'Yes') : t('modal.security.no', 'No'))
                      : unavailableValue}
                  />
                  <DetailField
                    label={t('modal.security.proxy', 'Proxy')}
                    value={typeof securityData.isProxy === 'boolean'
                      ? (securityData.isProxy ? t('modal.security.vpnWarning', 'Yes') : t('modal.security.no', 'No'))
                      : unavailableValue}
                  />
                </DetailsList>
              )}
            </Section>

            {/* User Agent - Collapsible */}
            <Section>
                <Flex justifyContent="space-between" alignItems="center" style={{ marginBottom: '12px', minWidth: 0, flexWrap: 'wrap', gap: '8px' }}>
                <Typography variant="epsilon" fontWeight="semiBold" textColor="neutral800" tag="h2">
                  {t('modal.section.technical', 'Technical Details')}
                </Typography>
                <Button
                  variant="tertiary"
                  size="S"
                  onClick={() => setShowUserAgent(!showUserAgent)}
                  aria-expanded={showUserAgent}
                  aria-controls="session-user-agent-details"
                >
                  {showUserAgent ? t('modal.technical.hide', 'Hide Details') : t('modal.technical.show', 'Show Details')}
                </Button>
              </Flex>

              <div id="session-user-agent-details" hidden={!showUserAgent}>
                {showUserAgent && (
                  <Box
                    padding={3}
                    background="neutral100"
                    hasRadius
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '12px',
                      lineHeight: 1.5,
                      overflowWrap: 'anywhere',
                      maxHeight: 'min(16rem, 30vh)',
                      overflow: 'auto',
                      marginTop: '8px',
                    }}
                  >
                    <ReadableText variant="pi" textColor="neutral600" tag="p">
                      {typeof session.userAgent === 'string' && session.userAgent.trim() && session.userAgent.trim().toLowerCase() !== 'unknown'
                        ? session.userAgent
                        : unavailableValue}
                    </ReadableText>
                  </Box>
                )}
              </div>
            </Section>
          </Box>
        </Modal.Body>

        <Modal.Footer>
          <ModalActions justifyContent="space-between">
            <Button variant="tertiary" onClick={onClose}>
              {t('modal.actions.close', 'Close')}
            </Button>
            <Button
              variant="danger-light"
              onClick={handleTerminate}
              disabled={!session.isActive || terminating}
              loading={terminating}
              startIcon={<Cross />}
            >
              {t('modal.actions.terminate', 'Terminate Session')}
            </Button>
          </ModalActions>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default SessionDetailModal;
