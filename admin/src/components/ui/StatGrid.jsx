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
 * Button reset for clickable cards. The browser focus ring stays; the
 * pressed card is marked by a primary border and aria-pressed.
 */
const CardButton = styled(Box)`
  appearance: none;
  font: inherit;
  color: inherit;
  text-align: start;
  cursor: pointer;
  width: 100%;

  &:hover {
    background: ${({ theme }) => theme.colors.primary100};
  }
`;

/**
 * One KPI card: icon, label and value in one compact block, an optional
 * secondary line below. The label is read before the value; the icon is
 * decorative. With `onClick` the whole card is a toggle button (for example
 * the dashboard status filter) and `pressed` marks the active choice.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.label Metric name.
 * @param {import('react').ReactNode} props.value Metric value.
 * @param {import('react').ComponentType<any>} [props.icon] Distinct DS icon.
 * @param {'primary'|'success'|'warning'|'danger'|'neutral'|'secondary'|'alternative'} [props.tone] Semantic tone.
 * @param {import('react').ReactNode} [props.description] Secondary line.
 * @param {() => void} [props.onClick] Makes the card a button.
 * @param {boolean} [props.pressed] Toggle state of a clickable card.
 * @param {string} [props.actionLabel] Accessible name of a clickable card (defaults to its text).
 * @returns {import('react').ReactElement} Stat card filling its grid cell.
 */
export const StatCard = ({ label, value, icon: Icon, tone = 'neutral', description, onClick, pressed, actionLabel }) => {
  const safeTone = STAT_TONES.has(tone) ? tone : 'neutral';
  const clickable = typeof onClick === 'function';
  const buttonProps = clickable
    ? { tag: 'button', type: 'button', onClick, 'aria-pressed': Boolean(pressed), 'aria-label': actionLabel }
    : {};
  const Card = clickable ? CardButton : Box;

  return (
    <Card
      {...buttonProps}
      background="neutral0"
      hasRadius
      shadow="tableShadow"
      borderColor={clickable ? (pressed ? 'primary600' : 'neutral150') : undefined}
      padding={4}
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
          <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
            <Typography variant="sigma" textColor="neutral600" tag="span">
              {label}
            </Typography>
            <Typography variant="beta" textColor="neutral800" tag="span">
              {value}
            </Typography>
          </Flex>
        </Flex>
        {description ? (
          <Typography variant="pi" textColor="neutral600" tag="span">
            {description}
          </Typography>
        ) : null}
      </Flex>
    </Card>
  );
};

export default StatGrid;
