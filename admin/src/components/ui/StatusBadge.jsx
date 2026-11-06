import { Badge, Flex, Typography } from '@strapi/design-system';
import { useIntl } from 'react-intl';
import { getTranslation } from '../../utils/getTranslation';
import {
  getSessionEndReasonPresentation,
  getSessionStatusPresentation,
} from '../../utils/sessionStatus.mjs';

/**
 * The one session status badge for every screen:
 * Active (success), Idle (warning), Logged out (neutral), Terminated (danger).
 *
 * @param {object} props
 * @param {string} [props.status] Status key from getSessionStatus().
 * @param {object} [props.session] Session row; used when `status` is omitted.
 * @param {boolean} [props.showEndReason] Also show why an ended session ended.
 * @param {'S'|'M'} [props.size] Badge size.
 * @returns {import('react').ReactElement} Status badge.
 */
const StatusBadge = ({ status, session, showEndReason = false, size = 'M' }) => {
  const { formatMessage } = useIntl();
  const presentation = getSessionStatusPresentation(status || session || {});
  const label = formatMessage({
    id: getTranslation(presentation.messageId),
    defaultMessage: presentation.defaultMessage,
  });
  const endReason = showEndReason && session ? getSessionEndReasonPresentation(session) : null;
  const badge = (
    <Badge variant={presentation.tone} size={size} data-session-status={presentation.status}>
      {label}
    </Badge>
  );

  if (!endReason || endReason.reason === 'logout') return badge;

  return (
    <Flex gap={2} alignItems="center" wrap="wrap">
      {badge}
      <Typography variant="pi" textColor="neutral600">
        {formatMessage({ id: getTranslation(endReason.messageId), defaultMessage: endReason.defaultMessage })}
      </Typography>
    </Flex>
  );
};

export default StatusBadge;
