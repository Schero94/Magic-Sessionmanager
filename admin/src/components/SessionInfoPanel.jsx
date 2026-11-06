import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { NavLink } from 'react-router-dom';
import { Badge, Box, Button, Flex, Link, Loader, Typography } from '@strapi/design-system';
import { CheckCircle, Lock, SignOut } from '@strapi/icons';
import { useFetchClient, useForm, useNotification, useRBAC } from '@strapi/strapi/admin';
import Alert from './PersistentAlert';
import ReadableText from './ReadableText';
import { ConfirmAction, DeviceIcon, StatusBadge } from './ui';
import { requireSessionList, requireSuccessfulMutation } from '../utils/adminResponse.mjs';
import { getManageableSessions } from '../utils/sessionFilters.mjs';
import { getDevicePresentation } from '../utils/devicePresentation.mjs';
import { toValidDate } from '../utils/sessionDates.mjs';
import { presentText } from '../utils/missingValue.mjs';
import { useSessionFormatters } from '../utils/useSessionFormatters';
import {
  applyBlockedFormSync,
  buildUserSessionsHref,
  getUserSessionSummary,
  getVisiblePanelSessions,
  isUserModel,
  planBlockedFormSync,
} from '../utils/userPanelState.mjs';
import { getTranslation } from '../utils/getTranslation';
import pluginPermissions from '../permissions';
import { logSafeAdminError } from '../utils/safeAdminLog.mjs';

const FORM_CONSUMER = 'MagicSessionManagerPanel';

/**
 * One compact session card: device icon and translated type, status badge,
 * browser and OS, IP address and last activity. The status badge is the only
 * status signal; the activity line is neutral text so an idle session never
 * reads as "active" (F3).
 *
 * @param {{session: object, t: Function}} props Session row and translator.
 * @returns {import('react').ReactElement} Session card.
 */
const PanelSessionCard = ({ session, t }) => {
  const { formatDate, formatRelativeTime, translate } = useSessionFormatters();
  const device = getDevicePresentation(session);
  const summary = device.summary.text ?? translate(device.summary, device.summary.values);
  const lastActivity = toValidDate(session.lastActive) || toValidDate(session.loginTime);
  const ipAddress = presentText(session.ipAddress);

  return (
    <Box
      tag="li"
      padding={3}
      background="neutral0"
      borderColor="neutral150"
      hasRadius
      minWidth={0}
      data-panel-session=""
    >
      <Flex gap={3} alignItems="flex-start" minWidth={0}>
        <Flex
          background="neutral100"
          color="neutral600"
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
          <Typography variant="pi" textColor="neutral600">
            {summary}
          </Typography>
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
 * Content Manager side panel for Users & Permissions users: session summary,
 * confirmed "Log out all" and "Block/Unblock" actions and the current sessions.
 * Renders nothing for any other model or without the plugin permission.
 * New entries receive a save-first message until Strapi assigns an ID.
 */
const SessionInfoPanel = ({ documentId, model, document }) => {
  const { formatMessage } = useIntl();
  const { allowedActions: { canAccess }, isLoading: permissionsLoading } = useRBAC(pluginPermissions.access);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [isBlocked, setIsBlocked] = useState(Boolean(document?.blocked));
  const [pendingAction, setPendingAction] = useState(null);
  const [formOutOfSync, setFormOutOfSync] = useState(false);
  const panelRef = useRef(null);
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

  useEffect(() => {
    setIsBlocked(persistedBlocked);
    setFormOutOfSync(false);
  }, [persistedBlocked, userId]);

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
        setSessions(getManageableSessions(requireSessionList(data)));
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
   * Ends all current sessions of the displayed user. Runs only from the
   * ConfirmAction dialog. Errors are reported and re-thrown so the dialog
   * stays open for a retry.
   *
   * @returns {Promise<void>}
   */
  const handleLogoutAll = async () => {
    if (!userId) return;
    setPendingAction('logoutAll');
    try {
      const response = await postRequest(`/magic-sessionmanager/user/${userId}/terminate-all`);
      requireSuccessfulMutation(response.data);
      toggleNotification({
        type: 'success',
        message: t('notifications.success.terminatedAll', 'All sessions of this user were ended'),
      });
      setSessions([]);
    } catch (error) {
      toggleNotification({
        type: 'danger',
        message: t('notifications.error.terminateAll', 'The sessions could not be ended'),
      });
      logSafeAdminError('userSessions.terminateAll', error);
      throw error;
    } finally {
      setPendingAction(null);
    }
  };

  /**
   * Blocks or unblocks the displayed user (blocking also ends the user's
   * sessions on the server), then writes the new value into the open edit
   * form so a later Save cannot restore the old value (F1).
   *
   * @returns {Promise<void>}
   */
  const handleToggleBlock = async () => {
    if (!userId) return;
    setPendingAction('toggleBlock');
    try {
      const response = await postRequest(`/magic-sessionmanager/user/${userId}/toggle-block`, { blocked: !isBlocked });
      requireSuccessfulMutation(response.data);
      const newBlockedStatus = response.data.blocked === true;
      setIsBlocked(newBlockedStatus);
      if (newBlockedStatus) setSessions([]);

      const plan = planBlockedFormSync({
        initialValues: formInitialValues,
        modified: formModified,
        blocked: newBlockedStatus,
      });
      const synced = applyBlockedFormSync(plan, { resetForm: formResetForm, onChange: formOnChange });
      setFormOutOfSync(!synced);

      toggleNotification({
        type: 'success',
        message: newBlockedStatus
          ? t('notifications.success.blocked', 'User blocked')
          : t('notifications.success.unblocked', 'User unblocked'),
      });
    } catch (error) {
      toggleNotification({
        type: 'danger',
        message: t('notifications.error.block', 'The user status could not be changed'),
      });
      logSafeAdminError('userSessions.toggleBlock', error);
      throw error;
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
          <ReadableText variant="pi" textColor="neutral600" tag="p">
            {t('panel.user.saveBeforeManagingSessions', 'Save this user before managing sessions.')}
          </ReadableText>
        </Box>
      ),
    };
  }

  if (loading) {
    return {
      title,
      content: (
        <Flex width="100%" justifyContent="center" padding={4}>
          <Loader small>{t('panel.loading', 'Loading sessions')}</Loader>
        </Flex>
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
            title={t('panel.error.title', 'Sessions could not be loaded')}
            closeLabel={t('common.close', 'Close')}
            action={(
              <Button size="S" variant="secondary" onClick={() => setReloadKey((key) => key + 1)}>
                {t('common.retry', 'Retry')}
              </Button>
            )}
          >
            <ReadableText variant="pi" textColor="neutral700" tag="span">
              {t('panel.error.description', 'Try again. If the problem continues, check permissions for this user.')}
            </ReadableText>
          </Alert>
        </Box>
      ),
    };
  }

  const summary = getUserSessionSummary(sessions);
  const { visible, hiddenCount } = getVisiblePanelSessions(sessions);
  const isBusy = pendingAction !== null;
  const blockLabel = isBlocked
    ? t('panel.actions.unblockUser', 'Unblock user')
    : t('panel.actions.blockUser', 'Block user');
  const logoutAllLabel = t('panel.actions.terminateAll', 'Log out all sessions');

  return {
    title,
    content: (
      <Flex ref={panelRef} direction="column" alignItems="stretch" gap={4} width="100%" minWidth={0} tabIndex={-1}>
        {/* Summary */}
        <Flex gap={2} alignItems="center" wrap="wrap" data-panel-summary="">
          {summary.status === 'none' ? (
            <Badge variant="neutral" size="M">{t('panel.status.offline', 'Offline')}</Badge>
          ) : (
            <StatusBadge status={summary.status} />
          )}
          <Typography variant="omega" textColor="neutral700">
            {t(
              'panel.sessions.currentCount',
              '{count, plural, one {# current session} other {# current sessions}}',
              { count: summary.currentCount }
            )}
          </Typography>
        </Flex>

        {isBlocked ? (
          <Alert
            variant="danger"
            title={t('panel.blocked.title', 'User is blocked')}
            closeLabel={t('common.close', 'Close')}
          >
            <ReadableText variant="pi" textColor="neutral700" tag="span">
              {t('panel.blocked.description', 'This user cannot sign in until you unblock the account.')}
            </ReadableText>
          </Alert>
        ) : null}

        {formOutOfSync ? (
          <Alert
            variant="warning"
            title={t('panel.form.reloadTitle', 'Reload before saving')}
            closeLabel={t('common.close', 'Close')}
          >
            <ReadableText variant="pi" textColor="neutral700" tag="span">
              {t(
                'panel.form.reloadDescription',
                'The blocked status changed. Reload this page before you save this entry, otherwise the previous value is saved again.'
              )}
            </ReadableText>
          </Alert>
        ) : null}

        {/* Action Buttons */}
        <Flex direction="column" alignItems="stretch" gap={2} data-panel-actions="">
          <ConfirmAction
            title={t('panel.confirm.terminateAllTitle', 'Log out all sessions?')}
            body={t('panel.confirm.terminateAll', 'All current sessions of this user end now. The user has to sign in again.')}
            confirmLabel={logoutAllLabel}
            onConfirm={handleLogoutAll}
            fallbackFocusRef={panelRef}
            disabled={isBusy || sessions.length === 0}
            trigger={(
              <Button
                fullWidth
                size="M"
                variant="danger-light"
                startIcon={<SignOut aria-hidden focusable={false} />}
                loading={pendingAction === 'logoutAll'}
                disabled={isBusy || sessions.length === 0}
                type="button"
              >
                {logoutAllLabel}
              </Button>
            )}
          />
          <ConfirmAction
            title={isBlocked
              ? t('panel.confirm.unblockUserTitle', 'Unblock this user?')
              : t('panel.confirm.blockUserTitle', 'Block this user?')}
            body={isBlocked
              ? t('panel.confirm.unblockUser', 'The user can sign in again.')
              : t('panel.confirm.blockUser', 'The user can no longer sign in and all current sessions end now.')}
            confirmLabel={blockLabel}
            variant={isBlocked ? 'default' : 'danger'}
            onConfirm={handleToggleBlock}
            fallbackFocusRef={panelRef}
            disabled={isBusy}
            trigger={(
              <Button
                fullWidth
                size="M"
                variant={isBlocked ? 'secondary' : 'danger-light'}
                startIcon={isBlocked
                  ? <CheckCircle aria-hidden focusable={false} />
                  : <Lock aria-hidden focusable={false} />}
                loading={pendingAction === 'toggleBlock'}
                disabled={isBusy}
                type="button"
              >
                {blockLabel}
              </Button>
            )}
          />
        </Flex>

        {/* Session list */}
        {sessions.length > 0 ? (
          <Flex direction="column" alignItems="stretch" gap={2}>
            <Typography variant="sigma" textColor="neutral600" tag="h3">
              {t('panel.sessions.title', 'Current sessions')}
            </Typography>
            <Flex tag="ul" direction="column" alignItems="stretch" gap={2} margin={0} padding={0} style={{ listStyle: 'none' }}>
              {visible.map((session) => (
                <PanelSessionCard key={session.id} session={session} t={t} />
              ))}
            </Flex>
            {hiddenCount > 0 ? (
              <Link tag={NavLink} to={buildUserSessionsHref(document)}>
                {t(
                  'panel.sessions.showAll',
                  '{count, plural, one {Show # session} other {Show all # sessions}}',
                  { count: sessions.length }
                )}
              </Link>
            ) : null}
          </Flex>
        ) : (
          <Box padding={4} background="neutral100" hasRadius textAlign="center">
            <Typography variant="omega" fontWeight="semiBold" textColor="neutral700" tag="p">
              {t('panel.empty.title', 'No current sessions')}
            </Typography>
            <ReadableText variant="pi" textColor="neutral600" tag="p">
              {t('panel.empty.description', 'This user has no current sessions.')}
            </ReadableText>
          </Box>
        )}
      </Flex>
    ),
  };
};

export default SessionInfoPanel;
