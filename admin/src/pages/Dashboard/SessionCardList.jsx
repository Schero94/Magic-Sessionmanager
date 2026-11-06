import { useIntl } from 'react-intl';
import { Box, Flex, Typography } from '@strapi/design-system';
import styled from 'styled-components';
import { getTranslation } from '../../utils/getTranslation';
import { useSessionFormatters } from '../../utils/useSessionFormatters';
import { toValidDate } from '../../utils/sessionDates.mjs';
import { MissingValue, PropertyList, StatusBadge } from '../../components/ui';
import SessionActions from './SessionActions';
import { DeviceSummary, LastActive } from './SessionTable';
import { getSessionUserLabels } from './dashboardModel.mjs';

/** Semantic list without browser bullets or indentation (DUX-14, DASH-18). */
const CardList = styled.ul`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spaces[4]};
  list-style: none;
  margin: 0;
  padding: 0;
  min-width: 0;
`;

/**
 * Session cards below the DS large breakpoint. Each card shows the same facts
 * as a table row as a PropertyList, with the row actions as equal-width
 * buttons. The list is a real <ul>, so its accessible name is exposed and the
 * cards are announced as list items.
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
 * @returns {import('react').ReactElement} Card list.
 */
const SessionCardList = ({
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
  const { formatDate } = useSessionFormatters();
  const t = (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values);

  return (
    <CardList aria-labelledby={labelledBy} aria-busy={busy}>
      {sessions.map((session) => {
        const user = getSessionUserLabels(session);
        return (
          <Box
            key={session.id}
            tag="li"
            background="neutral0"
            hasRadius
            shadow="tableShadow"
            padding={4}
            minWidth={0}
          >
            <Flex direction="column" alignItems="stretch" gap={4}>
              <Flex justifyContent="space-between" alignItems="flex-start" gap={2} wrap="wrap">
                <Flex direction="column" alignItems="stretch" minWidth={0} flex="1 1 auto">
                  <Typography variant="delta" tag="h3" textColor="neutral800" style={{ overflowWrap: 'anywhere' }}>
                    {user.primary || <MissingValue variant="delta" />}
                  </Typography>
                  {user.secondary ? (
                    <Typography variant="pi" textColor="neutral600" style={{ overflowWrap: 'anywhere' }}>
                      {user.secondary}
                    </Typography>
                  ) : null}
                </Flex>
                <StatusBadge session={session} size="S" />
              </Flex>

              <PropertyList
                items={[
                  {
                    id: 'device',
                    label: t('homepage.table.device', 'Device'),
                    render: <DeviceSummary session={session} />,
                  },
                  { id: 'ip', label: t('homepage.table.ipAddress', 'IP Address'), value: session.ipAddress, kind: 'id' },
                  {
                    id: 'lastActive',
                    label: t('homepage.table.lastActive', 'Last Active'),
                    render: <LastActive value={session.lastActive || session.loginTime} />,
                  },
                  {
                    id: 'login',
                    label: t('homepage.table.loginTime', 'Login Time'),
                    value: toValidDate(session.loginTime) ? formatDate(session.loginTime) : null,
                  },
                ]}
              />

              <SessionActions
                layout="card"
                session={session}
                onView={onView}
                onLogOut={onLogOut}
                onRemove={onRemove}
                mutationPending={mutationPending}
                focusFallback={getFocusFallback(session.id)}
              />
            </Flex>
          </Box>
        );
      })}
    </CardList>
  );
};

export default SessionCardList;
