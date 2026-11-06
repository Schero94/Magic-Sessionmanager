import { useId, useState } from 'react';
import { useIntl } from 'react-intl';
import { Box, Button, Flex, Typography } from '@strapi/design-system';
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

/** Legend rows without browser bullets. */
const Legend = styled.ul`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spaces[3]};
  list-style: none;
  margin: 0;
  padding: 0;
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

  return (
    <Box background="neutral0" hasRadius shadow="tableShadow" padding={4} data-how-sessions-work="">
      <Button
        variant="tertiary"
        size="S"
        startIcon={<Caret $open={open} aria-hidden focusable={false} />}
        aria-expanded={open}
        aria-controls={contentId}
        onClick={toggle}
      >
        {t('homepage.howItWorks.toggle', 'How sessions work')}
      </Button>
      <Box id={contentId} hidden={!open} paddingTop={4}>
        {open ? (
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Legend>
              {SESSION_STATES.map((state) => {
                const { definition } = SESSION_STATUS_PRESENTATION[state];
                return (
                  <Flex key={state} tag="li" gap={3} alignItems="flex-start" wrap="wrap">
                    <Box minWidth={0} shrink={0}>
                      <StatusBadge status={state} size="S" />
                    </Box>
                    <Typography variant="omega" textColor="neutral800" style={{ flex: '1 1 0', minWidth: 0 }}>
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
    </Box>
  );
};

export default HowSessionsWork;
