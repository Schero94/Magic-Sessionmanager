import { forwardRef } from 'react';
import { Box, Flex, Typography } from '@strapi/design-system';
import { CheckCircle, Information, WarningCircle } from '@strapi/icons';
import styled from 'styled-components';

/**
 * Surface, border and icon tokens per variant. The coloured variants use the
 * same mapping as the DS Alert. `neutral` is an informational notice with no
 * status colour: the card surface and a neutral border, so it does not read
 * as success, warning or error.
 */
const TONES = {
  danger: { background: 'danger100', border: 'danger200', icon: 'danger700' },
  success: { background: 'success100', border: 'success200', icon: 'success700' },
  warning: { background: 'warning100', border: 'warning200', icon: 'warning700' },
  default: { background: 'primary100', border: 'primary200', icon: 'primary700' },
  neutral: { background: 'neutral0', border: 'neutral200', icon: 'neutral600' },
};

/**
 * Body of the alert. Readable-text helpers passed as children render inline
 * with the alert's own size, colour and leading, so the body lines up with
 * the title instead of starting lower and smaller (F7). Only the plugin's own
 * children are selected, never DS markup (SET-17).
 */
const AlertBody = styled(Typography)`
  min-width: 0;

  & > * {
    display: inline;
    max-width: none;
    margin: 0;
    font-size: inherit;
    font-weight: inherit;
    line-height: inherit;
    color: inherit;
  }
`;

/**
 * A condition-driven notice that stays until its underlying state changes.
 *
 * The DS 2.2.4 Alert always renders a close button, even without an onClose
 * handler, and the only way to hide it was a selector into its markup. This
 * component composes the same look (tone background and border, filter
 * shadow, variant icon, bold title, body, optional action) from public DS
 * props only, so it has no close button and depends on no DS internals
 * (SET-17). With `stacked`, the title, body and action sit in one column
 * instead of flowing side by side, for notices with a long body.
 * `closeLabel` and `onClose` are accepted and ignored so call sites
 * written for the DS Alert keep working.
 *
 * @param {{
 *   variant?: 'default'|'neutral'|'success'|'warning'|'danger',
 *   title?: import('react').ReactNode,
 *   titleAs?: string,
 *   stacked?: boolean,
 *   action?: import('react').ReactNode,
 *   closeLabel?: string,
 *   onClose?: () => void,
 *   children?: import('react').ReactNode,
 *   [key: string]: unknown,
 * }} props Alert props; other props go to the outer Flex.
 * @param {import('react').Ref<HTMLDivElement>} ref Outer element.
 * @returns {import('react').ReactElement} Notice without a close button.
 */
const PersistentAlert = forwardRef(function PersistentAlert(
  {
    variant = 'default',
    title,
    titleAs = 'p',
    stacked = false,
    action,
    closeLabel: _closeLabel,
    onClose: _onClose,
    children,
    ...rest
  },
  ref
) {
  const tone = TONES[variant] || TONES.default;
  const Icon =
    variant === 'success'
      ? CheckCircle
      : variant === 'danger' || variant === 'warning'
        ? WarningCircle
        : Information;

  return (
    <Flex
      ref={ref}
      alignItems="flex-start"
      background={tone.background}
      borderColor={tone.border}
      shadow="filterShadow"
      gap={3}
      hasRadius
      padding={5}
      paddingRight={6}
      data-persistent-alert=""
      {...rest}
    >
      <Flex shrink={0} width="2rem" height="2rem">
        <Icon aria-hidden focusable="false" width="2rem" height="2rem" fill={tone.icon} />
      </Flex>
      <Flex
        direction={stacked ? 'column' : 'row'}
        alignItems={stacked ? 'stretch' : 'start'}
        gap={action || stacked ? 2 : 1}
        wrap={stacked ? 'nowrap' : 'wrap'}
        role={variant === 'danger' ? 'alert' : 'status'}
        width="100%"
        minWidth={0}
      >
        {title ? (
          <Typography fontWeight="bold" textColor="neutral800" tag={titleAs}>
            {title}
          </Typography>
        ) : null}
        <AlertBody tag="div" variant="omega" textColor="neutral800">
          {children}
        </AlertBody>
        {action ? <Box>{action}</Box> : null}
      </Flex>
    </Flex>
  );
});

export default PersistentAlert;
