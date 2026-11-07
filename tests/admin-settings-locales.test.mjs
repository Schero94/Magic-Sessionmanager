import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IntlMessageFormat } from 'intl-messageformat';
import { readSettingsFiles, readSettingsSource } from './helpers/settingsSource.mjs';

const LOCALES = ['en', 'de', 'es', 'fr', 'pt'];
const messagesFor = (locale) =>
  JSON.parse(readFileSync(new URL(`../admin/src/translations/${locale}.json`, import.meta.url)));
const source = readSettingsSource();
const extraSources = ['utils/settingsForm.mjs', 'utils/emailTemplateDraft.mjs']
  .map((path) => readFileSync(new URL(`../admin/src/${path}`, import.meta.url), 'utf8'))
  .join('\n');

const ids = [
  ...new Set([
    ...[...source.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
    ...[...source.matchAll(/\['((?:settings|notifications)\.[^']+)',\s*'/g)].map(
      (match) => match[1]
    ),
    ...[...extraSources.matchAll(/messageId:\s*'([^']+)'/g)].map((match) => match[1]),
    ...[...extraSources.matchAll(/\bmessage\(\s*'([^']+)'/g)].map((match) => match[1]),
  ]),
];

/**
 * Returns the source of every `t('id', …)` call with balanced parentheses.
 *
 * @param {string} text Source.
 * @returns {Array<{id: string, call: string}>} Calls.
 */
const findCalls = (text) => {
  const calls = [];
  for (const match of text.matchAll(/\bt\(\s*'([^']+)'/g)) {
    let depth = 0;
    let quote = null;
    let index = match.index + 1;
    for (; index < text.length; index += 1) {
      const char = text[index];
      if (quote) {
        if (char === '\\') index += 1;
        else if (char === quote) quote = null;
      } else if (char === "'" || char === '"' || char === '`') quote = char;
      else if (char === '(') depth += 1;
      else if (char === ')' && --depth === 0) break;
    }
    calls.push({ id: match[1], call: text.slice(match.index, index + 1) });
  }
  return calls;
};

/** Top-level argument count of a `t(...)` call. */
const countArgs = (call) => {
  let depth = 0;
  let quote = null;
  let count = 1;
  for (let index = 2; index < call.length - 1; index += 1) {
    const char = call[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
    } else if (char === "'" || char === '"' || char === '`') quote = char;
    else if ('([{'.includes(char)) depth += 1;
    else if (')]}'.includes(char)) depth -= 1;
    else if (char === ',' && depth === 0) count += 1;
  }
  return count;
};

test('every statically referenced Settings message exists in all five locales', () => {
  for (const locale of LOCALES) {
    const messages = messagesFor(locale);
    const missing = ids.filter((id) => typeof messages[id] !== 'string' || !messages[id].trim());
    assert.deepEqual(missing, [], `${locale}: missing ${missing.join(', ')}`);
  }
});

test('every Settings message is valid ICU in every locale (I18N-3)', () => {
  for (const locale of LOCALES) {
    const messages = messagesFor(locale);
    for (const id of ids) {
      if (typeof messages[id] !== 'string') continue;
      assert.doesNotThrow(() => new IntlMessageFormat(messages[id], locale), `${locale} ${id}`);
    }
  }
});

test('messages with ICU arguments always receive values (I18N-1)', () => {
  const english = messagesFor('en');
  const offenders = [];
  for (const { file, source: text } of readSettingsFiles()) {
    for (const { id, call } of findCalls(text)) {
      const message = english[id];
      if (typeof message !== 'string') continue;
      let ast;
      try {
        ast = new IntlMessageFormat(message, 'en').getAst();
      } catch {
        continue; // Malformed ICU is reported by the I18N-3 test.
      }
      const hasArguments = ast.some((element) => element.type !== 0);
      if (hasArguments && countArgs(call) < 3) offenders.push(`${file}: ${id}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('Settings defaultMessages equal the English catalogue', () => {
  const english = messagesFor('en');
  const unescape = (text) => text.replace(/\\(.)/g, (match, char) => (char === 'n' ? '\n' : char));
  const pairs = [
    ...[...source.matchAll(/\bt\(\s*'([^']+)'\s*,\s*(['"`])((?:\\.|(?!\2)[\s\S])*?)\2/g)].map(
      (m) => [m[1], unescape(m[3])]
    ),
    ...[...source.matchAll(/\['((?:settings|notifications)\.[^']+)',\s*'([^']*)'\]/g)].map((m) => [
      m[1],
      m[2],
    ]),
    ...[...extraSources.matchAll(/messageId:\s*'([^']+)',\s*defaultMessage:\s*'([^']*)'/g)].map(
      (m) => [m[1], m[2]]
    ),
    ...[...extraSources.matchAll(/\bmessage\(\s*'([^']+)',\s*'([^']*)'/g)].map((m) => [m[1], m[2]]),
  ];
  const mismatches = pairs
    .filter(([id, defaultMessage]) => english[id] !== defaultMessage)
    .map(([id]) => id);
  assert.deepEqual([...new Set(mismatches)], []);
});

test('one message id is never used with two different default messages (SET-02)', () => {
  const defaults = new Map();
  const conflicts = [];
  for (const { id, call } of findCalls(source)) {
    const defaultMessage = call.match(/^t\(\s*'[^']+'\s*,\s*(['"])((?:\\.|(?!\1)[\s\S])*)\1/)?.[2];
    if (defaultMessage === undefined) continue;
    if (defaults.has(id) && defaults.get(id) !== defaultMessage) conflicts.push(id);
    defaults.set(id, defaultMessage);
  }
  assert.deepEqual(conflicts, []);
});

test('German Settings copy uses the formal address (I18N-6)', () => {
  const german = messagesFor('de');
  const informal =
    /\b(?:du|dein\w*|dich|dir)\b|\b(?:Versuche|Aktiviere|Verwende|Prüfe|Wähle|Gib|Klicke|Speichere)\b(?! Sie)/;
  const offenders = Object.entries(german)
    .filter(([key]) => key.startsWith('settings.') || key.startsWith('notifications.'))
    .filter(([, value]) => informal.test(value))
    .map(([key]) => key);
  assert.deepEqual(offenders, []);
});

test('country picker and removal label use the active admin locale', () => {
  const hook = readFileSync(
    new URL('../admin/src/pages/Settings/hooks/useSettingsTranslate.js', import.meta.url),
    'utf8'
  );
  const geofencing = readFileSync(
    new URL('../admin/src/pages/Settings/CountryListEditor.jsx', import.meta.url),
    'utf8'
  );
  assert.match(hook, /const \{ formatMessage, locale \} = useIntl\(\)/);
  assert.match(geofencing, /const \{ t, tError, locale \} = useSettingsTranslate\(\)/);
  assert.match(geofencing, /formatCountry\(code, locale\)/);
  assert.match(geofencing, /getCountryOptions\(locale, activeList\)/);
});

test('country labels follow the locale, preserve unknown codes and leave flags out by default', async () => {
  const moduleSource = readFileSync(
    new URL('../admin/src/utils/countries.js', import.meta.url),
    'utf8'
  );
  const { formatCountry, getCountryOptions } = await import(
    `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`
  );
  for (const [locale, expected] of Object.entries({
    en: 'Germany',
    de: 'Deutschland',
    es: 'Alemania',
    fr: 'Allemagne',
    pt: 'Alemanha',
  })) {
    assert.match(formatCountry('DE', locale), new RegExp(expected));
  }
  assert.equal(formatCountry('ZZ', 'pt'), 'ZZ');
  assert.doesNotMatch(
    formatCountry('DE', 'en'),
    /\p{Extended_Pictographic}|\p{Regional_Indicator}/u
  );
  assert.match(formatCountry('DE', 'en', { withFlag: true }), /\p{Regional_Indicator}/u);
  const options = getCountryOptions('de', ['DE']);
  assert.ok(!options.some((option) => option.code === 'DE'));
  assert.deepEqual(
    options.map((option) => option.label),
    [...options.map((option) => option.label)].sort((a, b) => a.localeCompare(b, 'de'))
  );
});

test('the End session confirmation does not expose internal field names (I18N-8)', () => {
  // Table, cards and the dialog share the IA E.1 wording instead of the old
  // homepage.confirm.terminate ("…set isActive to false…") message.
  const actions = readFileSync(
    new URL('../admin/src/pages/Dashboard/SessionActions.jsx', import.meta.url),
    'utf8'
  );
  assert.match(actions, /t\(\s*'homepage\.confirm\.end\.body'/);
  assert.doesNotMatch(actions, /homepage\.confirm\.terminate|isActive to false/);
  for (const locale of LOCALES) {
    const message = messagesFor(locale)['homepage.confirm.end.body'];
    assert.equal(typeof message, 'string', locale);
    assert.doesNotMatch(message, /isActive|\bfalse\b/, locale);
    assert.equal(
      messagesFor(locale)['homepage.confirm.terminate'],
      undefined,
      `${locale} drops the developer-facing copy`
    );
  }
});
