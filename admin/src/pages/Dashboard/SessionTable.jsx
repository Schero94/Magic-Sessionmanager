import { useIntl } from 'react-intl';
import { Box, Flex, Table, Tbody, Td, Th, Thead, Tooltip, Tr, Typography, VisuallyHidden } from '@strapi/design-system';
import { getTranslation } from '../../utils/getTranslation';
import { getDevicePresentation } from '../../utils/devicePresentation.mjs';
import { toValidDate } from '../../utils/sessionDates.mjs';
import { isNativeOnlySession } from '../../utils/sessionStatus.mjs';
import { useSessionFormatters } from '../../utils/useSessionFormatters';
import { DeviceIcon, MissingValue, StatusBadge, ValueOrMissing } from '../../components/ui';
import SessionActions from './SessionActions';
import { DASHBOARD_COMPACT_TABLE_COLUMNS, DASHBOARD_TABLE_COLUMNS, getSessionUserLabels } from './dashboardModel.mjs';

/**
 * Cells that share the remaining width and cut long values with an ellipsis
 * instead of forcing a horizontal scroll (DUX-01, DASH-02). `max-width: 0`
 * lets an auto-layout table shrink the column below its content width.
 */
const SHRINKING_USER_CELL = { maxWidth: 0, width: '30%' };
const SHRINKING_DEVICE_CELL = { maxWidth: 0, width: '25%' };

/**
 * In the compact table (768-1199 px list width) the longest "{reason} ·
 * {Ended at}" line would otherwise widen the Status column to about a third
 * of the table and squeeze User and Device to a few letters. The detail line
 * wraps instead, inside a share comparable to the User column.
 */
const COMPACT_STATUS_CELL = { width: '24%', whiteSpace: 'normal' };

/** Monospace identifiers (IA H.13) through the theme font stack. */
const MONOSPACE = { fontFamily: 'monospace' };

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
 * Absolute sign-in time in the admin locale.
 *
 * @param {{value: unknown}} props Timestamp.
 * @returns {import('react').ReactElement} Date or the missing marker.
 */
export const SignedIn = ({ value }) => {
  const { formatDate } = useSessionFormatters();
  const date = toValidDate(value);
  if (!date) return <MissingValue variant="omega" />;
  return (
    <Typography tag="time" dateTime={date.toISOString()} variant="omega" textColor="neutral800">
      {formatDate(date)}
    </Typography>
  );
};

/**
 * Device-type icon with "{browser} · {os}" (IA D1.7, H.9): no browser
 * version, "Unknown device" when nothing could be parsed, and "—" for
 * Strapi sessions, which record no device details. The device type is
 * named in a second line when it is known, so the decorative icon is never
 * the only carrier of that fact.
 *
 * @param {{session: object}} props Session row.
 * @returns {import('react').ReactElement} Device summary.
 */
export const DeviceSummary = ({ session }) => {
  const { deviceTypeLabel, deviceSummary } = useSessionFormatters();
  if (isNativeOnlySession(session)) return <MissingValue variant="omega" />;

  const device = getDevicePresentation(session);
  const typeLabel = deviceTypeLabel(session);
  const summary = device.hasSummary ? deviceSummary(session) : typeLabel;

  return (
    <Flex gap={2} alignItems="center" minWidth={0}>
      <Flex shrink={0} color="neutral600" aria-hidden>
        <DeviceIcon icon={device.icon} />
      </Flex>
      <Flex direction="column" alignItems="stretch" minWidth={0}>
        <Typography variant="omega" textColor="neutral800" ellipsis title={summary}>
          {summary}
        </Typography>
        {device.hasSummary && device.hasDeviceType ? (
          <Typography variant="pi" textColor="neutral600" ellipsis title={typeLabel}>
            {typeLabel}
          </Typography>
        ) : null}
      </Flex>
    </Flex>
  );
};

/**
 * Session table from the DS medium breakpoint. From the large breakpoint it
 * shows every column; between medium and large the IP address and Signed in
 * columns are hidden (they stay in the dialog). Uses the DS grid table with
 * explicit column/row counts so arrow-key navigation works (DASH-01). Rows
 * open the detail dialog on click as a mouse convenience; they are not extra
 * tab stops and have no aria-label (DUX-08). The View details button is the
 * keyboard path to the same dialog.
 *
 * @param {object} props
 * @param {object[]} props.sessions Rows of the current page.
 * @param {string} props.labelledBy Id of the list caption.
 * @param {boolean} props.busy A background refresh is running.
 * @param {boolean} props.compact Hide the IP address and Signed in columns.
 * @param {(session: object, opener: HTMLElement) => void} props.onView Opens the detail dialog.
 * @param {(session: object) => Promise<void>} props.onEnd Ends a session.
 * @param {(session: object) => Promise<void>} props.onDelete Deletes a record.
 * @param {boolean} props.mutationPending A mutation is running.
 * @param {(sessionId: string) => {current: HTMLElement|null}} props.getFocusFallback Focus target after a row changes.
 * @returns {import('react').ReactElement} DS table.
 */
const SessionTable = ({
  sessions,
  labelledBy,
  busy,
  compact = false,
  onView,
  onEnd,
  onDelete,
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
      colCount={compact ? DASHBOARD_COMPACT_TABLE_COLUMNS : DASHBOARD_TABLE_COLUMNS}
      rowCount={sessions.length + 1}
      aria-labelledby={labelledBy}
      aria-busy={busy}
    >
      <Thead>
        <Tr>
          <Th style={compact ? COMPACT_STATUS_CELL : undefined}>{header('homepage.table.status', 'Status')}</Th>
          <Th>{header('homepage.table.user', 'User')}</Th>
          <Th>{header('homepage.table.device', 'Device')}</Th>
          {compact ? null : <Th>{header('homepage.table.ipAddress', 'IP address')}</Th>}
          {compact ? null : <Th>{header('homepage.table.signedIn', 'Signed in')}</Th>}
          <Th>{header('homepage.table.lastActive', 'Last active')}</Th>
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
              <Td style={compact ? COMPACT_STATUS_CELL : undefined}>
                <StatusBadge session={session} size="S" detail />
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
              {compact ? null : (
                <Td>
                  <Typography variant="omega" textColor="neutral800" style={MONOSPACE}>
                    <ValueOrMissing value={session.ipAddress} />
                  </Typography>
                </Td>
              )}
              {compact ? null : (
                <Td>
                  <SignedIn value={session.loginTime} />
                </Td>
              )}
              <Td>
                <LastActive value={session.lastActive || session.loginTime} />
              </Td>
              <Td>
                <Box>
                  <SessionActions
                    layout="table"
                    session={session}
                    onView={onView}
                    onEnd={onEnd}
                    onDelete={onDelete}
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
