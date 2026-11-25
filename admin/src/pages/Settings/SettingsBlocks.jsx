import { Fragment, useId, useState } from 'react';
import {
  Accordion,
  Box,
  Flex,
  SingleSelect,
  SingleSelectOption,
  Typography,
} from '@strapi/design-system';
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
 * Says why protected settings are read-only (4.17): location lookup,
 * webhooks and the security log need "Change protected settings"
 * (`plugin::magic-sessionmanager.settings.update`). The server enforces it.
 *
 * @returns {import('react').ReactElement} Notice line.
 */
export const ProtectedNotice = () => {
  const { t } = useSettingsTranslate();
  return (
    <RequiresNotice>
      {t(
        'settings.config.protected.notice',
        'Read-only for your role: changing this needs the “Change protected settings” permission.'
      )}
    </RequiresNotice>
  );
};

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
 * Says why a risk-dependent control is off: it needs a risk data source
 * (VPN, proxy and Tor data), which location data alone does not provide.
 * When the saved value is on, it also says that the value is kept and takes
 * effect once a source exists, so an upgrade never silently loses a choice.
 *
 * @param {{ savedOn?: boolean, tab?: string|null }} props Saved state and the
 *   tab that sets up risk data (null when the notice is already on that tab).
 * @returns {import('react').ReactElement} Requirement lines.
 */
export const RiskSourceNotice = ({ savedOn = false, tab = 'location-data' }) => {
  const { t } = useSettingsTranslate();
  return (
    <Flex direction="column" alignItems="flex-start" gap={1} data-risk-source-notice="">
      <RequiresNotice tab={tab || undefined}>
        {t('settings.config.requires.riskData', 'Needs a risk data source')}
      </RequiresNotice>
      {savedOn ? (
        <Typography variant="pi" textColor="neutral600" tag="p">
          {t(
            'settings.config.requires.riskData.savedOn',
            'Saved as on. It takes effect once a risk data source is set up.'
          )}
        </Typography>
      ) : null}
    </Flex>
  );
};

/**
 * The DS accordion marks keyboard focus only with a faint border tint. The
 * trigger gets the same 2 px primary focus ring as other DS controls; the
 * styled trigger receives the class itself, no DS markup is selected (SET-17).
 */
const AdvancedTrigger = styled(Accordion.Trigger)`
  &&:focus-visible {
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
  const [hadError, setHadError] = useState(false);

  // Open when a field inside becomes invalid. Adjusting state during render
  // avoids an extra effect pass.
  if (hasError !== hadError) {
    setHadError(hasError);
    if (hasError) setOpen(itemValue);
  }

  return (
    <Accordion.Root value={open} onValueChange={setOpen} data-advanced-section="">
      <Accordion.Item value={itemValue} disabled={disabled && !hasError}>
        <Accordion.Header>
          <AdvancedTrigger>{label || t('settings.config.advanced', 'Advanced')}</AdvancedTrigger>
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
export const PresetSelect = ({
  id,
  name,
  label,
  description,
  error,
  value,
  presets,
  format,
  onChange,
  disabled = false,
}) => {
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
          <Typography
            variant="omega"
            fontWeight={code ? undefined : 'semiBold'}
            textColor="neutral800"
          >
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
