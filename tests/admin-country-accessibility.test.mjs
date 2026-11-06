import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readSettingsFile } from './helpers/settingsSource.mjs';

// countries.js is an ES module inside a CommonJS package; load it as ESM text.
const countriesSource = readFileSync(new URL('../admin/src/utils/countries.js', import.meta.url), 'utf8');
const { getFocusIndexAfterRemoval } = await import(`data:text/javascript;base64,${Buffer.from(countriesSource).toString('base64')}`);

const source = readSettingsFile('CountryListEditor.jsx');

test('each country is a DS Tag whose remove button has a localized name without the flag emoji', () => {
  const section = source.slice(source.indexOf('activeList.map((code)'), source.indexOf('id="country-picker"'));
  assert.match(section, /<Tag\b/);
  assert.match(section, /icon=\{<Cross aria-hidden focusable=\{false\} \/>\}/);
  assert.match(section, /label=\{t\('settings\.geofencing\.removeCountry', 'Remove \{country\}', \{ country: getCountryName\(code, locale\) \|\| code \}\)\}/);
  assert.match(section, /onClick=\{\(\) => removeCode\(code\)\}/);
  assert.doesNotMatch(section, /disabled=\{!settings\.enableGeofencing\}/, 'lists stay editable while geofencing is off (SET-16)');
  assert.doesNotMatch(section, /×/, 'no text glyph inside the accessible name');
});

test('focus moves to the next chip, else the previous one, else the picker (SET-06 browser)', () => {
  assert.equal(getFocusIndexAfterRemoval(0, 2), 0);
  assert.equal(getFocusIndexAfterRemoval(2, 2), 1);
  assert.equal(getFocusIndexAfterRemoval(0, 0), null);
  assert.match(source, /setFocusIndex\(getFocusIndexAfterRemoval\(index, next\.length\)\)/);
  assert.match(source, /chips\[focusIndex\]\.focus\(\)/);
  assert.match(source, /else pickerRef\.current\?\.focus\(\)/);
});

test('country picker is a DS Combobox with typeahead and a separate typed-code field', () => {
  assert.match(source, /<Combobox\b[\s\S]*?autocomplete=\{\{ type: 'list', filter: 'contains' \}\}/);
  assert.match(source, /<ComboboxOption key=\{option\.code\} value=\{option\.code\}>/);
  assert.match(source, /const \[manualCode, setManualCode\] = useState\(''\)/, 'typed code has its own state');
  assert.match(source, /error=\{manualError\}/);
  assert.doesNotMatch(source, /1 1 12rem/, 'no rem flex-basis (12rem is 120px in Strapi)');
});

test('geofencing mode is a labelled DS Radio group with confirmation before a list is cleared (SET-05)', () => {
  assert.match(source, /<Radio\.Group\b[\s\S]*?aria-labelledby=\{modeLabelId\}[\s\S]*?value=\{mode\}[\s\S]*?onValueChange=\{requestMode\}/);
  assert.match(source, /<Radio\.Item value="allowlist">/);
  assert.match(source, /<Radio\.Item value="blocklist">/);
  assert.match(source, /if \(impact\.confirm\) \{\s*setPendingMode\(requestedMode\)/);
  assert.match(source, /<ConfirmDialog\b[\s\S]*?settings\.geofencing\.mode\.confirmTitle/);
});

test('country removal label exists in all supported locales', () => {
  for (const locale of ['en', 'de', 'es', 'fr', 'pt']) {
    const messages = JSON.parse(readFileSync(new URL(`../admin/src/translations/${locale}.json`, import.meta.url)));
    assert.match(messages['settings.geofencing.removeCountry'] || '', /\{country\}/, locale);
  }
});
