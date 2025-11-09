import { useState, useEffect } from 'react';
import { Box, Typography, Flex, Badge } from '@strapi/design-system';
import { useFetchClient } from '@strapi/strapi/admin';

/**
 * Session Info Card - shows user's session status and history
 * Injected into Content Manager edit view for Users
 */
const SessionInfoCard = ({ id, model }) => {
  const { get } = useFetchClient();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isUserModel, setIsUserModel] = useState(false);

  useEffect(() => {
    // Only show for User content type
    if (model !== 'plugin::users-permissions.user') {
      setIsUserModel(false);
      setLoading(false);
      return;
    }

    setIsUserModel(true);

    // Fetch user's sessions
    const fetchSessions = async () => {
      if (!id) {
        setLoading(false);
        return;
      }

      try {
        const { data } = await get(`/magic-sessionmanager/admin/user/${id}/sessions`);
          setSessions(data.data || []);
      } catch (err) {
        console.error('[SessionInfoCard] Error fetching sessions:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSessions();
  }, [id, model, get]);

  // Don't render anything if not a User model
  if (!isUserModel) {
    return null;
  }

  if (loading) {
    return (
      <Box padding={4} background="neutral100" borderRadius="4px">
        <Typography variant="sigma" textColor="neutral600">
          Loading sessions...
        </Typography>
      </Box>
    );
  }

  const activeSessions = sessions.filter(s => s.isActive);
  const isOnline = activeSessions.length > 0;

  return (
    <Box 
      padding={4} 
      background="neutral0" 
      shadow="tableShadow"
      borderRadius="4px"
      marginBottom={4}
    >
      <Flex direction="column" gap={3}>
        {/* Header */}
        <Flex justifyContent="space-between" alignItems="center">
          <Typography variant="sigma" textColor="neutral600" textTransform="uppercase">
            Session Status
          </Typography>
          {isOnline ? (
            <Badge active backgroundColor="success500">
              🟢 Online
            </Badge>
          ) : (
            <Badge backgroundColor="neutral150">
              ⚫ Offline
            </Badge>
          )}
        </Flex>

        {/* Stats */}
        <Box>
          <Typography variant="omega" fontWeight="bold">
            Active Sessions: {activeSessions.length}
          </Typography>
          <Typography variant="pi" textColor="neutral600">
            Total Sessions: {sessions.length}
          </Typography>
        </Box>

        {/* Active Sessions List */}
        {activeSessions.length > 0 && (
          <Box>
            <Typography variant="pi" fontWeight="bold" marginBottom={2}>
              Current Sessions:
            </Typography>
            {activeSessions.slice(0, 3).map((session) => (
              <Box 
                key={session.id} 
                padding={2} 
                background="neutral100" 
                borderRadius="4px"
                marginBottom={2}
              >
                <Typography variant="pi" textColor="neutral800">
                  📱 {session.ipAddress}
                </Typography>
                <Typography variant="pi" textColor="neutral600" fontSize="11px">
                  {new Date(session.loginTime).toLocaleString()}
                </Typography>
              </Box>
            ))}
            {activeSessions.length > 3 && (
              <Typography variant="pi" textColor="neutral600">
                + {activeSessions.length - 3} more...
              </Typography>
            )}
          </Box>
        )}

        {/* Last Activity */}
        {sessions.length > 0 && (
          <Box>
            <Typography variant="pi" textColor="neutral600">
              Last Activity: {new Date(sessions[0].lastActive).toLocaleString()}
            </Typography>
          </Box>
        )}

        {/* No sessions message */}
        {sessions.length === 0 && (
          <Box padding={2} background="neutral100" borderRadius="4px">
            <Typography variant="pi" textColor="neutral600">
              No session data available
            </Typography>
          </Box>
        )}
      </Flex>
    </Box>
  );
};

export default SessionInfoCard;

