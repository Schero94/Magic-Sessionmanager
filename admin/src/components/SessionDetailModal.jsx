import { useEffect, useId, useState } from 'react';
import { useIntl } from 'react-intl';
import { Badge, Box, Button, Flex, IconButton, Loader, Modal, Typography } from '@strapi/design-system';
import { Duplicate, SignOut } from '@strapi/icons';
import { useClipboard, useFetchClient, useNotification } from '@strapi/strapi/admin';
import pluginId from '../pluginId';
import { getTranslation } from '../utils/getTranslation';
import { getSessionStatus } from '../utils/sessionStatus.mjs';
import { getDevicePresentation } from '../utils/devicePresentation.mjs';
import { presentText } from '../utils/missingValue.mjs';
import { toValidDate } from '../utils/sessionDates.mjs';
import {
  RISK_LEVEL_MESSAGES,
  RISK_LEVEL_TONES,
  getStoredGeoData,
  normalizeGeoData,
} from '../utils/sessionSecurity.mjs';
import { useSessionFormatters } from '../utils/useSessionFormatters';
import { logSafeAdminError } from '../utils/safeAdminLog.mjs';
import { ConfirmAction, DeviceIcon, PropertyList, StatusBadge } from './ui';
import ReadableText from './ReadableText';

/**
 * One titled block of label/value pairs inside the dialog body.
 *
 * @param {{title: import('react').ReactNode, action?: import('react').ReactNode, children: import('react').ReactNode}} props Section content.
 * @returns {import('react').ReactElement} Section with an h3 heading.
 */
const DetailSection = ({ title, action, children }) => (
  <Flex tag="section" direction="column" alignItems="stretch" gap={3} minWidth={0}>
    <Flex justifyContent="space-between" alignItems="center" gap={2} wrap="wrap">
      <Typography variant="delta" tag="h3" textColor="neutral800">
        {title}
      </Typography>
      {action}
    </Flex>
    {children}
  </Flex>
);

/**
 * Session detail dialog: status, user, session timeline, device, location and
 * security, and technical details with a copyable session ID. Logging out is
 * confirmed through ConfirmAction and disabled, with a reason, once the session
 * has ended. Uses the same status, date, device and missing-value vocabulary
 * as the dashboard table (DUX-03, DASH-10).
 *
 * @param {object} props
 * @param {object} props.session Session row from the dashboard.
 * @param {() => void} props.onClose Closes the dialog.
 * @param {(event: Event) => void} [props.onCloseAutoFocus] Restores focus to the opener.
 * @param {() => void} props.onSessionTerminated Refreshes the dashboard after a logout.
 * @returns {import('react').ReactElement|null} Dialog.
 */
const SessionDetailModal = ({ session, onClose, onCloseAutoFocus, onSessionTerminated }) => {
  const { formatMessage } = useIntl();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const { copy } = useClipboard();
  const { formatDate, deviceTypeLabel, endReasonLabel } = useSessionFormatters();
  const [showUserAgent, setShowUserAgent] = useState(false);
  const [geoData, setGeoData] = useState(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const endedReasonId = `session-ended-reason-${useId().replace(/:/g, '')}`;
  const t = (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values);

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
          setGeoData(normalizeGeoData(data?.data));
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

  const status = getSessionStatus(session);
  const device = getDevicePresentation(session);
  const canLogOut = session.isActive === true;
  const userAgent = presentText(session.userAgent);
  const sessionId = presentText(session.id);

  // Do not infer location or security values when the session has no GeoIP data.
  const securityData = geoData || {
    country: null,
    city: null,
    timezone: null,
    securityScore: null,
    riskLevel: '',
    isVpn: null,
    isProxy: null,
  };

  /**
   * Logs the session out after ConfirmAction confirmed it. Rethrows on failure
   * so the confirmation stays open; the notification explains the failure.
   *
   * @returns {Promise<void>}
   */
  const handleTerminate = async () => {
    try {
      await post(`/${pluginId}/sessions/${session.id}/terminate`);
    } catch (err) {
      logSafeAdminError('sessionDetails.terminate', err);
      toggleNotification({
        type: 'danger',
        message: t('notifications.error.terminate', 'Failed to terminate session'),
      });
      throw err;
    }

    toggleNotification({
      type: 'success',
      message: t('notifications.success.terminated', 'Session terminated successfully'),
    });
    onSessionTerminated();
    onClose();
  };

  /**
   * Copies the session ID through Strapi's clipboard hook and reports the result.
   *
   * @returns {Promise<void>}
   */
  const handleCopyId = async () => {
    const copied = sessionId ? await copy(sessionId) : false;
    toggleNotification({
      type: copied ? 'success' : 'danger',
      message: copied
        ? t('modal.copy.success', 'Session ID copied')
        : t('modal.copy.error', 'The session ID could not be copied.'),
    });
  };

  const formatTimestamp = (value) => (toValidDate(value) ? formatDate(value) : null);
  const idleMinutes = Number(session.minutesSinceActive);
  const idleTimeValue = session.minutesSinceActive !== null
    && session.minutesSinceActive !== undefined
    && Number.isFinite(idleMinutes)
    ? t('modal.timeline.minutes', '{minutes} min', { minutes: idleMinutes })
    : null;

  const yesNoBadge = (value) => (typeof value === 'boolean' ? (
    <Badge variant={value ? 'warning' : 'neutral'} size="S">
      {value ? t('common.yes', 'Yes') : t('common.no', 'No')}
    </Badge>
  ) : undefined);

  const riskMessage = RISK_LEVEL_MESSAGES[securityData.riskLevel];
  const securityScoreRender = typeof securityData.securityScore === 'number' ? (
    <Flex gap={2} alignItems="center" wrap="wrap">
      <Typography variant="omega" textColor="neutral800">
        {t('modal.security.scoreValue', '{score}/100', { score: securityData.securityScore })}
      </Typography>
      {riskMessage ? (
        <Badge variant={RISK_LEVEL_TONES[securityData.riskLevel]} size="S">
          {t(riskMessage.messageId, riskMessage.defaultMessage)}
        </Badge>
      ) : null}
    </Flex>
  ) : undefined;

  return (
    <Modal.Root open onOpenChange={onClose}>
      <Modal.Content onCloseAutoFocus={onCloseAutoFocus} aria-describedby={undefined}>
        <Modal.Header closeLabel={t('common.close', 'Close')}>
          <Flex gap={3} alignItems="center" wrap="wrap" minWidth={0}>
            <Flex padding={2} background="neutral100" hasRadius shrink={0} aria-hidden>
              <DeviceIcon icon={device.icon} />
            </Flex>
            <Modal.Title>{t('modal.title', 'Session Details')}</Modal.Title>
            <StatusBadge session={session} status={status} size="S" />
          </Flex>
        </Modal.Header>

        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={6} minWidth={0}>
            <DetailSection title={t('modal.section.user', 'User')}>
              <PropertyList
                items={[
                  { id: 'username', label: t('modal.user.username', 'Username'), value: session.user?.username },
                  { id: 'email', label: t('modal.user.email', 'Email'), value: session.user?.email, kind: 'email' },
                  {
                    id: 'userId',
                    label: t('modal.user.id', 'User ID'),
                    value: session.user?.documentId || session.user?.id,
                    kind: 'id',
                  },
                ]}
              />
            </DetailSection>

            <DetailSection title={t('modal.section.session', 'Session')}>
              <PropertyList
                items={[
                  { id: 'login', label: t('modal.timeline.login', 'Login'), value: formatTimestamp(session.loginTime) },
                  {
                    id: 'lastActive',
                    label: t('modal.timeline.lastActive', 'Last Active'),
                    value: formatTimestamp(session.lastActive || session.loginTime),
                  },
                  { id: 'idle', label: t('modal.timeline.idleTime', 'Idle Time'), value: idleTimeValue },
                  session.logoutTime
                    ? { id: 'logout', label: t('modal.timeline.logout', 'Logout'), value: formatTimestamp(session.logoutTime) }
                    : null,
                  !canLogOut
                    ? { id: 'endReason', label: t('modal.timeline.endReason', 'End reason'), value: endReasonLabel(session) }
                    : null,
                ]}
              />
            </DetailSection>

            <DetailSection title={t('modal.section.device', 'Device')}>
              <PropertyList
                items={[
                  { id: 'device', label: t('modal.device.device', 'Device'), value: deviceTypeLabel(session) },
                  { id: 'browser', label: t('modal.device.browser', 'Browser'), value: [device.browser, device.browserVersion].filter(Boolean).join(' ') },
                  { id: 'os', label: t('modal.device.os', 'OS'), value: device.os },
                  { id: 'ip', label: t('modal.device.ip', 'IP'), value: session.ipAddress, kind: 'id' },
                ]}
              />
            </DetailSection>

            <DetailSection title={t('modal.section.security', 'Location and Security')}>
              {geoLoading ? (
                <Flex justifyContent="center" padding={4}>
                  <Loader small role="status" aria-live="polite">
                    {t('modal.security.loading', 'Loading location data...')}
                  </Loader>
                </Flex>
              ) : (
                <PropertyList
                  items={[
                    { id: 'country', label: t('modal.security.country', 'Country'), value: securityData.country },
                    { id: 'city', label: t('modal.security.city', 'City'), value: securityData.city },
                    { id: 'timezone', label: t('modal.security.timezone', 'Timezone'), value: securityData.timezone },
                    { id: 'score', label: t('modal.security.score', 'Security'), render: securityScoreRender },
                    { id: 'vpn', label: t('modal.security.vpn', 'VPN'), render: yesNoBadge(securityData.isVpn) },
                    { id: 'proxy', label: t('modal.security.proxy', 'Proxy'), render: yesNoBadge(securityData.isProxy) },
                  ]}
                />
              )}
            </DetailSection>

            <DetailSection
              title={t('modal.section.technical', 'Technical Details')}
              action={userAgent ? (
                <Button
                  variant="tertiary"
                  size="S"
                  onClick={() => setShowUserAgent(!showUserAgent)}
                  aria-expanded={showUserAgent}
                  aria-controls="session-user-agent-details"
                >
                  {showUserAgent ? t('modal.technical.hide', 'Hide Details') : t('modal.technical.show', 'Show Details')}
                </Button>
              ) : null}
            >
              <PropertyList
                columns={1}
                items={[
                  {
                    id: 'sessionId',
                    label: t('modal.technical.sessionId', 'Session ID'),
                    value: sessionId,
                    kind: 'id',
                    render: sessionId ? (
                      <Flex gap={2} alignItems="center" minWidth={0}>
                        <Typography variant="omega" textColor="neutral800" style={{ overflowWrap: 'anywhere', minWidth: 0 }}>
                          {sessionId}
                        </Typography>
                        <IconButton label={t('modal.actions.copyId', 'Copy session ID')} onClick={handleCopyId}>
                          <Duplicate />
                        </IconButton>
                      </Flex>
                    ) : undefined,
                  },
                  !userAgent
                    ? { id: 'userAgent', label: t('modal.technical.userAgent', 'User agent'), value: null }
                    : null,
                ]}
              />
              <div id="session-user-agent-details" hidden={!showUserAgent}>
                {showUserAgent && userAgent ? (
                  <Box padding={3} background="neutral100" hasRadius style={{ overflowWrap: 'anywhere', fontFamily: 'monospace' }}>
                    <ReadableText variant="pi" textColor="neutral700" tag="p">
                      {userAgent}
                    </ReadableText>
                  </Box>
                ) : null}
              </div>
            </DetailSection>
          </Flex>
        </Modal.Body>

        <Modal.Footer>
          <Flex justifyContent="space-between" alignItems="center" gap={3} wrap="wrap" width="100%">
            <Modal.Close>
              <Button variant="tertiary">{t('modal.actions.close', 'Close')}</Button>
            </Modal.Close>
            <Flex gap={3} alignItems="center" justifyContent="flex-end" wrap="wrap" flex="1 1 auto">
              {!canLogOut ? (
                <Typography id={endedReasonId} variant="pi" textColor="neutral600">
                  {t('modal.actions.alreadyEnded', 'This session has already ended and cannot be logged out.')}
                </Typography>
              ) : null}
              <ConfirmAction
                title={t('modal.actions.terminate', 'Log out session')}
                body={t('modal.confirm.terminate', 'Log out this device session? Other sessions will stay active.')}
                confirmLabel={t('modal.actions.terminate', 'Log out session')}
                onConfirm={handleTerminate}
                disabled={!canLogOut}
                trigger={(
                  <Button
                    variant="danger-light"
                    startIcon={<SignOut />}
                    disabled={!canLogOut}
                    aria-describedby={!canLogOut ? endedReasonId : undefined}
                  >
                    {t('modal.actions.terminate', 'Log out session')}
                  </Button>
                )}
              />
            </Flex>
          </Flex>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default SessionDetailModal;
