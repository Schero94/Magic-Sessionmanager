import { useIntl } from 'react-intl';
import { Flex, Typography } from '@strapi/design-system';
import styled from 'styled-components';
import { getTranslation } from '../../utils/getTranslation';
import { SESSION_STATES, SESSION_STATUS_PRESENTATION } from '../../utils/sessionStatus.mjs';
import { Disclosure, StatusBadge } from '../../components/ui';
import { HOW_IT_WORKS_STORAGE_KEY } from './dashboardModel.mjs';

/**
 * Legend without browser bullets: one column on small screens, three equal
 * columns (Active, Idle, Ended) from the DS medium breakpoint, so the
 * definitions start on one line and fill the card instead of leaving the
 * right half empty.
 */
const Legend = styled.ul`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: ${({ theme }) => theme.spaces[4]};
  list-style: none;
  margin: 0;
  padding: 0;

  /* The page text rhythm spaces stacked list items; grid cells use the gap. */
  && > li {
    margin: 0;
    max-width: none;
  }

  ${({ theme }) => theme.breakpoints.medium} {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: ${({ theme }) => theme.spaces[6]};
  }
`;

/**
 * "How sessions work" disclosure (IA D1.3): collapsed by default; the open
 * state is remembered per viewer in localStorage (every access wrapped in
 * try/catch, so private windows and blocked storage simply start collapsed).
 * The legend shows the badge, label and glossary definition of Active, Idle
 * and Ended, plus one line about history retention.
 *
 * @returns {import('react').ReactElement} Disclosure.
 */
const HowSessionsWork = () => {
  const { formatMessage } = useIntl();
  const t = (id, defaultMessage, values) =>
    formatMessage({ id: getTranslation(id), defaultMessage }, values);
  return (
    <Disclosure
      label={t('homepage.howItWorks.toggle', 'How sessions work')}
      storageKey={HOW_IT_WORKS_STORAGE_KEY}
      dataAttribute="how-sessions-work"
    >
      <Flex direction="column" alignItems="stretch" gap={4}>
        <Legend>
          {SESSION_STATES.map((state) => {
            const { definition } = SESSION_STATUS_PRESENTATION[state];
            return (
              <Flex
                key={state}
                tag="li"
                direction="column"
                alignItems="flex-start"
                gap={2}
                minWidth={0}
              >
                <StatusBadge status={state} size="S" />
                <Typography variant="omega" textColor="neutral800">
                  {formatMessage({
                    id: getTranslation(definition.messageId),
                    defaultMessage: definition.defaultMessage,
                  })}
                </Typography>
              </Flex>
            );
          })}
        </Legend>
        <Typography variant="pi" textColor="neutral600">
          {t(
            'homepage.howItWorks.history',
            'Ended sessions stay in the history until they are deleted.'
          )}
        </Typography>
        <Typography variant="pi" textColor="neutral600">
          {t(
            'homepage.howItWorks.untracked',
            'Strapi also keeps its own list of sign-ins (refresh tokens). A sign-in that has no session details here, for example one from before this plugin tracked sessions, is not in this list and is never counted as active or online. A notice above the cards shows how many there are and why.'
          )}
        </Typography>
      </Flex>
    </Disclosure>
  );
};

export default HowSessionsWork;
