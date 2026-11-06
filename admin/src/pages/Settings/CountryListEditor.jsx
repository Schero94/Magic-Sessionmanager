import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Button,
  Combobox,
  ComboboxOption,
  Dialog,
  Flex,
  Radio,
  Tag,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { ConfirmDialog } from '@strapi/strapi/admin';
import { Cross, Plus } from '@strapi/icons';
import styled from 'styled-components';
import { EqualGrid } from '../../components/ui';
import FormField from '../../components/FormField';
import ReadableText from '../../components/ReadableText';
import {
  formatCountry,
  getCountryName,
  getCountryOptions,
  getFocusIndexAfterRemoval,
  normalizeCountryCode,
} from '../../utils/countries';
import {
  getGeofencingField,
  getModeChangeImpact,
  inferGeofencingMode,
  selectGeofencingMode,
} from '../../utils/geofencingMode.mjs';
import { validateCountryCode } from '../../utils/settingsForm.mjs';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

/**
 * Country chips. A DS Tag is 28 px tall; below the medium breakpoint the
 * remove buttons grow to the 32 px touch target (IA D5 mobile).
 */
const ChipList = styled(Flex)`
  & button {
    min-width: ${({ theme }) => theme.spaces[7]};
    min-height: ${({ theme }) => theme.spaces[7]};
    justify-content: center;
  }

  ${({ theme }) => theme.breakpoints.medium} {
    & button {
      min-width: 0;
      min-height: 0;
    }
  }
`;

/**
 * Country rules editor: "Allow only listed countries" or "Reject listed
 * countries" (IA F 2.4). The mode is a DS Radio group; switching it asks for
 * confirmation before the other list is cleared (SET-05, IA E.2). Countries
 * are added through a Combobox with typeahead or a typed ISO code, shown as
 * DS Tags, and stay editable while the feature is off (SET-16). After a chip
 * is removed, focus moves to the next chip, else the previous one, else the
 * picker (SET-06 browser).
 *
 * @param {{ settings: object, handleChange: Function }} props Draft and change handler.
 * @returns {import('react').ReactElement} Country list editor.
 */
const CountryListEditor = ({ settings, handleChange }) => {
  const { t, tError, locale } = useSettingsTranslate();
  const modeLabelId = useId();
  const listLabelId = useId();
  const [mode, setMode] = useState(() => inferGeofencingMode(settings));
  const [pendingMode, setPendingMode] = useState(null);
  // A new key remounts the Combobox with an empty input after each pick.
  const [pickerKey, setPickerKey] = useState(0);
  const [refocusPicker, setRefocusPicker] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [focusIndex, setFocusIndex] = useState(undefined);
  const chipListRef = useRef(null);
  const pickerRef = useRef(null);
  const modeGroupRef = useRef(null);

  const activeField = getGeofencingField(mode);
  const activeList = Array.isArray(settings[activeField]) ? settings[activeField] : [];
  const options = useMemo(() => getCountryOptions(locale, activeList), [locale, activeList]);
  const manualError = tError(validateCountryCode(manualCode, activeList));

  // Keep the mode in sync when the draft is reset or reloaded from the server.
  const inferredMode = inferGeofencingMode(settings);
  const allowedCount = settings.allowedCountries?.length || 0;
  const blockedCount = settings.blockedCountries?.length || 0;
  useEffect(() => {
    if (allowedCount > 0 || blockedCount > 0) setMode(inferredMode);
  }, [inferredMode, allowedCount, blockedCount]);

  useEffect(() => {
    if (focusIndex === undefined) return;
    const chips = chipListRef.current?.querySelectorAll('button') || [];
    if (focusIndex !== null && chips[focusIndex]) chips[focusIndex].focus();
    else pickerRef.current?.focus();
    setFocusIndex(undefined);
  }, [focusIndex, activeList.length]);

  useEffect(() => {
    if (!refocusPicker) return;
    pickerRef.current?.focus();
    setRefocusPicker(false);
  }, [refocusPicker, pickerKey]);

  const applyMode = (requestedMode) => {
    const selection = selectGeofencingMode(mode, requestedMode);
    if (selection.mode === mode) return;
    setMode(selection.mode);
    if (selection.clearField) handleChange(selection.clearField, []);
  };

  const requestMode = (requestedMode) => {
    const impact = getModeChangeImpact(settings, mode, requestedMode);
    if (impact.confirm) {
      setPendingMode(requestedMode);
      return;
    }
    applyMode(requestedMode);
  };

  const focusSelectedMode = () => {
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      modeGroupRef.current?.querySelector('[role="radio"][data-state="checked"]')?.focus();
    });
  };

  const addCode = (raw) => {
    const code = normalizeCountryCode(raw);
    if (!code || activeList.includes(code)) return false;
    handleChange(activeField, [...activeList, code]);
    return true;
  };

  const removeCode = (code) => {
    const index = activeList.indexOf(code);
    const next = activeList.filter((entry) => entry !== code);
    handleChange(activeField, next);
    setFocusIndex(getFocusIndexAfterRemoval(index, next.length));
  };

  const pendingImpact = pendingMode ? getModeChangeImpact(settings, mode, pendingMode) : null;
  const modeLabels = {
    allowlist: t('settings.config.countries.mode.allow', 'Allow only listed countries'),
    blocklist: t('settings.config.countries.mode.reject', 'Reject listed countries'),
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Flex direction="column" alignItems="stretch" gap={2}>
        <Typography
          id={modeLabelId}
          variant="pi"
          fontWeight="bold"
          tag="div"
          textColor="neutral800"
        >
          {t('settings.config.countries.mode.label', 'Mode')}
        </Typography>
        <Radio.Group
          ref={modeGroupRef}
          aria-labelledby={modeLabelId}
          value={mode}
          onValueChange={requestMode}
        >
          <Radio.Item value="allowlist">{modeLabels.allowlist}</Radio.Item>
          <Radio.Item value="blocklist">{modeLabels.blocklist}</Radio.Item>
        </Radio.Group>
      </Flex>

      <Dialog.Root
        open={Boolean(pendingMode)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingMode(null);
            focusSelectedMode();
          }
        }}
      >
        <ConfirmDialog
          title={t('settings.config.countries.switch.title', 'Switch to {mode}?', {
            mode: modeLabels[pendingMode] ?? '',
          })}
          variant="danger"
          endAction={
            <Dialog.Action>
              <Button
                fullWidth
                variant="danger"
                onClick={() => {
                  applyMode(pendingMode);
                  setPendingMode(null);
                  focusSelectedMode();
                }}
              >
                {t('settings.config.countries.switch.action', 'Switch mode')}
              </Button>
            </Dialog.Action>
          }
        >
          {t(
            'settings.config.countries.switch.body',
            'The current list of {count, plural, one {# country} other {# countries}} is cleared when you save.',
            { count: pendingImpact?.count ?? 0 }
          )}
        </ConfirmDialog>
      </Dialog.Root>

      <Flex direction="column" alignItems="stretch" gap={3}>
        <Flex direction="column" alignItems="stretch" gap={1}>
          <Typography
            id={listLabelId}
            variant="pi"
            fontWeight="bold"
            tag="div"
            textColor="neutral800"
          >
            {t('settings.config.countries.list.label', 'Countries')}
          </Typography>
          <ReadableText variant="pi" textColor="neutral600" tag="p">
            {t(
              'settings.config.countries.list.hint',
              "With 'Allow only listed countries', an empty list allows every country."
            )}
          </ReadableText>
        </Flex>
        {activeList.length === 0 ? (
          <Typography variant="pi" textColor="neutral600" tag="p">
            {t('settings.geofencing.empty', 'No countries configured.')}
          </Typography>
        ) : (
          <ChipList
            ref={chipListRef}
            tag="ul"
            gap={2}
            wrap="wrap"
            aria-labelledby={listLabelId}
            data-country-chips=""
          >
            {activeList.map((code) => (
              <li key={code}>
                <Tag
                  icon={<Cross aria-hidden focusable={false} />}
                  label={t('settings.geofencing.removeCountry', 'Remove {country}', {
                    country: getCountryName(code, locale) || code,
                  })}
                  onClick={() => removeCode(code)}
                >
                  {formatCountry(code, locale)}
                </Tag>
              </li>
            ))}
          </ChipList>
        )}
      </Flex>

      <EqualGrid columns={2} stackBelow="medium" gap={4}>
        <FormField
          id="country-picker"
          name="countryPicker"
          label={t('settings.geofencing.pick.label', 'Select a country')}
          description={t(
            'settings.geofencing.pick.hint',
            'Choose a country to add it to the active list.'
          )}
        >
          <Combobox
            key={pickerKey}
            ref={pickerRef}
            autocomplete={{ type: 'list', filter: 'contains' }}
            placeholder={t('settings.geofencing.pick', 'Pick a country to add…')}
            onChange={(code) => {
              if (code && addCode(code)) {
                setPickerKey((key) => key + 1);
                setRefocusPicker(true);
              }
            }}
            noOptionsMessage={() => t('settings.geofencing.pick.noResults', 'No matching country')}
          >
            {options.map((option) => (
              <ComboboxOption key={option.code} value={option.code}>
                {option.label}
              </ComboboxOption>
            ))}
          </Combobox>
        </FormField>

        <FormField
          id="country-code-manual"
          name="countryCodeManual"
          label={t('settings.geofencing.manual.label', 'Country code')}
          description={t('settings.geofencing.manual.hint', 'Enter a two-letter ISO country code.')}
          error={manualError}
          action={
            <Button
              variant="secondary"
              size="L"
              startIcon={<Plus aria-hidden focusable={false} />}
              disabled={Boolean(manualError) || !normalizeCountryCode(manualCode)}
              onClick={() => {
                if (addCode(manualCode)) setManualCode('');
              }}
            >
              {t('settings.geofencing.add', 'Add')}
            </Button>
          }
        >
          <TextInput
            placeholder={t('settings.geofencing.manual', 'For example, JP')}
            value={manualCode}
            maxLength={2}
            autoComplete="off"
            onChange={(event) => setManualCode(event.target.value.toUpperCase().slice(0, 2))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (!manualError && addCode(manualCode)) setManualCode('');
              }
            }}
          />
        </FormField>
      </EqualGrid>
    </Flex>
  );
};

export default CountryListEditor;
