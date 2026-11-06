import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../admin/src/${path}`, import.meta.url), 'utf8');

const DASHBOARD_FILES = [
  'pages/HomePage.jsx',
  'components/SessionDetailModal.jsx',
  'components/ui/StatusBadge.jsx',
  'components/ui/EndReason.jsx',
  'utils/sessionSecurity.mjs',
  'utils/sessionStatus.mjs',
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
    for (const match of source.matchAll(/messageId: '([^']+)',\s*defaultMessage: '([^']*)'/g)) {
      messages.set(match[1], match[2]);
    }
  }
  return messages;
};

const LOCALES = ['en', 'de', 'fr', 'es', 'pt'];
const translations = Object.fromEntries(LOCALES.map((locale) => [locale, JSON.parse(read(`translations/${locale}.json`))]));
const messages = collectMessages();

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

test('dashboard message ids exist in every locale with matching English defaults', () => {
  for (const [key, defaultMessage] of messages) {
    for (const locale of LOCALES) {
      assert.ok(typeof translations[locale][key] === 'string' && translations[locale][key].trim(), `${key} exists in ${locale}`);
    }
    assert.equal(translations.en[key], defaultMessage, `${key} default matches en`);
  }
  // German uses the IA wording and no developer jargon in confirmations (DUX-03, I18N-8).
  for (const locale of LOCALES) {
    assert.doesNotMatch(translations[locale]['homepage.confirm.end.body'], /isActive|\bfalse\b/, locale);
    assert.equal(translations[locale]['homepage.confirm.terminate'], undefined, `${locale} drops the developer-facing copy`);
  }
  assert.equal(
    translations.de['homepage.confirm.end.body'],
    '{user} wird auf {device} abgemeldet. Andere Sitzungen bleiben bestehen. Der Datensatz bleibt im Verlauf. Dies kann nicht rückgängig gemacht werden.'
  );
  assert.equal(translations.de['common.status.idle'], 'Im Leerlauf');
  assert.equal(translations.de['common.endReason.idle'], 'Zeitüberschreitung');
  assert.equal(translations.de['modal.timeline.minutes'], '{minutes} Min.');
});

test('no retired session words remain in dashboard defaults (IA A.1)', () => {
  for (const [key, defaultMessage] of messages) {
    assert.doesNotMatch(defaultMessage, /\bTerminat|\bLog out\b|Logout|Remove session|\bOnline now\b/, key);
  }
});
