import { Box } from '@strapi/design-system';
import ReadableText from '../components/ReadableText';

const ActiveSessions = () => {
  return (
    <Box padding={8}>
      <h2>Active Sessions</h2>
      <ReadableText variant="pi" textColor="neutral700" tag="p">
        This page displays all currently active user sessions in your Strapi instance.
      </ReadableText>
    </Box>
  );
};

export default ActiveSessions;
