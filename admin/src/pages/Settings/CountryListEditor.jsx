import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Box, Button, Combobox, ComboboxOption, Dialog, Flex, Radio, Tag, TextInput, Typography } from '@strapi/design-system';
import { ConfirmDialog } from '@strapi/strapi/admin';
import { Cross, Plus } from '@strapi/icons';
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
 * Allowlist / blocklist editor. The mode is a DS Radio group; switching it
 * asks for confirmation before the other list is cleared (SET-05). Countries
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
  const listTitle = mode === 'allowlist'
    ? t('settings.geofencing.allowed.title', 'Allowed Countries')
    : t('settings.geofencing.blocked.title', 'Blocked Countries');

  return (
    <Flex direction="column" alignItems="stretch" gap={4}>
      <Flex direction="column" alignItems="stretch" gap={2}>
        <Typography id={modeLabelId} variant="delta" tag="h3" textColor="neutral800">
          {t('settings.geofencing.mode.title', 'Mode')}
        </Typography>
        <Radio.Group
          ref={modeGroupRef}
          aria-labelledby={modeLabelId}
          value={mode}
          onValueChange={requestMode}
        >
          <Radio.Item value="allowlist">
            {t('settings.geofencing.mode.allowlist', 'Allowlist (only selected countries)')}
          </Radio.Item>
          <Radio.Item value="blocklist">
            {t('settings.geofencing.mode.blocklist', 'Blocklist (block selected countries)')}
          </Radio.Item>
        </Radio.Group>
        <ReadableText variant="pi" textColor="neutral600" tag="p">
          {mode === 'allowlist'
            ? t('settings.geofencing.mode.allowlist.hint', 'Only countries in the list may authenticate. Empty list = no geo restriction.')
            : t('settings.geofencing.mode.blocklist.hint', 'Every country except those in the list may authenticate.')}
        </ReadableText>
      </Flex>

      <Dialog.Root open={Boolean(pendingMode)} onOpenChange={(open) => { if (!open) { setPendingMode(null); focusSelectedMode(); } }}>
        <ConfirmDialog
          title={t('settings.geofencing.mode.confirmTitle', 'Switch the geofencing mode?')}
          variant="danger"
          endAction={(
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
                {t('settings.geofencing.mode.confirmAction', 'Switch and clear list')}
              </Button>
            </Dialog.Action>
          )}
        >
          {t(
            'settings.geofencing.mode.confirmBody',
            'Switching removes {count, plural, one {# country} other {# countries}} from the current list. The change is saved only when you save the settings.',
            { count: pendingImpact?.count ?? 0 }
          )}
        </ConfirmDialog>
      </Dialog.Root>

      <Flex direction="column" alignItems="stretch" gap={2}>
        <Typography id={listLabelId} variant="delta" tag="h3" textColor="neutral800">
          {listTitle}
        </Typography>
        {activeList.length === 0 ? (
          <Typography variant="pi" textColor="neutral600" tag="p">
            {t('settings.geofencing.empty', 'No countries configured.')}
          </Typography>
        ) : (
          <Flex ref={chipListRef} tag="ul" gap={2} wrap="wrap" aria-labelledby={listLabelId} data-country-chips="">
            {activeList.map((code) => (
              <li key={code}>
                <Tag
                  icon={<Cross aria-hidden focusable={false} />}
                  label={t('settings.geofencing.removeCountry', 'Remove {country}', { country: getCountryName(code, locale) || code })}
                  onClick={() => removeCode(code)}
                >
                  {formatCountry(code, locale)}
                </Tag>
              </li>
            ))}
          </Flex>
        )}
      </Flex>

      <EqualGrid columns={2} stackBelow="medium" gap={4}>
        <FormField
          id="country-picker"
          name="countryPicker"
          label={t('settings.geofencing.pick.label', 'Select a country')}
          description={t('settings.geofencing.pick.hint', 'Choose a country to add it to the active list.')}
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

        <Flex direction="column" alignItems="stretch" gap={2}>
          <FormField
            id="country-code-manual"
            name="countryCodeManual"
            label={t('settings.geofencing.manual.label', 'Country code')}
            description={t('settings.geofencing.manual.hint', 'Enter a two-letter ISO country code.')}
            error={manualError}
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
          <Box>
            <Button
              variant="secondary"
              startIcon={<Plus aria-hidden focusable={false} />}
              disabled={Boolean(manualError) || !normalizeCountryCode(manualCode)}
              onClick={() => {
                if (addCode(manualCode)) setManualCode('');
              }}
            >
              {t('settings.geofencing.add', 'Add')}
            </Button>
          </Box>
        </Flex>
      </EqualGrid>
    </Flex>
  );
};

export default CountryListEditor;
