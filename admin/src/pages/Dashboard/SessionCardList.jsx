import { Box, Flex, Typography } from '@strapi/design-system';
import styled from 'styled-components';
import { MissingValue, StatusBadge, ValueOrMissing } from '../../components/ui';
import SessionActions from './SessionActions';
import { DeviceSummary } from './SessionTable';
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

/** Monospace identifiers (IA H.13). */
const MONOSPACE = { fontFamily: 'monospace' };

/**
 * Session cards below the DS medium breakpoint (IA D1, "Below medium"). Card
 * order: state badge with its second line; user (name, email); device and
 * IP address; then equal-width buttons Details, End session (open rows only)
 * and More (Delete record). The list is a real <ul>, so its accessible name
 * is exposed and the cards are announced as list items.
 *
 * @param {object} props
 * @param {object[]} props.sessions Rows of the current page.
 * @param {string} props.labelledBy Id of the list caption.
 * @param {boolean} props.busy A background refresh is running.
 * @param {(session: object, opener: HTMLElement) => void} props.onView Opens the detail dialog.
 * @param {(session: object) => Promise<void>} props.onEnd Ends a session.
 * @param {(session: object) => Promise<void>} props.onDelete Deletes a record.
 * @param {boolean} props.mutationPending A mutation is running.
 * @param {(sessionId: string) => {current: HTMLElement|null}} props.getFocusFallback Focus target after a row changes.
 * @returns {import('react').ReactElement} Card list.
 */
const SessionCardList = ({
  sessions,
  labelledBy,
  busy,
  onView,
  onEnd,
  onDelete,
  mutationPending,
  getFocusFallback,
}) => (
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
          <Flex direction="column" alignItems="stretch" gap={3}>
            <StatusBadge session={session} size="S" detail />

            <Flex direction="column" alignItems="stretch" minWidth={0}>
              <Typography variant="delta" tag="h3" textColor="neutral800" style={{ overflowWrap: 'anywhere' }}>
                {user.primary || <MissingValue variant="delta" />}
              </Typography>
              {user.secondary ? (
                <Typography variant="pi" textColor="neutral600" style={{ overflowWrap: 'anywhere' }}>
                  {user.secondary}
                </Typography>
              ) : null}
            </Flex>

            <Flex gap={2} alignItems="center" wrap="wrap" minWidth={0}>
              <Box minWidth={0} flex="1 1 auto">
                <DeviceSummary session={session} />
              </Box>
              <Typography variant="pi" textColor="neutral600" style={MONOSPACE}>
                <ValueOrMissing value={session.ipAddress} />
              </Typography>
            </Flex>

            <SessionActions
              layout="card"
              session={session}
              onView={onView}
              onEnd={onEnd}
              onDelete={onDelete}
              mutationPending={mutationPending}
              focusFallback={getFocusFallback(session.id)}
            />
          </Flex>
        </Box>
      );
    })}
  </CardList>
);

export default SessionCardList;
