import { useEffect, useId, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { NavLink } from 'react-router-dom';
import {
  Accordion,
  Box,
  Button,
  Flex,
  IconButton,
  Link,
  Loader,
  Modal,
  Typography,
} from '@strapi/design-system';
import { Cross, Duplicate, Earth } from '@strapi/icons';
import styled from 'styled-components';
import { useClipboard, useFetchClient, useNotification } from '@strapi/strapi/admin';
import pluginId from '../pluginId';
import { getTranslation } from '../utils/getTranslation';
import {
  getSessionEndReasonPresentation,
  getSessionStatus,
  isNativeOnlySession,
} from '../utils/sessionStatus.mjs';
import { getDevicePresentation } from '../utils/devicePresentation.mjs';
import { presentText } from '../utils/missingValue.mjs';
import { toValidDate } from '../utils/sessionDates.mjs';
import {
  RISK_LEVEL_MESSAGES,
  getStoredGeoData,
  interpretLookupResult,
} from '../utils/sessionSecurity.mjs';
import { useSessionFormatters } from '../utils/useSessionFormatters';
import { logSafeAdminError } from '../utils/safeAdminLog.mjs';
import { getSessionUserLabels, getUserEditPath } from '../pages/Dashboard/dashboardModel.mjs';
import { ConfirmAction, DeviceIcon, EndReason, PropertyList, StatusBadge } from './ui';
import Alert from './PersistentAlert';
import ReadableText from './ReadableText';

/**
 * Inline "Open user" link with a 32 px touch target below the DS medium
 * breakpoint and a 24 px hit area from medium (WCAG 2.5.8), without changing
 * how the text sits on the line.
 */
const TargetLink = styled(Link)`
  min-height: 3.2rem;
  display: inline-flex;
  align-items: center;

  ${({ theme }) => theme.breakpoints.medium} {
    min-height: 2.4rem;
  }
`;

/** Monospace identifiers (IA H.13). */
const MONOSPACE = { fontFamily: 'monospace', overflowWrap: 'anywhere', minWidth: 0 };

/**
 * One titled block of label/value pairs inside the dialog body.
 *
 * @param {{title: import('react').ReactNode, children: import('react').ReactNode}} props Section content.
 * @returns {import('react').ReactElement} Section with an h3 heading.
 */
const DetailSection = ({ title, children }) => (
  <Flex tag="section" direction="column" alignItems="stretch" gap={3} minWidth={0}>
    <Typography variant="delta" tag="h3" textColor="neutral800">
      {title}
    </Typography>
    {children}
  </Flex>
);

/**
 * Minutes since the last request: the server value, else derived from the
 * row's last activity.
 *
 * @param {object} session Session row.
 * @param {number} now Reference time.
 * @returns {number|null} Whole minutes or null.
 */
const getMinutesSinceActive = (session, now) => {
  const fromServer = Number(session.minutesSinceActive);
  if (
    session.minutesSinceActive !== null &&
    session.minutesSinceActive !== undefined &&
    Number.isFinite(fromServer)
  ) {
    return fromServer;
  }
  const last = toValidDate(session.lastActive || session.loginTime);
  return last ? Math.max(0, Math.floor((now - last.getTime()) / 60000)) : null;
};

/**
 * Session details dialog (IA D2): what is this session, and why is it in this
 * state? A plain-language state sentence, then User, Session, Device and
 * Location and security, and collapsed Technical details. The location is
 * looked up only on request, with a privacy hint, so opening the dialog never
 * sends an IP address anywhere (decision I.2-7). The footer offers End
 * session for open rows only; ended rows say so instead.
 *
 * @param {object} props
 * @param {object} props.session Session row from the dashboard.
 * @param {() => void} props.onClose Closes the dialog.
 * @param {(event: Event) => void} [props.onCloseAutoFocus] Restores focus to the opener.
 * @param {(session: object) => Promise<void>} props.onEndSession Ends the session (notifies and refreshes); throws on failure.
 * @returns {import('react').ReactElement|null} Dialog.
 */
const SessionDetailModal = ({ session, onClose, onCloseAutoFocus, onEndSession }) => {
  const { formatMessage } = useIntl();
  const { get } = useFetchClient();
  const { toggleNotification } = useNotification();
  const { copy } = useClipboard();
  const { formatDate, formatRelativeTime, deviceTypeLabel, deviceSummary } = useSessionFormatters();
  const [lookup, setLookup] = useState({ status: 'idle', geo: null });
  const lookupRequest = useRef(0);
  const endedReasonId = `session-ended-reason-${useId().replace(/:/g, '')}`;
  const t = (id, defaultMessage, values) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);

  // A different row starts without a previous lookup result.
  useEffect(() => {
    lookupRequest.current += 1;
    setLookup({ status: 'idle', geo: null });
  }, [session?.id]);

  if (!session) return null;

  const status = getSessionStatus(session);
  const device = getDevicePresentation(session);
  const canEnd = session.isActive === true;
  const native = isNativeOnlySession(session);
  const userAgent = presentText(session.userAgent);
  const sessionId = presentText(session.id);
  const ipAddress = presentText(session.ipAddress);
  const user = getSessionUserLabels(session);
  const userEditPath = getUserEditPath(session);
  const storedGeo = getStoredGeoData(session);
  const liveGeo = lookup.status === 'ok' ? lookup.geo : null;
  const geo = liveGeo || storedGeo;
  const now = Date.now();
  const minutes = getMinutesSinceActive(session, now);
  const reason = getSessionEndReasonPresentation(session);
  const translate = (descriptor, values) =>
    formatMessage(
      { id: getTranslation(descriptor.messageId), defaultMessage: descriptor.defaultMessage },
      values
    );
  const formatTimestamp = (value) => (toValidDate(value) ? formatDate(value) : null);

  /**
   * Looks the IP address up on demand (GET /geolocation/:ip). The result is
   * shown only; nothing is stored from the dialog.
   *
   * @returns {Promise<void>}
   */
  const handleLookup = async () => {
    if (!ipAddress) return;
    const requestId = lookupRequest.current + 1;
    lookupRequest.current = requestId;
    setLookup({ status: 'loading', geo: null });
    try {
      const { data } = await get(`/${pluginId}/geolocation/${encodeURIComponent(ipAddress)}`);
      if (requestId !== lookupRequest.current) return;
      setLookup(interpretLookupResult(data));
    } catch (err) {
      logSafeAdminError('sessionDetails.geolocation', err);
      if (requestId === lookupRequest.current) setLookup({ status: 'failed', geo: null });
    }
  };

  /**
   * Ends the session after ConfirmAction confirmed it. The dashboard handler
   * notifies and refreshes the list; a failure keeps the confirmation open.
   *
   * @returns {Promise<void>}
   */
  const handleTerminate = async () => {
    await onEndSession(session);
    onClose();
  };

  /**
   * Copies the record ID through Strapi's clipboard hook and reports the result.
   *
   * @returns {Promise<void>}
   */
  const handleCopyId = async () => {
    const copied = sessionId ? await copy(sessionId) : false;
    toggleNotification({
      type: copied ? 'success' : 'danger',
      message: copied
        ? t('modal.copy.success', 'Record ID copied.')
        : t('modal.copy.error', 'The record ID could not be copied.'),
    });
  };

  const stateSentence = () => {
    if (status === 'active') {
      return (
        <Typography variant="omega" textColor="neutral800">
          {t('modal.state.active', 'Active. Last request {time}.', {
            time: formatRelativeTime(session.lastActive || session.loginTime),
          })}
        </Typography>
      );
    }
    if (status === 'idle') {
      return (
        <Alert variant="warning" closeLabel={t('common.close', 'Close')}>
          <ReadableText variant="omega" tag="span">
            {t(
              'modal.state.idle',
              'Not used for {minutes} min. It ends on its next request or at the next idle check.',
              {
                minutes: minutes ?? 0,
              }
            )}
          </ReadableText>
        </Alert>
      );
    }
    const endedAt = formatTimestamp(session.logoutTime);
    return (
      <Flex direction="column" alignItems="stretch" gap={1}>
        <Typography variant="omega" textColor="neutral800">
          {endedAt
            ? t('modal.state.ended', 'Ended {endedAt} · {reason}.', {
                endedAt,
                reason: translate(reason),
              })
            : t('modal.state.endedNoTime', 'Ended · {reason}.', { reason: translate(reason) })}
        </Typography>
        <Typography variant="pi" textColor="neutral600">
          {translate(reason.description)}
        </Typography>
      </Flex>
    );
  };

  // Plain text: danger colour is reserved for destructive actions and the
  // blocked-user alert (IA B.3), and the DS danger badge fails AA (3.9:1).
  const yesNoText = (value) =>
    typeof value === 'boolean' ? (
      <Typography variant="omega" textColor="neutral800">
        {value ? t('common.yes', 'Yes') : t('common.no', 'No')}
      </Typography>
    ) : undefined;

  const notStoredForPast = (
    <Typography variant="omega" textColor="neutral600">
      {t('modal.security.notStored', 'Not stored for past sign-ins')}
    </Typography>
  );

  const score =
    typeof geo?.securityScore === 'number'
      ? geo.securityScore
      : typeof session.securityScore === 'number' && Number.isFinite(session.securityScore)
        ? session.securityScore
        : null;
  const riskMessage = liveGeo ? RISK_LEVEL_MESSAGES[liveGeo.riskLevel] : null;

  const locationItems = [
    { id: 'country', label: t('modal.security.country', 'Country'), value: geo?.country },
    { id: 'city', label: t('modal.security.city', 'City'), value: geo?.city },
    { id: 'timezone', label: t('modal.security.timezone', 'Time zone'), value: geo?.timezone },
    {
      id: 'score',
      label: t('modal.security.score', 'Security score'),
      value: score === null ? null : t('modal.security.scoreValue', '{score}/100', { score }),
    },
    {
      id: 'vpn',
      label: t('modal.security.vpn', 'VPN'),
      render: liveGeo ? yesNoText(liveGeo.isVpn) : storedGeo ? notStoredForPast : undefined,
    },
    {
      id: 'proxy',
      label: t('modal.security.proxy', 'Proxy'),
      render: liveGeo ? yesNoText(liveGeo.isProxy) : storedGeo ? notStoredForPast : undefined,
    },
    riskMessage
      ? {
          id: 'risk',
          label: t('modal.security.riskLevel', 'Risk level'),
          value: translate(riskMessage),
          fullWidth: true,
        }
      : null,
  ];

  // Without any stored or looked-up data the list would only repeat "—", so
  // the section shows the on-demand lookup alone (IA D2.6).
  const canLookUp = !geo && Boolean(ipAddress) && !native;
  const hasLocationData = Boolean(geo) || score !== null || !canLookUp;

  const lookupControls = canLookUp ? (
    <Flex direction="column" alignItems="flex-start" gap={2}>
      {lookup.status === 'loading' ? (
        <Loader small role="status" aria-live="polite">
          {t('modal.security.loading', 'Looking up the location')}
        </Loader>
      ) : (
        <Button variant="secondary" size="S" startIcon={<Earth />} onClick={handleLookup}>
          {t('modal.security.lookup', 'Look up location')}
        </Button>
      )}
      <Typography variant="pi" textColor="neutral600">
        {t(
          'modal.security.lookupHint',
          'Sends the IP address to the configured lookup service, which can be ipapi.co.'
        )}
      </Typography>
      {lookup.status === 'disabled' ? (
        <Typography variant="pi" textColor="neutral800" role="status">
          {t('modal.security.lookupOff', 'IP location lookup is off.')}
        </Typography>
      ) : null}
      {lookup.status === 'failed' ? (
        <Typography variant="pi" textColor="danger600" role="status">
          {t('modal.security.lookupFailed', 'The location could not be determined.')}
        </Typography>
      ) : null}
    </Flex>
  ) : null;

  return (
    <Modal.Root open onOpenChange={onClose}>
      <Modal.Content onCloseAutoFocus={onCloseAutoFocus} aria-describedby={undefined}>
        <Modal.Header closeLabel={t('common.close', 'Close')}>
          <Flex gap={3} alignItems="center" wrap="wrap" minWidth={0}>
            <Flex padding={2} background="neutral100" hasRadius shrink={0} aria-hidden>
              <DeviceIcon icon={device.icon} />
            </Flex>
            <Modal.Title>{t('modal.title', 'Session details')}</Modal.Title>
            <StatusBadge session={session} status={status} size="S" />
          </Flex>
        </Modal.Header>

        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={6} minWidth={0}>
            <Flex direction="column" alignItems="stretch" gap={2} data-state-sentence="">
              {stateSentence()}
              {canEnd ? (
                <Typography variant="pi" textColor="neutral600">
                  {t(
                    'modal.state.maxAgeNote',
                    'Sessions older than the maximum session age end on their next request.'
                  )}
                </Typography>
              ) : null}
            </Flex>

            <DetailSection title={t('modal.section.user', 'User')}>
              <PropertyList
                items={[
                  {
                    id: 'username',
                    label: t('modal.user.username', 'Username'),
                    value: session.user?.username,
                    render:
                      presentText(session.user?.username) && userEditPath ? (
                        <Flex gap={2} alignItems="baseline" wrap="wrap">
                          <Typography variant="omega" textColor="neutral800">
                            {session.user.username}
                          </Typography>
                          <TargetLink
                            tag={NavLink}
                            to={userEditPath}
                            aria-label={t('modal.user.openFor', 'Open user {user}', {
                              user: user.accessible,
                            })}
                          >
                            {t('modal.user.open', 'Open user')}
                          </TargetLink>
                        </Flex>
                      ) : undefined,
                  },
                  {
                    id: 'email',
                    label: t('modal.user.email', 'Email'),
                    value: session.user?.email,
                    kind: 'email',
                  },
                ]}
              />
            </DetailSection>

            <DetailSection title={t('modal.section.session', 'Session')}>
              <PropertyList
                items={[
                  {
                    id: 'login',
                    label: t('modal.timeline.signedIn', 'Signed in'),
                    value: formatTimestamp(session.loginTime),
                  },
                  {
                    id: 'lastActive',
                    label: t('modal.timeline.lastActive', 'Last active'),
                    value: formatTimestamp(session.lastActive || session.loginTime),
                  },
                  !canEnd
                    ? {
                        id: 'endedAt',
                        label: t('modal.timeline.endedAt', 'Ended at'),
                        value: formatTimestamp(session.logoutTime),
                      }
                    : null,
                  !canEnd
                    ? {
                        id: 'endReason',
                        label: t('modal.timeline.endReason', 'End reason'),
                        render: <EndReason session={session} />,
                      }
                    : null,
                ]}
              />
            </DetailSection>

            <DetailSection title={t('modal.section.device', 'Device')}>
              <PropertyList
                items={[
                  {
                    id: 'device',
                    label: t('modal.device.device', 'Device type'),
                    value: native ? null : deviceTypeLabel(session),
                  },
                  {
                    id: 'browser',
                    label: t('modal.device.browser', 'Browser'),
                    value: device.browser,
                  },
                  { id: 'os', label: t('modal.device.os', 'Operating system'), value: device.os },
                  {
                    id: 'ip',
                    label: t('modal.device.ip', 'IP address'),
                    value: session.ipAddress,
                    kind: 'id',
                    render: ipAddress ? (
                      <Typography variant="omega" textColor="neutral800" style={MONOSPACE}>
                        {ipAddress}
                      </Typography>
                    ) : undefined,
                  },
                ]}
              />
            </DetailSection>

            <DetailSection title={t('modal.section.security', 'Location and security')}>
              {hasLocationData ? <PropertyList items={locationItems} /> : null}
              {score !== null ? (
                <Typography variant="pi" textColor="neutral600" data-score-note="">
                  {t(
                    'modal.security.scoreNote',
                    'Higher is safer. Below 70 can trigger a suspicious-sign-in email and below 50 a rejection, if those settings are on. Local database results are always 100.'
                  )}
                </Typography>
              ) : null}
              {lookupControls}
            </DetailSection>

            <Accordion.Root collapsible size="S">
              <Accordion.Item value="technical">
                <Accordion.Header>
                  <Accordion.Trigger>
                    {t('modal.section.technical', 'Technical details')}
                  </Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Content>
                  <Box padding={4}>
                    <Flex direction="column" alignItems="stretch" gap={4}>
                      {native ? (
                        <Typography variant="pi" textColor="neutral600">
                          {t(
                            'common.status.nativeSession.help',
                            'Created by Strapi’s own session store. No device or location details were recorded.'
                          )}
                        </Typography>
                      ) : null}
                      <PropertyList
                        columns={1}
                        items={[
                          {
                            id: 'sessionId',
                            label: t('modal.technical.recordId', 'Record ID'),
                            value: sessionId,
                            kind: 'id',
                            render: sessionId ? (
                              <Flex gap={2} alignItems="center" minWidth={0}>
                                <Typography
                                  variant="omega"
                                  textColor="neutral800"
                                  style={MONOSPACE}
                                >
                                  {sessionId}
                                </Typography>
                                <IconButton
                                  label={t('modal.actions.copyId', 'Copy record ID')}
                                  onClick={handleCopyId}
                                >
                                  <Duplicate />
                                </IconButton>
                              </Flex>
                            ) : undefined,
                          },
                          {
                            id: 'userId',
                            label: t('modal.user.id', 'User ID'),
                            value: session.user?.documentId || session.user?.id,
                            kind: 'id',
                          },
                          {
                            id: 'userAgent',
                            label: t('modal.technical.userAgent', 'User agent'),
                            value: userAgent || null,
                            kind: 'id',
                          },
                        ]}
                      />
                    </Flex>
                  </Box>
                </Accordion.Content>
              </Accordion.Item>
            </Accordion.Root>
          </Flex>
        </Modal.Body>

        <Modal.Footer>
          <Flex
            justifyContent="space-between"
            alignItems="center"
            gap={3}
            wrap="wrap-reverse"
            width="100%"
          >
            <Modal.Close>
              <Button variant="tertiary">{t('modal.actions.close', 'Close')}</Button>
            </Modal.Close>
            {canEnd ? (
              <ConfirmAction
                title={t('homepage.confirm.end.title', 'End this session?')}
                body={t(
                  'homepage.confirm.end.body',
                  '{user} will be signed out on {device}. Their other sessions stay open. The record stays in the history. This cannot be undone.',
                  {
                    user: user.accessible,
                    device: deviceSummary(session) || deviceTypeLabel(session),
                  }
                )}
                confirmLabel={t('homepage.actions.end', 'End session')}
                onConfirm={handleTerminate}
                disabled={!canEnd}
                trigger={
                  <Button variant="danger-light" startIcon={<Cross />} disabled={!canEnd}>
                    {t('homepage.actions.end', 'End session')}
                  </Button>
                }
              />
            ) : (
              <Typography id={endedReasonId} variant="pi" textColor="neutral600">
                {t('modal.actions.alreadyEnded', 'This session has already ended.')}
              </Typography>
            )}
          </Flex>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default SessionDetailModal;
