import {
  Badge,
  Box,
  Flex,
  LinkButton,
  Table,
  Tbody,
  Td,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { Link as RouterLink } from 'react-router-dom';
import { useElementWidth } from '../../utils/useElementWidth';
import { useSessionFormatters } from '../../utils/useSessionFormatters';
import { getBadgeColors } from '../../components/ui/StatusBadge';
import { MissingValue } from '../../components/ui';
import {
  ACTIVITY_ACTION_LABELS,
  getActivityTone,
  getEventListLayout,
  getEventPlace,
  getEventPresentation,
  getSessionStatePresentation,
} from './adminActivityModel.mjs';
import {
  ActivityEntry,
  AdminName,
  BreakAnywhere,
  ClickableRow,
  DetailsButton,
  EventBadge,
  EventTime,
  HeaderCell,
  SessionState,
  SignInDetails,
  StackedItem,
  StackedList,
  WrapCell,
  stopCellKeys,
  useT,
} from './EventParts';
import {
  contentTypeText,
  deviceText,
  doneByText,
  eventDetailText,
  ipText,
  userEventDetailText,
  userText,
} from './eventText.mjs';
import {
  EventDetailsModal,
  activityDetails,
  signInDetails,
  useEventDetails,
  userEventDetails,
} from './EventDetails';
import { getUserEntryPath } from '../UserActivity/userActivityModel.mjs';
import pluginId from '../../pluginId';

/** Settings tab with the "Locked now" list, where locks are lifted (4.23.1). */
const LOCKED_NOW_PATH = `/settings/${pluginId}/general?tab=login-protection`;

/**
 * Whether an app-user event is about a lock: the lockout itself, or a
 * sign-in refused because the account or IP address was locked.
 *
 * @param {{event?: string, meta?: object}} row Event row.
 * @returns {boolean}
 */
const isLockEvent = (row) =>
  row?.event === 'user.lockout' ||
  (row?.event === 'user.sign-in.refused' && row?.meta?.reason === 'lockout');

/**
 * @typedef {object} EventColumn
 * @property {string} id Stable key.
 * @property {string} header Column name.
 * @property {(row: object, layout: 'table'|'full') => import('react').ReactNode} render Cell
 *   content.
 * @property {boolean} [wrap] The cell may wrap (default true).
 */

/**
 * One security event list, shared by every view (admin sign-in history, the
 * admin's Content Manager activity, the app-user security activity): a DS
 * table in wide containers and stacked rows in narrow ones (phones, the
 * admin details dialog, the Content Manager side panel). The time comes
 * first and the details button last in both; a row click or the Eye button
 * opens the details dialog (Audit Logs pattern) and focus returns to that
 * row's Eye button. Callers describe only what differs: the badge, the
 * columns, the two stacked lines and the dialog content.
 *
 * @param {object} props
 * @param {object[]} props.rows Rows from the API.
 * @param {string} props.label Accessible name of the list.
 * @param {boolean} [props.wide] The list has a subject column (Admin or User): wider minimum.
 * @param {boolean} [props.busy] A refresh is running.
 * @param {(row: object) => string} props.nameOf Event name for the Eye button's label.
 * @param {(row: object) => import('react').ReactNode} props.badge Badge of the row.
 * @param {(layout: 'table'|'full') => EventColumn[]} props.columns Columns after the time.
 * @param {(row: object) => import('react').ReactNode} [props.stackedSubject] Second stacked
 *   line (the admin, the entry, the user).
 * @param {(row: object) => string} [props.stackedDetail] Third stacked line.
 * @param {(row: object) => {title: string, items: object[]}} props.details Dialog content.
 * @param {(row: object, close: () => void) => import('react').ReactNode} [props.detailsAction]
 *   Extra footer action of the details dialog.
 * @param {(row: object) => string} [props.rowKind] `data-event-row` value.
 * @returns {import('react').ReactElement} List.
 */
export const EventTable = ({
  rows,
  label,
  wide = false,
  busy = false,
  nameOf,
  badge,
  columns,
  stackedSubject,
  stackedDetail,
  details,
  detailsAction,
  rowKind,
}) => {
  const t = useT();
  const { formatRelativeTime } = useSessionFormatters();
  const [measureRef, width] = useElementWidth();
  const {
    selected,
    open: openDetails,
    close: closeDetails,
    onCloseAutoFocus,
    setContainer,
  } = useEventDetails();
  const layout = getEventListLayout(width, { wide });

  const detailsLabel = (row) =>
    t('adminPanel.activity.details.open', 'Details of {event}, {time}', {
      event: nameOf(row),
      time: formatRelativeTime(row.at),
    });
  const kindOf = (row) => (rowKind ? rowKind(row) : undefined);

  let list;
  if (layout === 'stacked') {
    list = (
      <StackedList aria-label={label} data-event-list="stacked">
        {rows.map((row) => {
          const subject = stackedSubject ? stackedSubject(row) : null;
          const detail = stackedDetail ? stackedDetail(row) : '';
          return (
            <StackedItem
              key={row.id}
              data-event-row={kindOf(row)}
              data-event-id={row.id}
              onClick={(event) => openDetails(row, event.currentTarget)}
            >
              <Flex direction="column" alignItems="stretch" gap={1} padding={3} minWidth={0}>
                {/* Line 1: the badge, the time and the details button on the right (from
                    390 px on one line; at 320 px the time moves down, still right-aligned).
                    Line 2: who or what. Line 3: the details in plain words. */}
                <Flex gap={2} wrap="wrap" alignItems="center" minWidth={0}>
                  {badge(row)}
                  <Flex gap={1} alignItems="center" marginLeft="auto">
                    <EventTime value={row.at} compact />
                    <DetailsButton
                      label={detailsLabel(row)}
                      onOpen={(trigger) => openDetails(row, trigger)}
                    />
                  </Flex>
                </Flex>
                {subject ? <Flex minWidth={0}>{subject}</Flex> : null}
                {detail ? (
                  <BreakAnywhere variant="pi" textColor="neutral600">
                    {detail}
                  </BreakAnywhere>
                ) : null}
              </Flex>
            </StackedItem>
          );
        })}
      </StackedList>
    );
  } else {
    const cols = columns(layout);
    list = (
      <Box background="neutral0" hasRadius shadow="tableShadow" data-event-list={layout}>
        <Table
          colCount={cols.length + 2}
          rowCount={rows.length + 1}
          aria-label={label}
          aria-busy={busy}
        >
          <Thead>
            <Tr>
              <HeaderCell>{t('adminPanel.activity.column.time', 'Time')}</HeaderCell>
              {cols.map((column) => (
                <HeaderCell key={column.id}>{column.header}</HeaderCell>
              ))}
              <HeaderCell hidden>{t('adminPanel.table.actions', 'Actions')}</HeaderCell>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((row) => (
              <ClickableRow
                key={row.id}
                data-event-row={kindOf(row)}
                data-event-id={row.id}
                onClick={(event) => openDetails(row, event.currentTarget)}
              >
                <Td>
                  <EventTime value={row.at} />
                </Td>
                {cols.map((column) =>
                  column.wrap === false ? (
                    <Td key={column.id}>{column.render(row, layout)}</Td>
                  ) : (
                    <WrapCell key={column.id}>{column.render(row, layout)}</WrapCell>
                  )
                )}
                <Td onClick={(event) => event.stopPropagation()}>
                  <Flex justifyContent="flex-end" gap={1} onKeyDown={stopCellKeys}>
                    <DetailsButton
                      label={detailsLabel(row)}
                      onOpen={(trigger) => openDetails(row, trigger)}
                    />
                  </Flex>
                </Td>
              </ClickableRow>
            ))}
          </Tbody>
        </Table>
      </Box>
    );
  }

  const content = selected ? details(selected) : null;
  return (
    <Box ref={measureRef} minWidth={0} width="100%">
      <Box ref={setContainer} tabIndex={-1} minWidth={0}>
        {list}
      </Box>
      {content ? (
        <EventDetailsModal
          title={content.title}
          items={content.items}
          footerAction={detailsAction ? detailsAction(selected, closeDetails) : null}
          onClose={closeDetails}
          onCloseAutoFocus={onCloseAutoFocus}
        />
      ) : null}
    </Box>
  );
};

/**
 * Event cell: the badge, and a second line in plain words.
 *
 * @param {{presentation: object, detail: string}} props
 * @returns {import('react').ReactElement} Cell content.
 */
const EventCell = ({ presentation, detail }) => (
  <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
    <EventBadge presentation={presentation} nowrap />
    {detail ? (
      <Typography variant="pi" textColor="neutral600">
        {detail}
      </Typography>
    ) : null}
  </Flex>
);

/**
 * Plain text of a cell, or the dash for a missing value.
 *
 * @param {{text: string, strong?: boolean}} props
 * @returns {import('react').ReactElement} Text.
 */
const CellText = ({ text, strong = false }) =>
  text ? (
    <BreakAnywhere
      variant="omega"
      fontWeight={strong ? 'semiBold' : undefined}
      textColor="neutral800"
    >
      {text}
    </BreakAnywhere>
  ) : (
    <MissingValue variant="omega" />
  );

/**
 * Sign-in history as a table (wide containers) or stacked rows (narrow
 * containers): time, event, admin, address and device, session state, who
 * did it, and a details button. A row click or the Eye button opens the
 * details dialog with the exact time, the user agent and the event id.
 *
 * @param {object} props
 * @param {object[]} props.rows Sign-in rows from the API.
 * @param {string} props.label Accessible name of the list.
 * @param {boolean} [props.showAdmin] Add the Admin column (lists of several admins).
 * @param {(admin: object, trigger: HTMLElement) => void} [props.onOpenAdmin] Opens an admin's
 *   details from the name.
 * @param {(row: object, close: () => void) => import('react').ReactNode} [props.detailsAction]
 *   Extra footer action of the details dialog.
 * @param {boolean} [props.busy] A refresh is running.
 * @returns {import('react').ReactElement} List.
 */
export const SignInEventTable = ({
  rows,
  label,
  showAdmin = false,
  onOpenAdmin,
  detailsAction,
  busy = false,
}) => {
  const t = useT();
  const { formatDate } = useSessionFormatters();
  const nameOf = (row) => {
    const presentation = getEventPresentation(row);
    return t(presentation.label.messageId, presentation.label.defaultMessage);
  };
  const adminName = (row) => <AdminName admin={row.admin} row={row} onOpenAdmin={onOpenAdmin} />;
  return (
    <EventTable
      rows={rows}
      label={label}
      wide={showAdmin}
      busy={busy}
      nameOf={nameOf}
      rowKind={(row) => getEventPresentation(row).key}
      badge={(row) => <EventBadge presentation={getEventPresentation(row)} />}
      columns={(layout) => [
        {
          id: 'event',
          header: t('adminPanel.activity.column.event', 'Event'),
          render: (row) => {
            const presentation = getEventPresentation(row);
            return (
              <EventCell
                presentation={presentation}
                detail={eventDetailText(t, row, presentation, layout !== 'full')}
              />
            );
          },
        },
        ...(showAdmin
          ? [
              {
                id: 'admin',
                header: t('adminPanel.activity.column.admin', 'Admin'),
                render: adminName,
              },
            ]
          : []),
        {
          id: 'details',
          header: t('adminPanel.activity.column.details', 'IP address and device'),
          render: (row) => <SignInDetails row={row} />,
        },
        {
          id: 'session',
          header: t('adminPanel.activity.column.session', 'Session'),
          render: (row) => <SessionState row={row} />,
        },
        ...(layout === 'full'
          ? [
              {
                id: 'doneBy',
                header: t('adminPanel.activity.column.doneBy', 'Done by'),
                render: (row) => <CellText text={row.actor?.name || ''} />,
              },
            ]
          : []),
      ]}
      stackedSubject={showAdmin ? adminName : undefined}
      stackedDetail={(row) => {
        const presentation = getEventPresentation(row);
        const state = getSessionStatePresentation(row.session);
        return [
          eventDetailText(t, row, presentation, true),
          ipText(t, row),
          getEventPlace(row),
          deviceText(t, row),
          state ? t(state.label.messageId, state.label.defaultMessage) : '',
        ]
          .filter(Boolean)
          .join(' · ');
      }}
      details={(row) => signInDetails(t, formatDate, row)}
      detailsAction={detailsAction}
    />
  );
};

/**
 * Content Manager activity as a table or stacked rows: time, action, entry
 * (a link into the Content Manager), content type and locale, optionally the
 * admin, and a details button.
 *
 * @param {object} props
 * @param {object[]} props.rows Activity rows from the API.
 * @param {string} props.label Accessible name of the list.
 * @param {boolean} [props.showAdmin] Add the Admin column.
 * @param {boolean} [props.busy] A refresh is running.
 * @returns {import('react').ReactElement} List.
 */
export const ActivityEventTable = ({ rows, label, showAdmin = false, busy = false }) => {
  const t = useT();
  const { formatDate } = useSessionFormatters();
  const actionOf = (row) => {
    const entry = ACTIVITY_ACTION_LABELS[row.action] || ACTIVITY_ACTION_LABELS.view;
    return t(entry.messageId, entry.defaultMessage);
  };
  const badge = (row) => (
    <Badge
      {...getBadgeColors(getActivityTone(row.action))}
      data-event-tone={getActivityTone(row.action)}
    >
      {actionOf(row)}
    </Badge>
  );
  return (
    <EventTable
      rows={rows}
      label={label}
      wide={showAdmin}
      busy={busy}
      nameOf={actionOf}
      rowKind={(row) => row.action}
      badge={badge}
      columns={() => [
        {
          id: 'action',
          header: t('adminPanel.activity.column.action', 'Action'),
          render: badge,
          wrap: false,
        },
        {
          id: 'entry',
          header: t('adminPanel.activity.column.entry', 'Entry'),
          render: (row) => <ActivityEntry row={row} />,
        },
        {
          id: 'type',
          header: t('adminPanel.activity.column.contentType', 'Content type'),
          render: (row) => <CellText text={contentTypeText(row)} />,
        },
        ...(showAdmin
          ? [
              {
                id: 'admin',
                header: t('adminPanel.activity.column.admin', 'Admin'),
                render: (row) => <AdminName admin={row.admin} />,
              },
            ]
          : []),
      ]}
      stackedSubject={(row) => <ActivityEntry row={row} />}
      stackedDetail={(row) =>
        [contentTypeText(row), showAdmin ? row.admin?.name : ''].filter(Boolean).join(' · ')
      }
      details={(row) => activityDetails(t, formatDate, row)}
    />
  );
};

/**
 * App-user security activity (4.22) as a table or stacked rows: time, event
 * with what happened in plain words, the user (email when the reader may
 * read users, else "User #id"), address and device, and who did it (an
 * admin, or "Automatic"). Same table, details dialog and colours as the
 * admin lists. The details dialog can open the user in the Content Manager
 * when the reader may see them.
 *
 * @param {object} props
 * @param {object[]} props.rows Rows from `GET /user-activity`.
 * @param {string} props.label Accessible name of the list.
 * @param {boolean} [props.showUser] Add the User column (lists of several users); off in the
 *   user's own Sessions panel.
 * @param {boolean} [props.busy] A refresh is running.
 * @param {(row: object, close: () => void) => import('react').ReactNode} [props.detailsAction]
 *   Extra footer action of the details dialog.
 * @returns {import('react').ReactElement} List.
 */
export const UserEventTable = ({ rows, label, showUser = true, busy = false, detailsAction }) => {
  const t = useT();
  const { formatDate } = useSessionFormatters();
  const nameOf = (row) => {
    const presentation = getEventPresentation(row);
    return t(presentation.label.messageId, presentation.label.defaultMessage);
  };
  const userCell = (row) => (
    <CellText text={userText(t, row)} strong={Boolean(row.user?.email || row.user?.username)} />
  );
  // The Content Manager link is offered only when the reader may read that user.
  const openUser = (row) => {
    const path = row.user?.email || row.user?.username ? getUserEntryPath(row.user) : null;
    return path && showUser ? (
      <LinkButton tag={RouterLink} to={path} variant="secondary" data-open-user="">
        {t('userActivity.details.openUser', 'Open user')}
      </LinkButton>
    ) : null;
  };
  return (
    <EventTable
      rows={rows}
      label={label}
      wide={showUser}
      busy={busy}
      nameOf={nameOf}
      rowKind={(row) => getEventPresentation(row).key}
      badge={(row) => <EventBadge presentation={getEventPresentation(row)} />}
      columns={(layout) => [
        {
          id: 'event',
          header: t('adminPanel.activity.column.event', 'Event'),
          render: (row) => (
            <EventCell
              presentation={getEventPresentation(row)}
              detail={userEventDetailText(t, row, layout !== 'full')}
            />
          ),
        },
        ...(showUser
          ? [{ id: 'user', header: t('userActivity.column.user', 'User'), render: userCell }]
          : []),
        {
          id: 'details',
          header: t('adminPanel.activity.column.details', 'IP address and device'),
          render: (row) => <SignInDetails row={row} />,
        },
        ...(layout === 'full'
          ? [
              {
                id: 'doneBy',
                header: t('adminPanel.activity.column.doneBy', 'Done by'),
                render: (row) => <CellText text={doneByText(t, row)} />,
              },
            ]
          : []),
      ]}
      stackedSubject={showUser ? userCell : undefined}
      stackedDetail={(row) =>
        [userEventDetailText(t, row, true), ipText(t, row), getEventPlace(row), deviceText(t, row)]
          .filter(Boolean)
          .join(' · ')
      }
      details={(row) => userEventDetails(t, formatDate, row)}
      detailsAction={(row, close) => {
        const open = openUser(row);
        const extra = detailsAction ? detailsAction(row, close) : null;
        // A lock answers "why can this user not sign in?"; the next step,
        // lifting it, is one click away instead of four (4.23.1).
        const locks = isLockEvent(row) ? (
          <LinkButton tag={RouterLink} to={LOCKED_NOW_PATH} variant="secondary" data-open-locks="">
            {t('userActivity.details.openLocks', 'Go to Locked now')}
          </LinkButton>
        ) : null;
        if (!open && !extra && !locks) return null;
        return (
          <Flex gap={2} wrap="wrap">
            {open}
            {extra}
            {locks}
          </Flex>
        );
      }}
    />
  );
};
