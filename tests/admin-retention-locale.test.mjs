import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IntlMessageFormat } from 'intl-messageformat';

import { readSettingsSource } from './helpers/settingsSource.mjs';

const source = readSettingsSource();
const translations = Object.fromEntries(['en', 'de', 'es', 'fr', 'pt'].map((locale) => [locale, JSON.parse(readFileSync(new URL(`../admin/src/translations/${locale}.json`, import.meta.url)))]));

test('retention passes a numeric value and uses the never branch for -1', () => {
  assert.match(source, /settings\.retentionDays === -1\s*\? t\('settings\.general\.retention\.hintNever'/);
  assert.match(source, /\{ days: settings\.retentionDays \}/);
  assert.doesNotMatch(source, /\$\{settings\.retentionDays\} days/);
});

test('retention hints format singular and plural durations in each locale', () => {
  const units = { en: ['day', 'days'], de: ['Tag', 'Tagen'], es: ['día', 'días'], fr: ['jour', 'jours'], pt: ['dia', 'dias'] };
  for (const [locale, [singular, plural]] of Object.entries(units)) {
    const format = new IntlMessageFormat(translations[locale]['settings.general.retention.hint'], locale);
    assert.match(format.format({ days: 1 }), new RegExp(`1 ${singular}\\b`, 'u'), locale);
    assert.match(format.format({ days: 90 }), new RegExp(`90 ${plural}\\b`, 'u'), locale);
    assert.ok(translations[locale]['settings.general.retention.hintNever']);
  }
});
