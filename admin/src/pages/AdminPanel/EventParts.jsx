import { useIntl } from 'react-intl';
import { Link as RouterLink } from 'react-router-dom';
import {
  Badge,
  Flex,
  IconButton,
  TextButton,
  Td,
  Th,
  Tr,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import {
  CheckCircle,
  Cog,
  CrossCircle,
  Download,
  Earth,
  Eye,
  Information,
  Key,
  Lock,
  Monitor,
  Shield,
  SignOut,
  Stack,
  Trash,
  User,
  WarningCircle,
  Webhooks,
} from '@strapi/icons';
import styled from 'styled-components';
import { getTranslation } from '../../utils/getTranslation';
import { toValidDate } from '../../utils/sessionDates.mjs';
import { useSessionFormatters } from '../../utils/useSessionFormatters';
import { getBadgeColors } from '../../components/ui/StatusBadge';
import { MissingValue, TargetLink } from '../../components/ui';
import { getEntryPath, getEventPlace, getSessionStatePresentation } from './adminActivityModel.mjs';
import { deviceText, ipText, noAdminText } from './eventText.mjs';

/**
 * Building blocks of the admin event lists (EventTables.jsx) and their
 * details dialog (EventDetails.jsx): event badge with icon, times, names,
 * address and device text, session state, header cells and the row's
 * details button.
 */
/**
 * Translation helper bound to the plugin prefix.
 *
 * @returns {(id: string, defaultMessage: string, values?: object) => string}
 */
export const useT = () => {
  const { formatMessage } = useIntl();
  return (id, defaultMessage, values) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
};

/** Absolute time under the relative one: date and minutes in the admin locale. */
export const SHORT_DATE = Object.freeze({ dateStyle: 'medium', timeStyle: 'short' });

/** Exact time in the details dialog: weekday, date and seconds. */
export const FULL_DATE = Object.freeze({ dateStyle: 'full', timeStyle: 'medium' });

/** Icon per event (model key); decorative next to the text label. */
const EVENT_ICONS = Object.freeze({
  signIn: CheckCircle,
  failed: CrossCircle,
  lockout: Lock,
  signOut: SignOut,
  revoked: Shield,
  settings: Cog,
  logRead: Key,
  purged: Trash,
  refused: CrossCircle,
  unlock: Lock,
  limit: Stack,
  password: Key,
  device: Monitor,
  travel: Earth,
  notMe: WarningCircle,
  export: Download,
  impersonation: User,
  webhook: Webhooks,
  other: Information,
});

/**
 * Icon colour per tone. Non-text contrast (WCAG 1.4.11, 3:1) on neutral0 in
 * both themes: success600 4.86/6.01, danger600 5.19/4.77, warning700
 * 4.4/14.4 (warning600 is only 2.92:1 in the light theme), secondary600
 * 4.9/7.6, neutral600 5.50/6.53.
 */
const ICON_FILL = Object.freeze({
  success: 'success600',
  danger: 'danger600',
  warning: 'warning700',
  secondary: 'secondary600',
  neutral: 'neutral600',
});

/**
 * Enter and Space on a button inside a grid cell: the DS table cell handles
 * them for its own navigation when a cell holds more than one control, so
 * they are stopped here and the button keeps its native activation.
 *
 * @param {import('react').KeyboardEvent<HTMLElement>} event Keydown inside a cell.
 * @returns {void}
 */
export const stopCellKeys = (event) => {
  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
    event.stopPropagation();
  }
};

/** Rows open their details on click (mouse); the Eye button is the keyboard path. */
export const ClickableRow = styled(Tr)`
  cursor: pointer;
`;

/**
 * A table cell whose text may wrap. The DS table cell sets
 * `white-space: nowrap`, so long reasons, names and addresses would widen
 * the table past its container; these cells wrap at word boundaries instead.
 */
export const WrapCell = styled(Td)`
  white-space: normal;
`;

/** A cell whose values are short labels: no wrapping inside a value. */
const NoWrap = styled.span`
  white-space: nowrap;
`;

/**
 * Text button with the 3.2rem hit area of a size S button (the DS text button
 * is only as tall as its text line), like TargetLink. Left-aligned so a name
 * that wraps stays in its column.
 */
const NameButton = styled(TextButton)`
  min-height: 3.2rem;
  text-align: start;
`;

/** Stacked list (narrow containers): one bordered surface with hairline dividers. */
export const StackedList = styled.ul`
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid ${({ theme }) => theme.colors.neutral150};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.neutral0};
  min-width: 0;

  & > li + li {
    border-top: 1px solid ${({ theme }) => theme.colors.neutral150};
  }
`;

/** One stacked row; the whole surface opens the details on click. */
export const StackedItem = styled.li`
  cursor: pointer;
  min-width: 0;
`;

/** Values that may break anywhere (user agent, ids). */
export const BreakAnywhere = styled(Typography)`
  overflow-wrap: anywhere;
`;

/**
 * Badge colours of an event tone: the shared session-state colours, plus
 * danger for failed sign-ins and lockouts. The DS danger variant (danger700
 * on danger200) reaches only 3.89:1 light and 2.57:1 dark, so danger uses
 * the lighter danger100 surface (5.43:1 light, 5.31:1 dark).
 *
 * @param {string} tone Event tone.
 * @returns {object} Badge colour props.
 */
export const getEventBadgeColors = (tone) =>
  tone === 'danger'
    ? { backgroundColor: 'danger100', textColor: 'danger700' }
    : getBadgeColors(tone);

/**
 * Event label with its icon and semantic badge. In a table cell the label
 * stays on one line (`nowrap`); in stacked rows and the details dialog it
 * may wrap at 320 px.
 *
 * @param {{presentation: {tone: string, icon: string, key: string,
 *   label: {messageId: string, defaultMessage: string}}, nowrap?: boolean}} props
 * @returns {import('react').ReactElement} Badge with icon.
 */
export const EventBadge = ({ presentation, nowrap = false }) => {
  const t = useT();
  const Icon = EVENT_ICONS[presentation.icon] || Information;
  return (
    <Flex gap={2} alignItems="center" shrink={0} data-event-kind={presentation.key}>
      <Icon
        aria-hidden="true"
        focusable="false"
        width="1.6rem"
        height="1.6rem"
        fill={ICON_FILL[presentation.tone] || ICON_FILL.neutral}
      />
      <Badge {...getEventBadgeColors(presentation.tone)} data-event-tone={presentation.tone}>
        {nowrap ? (
          <NoWrap>{t(presentation.label.messageId, presentation.label.defaultMessage)}</NoWrap>
        ) : (
          t(presentation.label.messageId, presentation.label.defaultMessage)
        )}
      </Badge>
    </Flex>
  );
};

/**
 * Relative time with the absolute date and time on a second line, so no
 * hover is needed to read when it happened.
 *
 * @param {{value: unknown, compact?: boolean}} props Timestamp; `compact` (stacked rows)
 *   uses the smaller pi text and drops the second line.
 * @returns {import('react').ReactElement} Time.
 */
export const EventTime = ({ value, compact = false }) => {
  const { formatDate, formatRelativeTime } = useSessionFormatters();
  const date = toValidDate(value);
  if (!date) return <MissingValue variant="omega" />;
  return (
    <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
      <Typography
        tag="time"
        dateTime={date.toISOString()}
        variant={compact ? 'pi' : 'omega'}
        textColor="neutral800"
      >
        <NoWrap>{formatRelativeTime(date)}</NoWrap>
      </Typography>
      {compact ? null : (
        <Typography variant="pi" textColor="neutral600">
          <NoWrap>{formatDate(date, SHORT_DATE)}</NoWrap>
        </Typography>
      )}
    </Flex>
  );
};

/**
 * Name of the admin an event belongs to. With `onOpenAdmin` it opens that
 * admin's details; an event without an admin account is plain text.
 *
 * @param {{admin: {id: number, name: string}|null, row?: object,
 *   onOpenAdmin?: (admin: object, trigger: HTMLElement) => void}} props
 * @returns {import('react').ReactElement} Name.
 */
export const AdminName = ({ admin, row, onOpenAdmin }) => {
  const t = useT();
  if (!admin) {
    // Same size as the name buttons next to it (DS text buttons use pi).
    return (
      <Typography variant={onOpenAdmin ? 'pi' : 'omega'} textColor="neutral600">
        {noAdminText(t, row)}
      </Typography>
    );
  }
  if (!onOpenAdmin) {
    return (
      <Typography variant="omega" fontWeight="semiBold" textColor="neutral800">
        {admin.name}
      </Typography>
    );
  }
  return (
    <NameButton
      onClick={(event) => {
        event.stopPropagation();
        onOpenAdmin(admin, event.currentTarget);
      }}
      onKeyDown={stopCellKeys}
      aria-label={t('adminPanel.activity.openAdmin', 'Open the details of {name}', {
        name: admin.name,
      })}
    >
      {admin.name}
    </NameButton>
  );
};

/**
 * Address on the first line, place and device on the second.
 *
 * @param {{row: object}} props Sign-in row.
 * @returns {import('react').ReactElement} Details.
 */
export const SignInDetails = ({ row }) => {
  const t = useT();
  const ip = ipText(t, row);
  const second = [getEventPlace(row), deviceText(t, row)].filter(Boolean).join(' · ');
  if (!ip && !second) return <MissingValue variant="omega" />;
  return (
    <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
      {ip ? (
        <BreakAnywhere variant="omega" textColor="neutral800">
          {ip}
        </BreakAnywhere>
      ) : null}
      {second ? (
        <Typography variant="pi" textColor="neutral600">
          {second}
        </Typography>
      ) : null}
    </Flex>
  );
};

/**
 * Whether the session of a sign-in still runs, and when and by whom it
 * ended. Other events have no session: "—".
 *
 * @param {{row: object}} props Sign-in row.
 * @returns {import('react').ReactElement} Session state.
 */
export const SessionState = ({ row }) => {
  const t = useT();
  const { formatRelativeTime } = useSessionFormatters();
  const state = getSessionStatePresentation(row.session);
  if (!state) return <MissingValue variant="omega" />;
  const endedAt = toValidDate(row.session?.endedAt);
  const second = [
    endedAt ? formatRelativeTime(endedAt) : '',
    row.session?.endedBy?.name
      ? t('adminPanel.activity.byAdmin', 'by {name}', { name: row.session.endedBy.name })
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
      <Typography
        variant="omega"
        fontWeight={state.tone === 'success' ? 'semiBold' : undefined}
        textColor={state.tone === 'success' ? 'success600' : 'neutral800'}
        data-session-state={row.session?.state}
      >
        {t(state.label.messageId, state.label.defaultMessage)}
      </Typography>
      {second ? (
        <Typography variant="pi" textColor="neutral600">
          {second}
        </Typography>
      ) : null}
    </Flex>
  );
};

/**
 * Column header in the DS sigma style; `hidden` keeps the name for screen
 * readers only (the actions column).
 *
 * @param {{children: import('react').ReactNode, hidden?: boolean}} props
 * @returns {import('react').ReactElement} Header cell.
 */
export const HeaderCell = ({ children, hidden = false }) => (
  <Th>
    {hidden ? (
      <VisuallyHidden>{children}</VisuallyHidden>
    ) : (
      <Typography variant="sigma" textColor="neutral600">
        {children}
      </Typography>
    )}
  </Th>
);

/**
 * The details button of a row: a ghost Eye with a contextual name and no
 * tooltip, exactly like the row action of Strapi's Audit Logs. Without the
 * tooltip one Escape closes the surrounding dialog (with it, the first
 * Escape only closed the tooltip). Its cell stops the row click.
 *
 * @param {{label: string, onOpen: (trigger: HTMLElement) => void}} props
 * @returns {import('react').ReactElement} Button.
 */
export const DetailsButton = ({ label, onOpen }) => (
  <IconButton
    variant="ghost"
    label={label}
    withTooltip={false}
    onClick={(event) => {
      event.stopPropagation();
      onOpen(event.currentTarget);
    }}
    onKeyDown={stopCellKeys}
    data-event-details=""
  >
    <Eye />
  </IconButton>
);

/**
 * Entry of an activity row: a link into the Content Manager while the entry
 * exists, plain text otherwise. A missing title (deleted entry, or no read
 * access to it) shows the document id or the content type.
 *
 * @param {{row: object}} props Activity row.
 * @returns {import('react').ReactElement} Entry.
 */
export const ActivityEntry = ({ row }) => {
  const t = useT();
  const path = getEntryPath(row);
  const name =
    row.entry?.count !== null && row.entry?.count !== undefined
      ? t('adminPanel.activity.entries', '{count, plural, one {# entry} other {# entries}}', {
          count: row.entry.count,
        })
      : row.entry?.title || row.entry?.documentId || row.contentType?.name || '';
  if (!name) return <MissingValue variant="omega" />;
  if (!path) {
    return (
      <BreakAnywhere variant="omega" textColor="neutral800">
        {name}
      </BreakAnywhere>
    );
  }
  return (
    <TargetLink
      tag={RouterLink}
      to={path}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={stopCellKeys}
      aria-label={t('adminPanel.activity.openEntry', 'Open {entry} in the Content Manager', {
        entry: name,
      })}
    >
      {name}
    </TargetLink>
  );
};
