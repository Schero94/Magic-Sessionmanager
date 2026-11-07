import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IntlMessageFormat } from 'intl-messageformat';
import { readSettingsFile } from './helpers/settingsSource.mjs';
import { readCatalogue } from './helpers/settingsCatalogue.mjs';

test('retention is a preset select with "Forever" for -1 and a numeric value (IA F Tab 5)', () => {
  const tab = readSettingsFile('DataRetentionTab.jsx');
  const field = tab.match(/<PresetSelect\s+id="session-retention-period"[\s\S]*?\/>/)?.[0] || '';
  assert.match(field, /value=\{settings\.retentionDays\}/);
  assert.match(field, /presets=\{SELECT_PRESETS\.retentionDays\}/);
  assert.match(field, /format=\{units\.retentionDays\}/);
  assert.match(field, /onChange=\{\(value\) => handleChange\('retentionDays', value\)\}/);
  assert.match(
    readSettingsFile('SettingsBlocks.jsx'),
    /onChange=\{\(next\) => onChange\(Number\.parseInt\(next, 10\)\)\}/,
    'the draft stores numbers'
  );
  assert.doesNotMatch(tab, /\$\{settings\.retentionDays\} days/);
});

test('unit labels format singular and plural durations in each locale (IA H.7)', () => {
  const expected = {
    en: { day: '1 day', days: '90 days', min: '15 min', s: '30 s' },
    de: { day: '1 Tag', days: '90 Tage', min: '15 Min.', s: '30 Sek.' },
    es: { day: '1 día', days: '90 días', min: '15 min', s: '30 s' },
    fr: { day: '1 jour', days: '90 jours', min: '15 min', s: '30 s' },
    pt: { day: '1 dia', days: '90 dias', min: '15 min', s: '30 s' },
  };
  for (const [locale, values] of Object.entries(expected)) {
    const messages = readCatalogue(locale);
    const days = new IntlMessageFormat(messages['settings.config.unit.days'], locale);
    assert.equal(days.format({ count: 1 }), values.day, locale);
    assert.equal(days.format({ count: 90 }), values.days, locale);
    assert.equal(
      new IntlMessageFormat(messages['settings.config.unit.minutes'], locale).format({ count: 15 }),
      values.min,
      locale
    );
    assert.equal(
      new IntlMessageFormat(messages['settings.config.unit.seconds'], locale).format({ count: 30 }),
      values.s,
      locale
    );
    assert.ok(messages['settings.config.option.forever'], locale);
    assert.match(
      new IntlMessageFormat(messages['settings.config.option.custom'], locale).format({
        value: '45 min',
      }),
      /^45 min \(.+\)$/,
      locale
    );
  }
});
