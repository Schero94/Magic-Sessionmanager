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
    <Grid.Root
      gap={gap}
      role={label ? 'group' : undefined}
      aria-label={label}
      data-equal-grid={columns}
    >
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
 * Width of a four-up KPI row below which it folds to 2 × 2: four 20rem cards
 * plus three spacing-4 gaps. Units follow the DS convention of the Strapi
 * admin, whose root font size is ten pixels (DS font sizes are 1.1rem–3.2rem). The
 * lower bound is the DS small breakpoint (52rem), where the DS spans are
 * already two-up, so phones keep their one-column layout.
 */
const STAT_GRID_FOLD_REM = (4 * 200 + 3 * 16) / 10;
const DS_SMALL_REM = 52;

/**
 * The viewport breakpoints cannot see the Settings sub-navigation, which
 * leaves a four-up KPI row only about 17rem per card in a 1024–1080 wide
 * window. The frame is a size container: when it is narrower than four
 * 20rem cards the row folds to two columns. Phones are untouched.
 */
const StatGridFrame = styled.div`
  container-type: inline-size;
  min-width: 0;

  @container (min-width: ${DS_SMALL_REM}rem) and (max-width: ${STAT_GRID_FOLD_REM - 0.01}rem) {
    [data-equal-grid='4'] > * {
      grid-column: span 6;
    }
  }

  /* Rows without secondary lines: pin every value to the card bottom, so a
     label that wraps onto two lines does not push its value off the row's line. */
  &[data-align-values] [data-stat-body] {
    flex: 1 1 auto;
  }

  &[data-align-values] [data-stat-text] {
    justify-content: space-between;
  }
`;

/**
 * KPI row: four equal cards on desktop, two from the small breakpoint, one on
 * phones, and two when the row itself is too narrow for four readable cards.
 * Cards in a row always share the same height.
 *
 * @param {object} props
 * @param {number} [props.columns] Columns at the large breakpoint.
 * @param {string} [props.label] Accessible name for the group.
 * @param {boolean} [props.alignValues] Pin values to the card bottom. Only for
 *   rows whose cards have no secondary line (a secondary line would sit under
 *   some values and not others).
 * @param {import('react').ReactNode} props.children Stat cards.
 * @returns {import('react').ReactElement} Equal KPI grid.
 */
export const StatGrid = ({ columns = 4, label, alignValues = false, children }) => (
  <StatGridFrame data-stat-grid="" data-align-values={alignValues ? '' : undefined}>
    <EqualGrid columns={columns} stackBelow="small" gap={4} label={label}>
      {children}
    </EqualGrid>
  </StatGridFrame>
);

const IconTile = styled(Flex)`
  align-self: flex-start;

  svg {
    width: ${({ theme }) => theme.spaces[5]};
    height: ${({ theme }) => theme.spaces[5]};
  }

  svg path {
    fill: ${({ theme, $tone }) => theme.colors[`${$tone}600`]};
  }
`;

const STAT_TONES = new Set([
  'primary',
  'success',
  'warning',
  'danger',
  'neutral',
  'secondary',
  'alternative',
]);

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
 * secondary line below. The icon sits at the top and the value at the bottom
 * of the stretched body, so icons and values line up across a row even when
 * one label wraps onto two lines. The label is read before the value; the icon is
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
export const StatCard = ({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
  description,
  onClick,
  pressed,
  actionLabel,
}) => {
  const safeTone = STAT_TONES.has(tone) ? tone : 'neutral';
  const clickable = typeof onClick === 'function';
  const buttonProps = clickable
    ? {
        tag: 'button',
        type: 'button',
        onClick,
        'aria-pressed': Boolean(pressed),
        'aria-label': actionLabel,
      }
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
        <Flex gap={3} alignItems="stretch" minWidth={0} data-stat-body="">
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
          <Flex
            direction="column"
            alignItems="flex-start"
            gap={1}
            minWidth={0}
            flex="1 1 auto"
            data-stat-text=""
          >
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
