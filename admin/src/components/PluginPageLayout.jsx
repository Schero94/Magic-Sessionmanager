import { Flex, Main } from '@strapi/design-system';
import styled from 'styled-components';
import { Layouts } from '@strapi/strapi/admin';
import { paragraphRhythm } from './ReadableText';

const PageContent = styled(Flex)`
  width: 100%;
  min-width: 0;

  ${paragraphRhythm}
`;

/**
 * Frames a plugin page with Strapi's native heading and content layouts.
 * @param {object} props Page heading, optional action and page content.
 * @returns {import('react').ReactElement} A Strapi admin page.
 */
const PluginPageLayout = ({
  headingId,
  title,
  subtitle,
  primaryAction,
  children,
}) => (
  <Main aria-labelledby={headingId}>
    <Layouts.Header
      id={headingId}
      title={title}
      subtitle={subtitle}
      primaryAction={primaryAction}
    />
    <Layouts.Content>
      <PageContent
        direction="column"
        gap={4}
        padding={{ initial: 3, small: 6 }}
        alignItems="stretch"
        data-text-rhythm="page"
      >
        {children}
      </PageContent>
    </Layouts.Content>
  </Main>
);

export default PluginPageLayout;
