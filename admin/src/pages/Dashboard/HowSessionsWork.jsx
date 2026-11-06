import { useId, useState } from 'react';
import { useIntl } from 'react-intl';
import { Box, Flex, TextButton, Typography } from '@strapi/design-system';
import { CaretDown } from '@strapi/icons';
import styled from 'styled-components';
import { getTranslation } from '../../utils/getTranslation';
import { SESSION_STATES, SESSION_STATUS_PRESENTATION } from '../../utils/sessionStatus.mjs';
import { StatusBadge } from '../../components/ui';
import { getBrowserStorage, readDisclosureOpen, writeDisclosureOpen } from './dashboardModel.mjs';

/** Caret that points down when open and right when closed. */
const Caret = styled(CaretDown)`
  transform: rotate(${({ $open }) => ($open ? '0deg' : '-90deg')});
`;

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
  const t = (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const [open, setOpen] = useState(() => readDisclosureOpen(getBrowserStorage()));
  const contentId = `how-sessions-work-${useId().replace(/:/g, '')}`;

  const toggle = () => {
    setOpen((previous) => {
      const next = !previous;
      writeDisclosureOpen(getBrowserStorage(), next);
      return next;
    });
  };

  // No card of its own: a DS TextButton on the page background, flush with
  // the title edge, so the disclosure stays lighter than the stat cards below
  // it. Only the opened legend gets the white section surface. The 32 px
  // min-height keeps the hit area at the touch-target size.
  return (
    <Flex direction="column" alignItems="flex-start" gap={2} data-how-sessions-work="">
      <TextButton
        minHeight="3.2rem"
        startIcon={<Caret $open={open} aria-hidden focusable={false} />}
        aria-expanded={open}
        aria-controls={contentId}
        onClick={toggle}
      >
        {t('homepage.howItWorks.toggle', 'How sessions work')}
      </TextButton>
      <Box
        id={contentId}
        hidden={!open}
        width="100%"
        background="neutral0"
        hasRadius
        shadow="tableShadow"
        padding={{ initial: 4, medium: 6 }}
      >
        {open ? (
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Legend>
              {SESSION_STATES.map((state) => {
                const { definition } = SESSION_STATUS_PRESENTATION[state];
                return (
                  <Flex key={state} tag="li" direction="column" alignItems="flex-start" gap={2} minWidth={0}>
                    <StatusBadge status={state} size="S" />
                    <Typography variant="omega" textColor="neutral800">
                      {formatMessage({ id: getTranslation(definition.messageId), defaultMessage: definition.defaultMessage })}
                    </Typography>
                  </Flex>
                );
              })}
            </Legend>
            <Typography variant="pi" textColor="neutral600">
              {t('homepage.howItWorks.history', 'Ended sessions stay in the history until they are deleted.')}
            </Typography>
          </Flex>
        ) : null}
      </Box>
    </Flex>
  );
};

export default HowSessionsWork;
