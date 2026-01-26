import { useState, useEffect } from 'react';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { Box, Typography, Flex, Badge, Divider } from '@strapi/design-system';
import { Check, Cross, Monitor, Phone, Server, Clock, User } from '@strapi/icons';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import parseUserAgent from '../utils/parseUserAgent';
import { getTranslation } from '../utils/getTranslation';

// ================ STYLED COMPONENTS ================

const PanelContainer = styled(Box)`
  width: 100%;
`;

const StatusCard = styled(Box)`
  padding: 20px;
  border-radius: 12px;
  border: 1px solid ${props => props.$isOnline ? '#BBF7D0' : '#E5E7EB'};
  background: ${props => props.$isOnline 
    ? 'linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%)' 
    : 'linear-gradient(135deg, #F9FAFB 0%, #F3F4F6 100%)'};
  transition: all 0.2s ease;
`;

const BlockedWarning = styled(Box)`
  padding: 16px;
  border-radius: 10px;
  background: linear-gradient(135deg, #FEF2F2 0%, #FEE2E2 100%);
  border: 1px solid #FECACA;
`;

const SessionCard = styled(Box)`
  padding: 16px;
  background: white;
  border-radius: 10px;
  border: 1px solid #E5E7EB;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  transition: all 0.2s ease;
  
  &:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    border-color: #0EA5E9;
  }
`;

const EmptyState = styled(Box)`
  padding: 32px;
  background: #F9FAFB;
  border-radius: 12px;
  border: 2px dashed #E5E7EB;
  text-align: center;
`;

const EmptyIcon = styled(Box)`
  width: 48px;
  height: 48px;
  margin: 0 auto 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #E5E7EB;
  border-radius: 50%;
  color: #9CA3AF;
`;

const SectionLabel = styled(Typography)`
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-size: 11px !important;
  font-weight: 700 !important;
  color: #6B7280;
  margin-bottom: 12px;
  display: block;
`;

const ActionButton = styled.button`
  width: 100%;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.2s ease;
  
  ${props => props.$variant === 'danger' && `
    background: white;
    color: #DC2626;
    border: 2px solid #DC2626;
    
    &:hover:not(:disabled) {
      background: #DC2626;
      color: white;
    }
  `}
  
  ${props => props.$variant === 'success' && `
    background: white;
    color: #16A34A;
    border: 2px solid #16A34A;
    
    &:hover:not(:disabled) {
      background: #16A34A;
      color: white;
    }
  `}
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  svg {
    width: 16px;
    height: 16px;
  }
`;

const IconWrapper = styled(Box)`
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #F3F4F6;
  border-radius: 8px;
  flex-shrink: 0;
  
  svg {
    width: 16px;
    height: 16px;
    color: #6B7280;
  }
`;

/**
 * Session Info Panel - Styled Components Version
 * Clean sidebar panel for Content Manager user edit page
 */
const SessionInfoPanel = ({ documentId, model, document }) => {
  const { formatMessage } = useIntl();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isBlocked, setIsBlocked] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const { get, post: postRequest } = useFetchClient();
  const { toggleNotification } = useNotification();
  const t = (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values);

  const userId = document?.documentId || documentId;

  useEffect(() => {
    if (model !== 'plugin::users-permissions.user' || !userId) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        const { data } = await get(`/magic-sessionmanager/user/${userId}/sessions`);
        const activeSessions = (data.data || []).filter(s => s.isTrulyActive);
        setSessions(activeSessions);
        setIsBlocked(document?.blocked || false);
      } catch (err) {
        console.error('[SessionInfoPanel] Error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [userId, model, document, get]);

  /**
   * Handles terminating all user sessions
   */
  const handleLogoutAll = async () => {
    if (!userId) return;
    
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
      console.error('[SessionInfoPanel] Logout all error:', error);
    } finally {
      setActionLoading(false);
    }
  };

  /**
   * Handles toggling user block status
   */
  const handleToggleBlock = async () => {
    if (!userId) return;
    
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
      console.error('[SessionInfoPanel] Toggle block error:', error);
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
    return Server;
  };

  // Only show for User content type
  if (model !== 'plugin::users-permissions.user') {
    return null;
  }

  if (loading) {
    return {
      title: t('panel.title', 'Session Info'),
      content: (
        <Box padding={4} background="neutral0">
          <Typography variant="pi" textColor="neutral600">
            {t('panel.loading', 'Loading...')}
          </Typography>
        </Box>
      ),
    };
  }

  const isOnline = sessions.length > 0;

  return {
    title: t('panel.title', 'Session Info'),
    content: (
      <PanelContainer>
        <Flex direction="column" gap={4} alignItems="stretch">
          
          {/* Status Card */}
          <StatusCard $isOnline={isOnline}>
            <Flex direction="column" gap={3} alignItems="center">
              <Badge 
                backgroundColor={isOnline ? 'success600' : 'neutral600'}
                textColor="neutral0"
                size="M"
                style={{ fontSize: '12px', padding: '6px 14px', fontWeight: '700' }}
              >
                {isOnline ? t('panel.status.active', 'ONLINE') : t('panel.status.offline', 'OFFLINE')}
              </Badge>
              <Typography 
                variant="omega" 
                fontWeight="semiBold" 
                textColor={isOnline ? 'success700' : 'neutral700'}
              >
                {sessions.length} {t('panel.sessions.label', 'active session')}{sessions.length !== 1 ? 's' : ''}
              </Typography>
            </Flex>
          </StatusCard>

          {/* User Blocked Warning */}
          {isBlocked && (
            <BlockedWarning>
              <Typography variant="omega" fontWeight="bold" textColor="danger700">
                {t('panel.blocked.title', 'User is blocked')}
              </Typography>
              <Typography variant="pi" textColor="danger600" style={{ marginTop: '4px' }}>
                {t('panel.blocked.description', 'Authentication disabled')}
              </Typography>
            </BlockedWarning>
          )}

          {/* Active Sessions List */}
          {sessions.length > 0 ? (
            <Flex direction="column" gap={3} alignItems="stretch">
              <SectionLabel>
                {t('panel.sessions.title', 'Active Sessions')}
              </SectionLabel>
              
              {sessions.slice(0, 5).map((session) => {
                const deviceInfo = parseUserAgent(session.userAgent);
                const DeviceIcon = getDeviceIcon(deviceInfo.device);
                
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
                      
                      <Badge backgroundColor="success600" textColor="neutral0" size="S">
                        {t('panel.sessions.active', 'Active')}
                      </Badge>
                      
                      <Typography variant="pi" textColor="neutral600">
                        {deviceInfo.browser} on {deviceInfo.os}
                      </Typography>
                      
                      <Divider />
                      
                      <Flex gap={2} alignItems="center">
                        <Server width="14px" height="14px" style={{ color: '#9CA3AF' }} />
                        <Typography variant="pi" textColor="neutral600">
                          {session.ipAddress}
                        </Typography>
                      </Flex>
                      
                      <Flex gap={2} alignItems="center">
                        <Clock width="14px" height="14px" style={{ color: '#9CA3AF' }} />
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
                {t('panel.empty.title', 'No active sessions')}
              </Typography>
              <Typography variant="pi" textColor="neutral500" style={{ display: 'block', marginTop: '4px' }}>
                {t('panel.empty.description', 'User has not logged in yet')}
              </Typography>
            </EmptyState>
          )}

          {/* Action Buttons */}
          <Divider />
          
          <Flex direction="column" gap={3} alignItems="stretch">
            <SectionLabel>
              {t('panel.actions.title', 'Actions')}
            </SectionLabel>
            
            <ActionButton
              $variant="danger"
              onClick={handleLogoutAll}
              disabled={actionLoading || sessions.length === 0}
              type="button"
            >
              <Cross />
              {t('panel.actions.terminateAll', 'Terminate All Sessions')}
            </ActionButton>
            
            <ActionButton
              $variant={isBlocked ? 'success' : 'danger'}
              onClick={handleToggleBlock}
              disabled={actionLoading}
              type="button"
            >
              {isBlocked ? <Check /> : <Cross />}
              {isBlocked 
                ? t('panel.actions.unblockUser', 'Unblock User') 
                : t('panel.actions.blockUser', 'Block User')
              }
            </ActionButton>
          </Flex>
        </Flex>
      </PanelContainer>
    ),
  };
};

export default SessionInfoPanel;
