import { Children } from 'react';
import { Box, Flex, Grid, Typography } from '@strapi/design-system';
import styled from 'styled-components';
import { getGridItemSpans } from '../../utils/gridSpans.mjs';

/**
 * Equal-width, equal-height grid. Grid rows stretch by default; each item is
 * a column flex container so its single child fills the full row height.
 *
 * @param {object} props
 * @param {number} [props.columns] Columns at the large breakpoint (1, 2, 3, 4 or 6).
 * @param {'small'|'medium'} [props.stackBelow] One column below this DS breakpoint.
 * @param {number} [props.gap] DS spacing token between items.
 * @param {string} [props.label] Accessible name for the group.
 * @param {import('react').ReactNode} props.children Cards.
 * @returns {import('react').ReactElement} DS Grid.
 */
export const EqualGrid = ({ columns = 2, stackBelow = 'medium', gap = 6, label, children }) => {
  const spans = getGridItemSpans(columns, stackBelow);
  const items = Children.toArray(children).filter(Boolean);

  return (
    <Grid.Root gap={gap} role={label ? 'group' : undefined} aria-label={label} data-equal-grid={columns}>
      {items.map((child, index) => (
        <Grid.Item
          key={child.key ?? index}
          col={spans.col}
          m={spans.m}
          s={spans.s}
          xs={spans.xs}
          direction="column"
          alignItems="stretch"
          minWidth={0}
        >
          {child}
        </Grid.Item>
      ))}
    </Grid.Root>
  );
};

/**
 * KPI row: four equal cards on desktop, two from the small breakpoint, one on
 * phones. Cards in a row always share the same height.
 *
 * @param {{columns?: number, label?: string, children: import('react').ReactNode}} props Grid props.
 * @returns {import('react').ReactElement} Equal KPI grid.
 */
export const StatGrid = ({ columns = 4, label, children }) => (
  <EqualGrid columns={columns} stackBelow="small" gap={4} label={label}>
    {children}
  </EqualGrid>
);

const IconTile = styled(Flex)`
  svg {
    width: ${({ theme }) => theme.spaces[5]};
    height: ${({ theme }) => theme.spaces[5]};
  }

  svg path {
    fill: ${({ theme, $tone }) => theme.colors[`${$tone}600`]};
  }
`;

const STAT_TONES = new Set(['primary', 'success', 'warning', 'danger', 'neutral', 'secondary', 'alternative']);

/**
 * One KPI card. The label is read before the value; the icon is decorative.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.label Metric name.
 * @param {import('react').ReactNode} props.value Metric value.
 * @param {import('react').ComponentType<any>} [props.icon] Distinct DS icon.
 * @param {'primary'|'success'|'warning'|'danger'|'neutral'|'secondary'|'alternative'} [props.tone] Semantic tone.
 * @param {import('react').ReactNode} [props.description] Secondary line.
 * @returns {import('react').ReactElement} Stat card filling its grid cell.
 */
export const StatCard = ({ label, value, icon: Icon, tone = 'neutral', description }) => {
  const safeTone = STAT_TONES.has(tone) ? tone : 'neutral';

  return (
    <Box
      background="neutral0"
      hasRadius
      shadow="tableShadow"
      padding={{ initial: 4, medium: 6 }}
      flex="1 1 auto"
      minWidth={0}
      data-stat-card={safeTone}
    >
      <Flex direction="column" alignItems="stretch" gap={2} height="100%">
        <Flex gap={3} alignItems="center" minWidth={0}>
          {Icon ? (
            <IconTile
              $tone={safeTone}
              background={`${safeTone}100`}
              hasRadius
              padding={2}
              shrink={0}
              justifyContent="center"
              alignItems="center"
              aria-hidden
            >
              <Icon aria-hidden focusable={false} />
            </IconTile>
          ) : null}
          <Typography variant="sigma" textColor="neutral600" tag="p">
            {label}
          </Typography>
        </Flex>
        <Typography variant="alpha" textColor="neutral800" tag="p">
          {value}
        </Typography>
        {description ? (
          <Typography variant="pi" textColor="neutral600" tag="p">
            {description}
          </Typography>
        ) : null}
      </Flex>
    </Box>
  );
};

export default StatGrid;
