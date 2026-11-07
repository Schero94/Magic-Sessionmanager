import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { LICENSE_SUMMARY_MESSAGES } from '../admin/src/utils/activationSummary.mjs';
import {
  LICENSE_FEATURES_MESSAGE,
  LICENSE_STATE_MESSAGES,
} from '../admin/src/utils/licenseStatus.mjs';
import { DEVICE_TYPE_MESSAGES } from '../admin/src/utils/devicePresentation.mjs';

/**
 * Every message id used by Analytics, License and the license download must
 * exist in all five locales, and the English catalog must equal the
 * defaultMessage in code (UX-01 follow-up, UX-09, I18N-11).
 */

const read = (path) => readFileSync(new URL(`../admin/src/${path}`, import.meta.url), 'utf8');
const locales = ['en', 'de', 'es', 'fr', 'pt'];
const catalogs = Object.fromEntries(
  locales.map((locale) => [locale, JSON.parse(read(`translations/${locale}.json`))])
);

/** Collects literal `t('id', 'default')` calls and feature tuples from a page. */
const collect = (source) => {
  const messages = new Map();
  for (const match of source.matchAll(/\bt\(\s*'([\w.]+)',\s*'((?:[^'\\]|\\.)*)'/g)) {
    messages.set(match[1], match[2].replace(/\\'/g, "'"));
  }
  for (const match of source.matchAll(/\['(license\.features\.\w+)',\s*'([^']*)'\]/g)) {
    messages.set(match[1], match[2]);
  }
  return messages;
};

const messages = new Map([
  ...collect(read('pages/Analytics.jsx')),
  ...collect(read('pages/License.jsx')),
  ...[
    ...Object.values(LICENSE_SUMMARY_MESSAGES),
    ...Object.values(LICENSE_STATE_MESSAGES),
    LICENSE_FEATURES_MESSAGE,
  ].map(({ messageId, defaultMessage }) => [messageId, defaultMessage]),
  ...Object.values(DEVICE_TYPE_MESSAGES).map(({ messageId, defaultMessage }) => [
    messageId,
    defaultMessage,
  ]),
]);

test('the scan finds the analytics and license messages', () => {
  assert.ok(messages.size > 40, `found ${messages.size} message ids`);
  assert.ok(messages.has('analytics.bucket.unknown'));
  assert.ok(messages.has('license.state.noKey'));
  assert.ok(messages.has('license.download.heading'));
});

test('analytics and license message ids exist in every locale with matching English defaults', () => {
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

test('German analytics and license copy uses the formal Sie', () => {
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
  assert.equal(catalogs.de['license.title'], 'Lizenz');
  for (const id of messages.keys()) {
    const value = catalogs.de[id];
    if (typeof value !== 'string') continue;
    assert.doesNotMatch(value, /\bSession\b(?! Manager)/, `${id} says "Sitzung" in running text`);
    assert.doesNotMatch(value, /Aktivierung/, `${id} uses the retired "Aktivierung"`);
  }
});
