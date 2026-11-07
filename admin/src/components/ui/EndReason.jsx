import { Typography } from '@strapi/design-system';
import { useIntl } from 'react-intl';
import { getTranslation } from '../../utils/getTranslation';
import { getEndReasonPresentation, getSessionEndReason } from '../../utils/sessionStatus.mjs';

/**
 * Translated end reason of an ended session (IA A.4): Logged out, Timed out,
 * Expired, Ended manually, User blocked or Reason not recorded. Renders
 * nothing for an open session. Used by the table, the cards, the dialog and
 * the End reason filter (through the same descriptors).
 *
 * @param {object} props
 * @param {object} [props.session] Session row.
 * @param {string} [props.reason] End reason key; overrides `session`.
 * @param {string} [props.variant] Typography variant.
 * @param {string} [props.textColor] Typography colour token.
 * @returns {import('react').ReactElement|null} Reason text.
 */
const EndReason = ({ session, reason, variant = 'omega', textColor = 'neutral800' }) => {
  const { formatMessage } = useIntl();
  const key = reason || getSessionEndReason(session);
  if (!key) return null;
  const presentation = getEndReasonPresentation(key);
  const translate = (descriptor) =>
    formatMessage({
      id: getTranslation(descriptor.messageId),
      defaultMessage: descriptor.defaultMessage,
    });

  return (
    <Typography variant={variant} textColor={textColor} data-end-reason={presentation.reason}>
      {translate(presentation)}
    </Typography>
  );
};

export default EndReason;
