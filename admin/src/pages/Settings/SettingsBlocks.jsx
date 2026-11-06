import { useEffect, useId, useState } from 'react';
import { Accordion, Box, Flex, SingleSelect, SingleSelectOption, Typography } from '@strapi/design-system';
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
