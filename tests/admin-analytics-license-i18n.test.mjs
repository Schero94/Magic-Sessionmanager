import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ACTIVATION_SUMMARY_MESSAGES } from '../admin/src/utils/activationSummary.mjs';
import { DEVICE_TYPE_MESSAGES } from '../admin/src/utils/devicePresentation.mjs';

/**
 * Every message id used by Analytics, Activation and the activation download
 * must exist in all five locales, and the English catalog must equal the
 * defaultMessage in code (UX-01 follow-up, UX-09, I18N-11).
 *
 * TODO(integrator): new and changed keys are delivered through the i18n merge
 * step (scratchpad/i18n/analytics-license.json). Flip STRICT to true after the
 * merge has landed in admin/src/translations.
 */
const STRICT = true;
const options = STRICT ? {} : { todo: 'enabled after the analytics-license i18n merge' };

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
  ...Object.values(ACTIVATION_SUMMARY_MESSAGES).map(({ messageId, defaultMessage }) => [messageId, defaultMessage]),
  ...Object.values(DEVICE_TYPE_MESSAGES).map(({ messageId, defaultMessage }) => [messageId, defaultMessage]),
]);

test('the scan finds the analytics and activation messages', () => {
  assert.ok(messages.size > 40, `found ${messages.size} message ids`);
  assert.ok(messages.has('analytics.browser.other'));
  assert.ok(messages.has('license.download.heading'));
});

test('analytics and activation message ids exist in every locale with matching English defaults', options, () => {
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

test('German analytics and activation copy uses the formal Sie', options, () => {
  const informal = /\b(?:du|dein\w*|dich|dir)\b|\bVersuche\b|\bprüfe\b/i;
  for (const id of messages.keys()) {
    const value = catalogs.de[id];
    if (typeof value === 'string') assert.doesNotMatch(value, informal, id);
  }
});
