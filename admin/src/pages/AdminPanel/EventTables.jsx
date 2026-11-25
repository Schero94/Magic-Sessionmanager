import { Badge, Box, Flex, Table, Tbody, Td, Thead, Tr, Typography } from '@strapi/design-system';
import { useElementWidth } from '../../utils/useElementWidth';
import { useSessionFormatters } from '../../utils/useSessionFormatters';
import { getBadgeColors } from '../../components/ui/StatusBadge';
import { MissingValue } from '../../components/ui';
import {
  ACTIVITY_ACTION_LABELS,
  getActivityTone,
  getEventListLayout,
  getEventPlace,
  getSessionStatePresentation,
  getSignInEventPresentation,
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
  contentTypeText,
  deviceText,
  eventDetailText,
  ipText,
  stopCellKeys,
  useT,
} from './EventParts';
import { EventDetailsModal, activityDetails, signInDetails, useEventDetails } from './EventDetails';

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
  const { formatDate, formatRelativeTime } = useSessionFormatters();
  const [measureRef, width] = useElementWidth();
  const {
    selected,
    open: openDetails,
    close: closeDetails,
    onCloseAutoFocus,
    setContainer,
  } = useEventDetails();
  const layout = getEventListLayout(width, { showAdmin });
  const showDoneBy = layout === 'full';

  const detailsLabel = (row, presentation) =>
    t('adminPanel.activity.details.open', 'Details of {event}, {time}', {
      event: t(presentation.label.messageId, presentation.label.defaultMessage),
      time: formatRelativeTime(row.at),
    });

  let list;
  if (layout === 'stacked') {
    list = (
      <StackedList aria-label={label} data-event-list="stacked">
        {rows.map((row) => {
          const presentation = getSignInEventPresentation(row);
          const state = getSessionStatePresentation(row.session);
          const second = [
            eventDetailText(t, row, presentation, true),
            ipText(t, row),
            getEventPlace(row),
            deviceText(t, row),
            state ? t(state.label.messageId, state.label.defaultMessage) : '',
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <StackedItem
              key={row.id}
              data-event-row={presentation.key}
              data-event-id={row.id}
              onClick={(event) => openDetails(row, event.currentTarget)}
            >
              <Flex direction="column" alignItems="stretch" gap={1} padding={3} minWidth={0}>
                {/* Line 1: the badge, the time and the details button on the right (from
                    390 px on one line; at 320 px the time moves down, still right-aligned).
                    Line 2: the admin. Line 3: reason, address, place, device, session. */}
                <Flex gap={2} wrap="wrap" alignItems="center" minWidth={0}>
                  <EventBadge presentation={presentation} />
                  <Flex gap={1} alignItems="center" marginLeft="auto">
                    <EventTime value={row.at} compact />
                    <DetailsButton
                      label={detailsLabel(row, presentation)}
                      onOpen={(trigger) => openDetails(row, trigger)}
                    />
                  </Flex>
                </Flex>
                {showAdmin ? (
                  <Flex minWidth={0}>
                    <AdminName admin={row.admin} row={row} onOpenAdmin={onOpenAdmin} />
                  </Flex>
                ) : null}
                {second ? (
                  <BreakAnywhere variant="pi" textColor="neutral600">
                    {second}
                  </BreakAnywhere>
                ) : null}
              </Flex>
            </StackedItem>
          );
        })}
      </StackedList>
    );
  } else {
    const colCount = 5 + (showAdmin ? 1 : 0) + (showDoneBy ? 1 : 0);
    list = (
      <Box background="neutral0" hasRadius shadow="tableShadow" data-event-list={layout}>
        <Table colCount={colCount} rowCount={rows.length + 1} aria-label={label} aria-busy={busy}>
          <Thead>
            <Tr>
              <HeaderCell>{t('adminPanel.activity.column.time', 'Time')}</HeaderCell>
              <HeaderCell>{t('adminPanel.activity.column.event', 'Event')}</HeaderCell>
              {showAdmin ? (
                <HeaderCell>{t('adminPanel.activity.column.admin', 'Admin')}</HeaderCell>
              ) : null}
              <HeaderCell>
                {t('adminPanel.activity.column.details', 'IP address and device')}
              </HeaderCell>
              <HeaderCell>{t('adminPanel.activity.column.session', 'Session')}</HeaderCell>
              {showDoneBy ? (
                <HeaderCell>{t('adminPanel.activity.column.doneBy', 'Done by')}</HeaderCell>
              ) : null}
              <HeaderCell hidden>{t('adminPanel.table.actions', 'Actions')}</HeaderCell>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((row) => {
              const presentation = getSignInEventPresentation(row);
              const eventDetail = eventDetailText(t, row, presentation, !showDoneBy);
              return (
                <ClickableRow
                  key={row.id}
                  data-event-row={presentation.key}
                  data-event-id={row.id}
                  onClick={(event) => openDetails(row, event.currentTarget)}
                >
                  <Td>
                    <EventTime value={row.at} />
                  </Td>
                  <WrapCell>
                    <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
                      <EventBadge presentation={presentation} nowrap />
                      {eventDetail ? (
                        <Typography variant="pi" textColor="neutral600">
                          {eventDetail}
                        </Typography>
                      ) : null}
                    </Flex>
                  </WrapCell>
                  {showAdmin ? (
                    <WrapCell>
                      <AdminName admin={row.admin} row={row} onOpenAdmin={onOpenAdmin} />
                    </WrapCell>
                  ) : null}
                  <WrapCell>
                    <SignInDetails row={row} />
                  </WrapCell>
                  <WrapCell>
                    <SessionState row={row} />
                  </WrapCell>
                  {showDoneBy ? (
                    <WrapCell>
                      {row.actor?.name ? (
                        <Typography variant="omega" textColor="neutral800">
                          {row.actor.name}
                        </Typography>
                      ) : (
                        <MissingValue variant="omega" />
                      )}
                    </WrapCell>
                  ) : null}
                  <Td onClick={(event) => event.stopPropagation()}>
                    <Flex justifyContent="flex-end" gap={1} onKeyDown={stopCellKeys}>
                      <DetailsButton
                        label={detailsLabel(row, presentation)}
                        onOpen={(trigger) => openDetails(row, trigger)}
                      />
                    </Flex>
                  </Td>
                </ClickableRow>
              );
            })}
          </Tbody>
        </Table>
      </Box>
    );
  }

  const content = selected ? signInDetails(t, formatDate, selected) : null;
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
  const { formatDate, formatRelativeTime } = useSessionFormatters();
  const [measureRef, width] = useElementWidth();
  const {
    selected,
    open: openDetails,
    close: closeDetails,
    onCloseAutoFocus,
    setContainer,
  } = useEventDetails();
  const layout = getEventListLayout(width, { showAdmin });

  const actionOf = (row) => {
    const entry = ACTIVITY_ACTION_LABELS[row.action] || ACTIVITY_ACTION_LABELS.view;
    return t(entry.messageId, entry.defaultMessage);
  };
  const detailsLabel = (row) =>
    t('adminPanel.activity.details.open', 'Details of {event}, {time}', {
      event: actionOf(row),
      time: formatRelativeTime(row.at),
    });
  const badge = (row) => (
    <Badge
      {...getBadgeColors(getActivityTone(row.action))}
      data-event-tone={getActivityTone(row.action)}
    >
      {actionOf(row)}
    </Badge>
  );

  let list;
  if (layout === 'stacked') {
    list = (
      <StackedList aria-label={label} data-event-list="stacked">
        {rows.map((row) => (
          <StackedItem
            key={row.id}
            data-event-row={row.action}
            data-event-id={row.id}
            onClick={(event) => openDetails(row, event.currentTarget)}
          >
            <Flex direction="column" alignItems="stretch" gap={1} padding={3} minWidth={0}>
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
              <Flex minWidth={0}>
                <ActivityEntry row={row} />
              </Flex>
              {contentTypeText(row) || (showAdmin && row.admin?.name) ? (
                <Typography variant="pi" textColor="neutral600">
                  {[contentTypeText(row), showAdmin ? row.admin?.name : '']
                    .filter(Boolean)
                    .join(' · ')}
                </Typography>
              ) : null}
            </Flex>
          </StackedItem>
        ))}
      </StackedList>
    );
  } else {
    const colCount = 5 + (showAdmin ? 1 : 0);
    list = (
      <Box background="neutral0" hasRadius shadow="tableShadow" data-event-list={layout}>
        <Table colCount={colCount} rowCount={rows.length + 1} aria-label={label} aria-busy={busy}>
          <Thead>
            <Tr>
              <HeaderCell>{t('adminPanel.activity.column.time', 'Time')}</HeaderCell>
              <HeaderCell>{t('adminPanel.activity.column.action', 'Action')}</HeaderCell>
              <HeaderCell>{t('adminPanel.activity.column.entry', 'Entry')}</HeaderCell>
              <HeaderCell>{t('adminPanel.activity.column.contentType', 'Content type')}</HeaderCell>
              {showAdmin ? (
                <HeaderCell>{t('adminPanel.activity.column.admin', 'Admin')}</HeaderCell>
              ) : null}
              <HeaderCell hidden>{t('adminPanel.table.actions', 'Actions')}</HeaderCell>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((row) => (
              <ClickableRow
                key={row.id}
                data-event-row={row.action}
                data-event-id={row.id}
                onClick={(event) => openDetails(row, event.currentTarget)}
              >
                <Td>
                  <EventTime value={row.at} />
                </Td>
                <Td>{badge(row)}</Td>
                <WrapCell>
                  <ActivityEntry row={row} />
                </WrapCell>
                <WrapCell>
                  {contentTypeText(row) ? (
                    <Typography variant="omega" textColor="neutral800">
                      {contentTypeText(row)}
                    </Typography>
                  ) : (
                    <MissingValue variant="omega" />
                  )}
                </WrapCell>
                {showAdmin ? (
                  <WrapCell>
                    <AdminName admin={row.admin} />
                  </WrapCell>
                ) : null}
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

  const content = selected ? activityDetails(t, formatDate, selected) : null;
  return (
    <Box ref={measureRef} minWidth={0} width="100%">
      <Box ref={setContainer} tabIndex={-1} minWidth={0}>
        {list}
      </Box>
      {content ? (
        <EventDetailsModal
          title={content.title}
          items={content.items}
          onClose={closeDetails}
          onCloseAutoFocus={onCloseAutoFocus}
        />
      ) : null}
    </Box>
  );
};
