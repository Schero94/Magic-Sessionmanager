import { useId } from 'react';
import { Box, Flex, Typography } from '@strapi/design-system';

/**
 * White content section with the shared heading rhythm.
 * Padding is spacing token 4 below the medium breakpoint and token 6 above it.
 *
 * @param {object} props
 * @param {import('react').ReactNode} [props.title] Section heading.
 * @param {import('react').ReactNode} [props.subtitle] Secondary line under the heading.
 * @param {import('react').ReactNode} [props.action] Action aligned with the heading.
 * @param {'h2'|'h3'} [props.headingTag] Heading level, h2 by default.
 * @param {'default'|'danger'} [props.tone] Danger zone styling for the heading.
 * @param {boolean} [props.fill] Stretch to the row height (equal-height grids).
 * @param {string} [props.id] Optional section id.
 * @param {import('react').ReactNode} props.children Section content.
 * @returns {import('react').ReactElement} A labelled section.
 */
const SectionCard = ({
  title,
  subtitle,
  action,
  headingTag = 'h2',
  tone = 'default',
  fill = false,
  id,
  children,
}) => {
  const generatedId = useId();
  const headingId = `${id || 'section'}-heading-${generatedId.replace(/:/g, '')}`;
  const hasHeader = Boolean(title || subtitle || action);

  return (
    <Box
      tag="section"
      id={id}
      aria-labelledby={title ? headingId : undefined}
      background="neutral0"
      hasRadius
      shadow="tableShadow"
      borderColor={tone === 'danger' ? 'danger200' : undefined}
      padding={{ initial: 4, medium: 6 }}
      minWidth={0}
      height={fill ? '100%' : undefined}
      data-section-card={tone}
    >
      <Flex direction="column" alignItems="stretch" gap={4} height={fill ? '100%' : undefined}>
        {hasHeader ? (
          <Flex justifyContent="space-between" alignItems="flex-start" gap={4} wrap="wrap">
            <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0} flex="1 1 auto">
              {title ? (
                <Typography
                  id={headingId}
                  variant="delta"
                  tag={headingTag}
                  textColor={tone === 'danger' ? 'danger700' : 'neutral800'}
                >
                  {title}
                </Typography>
              ) : null}
              {subtitle ? (
                <Typography variant="pi" textColor="neutral600">
                  {subtitle}
                </Typography>
              ) : null}
            </Flex>
            {action ? (
              <Flex gap={2} wrap="wrap">
                {action}
              </Flex>
            ) : null}
          </Flex>
        ) : null}
        {children}
      </Flex>
    </Box>
  );
};

export default SectionCard;
