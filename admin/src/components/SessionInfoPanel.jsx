import { useState, useEffect } from 'react';
import { useIntl } from 'react-intl';
import { Box, Typography, Flex, Button, Badge, Divider } from '@strapi/design-system';
import { Check, Cross, Monitor, Phone, Server, Clock } from '@strapi/icons';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import parseUserAgent from '../utils/parseUserAgent';
import { getTranslation } from '../utils/getTranslation';

/**
 * Session Info Panel - Native Strapi design
 * Clean, professional sidebar panel for Content Manager
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

  // Strapi v5: Use documentId (string UUID) instead of numeric id
  const userId = document?.documentId || documentId;

  useEffect(() => {
    if (model !== 'plugin::users-permissions.user' || !userId) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        const { data } = await get(`/magic-sessionmanager/user/${userId}/sessions`);
          // Filter by truly active (not just isActive, but also within timeout)
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

  const getDeviceIcon = (deviceType) => {
    if (deviceType === 'Mobile' || deviceType === 'Tablet') return Phone;
    if (deviceType === 'Desktop' || deviceType === 'Laptop') return Monitor;
    return Server;
  };

  // ONLY show for User content type - hide completely for others
  if (model !== 'plugin::users-permissions.user') {
    return null;
  }

  if (loading) {
    return {
      title: t('panel.title', 'Session Info'),
      content: (
        <Box padding={4} background="neutral0">
          <Typography variant="pi" textColor="neutral600">{t('panel.loading', 'Loading...')}</Typography>
        </Box>
      ),
    };
  }

  const isOnline = sessions.length > 0;

  return {
    title: t('panel.title', 'Session Info'),
    content: (
      <Box style={{ width: '100%' }}>
        <Flex direction="column" gap={4} alignItems="stretch">
        {/* Status Bar */}
        <Box 
          padding={5} 
          background={isOnline ? 'success100' : 'neutral150'}
          hasRadius
          style={{ 
            border: isOnline ? '1px solid #c6f6d5' : '1px solid #eaeaef',
            transition: 'all 0.2s ease'
          }}
        >
          <Flex direction="column" gap={3} alignItems="center">
            <Badge 
              backgroundColor={isOnline ? 'success600' : 'neutral600'}
              textColor="neutral0"
              size="M"
              style={{ fontSize: '14px', padding: '6px 12px' }}
            >
              {isOnline ? t('panel.status.active', 'ACTIVE') : t('panel.status.offline', 'OFFLINE')}
            </Badge>
            <Typography variant="omega" fontWeight="semiBold" textColor={isOnline ? 'success700' : 'neutral700'}>
              {t('panel.sessions.count', '{count} active session{count, plural, one {} other {s}}', { count: sessions.length })}
            </Typography>
          </Flex>
        </Box>

        {/* User Blocked Warning */}
        {isBlocked && (
          <Box
            padding={4}
            background="danger100"
            hasRadius
          >
            <Typography variant="omega" fontWeight="semiBold" textColor="danger700" marginBottom={1}>
              {t('panel.blocked.title', 'User is blocked')}
            </Typography>
            <Typography variant="pi" textColor="danger600">
              {t('panel.blocked.description', 'Authentication disabled')}
            </Typography>
          </Box>
        )}

        {/* Active Sessions List */}
        {sessions.length > 0 ? (
          <Flex direction="column" gap={3} alignItems="stretch">
            <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ 
              textAlign: 'left',
              letterSpacing: '0.5px',
              fontSize: '12px'
            }}>
              {t('panel.sessions.title', 'Active Sessions')}
            </Typography>
            
            {sessions.slice(0, 5).map((session) => {
              const deviceInfo = parseUserAgent(session.userAgent);
              const DeviceIcon = getDeviceIcon(deviceInfo.device);
              
              return (
                <Box 
                  key={session.id}
                  padding={4}
                  background="neutral0"
                  hasRadius
                  style={{ 
                    border: '1px solid #e3e8ef',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.08)';
                    e.currentTarget.style.borderColor = '#4945FF';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.04)';
                    e.currentTarget.style.borderColor = '#e3e8ef';
                  }}
                >
                  <Flex direction="column" gap={2} alignItems="flex-start">
                    {/* Device Name with Icon */}
                    <Flex gap={2} alignItems="center">
                      <DeviceIcon width="20px" height="20px" />
                      <Typography variant="omega" fontWeight="bold" textColor="neutral800">
                        {deviceInfo.device}
                      </Typography>
                    </Flex>
                    
                    {/* Status Badge */}
                    <Badge 
                      backgroundColor="success600" 
                      textColor="neutral0" 
                      size="S"
                    >
                      {t('panel.sessions.active', 'Active')}
                    </Badge>
                    
                    {/* Browser & OS */}
                    <Typography variant="pi" textColor="neutral600">
                      {deviceInfo.browser} on {deviceInfo.os}
                    </Typography>
                    
                    <Divider />
                    
                    {/* IP Address */}
                    <Flex gap={2} alignItems="center">
                      <Server width="14px" height="14px" />
                      <Typography variant="pi" textColor="neutral600">
                        {session.ipAddress}
                      </Typography>
                    </Flex>
                    
                    {/* Login Time */}
                      <Flex gap={2} alignItems="center">
                        <Clock width="14px" height="14px" />
                        <Typography variant="pi" textColor="neutral600">
                          {new Date(session.loginTime).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </Typography>
                      </Flex>
                      
                      {/* Show minutes since last activity */}
                      {session.minutesSinceActive !== undefined && session.minutesSinceActive < 60 && (
                        <Typography variant="pi" textColor="success600" fontWeight="semiBold">
                          {session.minutesSinceActive === 0 
                            ? t('panel.sessions.activeNow', 'Active now')
                            : t('panel.sessions.activeAgo', 'Active {minutes} min ago', { minutes: session.minutesSinceActive })
                          }
                        </Typography>
                      )}
                  </Flex>
                </Box>
              );
            })}
            
            {sessions.length > 5 && (
              <Box padding={3} background="primary100" hasRadius textAlign="center">
                <Typography variant="pi" textColor="primary600" fontWeight="semiBold">
                  {t('panel.sessions.more', '+{count} more session{count, plural, one {} other {s}}', { count: sessions.length - 5 })}
                </Typography>
              </Box>
            )}
          </Flex>
        ) : (
          <Box 
            padding={6}
            background="neutral100"
            hasRadius
            style={{ 
              border: '1px dashed #dcdce4',
              textAlign: 'center'
            }}
          >
            <Flex direction="column" alignItems="center" gap={2}>
              <Typography 
                variant="pi" 
                textColor="neutral600"
                style={{ fontSize: '32px', marginBottom: '8px' }}
              >
                💤
              </Typography>
              <Typography variant="omega" fontWeight="semiBold" textColor="neutral700">
              {t('panel.empty.title', 'No active sessions')}
            </Typography>
              <Typography variant="pi" textColor="neutral500" style={{ fontSize: '13px' }}>
              {t('panel.empty.description', 'User has not logged in yet')}
            </Typography>
            </Flex>
          </Box>
        )}

        {/* Action Buttons - Always at the bottom */}
        <Divider />
        
        <Flex direction="column" gap={3} alignItems="stretch">
          <Typography variant="sigma" textColor="neutral600" textTransform="uppercase" style={{ 
            textAlign: 'left',
            letterSpacing: '0.5px',
            fontSize: '12px'
          }}>
            {t('panel.actions.title', 'Actions')}
          </Typography>
          
          <Button
            variant="secondary"
            size="M"
            fullWidth
            onClick={handleLogoutAll}
            disabled={actionLoading || sessions.length === 0}
            startIcon={<Cross />}
            style={{
              border: '1px solid #dc2626',
              color: '#dc2626',
              backgroundColor: 'transparent',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              if (!actionLoading && sessions.length > 0) {
                e.currentTarget.style.backgroundColor = '#dc2626';
                e.currentTarget.style.color = 'white';
              }
            }}
            onMouseLeave={(e) => {
              if (!actionLoading && sessions.length > 0) {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = '#dc2626';
              }
            }}
          >
            {t('panel.actions.terminateAll', 'Terminate All Sessions')}
          </Button>
          
          <Button
            variant="secondary"
            size="M"
            fullWidth
            onClick={handleToggleBlock}
            disabled={actionLoading}
            startIcon={isBlocked ? <Check /> : <Cross />}
            style={{
              border: isBlocked ? '1px solid #16a34a' : '1px solid #dc2626',
              color: isBlocked ? '#16a34a' : '#dc2626',
              backgroundColor: 'transparent',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              if (!actionLoading) {
                e.currentTarget.style.backgroundColor = isBlocked ? '#16a34a' : '#dc2626';
                e.currentTarget.style.color = 'white';
              }
            }}
            onMouseLeave={(e) => {
              if (!actionLoading) {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = isBlocked ? '#16a34a' : '#dc2626';
              }
            }}
          >
            {isBlocked ? t('panel.actions.unblockUser', 'Unblock User') : t('panel.actions.blockUser', 'Block User')}
          </Button>
        </Flex>
        </Flex>
      </Box>
    ),
  };
};

export default SessionInfoPanel;
