import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { DEVICE_TYPE_MESSAGES } from '../admin/src/utils/devicePresentation.mjs';

/**
 * Every message id used by Analytics and the device labels must exist in all
 * five locales, and the English catalog must equal the
 * defaultMessage in code (UX-01 follow-up, UX-09, I18N-11).
 */

const read = (path) => readFileSync(new URL(`../admin/src/${path}`, import.meta.url), 'utf8');
const locales = ['en', 'de', 'es', 'fr', 'pt'];
const catalogs = Object.fromEntries(
  locales.map((locale) => [locale, JSON.parse(read(`translations/${locale}.json`))])
);

/** Collects literal `t('id', 'default')` calls from a page. */
const collect = (source) => {
  const messages = new Map();
  for (const match of source.matchAll(/\bt\(\s*'([\w.]+)',\s*'((?:[^'\\]|\\.)*)'/g)) {
    messages.set(match[1], match[2].replace(/\\'/g, "'"));
  }
  return messages;
};

const messages = new Map([
  ...collect(read('pages/Analytics.jsx')),
  ...Object.values(DEVICE_TYPE_MESSAGES).map(({ messageId, defaultMessage }) => [
    messageId,
    defaultMessage,
  ]),
]);

test('the scan finds the analytics messages', () => {
  assert.ok(messages.size > 20, `found ${messages.size} message ids`);
  assert.ok(messages.has('analytics.bucket.unknown'));
});

test('no catalog keeps a message of the removed license page', () => {
  for (const locale of locales) {
    const leftovers = Object.keys(catalogs[locale]).filter(
      (id) => id.startsWith('license.') || id === 'settings.link.license'
    );
    assert.deepEqual(leftovers, [], locale);
  }
});

test('analytics message ids exist in every locale with matching English defaults', () => {
  const problems = [];
  for (const [id, defaultMessage] of messages) {
    for (const locale of locales) {
      if (typeof catalogs[locale][id] !== 'string' || !catalogs[locale][id].trim()) {
        problems.push(`${id} missing in ${locale}`);
      }
    }
    if (catalogs.en[id] !== undefined && catalogs.en[id] !== defaultMessage) {
      problems.push(`${id}: en "${catalogs.en[id]}" differs from code "${defaultMessage}"`);
    }
  }
  assert.deepEqual(problems, []);
});

test('German analytics copy uses the formal Sie', () => {
  const informal = /\b(?:du|dein\w*|dich|dir)\b|\bVersuche\b|\bprüfe\b/i;
  for (const id of messages.keys()) {
    const value = catalogs.de[id];
    if (typeof value === 'string') assert.doesNotMatch(value, informal, id);
  }
});

test('German copy uses the IA wording for shared sentences (IA D1, D6, D7)', () => {
  assert.equal(
    catalogs.de['analytics.truncated'],
    'Es werden nur die neuesten {count, number} Sitzungen geladen. Zahlen, Filter und Exporte beziehen sich nur auf diese Sitzungen.'
  );
  assert.equal(catalogs.de['analytics.title'], 'Auswertung');
  for (const id of messages.keys()) {
    const value = catalogs.de[id];
    if (typeof value !== 'string') continue;
    assert.doesNotMatch(value, /\bSession\b(?! Manager)/, `${id} says "Sitzung" in running text`);
    assert.doesNotMatch(value, /Aktivierung/, `${id} uses the retired "Aktivierung"`);
  }
});
