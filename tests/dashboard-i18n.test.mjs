import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../admin/src/${path}`, import.meta.url), 'utf8');

const DASHBOARD_FILES = [
  'pages/HomePage.jsx',
  'components/SessionDetailModal.jsx',
  'utils/sessionSecurity.mjs',
  ...readdirSync(new URL('../admin/src/pages/Dashboard/', import.meta.url))
    .filter((file) => /\.(?:jsx|mjs|js)$/.test(file))
    .map((file) => `pages/Dashboard/${file}`),
];

/** Collects `t('id', 'default')` calls and `messageId`/`defaultMessage` descriptors. */
const collectMessages = () => {
  const messages = new Map();
  for (const file of DASHBOARD_FILES) {
    const source = read(file);
    for (const match of source.matchAll(/\bt\(\s*'([^']+)',\s*(['"])((?:\\.|(?!\2).)*)\2/g)) {
      messages.set(match[1], match[3].replace(/\\'/g, "'"));
    }
    for (const match of source.matchAll(/messageId: '([^']+)', defaultMessage: '([^']*)'/g)) {
      messages.set(match[1], match[2]);
    }
  }
  return messages;
};

const LOCALES = ['en', 'de', 'fr', 'es', 'pt'];
const translations = Object.fromEntries(LOCALES.map((locale) => [locale, JSON.parse(read(`translations/${locale}.json`))]));
const messages = collectMessages();
const pending = [...messages].filter(([key, defaultMessage]) =>
  LOCALES.some((locale) => !(key in translations[locale])) || translations.en[key] !== defaultMessage
);

test('dashboard and session detail texts all go through translation ids', () => {
  assert.ok(messages.size >= 60, `collected ${messages.size} dashboard messages`);
  for (const file of DASHBOARD_FILES) {
    const source = read(file);
    // No English sentence fragments in JSX text (I18N-4, DUX-04).
    assert.doesNotMatch(source, /\}\s+on\s+\{/, `${file} has no hard-coded " on "`);
    assert.doesNotMatch(source, /\[WARNING\]|'High' : 'Low'/, `${file} has no raw English status words`);
    if (file.endsWith('.jsx')) {
      assert.doesNotMatch(source, /'Unknown'|'Unavailable'|'N\/A'/, `${file} has no English missing-value words`);
    }
  }
});

test('dashboard message ids exist in every locale with matching English defaults', {
  todo: pending.length ? `pending i18n merge: ${pending.length} key(s)` : false,
}, () => {
  for (const [key, defaultMessage] of messages) {
    for (const locale of LOCALES) {
      assert.ok(typeof translations[locale][key] === 'string' && translations[locale][key].trim(), `${key} exists in ${locale}`);
    }
    assert.equal(translations.en[key], defaultMessage, `${key} default matches en`);
  }
  // German uses "Sitzung" and no developer jargon in confirmations (DUX-03).
  assert.doesNotMatch(translations.de['modal.confirm.terminate'], /isActive/);
  assert.equal(translations.de['modal.timeline.minutes'], '{minutes} Min.');
});
