import { Badge, Flex, Tooltip, Typography } from '@strapi/design-system';
import { useIntl } from 'react-intl';
import { getTranslation } from '../../utils/getTranslation';
import { toValidDate } from '../../utils/sessionDates.mjs';
import { useSessionFormatters } from '../../utils/useSessionFormatters';
import {
  getSessionEndReasonPresentation,
  getSessionStatusPresentation,
  isNativeOnlySession,
} from '../../utils/sessionStatus.mjs';
import { MissingValue } from './MissingValue';

/**
 * Second line under the badge (IA B.3), in neutral text: "Last active
 * {relative}" (Active), "Not used for {minutes} min" (Idle) or
 * "{reason} · {Ended at}" (Ended; "—" without an end time).
 *
 * @param {{session: object, status: string}} props Row and its state.
 * @returns {import('react').ReactElement} Detail line.
 */
const StatusDetail = ({ session, status }) => {
  const { formatMessage } = useIntl();
  const { formatDate, formatRelativeTime, endReasonLabel } = useSessionFormatters();
  const t = (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values);
  let text;

  if (status === 'ended') {
    const endedAt = toValidDate(session.logoutTime);
    text = t('common.status.ended.detail', '{reason} · {endedAt}', {
      reason: endReasonLabel(session),
      endedAt: endedAt ? formatDate(endedAt) : <MissingValue variant="pi" key="ended-at" />,
    });
  } else {
    const minutes = Number(session.minutesSinceActive);
    const hasMinutes = session.minutesSinceActive !== null && session.minutesSinceActive !== undefined && Number.isFinite(minutes);
    text = status === 'idle' && hasMinutes
      ? t('common.status.idle.detail', 'Not used for {minutes} min', { minutes })
      : t('common.status.active.detail', 'Last active {time}', {
        time: formatRelativeTime(session.lastActive || session.loginTime),
      });
  }

  return (
    <Typography variant="pi" textColor="neutral600" data-status-detail="">
      {text}
    </Typography>
  );
};

/**
 * DS Badge colours for a tone. The DS warning variant (warning700 on
 * warning200) reaches only 3.6:1 in the light theme, so the Idle badge keeps
 * the warning background but uses neutral800 text (light about 10:1, dark
 * white on warning200). Every other tone uses its DS variant.
 *
 * @param {string} tone DS Badge variant.
 * @returns {object} Badge colour props.
 */
export const getBadgeColors = (tone) => (tone === 'warning'
  ? { backgroundColor: 'warning200', textColor: 'neutral800' }
  : { variant: tone });

/**
 * The one session state badge for every screen (IA B.3): Active (success),
 * Idle (warning), Ended (neutral). Colour never carries meaning alone: the
 * label is the state and, with `detail`, a neutral second line gives the
 * last activity or the end reason with its end time. Native-only rows get a
 * second neutral "Strapi session" badge.
 *
 * @param {object} props
 * @param {string} [props.status] State key from getSessionStatus().
 * @param {object} [props.session] Session row; used when `status` is omitted and for the detail line.
 * @param {boolean} [props.detail] Show the second line and the helper tooltip (table, cards).
 * @param {boolean} [props.showEndReason] Alias of `detail` for existing callers.
 * @param {'S'|'M'} [props.size] Badge size.
 * @returns {import('react').ReactElement} Status badge.
 */
const StatusBadge = ({ status, session, detail = false, showEndReason = false, size = 'M' }) => {
  const { formatMessage } = useIntl();
  const presentation = getSessionStatusPresentation(status || session || {});
  const translate = (descriptor) =>
    formatMessage({ id: getTranslation(descriptor.messageId), defaultMessage: descriptor.defaultMessage });
  const label = translate(presentation);
  const badge = (
    <Badge {...getBadgeColors(presentation.tone)} size={size} data-session-status={presentation.status}>
      {label}
    </Badge>
  );

  if (!(detail || showEndReason) || !session) return badge;

  const reason = presentation.status === 'ended' ? getSessionEndReasonPresentation(session) : null;
  const help = reason ? reason.description : presentation.help;
  const native = isNativeOnlySession(session);

  return (
    <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
      <Flex gap={1} alignItems="center" wrap="wrap">
        {help ? (
          <Tooltip label={translate(help)}>
            <span>{badge}</span>
          </Tooltip>
        ) : badge}
        {native ? (
          <Tooltip
            label={formatMessage({
              id: getTranslation('common.status.nativeSession.help'),
              defaultMessage: 'Created by Strapi’s own session store. No device or location details were recorded.',
            })}
          >
            <span>
              <Badge variant="neutral" size={size} data-native-session="">
                {formatMessage({ id: getTranslation('common.status.nativeSession'), defaultMessage: 'Strapi session' })}
              </Badge>
            </span>
          </Tooltip>
        ) : null}
      </Flex>
      <StatusDetail session={session} status={presentation.status} />
    </Flex>
  );
};

export default StatusBadge;
