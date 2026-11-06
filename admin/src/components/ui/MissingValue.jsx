import { Typography, VisuallyHidden } from '@strapi/design-system';
import { useIntl } from 'react-intl';
import { getTranslation } from '../../utils/getTranslation';
import {
  MISSING_VALUE_GLYPH,
  MISSING_VALUE_MESSAGE,
  isMissingValue,
} from '../../utils/missingValue.mjs';

/**
 * Renders the shared "—" for a missing value. Screen readers hear
 * "Not available" instead of "em dash" (DASH-06, F15, DUX-15).
 *
 * @param {{textColor?: string, variant?: string}} props Typography options.
 * @returns {import('react').ReactElement} Missing value marker.
 */
export const MissingValue = ({ textColor = 'neutral600', variant }) => {
  const { formatMessage } = useIntl();
  const label = formatMessage({
    id: getTranslation(MISSING_VALUE_MESSAGE.messageId),
    defaultMessage: MISSING_VALUE_MESSAGE.defaultMessage,
  });

  return (
    <Typography textColor={textColor} variant={variant} data-missing-value="">
      <span aria-hidden="true">{MISSING_VALUE_GLYPH}</span>
      <VisuallyHidden>{label}</VisuallyHidden>
    </Typography>
  );
};

/**
 * Renders `children` when `value` is present, otherwise the missing marker.
 *
 * @param {{value: unknown, children?: import('react').ReactNode, textColor?: string, variant?: string}} props Value and optional custom rendering.
 * @returns {import('react').ReactElement} Value or missing marker.
 */
export const ValueOrMissing = ({ value, children, textColor, variant }) => {
  if (isMissingValue(value)) return <MissingValue textColor={textColor} variant={variant} />;
  return <>{children ?? String(value)}</>;
};

export default MissingValue;
