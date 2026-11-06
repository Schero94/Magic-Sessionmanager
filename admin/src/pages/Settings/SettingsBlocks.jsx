import { Fragment, useEffect, useId, useState } from 'react';
import { Accordion, Box, Flex, SingleSelect, SingleSelectOption, Typography } from '@strapi/design-system';
import styled from 'styled-components';
import FormField from '../../components/FormField';
import ReadableText from '../../components/ReadableText';
import { buildSelectOptions } from './settingsTabs.mjs';
import { SettingsTabLink } from './SettingsNavigation';
import { useOptionLabels } from './hooks/useOptionLabels';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

/**
 * One intro sentence at the top of a tab or card (IA D5.3).
 *
 * @param {{ children: import('react').ReactNode }} props Sentence.
 * @returns {import('react').ReactElement} Intro paragraph.
 */
export const IntroText = ({ children }) => (
  <ReadableText variant="omega" textColor="neutral600" tag="p">
    {children}
  </ReadableText>
);

/**
 * Explains why a dependent field is disabled ("Requires IP location
 * lookup") and links to the tab that owns the setting (IA D5.4, F).
 *
 * @param {{ tab?: string, children: import('react').ReactNode }} props Owning tab and requirement text.
 * @returns {import('react').ReactElement} Requirement line.
 */
export const RequiresNotice = ({ tab, children }) => (
  <Typography variant="pi" textColor="neutral600" tag="p" data-requires="">
    {tab ? <SettingsTabLink tab={tab}>{children}</SettingsTabLink> : children}
  </Typography>
);

/**
 * The "Requires IP location lookup" line linking to Location data.
 *
 * @returns {import('react').ReactElement} Requirement line.
 */
export const RequiresGeolocation = () => {
  const { t } = useSettingsTranslate();
  return (
    <RequiresNotice tab="location-data">
      {t('settings.config.requires.geolocation', 'Requires IP location lookup')}
    </RequiresNotice>
  );
};

/**
 * The DS accordion marks keyboard focus only with a faint border tint. The
 * trigger gets the same 2 px primary focus ring as other DS controls.
 */
const AdvancedFrame = styled.div`
  min-width: 0;

  & button[data-radix-collection-item][aria-expanded]:not([role]):focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: -2px;
  }
`;

/**
 * Collapsed "Advanced" accordion inside a card (IA D5.3). It opens by itself
 * when a field inside it becomes invalid, so the error is never hidden.
 *
 * @param {{
 *   label?: string,
 *   hasError?: boolean,
 *   disabled?: boolean,
 *   children: import('react').ReactNode,
 * }} props Trigger label (defaults to "Advanced"), error state and content.
 * @returns {import('react').ReactElement} Accordion.
 */
export const AdvancedSection = ({ label, hasError = false, disabled = false, children }) => {
  const { t } = useSettingsTranslate();
  const itemValue = useId();
  const [open, setOpen] = useState('');

  useEffect(() => {
    if (hasError) setOpen(itemValue);
  }, [hasError, itemValue]);

  return (
    <AdvancedFrame>
      <Accordion.Root value={open} onValueChange={setOpen} data-advanced-section="">
        <Accordion.Item value={itemValue} disabled={disabled && !hasError}>
          <Accordion.Header>
            <Accordion.Trigger>{label || t('settings.config.advanced', 'Advanced')}</Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Content>
            <Box padding={{ initial: 4, medium: 6 }}>
              <Flex direction="column" alignItems="stretch" gap={6}>
                {children}
              </Flex>
            </Box>
          </Accordion.Content>
        </Accordion.Item>
      </Accordion.Root>
    </AdvancedFrame>
  );
};

/**
 * DS SingleSelect over numeric presets with readable, unit-bearing labels.
 * A stored value outside the presets stays selected as "{value} (custom)"
 * instead of being replaced (IA F).
 *
 * @param {{
 *   id: string,
 *   name: string,
 *   label: string,
 *   description?: import('react').ReactNode,
 *   error?: string,
 *   value: number,
 *   presets: readonly number[],
 *   format: (value: number) => string,
 *   onChange: (value: number) => void,
 *   disabled?: boolean,
 * }} props Field copy, value, presets and formatter.
 * @returns {import('react').ReactElement} Select field.
 */
export const PresetSelect = ({ id, name, label, description, error, value, presets, format, onChange, disabled = false }) => {
  const { custom } = useOptionLabels();
  const options = buildSelectOptions(presets, value);
  return (
    <FormField id={id} name={name} label={label} description={description} error={error}>
      <SingleSelect
        value={String(value)}
        disabled={disabled}
        onChange={(next) => onChange(Number.parseInt(next, 10))}
      >
        {options.map((option) => (
          <SingleSelectOption key={option.value} value={String(option.value)}>
            {option.custom ? custom(format(option.value)) : format(option.value)}
          </SingleSelectOption>
        ))}
      </SingleSelect>
    </FormField>
  );
};

const Terms = styled.dl`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: ${({ theme }) => theme.spaces[1]} ${({ theme }) => theme.spaces[6]};
  margin: 0;
  min-width: 0;

  /* The term column takes its natural width, but never more than 45% of
     the list: a long term ('403 "Login temporarily unavailable"') wraps
     instead of squeezing the descriptions into a narrow column. */
  ${({ theme }) => theme.breakpoints.small} {
    grid-template-columns: fit-content(45%) minmax(0, 1fr);
    row-gap: ${({ theme }) => theme.spaces[3]};
  }

  dt,
  dd {
    margin: 0;
    min-width: 0;
  }

  dd + dt {
    margin-top: ${({ theme }) => theme.spaces[2]};
  }

  ${({ theme }) => theme.breakpoints.small} {
    dd + dt {
      margin-top: 0;
    }
  }

  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
`;

/**
 * Read-only reference list (IA F 1.3 and 2.5): a term column and a
 * description column, so every description starts on the same edge. One
 * column below the DS small breakpoint. Terms keep their case (no sigma
 * uppercase), because they quote protocol values and server messages.
 *
 * @param {{
 *   items: Array<{ id: string, term: string, description: string }>,
 *   label?: string,
 *   code?: boolean,
 * }} props Rows, accessible name and whether terms are protocol codes
 *   (monospace).
 * @returns {import('react').ReactElement} Description list.
 */
export const TermList = ({ items, label, code = false }) => (
  <Terms aria-label={label} data-term-list="">
    {items.map((item) => (
      <Fragment key={item.id}>
        <dt>
          <Typography variant="omega" fontWeight={code ? undefined : 'semiBold'} textColor="neutral800">
            {code ? <code>{item.term}</code> : item.term}
          </Typography>
        </dt>
        <dd>
          <Typography variant="omega" textColor="neutral700">
            {item.description}
          </Typography>
        </dd>
      </Fragment>
    ))}
  </Terms>
);
