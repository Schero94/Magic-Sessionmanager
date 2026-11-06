import { useIntl } from 'react-intl';
import { Box, Flex, Table, Tbody, Td, Th, Thead, Tooltip, Tr, Typography, VisuallyHidden } from '@strapi/design-system';
import { getTranslation } from '../../utils/getTranslation';
import { getDevicePresentation } from '../../utils/devicePresentation.mjs';
import { toValidDate } from '../../utils/sessionDates.mjs';
import { useSessionFormatters } from '../../utils/useSessionFormatters';
import { DeviceIcon, MissingValue, StatusBadge, ValueOrMissing } from '../../components/ui';
import SessionActions from './SessionActions';
import { DASHBOARD_TABLE_COLUMNS, getSessionUserLabels } from './dashboardModel.mjs';

/**
 * Cells that share the remaining width and cut long values with an ellipsis
 * instead of forcing a horizontal scroll (DUX-01, DASH-02). `max-width: 0`
 * lets an auto-layout table shrink the column below its content width.
 */
const SHRINKING_USER_CELL = { maxWidth: 0, width: '40%' };
const SHRINKING_DEVICE_CELL = { maxWidth: 0, width: '30%' };

/**
 * Last activity as relative time, with the absolute admin-locale date in a
 * tooltip and in the machine-readable `dateTime`.
 *
 * @param {{value: unknown}} props Timestamp.
 * @returns {import('react').ReactElement} Relative time or the missing marker.
 */
export const LastActive = ({ value }) => {
  const { formatDate, formatRelativeTime } = useSessionFormatters();
  const date = toValidDate(value);
  if (!date) return <MissingValue variant="omega" />;

  return (
    <Tooltip label={formatDate(date)}>
      <Typography tag="time" dateTime={date.toISOString()} variant="omega" textColor="neutral800">
        {formatRelativeTime(date)}
      </Typography>
    </Tooltip>
  );
};

/**
 * Device type with icon, plus "Browser 17 · OS" (or one translated
 * "unavailable" line, never "Unavailable on Unavailable").
 *
 * @param {{session: object}} props Session row.
 * @returns {import('react').ReactElement} Device summary.
 */
export const DeviceSummary = ({ session }) => {
  const { deviceTypeLabel, deviceSummary } = useSessionFormatters();
  const device = getDevicePresentation(session);
  const typeLabel = deviceTypeLabel(session);
  const summary = deviceSummary(session);

  return (
    <Flex gap={2} alignItems="center" minWidth={0}>
      <Flex shrink={0} color="neutral600" aria-hidden>
        <DeviceIcon icon={device.icon} />
      </Flex>
      <Flex direction="column" alignItems="stretch" minWidth={0}>
        <Typography variant="omega" fontWeight="semiBold" textColor="neutral800" ellipsis title={typeLabel}>
          {typeLabel}
        </Typography>
        <Typography variant="pi" textColor="neutral600" ellipsis title={summary}>
          {summary}
        </Typography>
      </Flex>
    </Flex>
  );
};

/**
 * Desktop session table (from the DS large breakpoint). Uses the DS grid
 * table with explicit column/row counts so arrow-key navigation works
 * (DASH-01). Rows open the detail modal on click as a mouse convenience;
 * they are not extra tab stops and have no aria-label (DUX-08). The View
 * button in the Actions column is the keyboard path to the same dialog.
 *
 * @param {object} props
 * @param {object[]} props.sessions Rows of the current page.
 * @param {string} props.labelledBy Id of the list heading.
 * @param {boolean} props.busy A background refresh is running.
 * @param {(session: object, opener: HTMLElement) => void} props.onView Opens the detail modal.
 * @param {(sessionId: string) => Promise<void>} props.onLogOut Logs a session out.
 * @param {(sessionId: string) => Promise<void>} props.onRemove Removes session details.
 * @param {boolean} props.mutationPending A mutation is running.
 * @param {(sessionId: string) => {current: HTMLElement|null}} props.getFocusFallback Focus target after a row changes.
 * @returns {import('react').ReactElement} DS table.
 */
const SessionTable = ({
  sessions,
  labelledBy,
  busy,
  onView,
  onLogOut,
  onRemove,
  mutationPending,
  getFocusFallback,
}) => {
  const { formatMessage } = useIntl();
  const t = (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values);

  const header = (id, defaultMessage) => (
    <Typography variant="sigma" textColor="neutral600">
      {t(id, defaultMessage)}
    </Typography>
  );

  return (
    <Table
      colCount={DASHBOARD_TABLE_COLUMNS}
      rowCount={sessions.length + 1}
      aria-labelledby={labelledBy}
      aria-busy={busy}
    >
      <Thead>
        <Tr>
          <Th>{header('homepage.table.status', 'Status')}</Th>
          <Th>{header('homepage.table.user', 'User')}</Th>
          <Th>{header('homepage.table.device', 'Device')}</Th>
          <Th>{header('homepage.table.ipAddress', 'IP Address')}</Th>
          <Th>{header('homepage.table.lastActive', 'Last Active')}</Th>
          <Th>
            <VisuallyHidden>{t('homepage.table.actions', 'Actions')}</VisuallyHidden>
          </Th>
        </Tr>
      </Thead>
      <Tbody>
        {sessions.map((session) => {
          const user = getSessionUserLabels(session);
          return (
            <Tr
              key={session.id}
              style={{ cursor: 'pointer' }}
              onClick={(event) => {
                const opener = event.currentTarget.querySelector('[data-session-view]');
                onView(session, opener || event.currentTarget);
              }}
            >
              <Td>
                <StatusBadge session={session} size="S" />
              </Td>
              <Td style={SHRINKING_USER_CELL}>
                <Flex direction="column" alignItems="stretch" minWidth={0}>
                  {user.primary ? (
                    <Typography fontWeight="semiBold" textColor="neutral800" ellipsis title={user.primary}>
                      {user.primary}
                    </Typography>
                  ) : (
                    <MissingValue variant="omega" />
                  )}
                  {user.secondary ? (
                    <Typography variant="pi" textColor="neutral600" ellipsis title={user.secondary}>
                      {user.secondary}
                    </Typography>
                  ) : null}
                </Flex>
              </Td>
              <Td style={SHRINKING_DEVICE_CELL}>
                <DeviceSummary session={session} />
              </Td>
              <Td>
                <Typography variant="omega" textColor="neutral800">
                  <ValueOrMissing value={session.ipAddress} />
                </Typography>
              </Td>
              <Td>
                <LastActive value={session.lastActive || session.loginTime} />
              </Td>
              <Td>
                <Box>
                  <SessionActions
                    layout="table"
                    session={session}
                    onView={onView}
                    onLogOut={onLogOut}
                    onRemove={onRemove}
                    mutationPending={mutationPending}
                    focusFallback={getFocusFallback(session.id)}
                  />
                </Box>
              </Td>
            </Tr>
          );
        })}
      </Tbody>
    </Table>
  );
};

export default SessionTable;
