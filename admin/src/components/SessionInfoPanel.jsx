import { useState, useEffect } from 'react';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { Box, Typography, Flex, Badge, Button, Divider, Alert } from '@strapi/design-system';
import { Check, Cross, Monitor, Phone, Server, Clock, User, Information } from '@strapi/icons';
import { useFetchClient, useNotification, useRBAC } from '@strapi/strapi/admin';
import parseUserAgent from '../utils/parseUserAgent';
import { getSessionStatus } from '../utils/sessionStatus.mjs';
import { getManageableSessions } from '../utils/sessionFilters.mjs';
import { getTranslation } from '../utils/getTranslation';
import pluginPermissions from '../permissions';
import { logSafeAdminError } from '../utils/safeAdminLog.mjs';
import ReadableText, { paragraphRhythm } from './ReadableText';

// ================ STYLED COMPONENTS ================

const PanelContainer = styled(Box)`
  width: 100%;
  min-width: 0;

  ${paragraphRhythm}
`;

const StatusCard = styled(Box)`
  padding: 20px;
  border-radius: 4px;
  border: 1px solid ${(p) => p.theme.colors.neutral150};
  background: ${(p) => p.theme.colors.neutral0};
`;

const BlockedWarning = styled(Box)`
  padding: 16px;
  border-radius: 4px;
  background: ${(p) => p.theme.colors.danger100};
  border: 1px solid ${(p) => p.theme.colors.danger200};
`;

const SessionCard = styled(Box)`
  padding: 16px;
  background: ${(p) => p.theme.colors.neutral0};
  border-radius: 4px;
  border: 1px solid ${(p) => p.theme.colors.neutral150};
`;

const EmptyState = styled(Box)`
  padding: 32px;
  background: ${(p) => p.theme.colors.neutral0};
  border-radius: 4px;
  border: 1px solid ${(p) => p.theme.colors.neutral150};
  text-align: center;
`;

const EmptyIcon = styled(Box)`
  width: 48px;
  height: 48px;
  margin: 0 auto 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${(p) => p.theme.colors.neutral100};
  border-radius: 50%;
  color: ${(p) => p.theme.colors.neutral500};
`;

const IconWrapper = styled(Box)`
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${(p) => p.theme.colors.neutral100};
  border-radius: 8px;
  flex-shrink: 0;
  
  svg {
    width: 16px;
    height: 16px;
    color: ${(p) => p.theme.colors.neutral600};
  }
`;

const MutedIcon = styled.div`
  display: flex;
  color: ${(p) => p.theme.colors.neutral500};
`;

/**
 * Shows session status and confirmed session actions for a saved end user.
 * New Users & Permissions entries receive a save-first message until Strapi assigns an ID.
 */
const SessionInfoPanel = ({ documentId, model, document }) => {
  const { formatMessage } = useIntl();
  const { allowedActions: { canAccess }, isLoading: permissionsLoading } = useRBAC(pluginPermissions.access);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [isBlocked, setIsBlocked] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const { get, post: postRequest } = useFetchClient();
  const { toggleNotification } = useNotification();
  const t = (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const unavailableValue = t('common.unavailable', 'Unavailable');

  const userId = document?.documentId || documentId;

  useEffect(() => {
    if (model !== 'plugin::users-permissions.user' || !userId || permissionsLoading || !canAccess) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const fetchData = async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const { data } = await get(`/magic-sessionmanager/user/${userId}/sessions`);
        if (cancelled) return;
        setSessions(getManageableSessions(data.data || []));
        setIsBlocked(document?.blocked || false);
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
  }, [userId, model, document, get, reloadKey, canAccess, permissionsLoading]);

  /**
   * Confirms and terminates all active sessions for the displayed user.
   *
   * @returns {Promise<void>}
   */
  const handleLogoutAll = async () => {
    if (!userId) return;
    if (!confirm(t('panel.confirm.terminateAll', 'End all active sessions for this user?'))) return;
    
    setActionLoading(true);
    try {
      const response = await postRequest(`/magic-sessionmanager/user/${userId}/terminate-all`);
      
      if (response.data?.success) {
        toggleNotification({
          type: 'success',
          message: t('notifications.success.terminatedAll', 'All sessions terminated successfully'),
        });
        setSessions([]);
      }
    } catch (error) {
      toggleNotification({
        type: 'warning',
        message: t('notifications.error.terminateAll', 'Failed to terminate sessions'),
      });
      logSafeAdminError('userSessions.terminateAll', error);
    } finally {
      setActionLoading(false);
    }
  };

  /**
   * Confirms the access change before blocking or unblocking the displayed user.
   * Blocking also ends that user's active sessions on the server.
   *
   * @returns {Promise<void>}
   */
  const handleToggleBlock = async () => {
    if (!userId) return;
    const confirmation = isBlocked
      ? t('panel.confirm.unblockUser', 'Unblock this user?')
      : t('panel.confirm.blockUser', 'Block this user and end all active sessions?');
    if (!confirm(confirmation)) return;
    
    setActionLoading(true);
    try {
      const response = await postRequest(`/magic-sessionmanager/user/${userId}/toggle-block`);
      
      if (response.data?.success) {
        const newBlockedStatus = response.data.blocked;
        setIsBlocked(newBlockedStatus);
        
        toggleNotification({
          type: 'success',
          message: newBlockedStatus 
            ? t('notifications.success.blocked', 'User blocked successfully') 
            : t('notifications.success.unblocked', 'User unblocked successfully'),
        });
        
        if (newBlockedStatus) {
          setSessions([]);
        }
      }
    } catch (error) {
      toggleNotification({
        type: 'warning',
        message: t('notifications.error.block', 'Failed to update user status'),
      });
      logSafeAdminError('userSessions.toggleBlock', error);
    } finally {
      setActionLoading(false);
    }
  };

  /**
   * Returns the appropriate device icon component
   */
  const getDeviceIcon = (deviceType) => {
    if (deviceType === 'Mobile' || deviceType === 'Tablet') return Phone;
    if (deviceType === 'Desktop' || deviceType === 'Laptop') return Monitor;
    if (deviceType === 'API Client') return Server;
    return Information;
  };

  // Only show for User content type
  if (model !== 'plugin::users-permissions.user') {
    return null;
  }

  if (permissionsLoading || !canAccess) {
    return null;
  }

  if (!userId) {
    return {
      title: t('panel.title', 'Session Info'),
      content: (
        <PanelContainer>
          <Box padding={4}>
            <ReadableText variant="pi" textColor="neutral600" tag="p">
              {t('panel.user.saveBeforeManagingSessions', 'Save this user before managing sessions.')}
            </ReadableText>
          </Box>
        </PanelContainer>
      ),
    };
  }

  if (loading) {
    return {
      title: t('panel.title', 'Session Info'),
      content: (
        <Box padding={4} background="neutral0">
          <ReadableText variant="pi" textColor="neutral600" tag="p">
            {t('panel.loading', 'Loading...')}
          </ReadableText>
        </Box>
      ),
    };
  }

  if (loadError) {
    return {
      title: t('panel.title', 'Session Info'),
      content: (
        <Box padding={4}>
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

  const onlineCount = sessions.filter((session) => getSessionStatus(session) === 'active').length;
  const isOnline = onlineCount > 0;

  return {
    title: t('panel.title', 'Session Info'),
    content: (
      <PanelContainer>
        <Flex direction="column" gap={4} alignItems="stretch">
          
          {/* Status Card */}
          <StatusCard>
            <Flex direction="column" gap={3} alignItems="center">
              <Badge variant={isOnline ? 'success' : 'neutral'} size="M">
                {isOnline ? t('panel.status.active', 'Online') : t('panel.status.offline', 'Offline')}
              </Badge>
              <Typography
                variant="omega"
                fontWeight="semiBold"
                textColor={isOnline ? 'success700' : 'neutral700'}
              >
                {t(
                  'panel.sessions.currentCount',
                  '{count, plural, one {# current session} other {# current sessions}}',
                  { count: sessions.length }
                )}
              </Typography>
            </Flex>
          </StatusCard>

          {/* User Blocked Warning */}
          {isBlocked && (
            <BlockedWarning>
              <Typography variant="omega" fontWeight="bold" textColor="danger700">
                {t('panel.blocked.title', 'User is blocked')}
              </Typography>
              <ReadableText variant="pi" textColor="danger600" tag="p">
                {t('panel.blocked.description', 'Authentication disabled')}
              </ReadableText>
            </BlockedWarning>
          )}

          {/* Active Sessions List */}
          {sessions.length > 0 ? (
            <Flex direction="column" gap={3} alignItems="stretch">
              <Typography variant="pi" fontWeight="semiBold" textColor="neutral600">
                {t('panel.sessions.title', 'Current Sessions')}
              </Typography>
              
              {sessions.slice(0, 5).map((session) => {
                const userAgent = typeof session.userAgent === 'string' ? session.userAgent.trim() : '';
                const hasUserAgent = Boolean(userAgent && userAgent.toLowerCase() !== 'unknown');
                const parsedDevice = hasUserAgent ? parseUserAgent(userAgent) : null;
                const nativeDeviceType = typeof session.deviceType === 'string'
                  && session.deviceType.trim().toLowerCase() !== 'unknown'
                  ? session.deviceType.trim()
                  : '';
                const nativeDeviceName = typeof session.deviceName === 'string'
                  && session.deviceName.trim().toLowerCase() !== 'unknown'
                  ? session.deviceName.trim()
                  : '';
                const availableValue = (value) =>
                  typeof value === 'string' && value.trim() && value.trim().toLowerCase() !== 'unknown'
                    ? value.trim()
                    : '';
                const deviceInfo = {
                  device: nativeDeviceName || nativeDeviceType || availableValue(parsedDevice?.device) || unavailableValue,
                  browser: availableValue(session.browserName) || availableValue(parsedDevice?.browser) || unavailableValue,
                  os: availableValue(session.osName) || availableValue(parsedDevice?.os) || unavailableValue,
                };
                const DeviceIcon = getDeviceIcon(nativeDeviceType || parsedDevice?.device);
                const sessionStatus = getSessionStatus(session);
                const isSessionOnline = sessionStatus === 'active';
                
                return (
                  <SessionCard key={session.id}>
                    <Flex direction="column" gap={2} alignItems="flex-start">
                      <Flex gap={2} alignItems="center">
                        <IconWrapper>
                          <DeviceIcon />
                        </IconWrapper>
                        <Typography variant="omega" fontWeight="bold" textColor="neutral800">
                          {deviceInfo.device}
                        </Typography>
                      </Flex>
                      
                      <Badge variant={isSessionOnline ? 'success' : 'warning'} size="S">
                        {isSessionOnline
                          ? t('panel.sessions.active', 'Active')
                          : t('panel.sessions.idle', 'Idle')}
                      </Badge>
                      
                      <Typography variant="pi" textColor="neutral600">
                        {deviceInfo.browser} on {deviceInfo.os}
                      </Typography>
                      
                      <Divider />
                      
                      <Flex gap={2} alignItems="center">
                        <MutedIcon><Server width="14px" height="14px" /></MutedIcon>
                        <Typography variant="pi" textColor="neutral600">
                          {session.ipAddress || unavailableValue}
                        </Typography>
                      </Flex>
                      
                      <Flex gap={2} alignItems="center">
                        <MutedIcon><Clock width="14px" height="14px" /></MutedIcon>
                        <Typography variant="pi" textColor="neutral600">
                          {new Date(session.loginTime).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </Typography>
                      </Flex>
                      
                      {session.minutesSinceActive !== undefined && session.minutesSinceActive < 60 && (
                        <Typography variant="pi" textColor="success600" fontWeight="semiBold">
                          {session.minutesSinceActive === 0 
                            ? t('panel.sessions.activeNow', 'Active now')
                            : t('panel.sessions.activeAgo', 'Active {minutes} min ago', { minutes: session.minutesSinceActive })
                          }
                        </Typography>
                      )}
                    </Flex>
                  </SessionCard>
                );
              })}
              
              {sessions.length > 5 && (
                <Box padding={3} background="primary100" hasRadius style={{ textAlign: 'center' }}>
                  <Typography variant="pi" textColor="primary600" fontWeight="semiBold">
                    +{sessions.length - 5} {t('panel.sessions.more', 'more session')}{sessions.length - 5 !== 1 ? 's' : ''}
                  </Typography>
                </Box>
              )}
            </Flex>
          ) : (
                <EmptyState>
              <EmptyIcon>
                <User width="24px" height="24px" />
              </EmptyIcon>
                  <Typography variant="omega" fontWeight="semiBold" textColor="neutral700" style={{ display: 'block' }}>
                    {t('panel.empty.title', 'No current sessions')}
              </Typography>
              <ReadableText variant="pi" textColor="neutral500" tag="p">
                {t('panel.empty.description', 'User has not logged in yet')}
              </ReadableText>
            </EmptyState>
          )}

          {/* Action Buttons */}
          <Divider />
          
          <Flex direction="column" gap={3} alignItems="stretch">
            <Typography variant="pi" fontWeight="semiBold" textColor="neutral600">
              {t('panel.actions.title', 'Actions')}
            </Typography>
            
            <Button
              fullWidth
              variant="danger-light"
              startIcon={<Cross />}
              onClick={handleLogoutAll}
              loading={actionLoading}
              disabled={actionLoading || sessions.length === 0}
              type="button"
            >
              {t('panel.actions.terminateAll', 'Terminate All Sessions')}
            </Button>
            
            <Button
              fullWidth
              variant={isBlocked ? 'secondary' : 'danger-light'}
              startIcon={isBlocked ? <Check /> : <Cross />}
              onClick={handleToggleBlock}
              loading={actionLoading}
              disabled={actionLoading}
              type="button"
            >
              {isBlocked 
                ? t('panel.actions.unblockUser', 'Unblock User') 
                : t('panel.actions.blockUser', 'Block User')
              }
            </Button>
          </Flex>
        </Flex>
      </PanelContainer>
    ),
  };
};

export default SessionInfoPanel;
