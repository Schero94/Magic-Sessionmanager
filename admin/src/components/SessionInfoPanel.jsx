import { useEffect, useId, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { NavLink } from 'react-router-dom';
import { Badge, Box, Button, Flex, Loader, Typography } from '@strapi/design-system';
import { CheckCircle, Lock, SignOut } from '@strapi/icons';
import { useFetchClient, useForm, useNotification, useRBAC } from '@strapi/strapi/admin';
import Alert from './PersistentAlert';
import ReadableText from './ReadableText';
import { ActionStack, ConfirmAction, DeviceIcon, StatusBadge, TargetLink } from './ui';
import { requireSessionList, requireSuccessfulMutation } from '../utils/adminResponse.mjs';
import { getManageableSessions } from '../utils/sessionFilters.mjs';
import { getDevicePresentation } from '../utils/devicePresentation.mjs';
import { toValidDate } from '../utils/sessionDates.mjs';
import { presentText } from '../utils/missingValue.mjs';
import { useSessionFormatters } from '../utils/useSessionFormatters';
import {
  applyBlockedFormSync,
  buildUserSessionsHref,
  endOpenSessions,
  getPanelUserLabel,
  getUserSessionSummary,
  getVisiblePanelSessions,
  isNotFoundError,
  isUserModel,
  planBlockedFormSync,
} from '../utils/userPanelState.mjs';
import { getTranslation } from '../utils/getTranslation';
import pluginPermissions from '../permissions';
import { logSafeAdminError } from '../utils/safeAdminLog.mjs';

const FORM_CONSUMER = 'MagicSessionManagerPanel';

/**
 * One compact open-session card: device icon and translated device type,
 * state badge (Active or Idle), "{browser} · {os}", IP address and last
 * activity. The badge is the only state signal; the activity line is neutral
 * text, so an idle session never reads as active (F3).
 *
 * @param {{session: object, t: Function}} props Session row and translator.
 * @returns {import('react').ReactElement} Session card.
 */
const PanelSessionCard = ({ session, t }) => {
  const { formatDate, formatRelativeTime, translate } = useSessionFormatters();
  const device = getDevicePresentation(session);
  const hasSummary = Boolean(device.browserLabel || device.os);
  const summary = hasSummary ? device.summary.text ?? translate(device.summary, device.summary.values) : '';
  const lastActivity = toValidDate(session.lastActive) || toValidDate(session.loginTime);
  const ipAddress = presentText(session.ipAddress);

  return (
    <Box
      tag="li"
      padding={3}
      background="neutral0"
      borderColor="neutral200"
      hasRadius
      minWidth={0}
      data-panel-session=""
    >
      <Flex gap={3} alignItems="flex-start" minWidth={0}>
        <Flex
          background="neutral100"
          color="neutral700"
          hasRadius
          padding={2}
          shrink={0}
          justifyContent="center"
          alignItems="center"
          aria-hidden
        >
          <DeviceIcon icon={device.icon} />
        </Flex>
        <Flex direction="column" alignItems="stretch" gap={1} minWidth={0} flex="1 1 auto">
          <Flex justifyContent="space-between" alignItems="center" gap={2} wrap="wrap">
            <Typography variant="omega" fontWeight="semiBold" textColor="neutral800">
              {translate(device.deviceTypeMessage)}
            </Typography>
            <StatusBadge session={session} size="S" />
          </Flex>
          {summary ? (
            <Typography variant="pi" textColor="neutral600">
              {summary}
            </Typography>
          ) : null}
          {ipAddress ? (
            <Typography variant="pi" textColor="neutral600">
              {t('panel.sessions.ip', 'IP {ip}', { ip: ipAddress })}
            </Typography>
          ) : null}
          {lastActivity ? (
            <Typography variant="pi" textColor="neutral600" title={formatDate(lastActivity)}>
              {t('panel.sessions.lastActive', 'Last active {time}', { time: formatRelativeTime(lastActivity) })}
            </Typography>
          ) : null}
        </Flex>
      </Flex>
    </Box>
  );
};

/**
 * Content Manager side panel "Sessions" for Users & Permissions users (IA D3):
 * what access the user has and how to cut it off. Summary (Online / Not
 * online, open sessions, last activity), blocked alert, "End all sessions"
 * and "Block user" (both confirmed) or "Unblock user" (not destructive, no
 * confirmation), up to five open-session cards and a link to the dashboard.
 * Renders nothing for any other model or without the plugin permission.
 * New entries get a save-first message until Strapi assigns an ID.
 */
const SessionInfoPanel = ({ documentId, model, document }) => {
  const { formatMessage } = useIntl();
  const { formatDate, formatRelativeTime } = useSessionFormatters();
  const { allowedActions: { canAccess }, isLoading: permissionsLoading } = useRBAC(pluginPermissions.access);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [isBlocked, setIsBlocked] = useState(Boolean(document?.blocked));
  const [pendingAction, setPendingAction] = useState(null);
  const [formOutOfSync, setFormOutOfSync] = useState(false);
  const panelRef = useRef(null);
  const blockToggleRef = useRef(null);
  const focusBlockToggle = useRef(false);
  const noOpenSessionsHintId = useId();
  const { get, post: postRequest } = useFetchClient();
  const { toggleNotification } = useNotification();
  // The side panels render inside the edit view <Form>. Without it, Strapi's
  // default context has no "blocked" initial value and the panel shows a notice.
  const formInitialValues = useForm(FORM_CONSUMER, (state) => state.initialValues, false);
  const formModified = useForm(FORM_CONSUMER, (state) => state.modified, false);
  const formOnChange = useForm(FORM_CONSUMER, (state) => state.onChange, false);
  const formResetForm = useForm(FORM_CONSUMER, (state) => state.resetForm, false);
  const t = (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values);

  const userId = document?.documentId || documentId;
  const isUserPanel = isUserModel(model);
  const persistedBlocked = Boolean(document?.blocked);
  const userLabel = getPanelUserLabel(document) || String(userId ?? '');

  useEffect(() => {
    setIsBlocked(persistedBlocked);
    setFormOutOfSync(false);
  }, [persistedBlocked, userId]);

  // Block and Unblock swap the button; keep keyboard focus on the new one.
  // Strapi renders the panel content one commit after this hook, the new
  // button stays disabled until the pending action is cleared, and Radix
  // focuses <body> in a zero-delay timeout when the Block dialog unmounts.
  // So the focus is moved in later timeouts, once the swapped and enabled
  // button is in the document.
  useEffect(() => {
    if (!focusBlockToggle.current || pendingAction !== null) return undefined;
    const expected = isBlocked ? 'unblock' : 'block';
    let attempts = 0;
    let timer;
    const tryFocus = () => {
      const button = blockToggleRef.current;
      if (button?.isConnected && !button.disabled && button.dataset.blockToggle === expected) {
        focusBlockToggle.current = false;
        button.focus();
        return;
      }
      attempts += 1;
      if (attempts < 20) timer = window.setTimeout(tryFocus, 25);
      else focusBlockToggle.current = false;
    };
    timer = window.setTimeout(tryFocus, 0);
    return () => window.clearTimeout(timer);
  }, [isBlocked, pendingAction]);

  useEffect(() => {
    if (model !== 'plugin::users-permissions.user' || !userId || permissionsLoading || !canAccess) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const { data } = await get(`/magic-sessionmanager/user/${userId}/sessions`);
        if (cancelled) return;
        // All rows are kept: ended ones only feed the "Last active" line.
        setSessions(requireSessionList(data));
      } catch (err) {
        if (!cancelled) setLoadError(true);
        logSafeAdminError('userSessions.load', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [userId, model, get, reloadKey, canAccess, permissionsLoading]);

  /**
   * Ends every open session of the displayed user. Runs only from the
   * ConfirmAction dialog. Errors are reported and re-thrown so the dialog
   * stays open for a retry.
   *
   * @returns {Promise<void>}
   */
  const handleEndAll = async () => {
    if (!userId) return;
    setPendingAction('endAll');
    try {
      const response = await postRequest(`/magic-sessionmanager/user/${userId}/terminate-all`);
      requireSuccessfulMutation(response.data);
      setSessions((rows) => endOpenSessions(rows, 'manual'));
      toggleNotification({
        type: 'success',
        message: t('panel.notify.endAllSuccess', 'All sessions of {user} ended.', { user: userLabel }),
      });
    } catch (error) {
      toggleNotification({
        type: 'danger',
        message: isNotFoundError(error)
          ? t('panel.notify.userNotFound', 'User not found.')
          : t('panel.notify.endAllError', 'The sessions could not be ended. Please try again.'),
      });
      logSafeAdminError('userSessions.endAll', error);
      throw error;
    } finally {
      setPendingAction(null);
    }
  };

  /**
   * Sets the user's blocked state (blocking also ends the open sessions on
   * the server), then writes the confirmed value into the open edit form so
   * a later Save cannot restore the old value (F1).
   *
   * @param {boolean} blocked Requested state.
   * @returns {Promise<boolean>} The state the server confirmed.
   */
  const changeBlocked = async (blocked) => {
    const response = await postRequest(`/magic-sessionmanager/user/${userId}/toggle-block`, { blocked });
    requireSuccessfulMutation(response.data);
    const newBlockedStatus = response.data.blocked === true;
    focusBlockToggle.current = newBlockedStatus !== isBlocked;
    setIsBlocked(newBlockedStatus);
    if (newBlockedStatus) setSessions((rows) => endOpenSessions(rows, 'blocked'));

    const plan = planBlockedFormSync({
      initialValues: formInitialValues,
      modified: formModified,
      blocked: newBlockedStatus,
    });
    const synced = applyBlockedFormSync(plan, { resetForm: formResetForm, onChange: formOnChange });
    setFormOutOfSync(!synced);
    return newBlockedStatus;
  };

  /**
   * Blocks the user. Runs only from the ConfirmAction dialog; errors are
   * reported and re-thrown so the dialog stays open for a retry.
   *
   * @returns {Promise<void>}
   */
  const handleBlock = async () => {
    if (!userId) return;
    setPendingAction('block');
    try {
      await changeBlocked(true);
      toggleNotification({
        type: 'success',
        message: t('panel.notify.blockSuccess', '{user} is blocked.', { user: userLabel }),
      });
    } catch (error) {
      toggleNotification({
        type: 'danger',
        message: isNotFoundError(error)
          ? t('panel.notify.userNotFound', 'User not found.')
          : t('panel.notify.blockError', 'The user could not be blocked. Please try again.'),
      });
      logSafeAdminError('userSessions.block', error);
      throw error;
    } finally {
      setPendingAction(null);
    }
  };

  /**
   * Unblocks the user. Not destructive, so there is no confirmation (IA E.1);
   * the button shows its own loading state and errors become a notification.
   *
   * @returns {Promise<void>}
   */
  const handleUnblock = async () => {
    if (!userId) return;
    setPendingAction('unblock');
    try {
      await changeBlocked(false);
      toggleNotification({
        type: 'success',
        message: t('panel.notify.unblockSuccess', '{user} can sign in again.', { user: userLabel }),
      });
    } catch (error) {
      toggleNotification({
        type: 'danger',
        message: isNotFoundError(error)
          ? t('panel.notify.userNotFound', 'User not found.')
          : t('panel.notify.unblockError', 'The block could not be removed. Please try again.'),
      });
      logSafeAdminError('userSessions.unblock', error);
    } finally {
      setPendingAction(null);
    }
  };

  // Only show for the Users & Permissions user content type
  if (!isUserPanel) {
    return null;
  }

  if (permissionsLoading || !canAccess) {
    return null;
  }

  const title = t('panel.title', 'Sessions');

  if (!userId) {
    return {
      title,
      content: (
        <Box width="100%" minWidth={0}>
          <ReadableText variant="omega" textColor="neutral700" tag="p">
            {t('panel.unsaved.description', 'Save this user before you can manage sessions.')}
          </ReadableText>
        </Box>
      ),
    };
  }

  if (loadError) {
    return {
      title,
      content: (
        <Box width="100%" minWidth={0}>
          <Alert
            variant="danger"
            closeLabel={t('common.close', 'Close')}
            action={(
              <Button size="S" variant="secondary" onClick={() => setReloadKey((key) => key + 1)}>
                {t('common.tryAgain', 'Try again')}
              </Button>
            )}
          >
            {t('panel.error.message', 'Sessions could not be loaded.')}
          </Alert>
        </Box>
      ),
    };
  }

  const openSessions = getManageableSessions(sessions);
  const summary = getUserSessionSummary(sessions);
  const { visible, hiddenCount } = getVisiblePanelSessions(openSessions);
  const actionsDisabled = loading || pendingAction !== null;
  const hasOpenSessions = summary.openCount > 0;
  const endAllLabel = t('panel.actions.endAll', 'End all sessions');
  const blockLabel = t('panel.actions.blockUser', 'Block user');
  const unblockLabel = t('panel.actions.unblock', 'Unblock user');

  return {
    title,
    content: (
      <Flex ref={panelRef} direction="column" alignItems="stretch" gap={4} width="100%" minWidth={0} tabIndex={-1}>
        {/* Summary */}
        {loading ? (
          <Flex justifyContent="center" padding={2} data-panel-summary="">
            <Loader small>{t('panel.loading', 'Loading sessions')}</Loader>
          </Flex>
        ) : (
          <Flex direction="column" alignItems="stretch" gap={1} data-panel-summary="">
            <Flex gap={2} alignItems="center" wrap="wrap">
              <Badge variant={summary.isOnline ? 'success' : 'neutral'} size="M">
                {summary.isOnline
                  ? t('panel.status.online', 'Online')
                  : t('panel.status.notOnline', 'Not online')}
              </Badge>
              <Typography variant="omega" fontWeight="semiBold" textColor="neutral800">
                {t(
                  'panel.summary.openCount',
                  '{count, plural, one {# open session} other {# open sessions}}',
                  { count: summary.openCount }
                )}
              </Typography>
            </Flex>
            <Typography variant="pi" textColor="neutral600">
              {t('panel.summary.openHint', 'Active or idle')}
            </Typography>
            {summary.lastActive ? (
              <Typography variant="pi" textColor="neutral600" title={formatDate(summary.lastActive)}>
                {t('panel.sessions.lastActive', 'Last active {time}', { time: formatRelativeTime(summary.lastActive) })}
              </Typography>
            ) : (
              <Typography variant="pi" textColor="neutral600">
                {t('panel.summary.noSessions', 'No sessions recorded')}
              </Typography>
            )}
          </Flex>
        )}

        {isBlocked ? (
          <Alert variant="danger" closeLabel={t('common.close', 'Close')}>
            {t('panel.blocked.message', 'This account is blocked. The user cannot sign in.')}
          </Alert>
        ) : null}

        {formOutOfSync ? (
          <Alert variant="warning" closeLabel={t('common.close', 'Close')}>
            {t('panel.form.reloadNotice', 'Reload this page before saving, or the Blocked field will be overwritten.')}
          </Alert>
        ) : null}

        {/* Action Buttons */}
        <Flex direction="column" alignItems="stretch" gap={2} data-panel-actions="">
          <ActionStack>
            <ConfirmAction
              title={t('panel.confirm.endAllTitle', 'End all sessions of {user}?', { user: userLabel })}
              body={t(
                'panel.confirm.endAllBody',
                '{count, plural, one {# open session ends} other {# open sessions end}} on all devices. {user} can sign in again unless you also block the account.',
                { count: summary.openCount, user: userLabel }
              )}
              confirmLabel={endAllLabel}
              onConfirm={handleEndAll}
              fallbackFocusRef={panelRef}
              disabled={actionsDisabled || !hasOpenSessions}
              trigger={(
                <Button
                  fullWidth
                  size="S"
                  variant="danger-light"
                  startIcon={<SignOut aria-hidden focusable={false} />}
                  loading={pendingAction === 'endAll'}
                  disabled={actionsDisabled || !hasOpenSessions}
                  aria-describedby={!loading && !hasOpenSessions ? noOpenSessionsHintId : undefined}
                  type="button"
                >
                  {endAllLabel}
                </Button>
              )}
            />
            {isBlocked ? (
              <Button
                ref={blockToggleRef}
                data-block-toggle="unblock"
                fullWidth
                size="S"
                variant="secondary"
                startIcon={<CheckCircle aria-hidden focusable={false} />}
                loading={pendingAction === 'unblock'}
                disabled={actionsDisabled}
                onClick={handleUnblock}
                type="button"
              >
                {unblockLabel}
              </Button>
            ) : (
              <ConfirmAction
                title={t('panel.confirm.blockTitle', 'Block {user}?', { user: userLabel })}
                body={t(
                  'panel.confirm.blockBody',
                  '{user} can no longer sign in, and {count, plural, =0 {no open sessions are affected} one {# open session ends now} other {# open sessions end now}}. You can unblock the account later; ended sessions stay ended.',
                  { count: summary.openCount, user: userLabel }
                )}
                confirmLabel={blockLabel}
                onConfirm={handleBlock}
                fallbackFocusRef={panelRef}
                disabled={actionsDisabled}
                trigger={(
                  <Button
                    ref={blockToggleRef}
                    data-block-toggle="block"
                    fullWidth
                    size="S"
                    variant="danger-light"
                    startIcon={<Lock aria-hidden focusable={false} />}
                    loading={pendingAction === 'block'}
                    disabled={actionsDisabled}
                    type="button"
                  >
                    {blockLabel}
                  </Button>
                )}
              />
            )}
          </ActionStack>
          {!loading && !hasOpenSessions ? (
            <Typography id={noOpenSessionsHintId} variant="pi" textColor="neutral600">
              {t('panel.actions.noOpenSessions', 'No open sessions')}
            </Typography>
          ) : null}
          <ReadableText variant="pi" textColor="neutral600" tag="p">
            {t(
              'panel.actions.hint',
              'End all sessions lets the user sign in again. Block user also prevents new sign-ins.'
            )}
          </ReadableText>
        </Flex>

        {/* Open sessions */}
        {loading ? null : (
          <Flex direction="column" alignItems="stretch" gap={2} data-panel-sessions="">
            <Typography variant="sigma" textColor="neutral600" tag="h3">
              {t('panel.sessions.openTitle', 'Open sessions')}
            </Typography>
            {visible.length > 0 ? (
              <Flex tag="ul" direction="column" alignItems="stretch" gap={2} margin={0} padding={0} style={{ listStyle: 'none' }}>
                {visible.map((session) => (
                  <PanelSessionCard key={session.id} session={session} t={t} />
                ))}
              </Flex>
            ) : (
              <Box padding={3} background="neutral0" borderColor="neutral200" hasRadius>
                <ReadableText variant="omega" textColor="neutral800" tag="p">
                  {t(
                    'panel.empty.noOpenSessions',
                    'No open sessions. {user} is not signed in on any device.',
                    { user: userLabel }
                  )}
                </ReadableText>
              </Box>
            )}
            {hiddenCount > 0 ? (
              <Typography variant="pi" textColor="neutral600">
                {t('panel.sessions.more', '{count, plural, other {+# more}}', { count: hiddenCount })}
              </Typography>
            ) : null}
          </Flex>
        )}

        <TargetLink tag={NavLink} to={buildUserSessionsHref(document)}>
          {t('panel.sessions.showAllLink', 'Show all sessions')}
        </TargetLink>
      </Flex>
    ),
  };
};

export default SessionInfoPanel;
