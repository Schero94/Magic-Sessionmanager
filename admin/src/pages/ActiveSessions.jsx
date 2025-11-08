import { Box } from '@strapi/design-system';

const ActiveSessions = () => {
  return (
    <Box padding={8}>
      <h2>Active Sessions</h2>
      <p>This page displays all currently active user sessions in your Strapi instance.</p>
    </Box>
  );
};

export default ActiveSessions;
