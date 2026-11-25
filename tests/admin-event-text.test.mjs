/**
 * Text of the admin event lists (admin/src/pages/AdminPanel/eventText.mjs): changed settings in
 * the Settings page's own words, grouped by tab, with the raw key only for unknown keys.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupChangedSettings } from '../admin/src/pages/AdminPanel/adminActivityModel.mjs';
import {
  changedSettingsLines,
  changedSettingsText,
  eventDetailText,
} from '../admin/src/pages/AdminPanel/eventText.mjs';
import { getSignInEventPresentation } from '../admin/src/pages/AdminPanel/adminActivityModel.mjs';

const catalogue = (locale) =>
  JSON.parse(readFileSync(new URL(`../admin/src/translations/${locale}.json`, import.meta.url)));

/**
 * Minimal translator like the admin's: catalogue value or default, `{name}` placeholders and the
 * one plural/number form these texts use.
 * @param {Record<string, string>} messages - Catalogue.
 * @returns {(id: string, defaultMessage: string, values?: object) => string} Translator.
 */
const translator =
  (messages) =>
  (id, defaultMessage, values = {}) =>
    (messages[id] ?? defaultMessage).replace(/\{(\w+)(?:, number)?\}/g, (_, name) =>
      String(values[name] ?? '')
    );

const KEYS = ['maxFailedLogins', 'lockoutDurationMinutes', 'adminSignInHistory', 'futureKey'];

test('changed settings are grouped by Settings tab in tab order; unknown keys come last', () => {
  const groups = groupChangedSettings([
    'adminSignInHistory',
    ...KEYS,
    'blockedCountries',
    'allowedCountries',
  ]);
  assert.deepEqual(
    groups.map((group) => [group.tab, group.fields.map((field) => field.key)]),
    [
      ['login-protection', ['maxFailedLogins', 'lockoutDurationMinutes', 'blockedCountries']],
      ['data-retention', ['adminSignInHistory']],
      [null, ['futureKey']],
    ],
    'tab order, duplicates and same-label keys (allowed/blocked countries) once'
  );
  assert.equal(groups[2].fields[0].label, null);
  assert.deepEqual(groupChangedSettings(null), []);
  assert.deepEqual(groupChangedSettings(['', 42]), []);
});

test('English: labels of the Settings page, grouped, raw key only when unknown', () => {
  const t = translator(catalogue('en'));
  assert.equal(
    changedSettingsText(t, KEYS),
    'Login protection: Lock an IP address after, Lock for · Data and retention: Record admin sign-ins · futureKey'
  );
  assert.equal(
    changedSettingsText(t, KEYS, { limit: 3 }),
    'Login protection: Lock an IP address after, Lock for · Data and retention: Record admin sign-ins and 1 more'
  );
  assert.deepEqual(changedSettingsLines(t, KEYS), [
    'Login protection: Lock an IP address after, Lock for',
    'Data and retention: Record admin sign-ins',
    'futureKey',
  ]);
  assert.equal(changedSettingsText(t, []), '');
});

test('German and French use their own labels and punctuation', () => {
  assert.equal(
    changedSettingsText(translator(catalogue('de')), KEYS.slice(0, 3)),
    'Anmeldeschutz: IP-Adresse sperren nach, Sperren für · Daten und Aufbewahrung: Admin-Anmeldungen speichern'
  );
  assert.match(changedSettingsText(translator(catalogue('fr')), ['maxFailedLogins']), /^\S.* : /);
});

test('the event cell names at most three settings', () => {
  const t = translator(catalogue('en'));
  const row = { event: 'settings.updated', change: { keys: KEYS, viaToken: true } };
  assert.equal(
    eventDetailText(t, row, getSignInEventPresentation(row), false),
    'With an admin API token · Login protection: Lock an IP address after, Lock for · Data and retention: Record admin sign-ins and 1 more'
  );
});
