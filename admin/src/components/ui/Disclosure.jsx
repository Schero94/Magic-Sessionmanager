import { useId, useState } from 'react';
import { Box, Flex, TextButton } from '@strapi/design-system';
import { CaretDown } from '@strapi/icons';
import styled from 'styled-components';
import {
  getBrowserStorage,
  readDisclosureOpen,
  writeDisclosureOpen,
} from '../../pages/Dashboard/dashboardModel.mjs';

const Caret = styled(CaretDown)`
  transform: rotate(${({ $open }) => ($open ? '0deg' : '-90deg')});
`;

/**
 * "How … works" disclosure shared by the app-user and the admin panel views
 * (4.23.1), so both explain themselves the same way: a DS TextButton on the
 * page background, flush with the title edge and lighter than the stat
 * cards, and only the opened text on the white section surface. The open
 * state is remembered per viewer under `storageKey` (best effort). The
 * 32 px min-height keeps the hit area at the touch-target size.
 *
 * @param {object} props
 * @param {string} props.label Toggle text.
 * @param {string} props.storageKey Browser storage key for the open state.
 * @param {string} [props.dataAttribute] Data attribute name for tests, without `data-`.
 * @param {import('react').ReactNode} props.children Content shown when open.
 * @returns {import('react').ReactElement} Disclosure.
 */
const Disclosure = ({ label, storageKey, dataAttribute = 'disclosure', children }) => {
  const [open, setOpen] = useState(() => readDisclosureOpen(getBrowserStorage(), storageKey));
  const contentId = `disclosure-${useId().replace(/:/g, '')}`;

  const toggle = () => {
    setOpen((previous) => {
      const next = !previous;
      writeDisclosureOpen(getBrowserStorage(), next, storageKey);
      return next;
    });
  };

  return (
    <Flex direction="column" alignItems="flex-start" gap={2} {...{ [`data-${dataAttribute}`]: '' }}>
      <TextButton
        minHeight="3.2rem"
        startIcon={<Caret $open={open} aria-hidden focusable={false} />}
        aria-expanded={open}
        aria-controls={contentId}
        onClick={toggle}
      >
        {label}
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
        {open ? children : null}
      </Box>
    </Flex>
  );
};

export default Disclosure;
