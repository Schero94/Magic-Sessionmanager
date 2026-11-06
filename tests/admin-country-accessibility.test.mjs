import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../admin/src/pages/Settings.jsx', import.meta.url), 'utf8');
test('each country has a named, disabled-aware native remove button', () => {
  const section = source.slice(source.indexOf('activeList.map((code)'), source.indexOf('id="country-picker"'));
  assert.match(section, /<Button\b/);
  assert.match(section, /disabled=\{!settings\.enableGeofencing\}/);
  assert.match(section, /aria-label=\{t\('settings\.geofencing\.removeCountry', 'Remove \{country\}', \{ country: formatCountry\(code, locale\) \}\)\}/);
  assert.match(section, /onClick=\{\(\) => removeCode\(code\)\}/);
});

test('country removal label exists in all supported locales', () => {
  for (const locale of ['en', 'de', 'es', 'fr', 'pt']) {
    const messages = JSON.parse(readFileSync(new URL(`../admin/src/translations/${locale}.json`, import.meta.url)));
    assert.match(messages['settings.geofencing.removeCountry'] || '', /\{country\}/, locale);
  }
});
