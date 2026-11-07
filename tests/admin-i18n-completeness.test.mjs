import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, TYPE } from '@formatjs/icu-messageformat-parser';
import {
  LOCALES,
  buildReport,
  extractFromSource,
  listSourceFiles,
  readLocale,
} from '../scripts/check-i18n.mjs';

const report = buildReport();
const catalogues = Object.fromEntries(LOCALES.map((locale) => [locale, readLocale(locale)]));
const en = catalogues.en;
const format = (entries) =>
  entries.map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry))).join('\n');

/**
 * Collects ICU argument names from a parsed message, including nested
 * plural/select branches and rich-text tags.
 *
 * @param {Array<object>} ast Parsed ICU elements.
 * @param {Set<string>} names Accumulator.
 * @returns {Set<string>} Argument names.
 */
const argumentNames = (ast, names = new Set()) => {
  for (const element of ast) {
    if (
      [
        TYPE.argument,
        TYPE.number,
        TYPE.date,
        TYPE.time,
        TYPE.select,
        TYPE.plural,
        TYPE.tag,
      ].includes(element.type)
    ) {
      names.add(element.value);
    }
    if (element.options)
      for (const option of Object.values(element.options)) argumentNames(option.value, names);
    if (element.children) argumentNames(element.children, names);
  }
  return names;
};
const argsOf = (message) => [...argumentNames(parse(message))].sort().join(',');

test('the extractor finds the ids of every call shape used in admin/src', () => {
  const sample = [
    "t('homepage.title', 'Session Manager')",
    "header('homepage.table.user', 'User')",
    "loadDefaultAction('html', 'settings.email.templates.html.loadDefault', 'Load Default')",
    "['analytics.features.alerts', 'Email alerts']",
    "{ messageId: 'common.status.idle', defaultMessage: 'Idle' }",
    "intlLabel: { id: `${pluginId}.plugin.name`, defaultMessage: 'Session Manager' }",
    "t(show ? 'settings.key.hide' : 'settings.key.show', show ? 'Hide key' : 'Show key')",
    "logSafeAdminError('settings.load', err)",
  ].join('\n');
  const ids = extractFromSource(sample)
    .usages.map((usage) => `${usage.id}=${usage.defaultMessage}`)
    .sort();
  assert.deepEqual(ids, [
    'analytics.features.alerts=Email alerts',
    'common.status.idle=Idle',
    'homepage.table.user=User',
    'homepage.title=Session Manager',
    'plugin.name=Session Manager',
    'settings.email.templates.html.loadDefault=Load Default',
    'settings.key.hide=Hide key',
    'settings.key.show=Show key',
  ]);
  assert.ok(report.ids.length > 300, `expected the whole admin UI, found ${report.ids.length} ids`);
});

test('every translation id used in admin/src exists in all five locales (I18N-2, UX-01)', () => {
  assert.deepEqual(report.missing, [], `missing translations:\n${format(report.missing)}`);
});

test('all locales carry the same keys and no orphan keys remain (I18N-13)', () => {
  assert.deepEqual(report.orphans, [], `unused keys in en.json:\n${format(report.orphans)}`);
  assert.deepEqual(report.extra, [], `keys missing from en.json:\n${format(report.extra)}`);
  const enKeys = Object.keys(en).sort();
  for (const locale of LOCALES) {
    assert.deepEqual(
      Object.keys(catalogues[locale]).sort(),
      enKeys,
      `${locale}.json key set differs from en.json`
    );
  }
});

test('template-literal ids are not used, so orphan detection is complete', () => {
  assert.deepEqual(report.dynamic, [], `dynamic ids found:\n${format(report.dynamic)}`);
});

test('every defaultMessage in code equals en.json (I18N-9, SET-12)', () => {
  assert.deepEqual(
    report.defaultDrift.map(({ id, file, line, defaultMessage, en: value }) => ({
      id,
      file,
      line,
      defaultMessage,
      en: value,
    })),
    [],
    `defaultMessage drift:\n${format(report.defaultDrift)}`
  );
});

test('every message is valid ICU and uses the same placeholders in every locale (I18N-3)', () => {
  const problems = [];
  for (const locale of LOCALES) {
    for (const [id, message] of Object.entries(catalogues[locale])) {
      try {
        const actual = argsOf(message);
        if (locale !== 'en' && typeof en[id] === 'string' && actual !== argsOf(en[id])) {
          problems.push(`${locale} ${id}: {${actual}} vs en {${argsOf(en[id])}}`);
        }
      } catch (error) {
        problems.push(`${locale} ${id}: invalid ICU (${error.message})`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('every t() call whose message has placeholders passes values (I18N-1, SET-02)', () => {
  const problems = [];
  for (const path of listSourceFiles()) {
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(/\bt\(\s*'([^']+)'/g)) {
      const message = en[match[1]];
      if (typeof message !== 'string' || argsOf(message) === '') continue;
      // Walk the call with balanced parentheses and count top-level arguments.
      let depth = 0;
      let quote = null;
      let args = 1;
      for (let index = match.index + 1; index < text.length; index += 1) {
        const char = text[index];
        if (quote) {
          if (char === '\\') index += 1;
          else if (char === quote) quote = null;
        } else if (char === "'" || char === '"' || char === '`') quote = char;
        else if ('([{'.includes(char)) depth += 1;
        else if (')]}'.includes(char) && --depth === 0) break;
        else if (char === ',' && depth === 1) args += 1;
      }
      if (args < 3)
        problems.push(`${path.split('admin/src/')[1]}: ${match[1]} needs {${argsOf(message)}}`);
    }
  }
  assert.deepEqual(problems, []);
});

// Values that are legitimately identical to English in a locale: product
// names, protocols, examples and established loanwords or cognates.
const SAME_AS_ENGLISH = {
  shared: new Set([
    'Session Manager',
    'Geofencing',
    'Document Service',
    'ipapi.co',
    'VPN/Proxy',
    'Proxy',
    'https://discord.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz...',
    'https://hooks.slack.com/services/XXXX/XXXX/XXXX',
    '{count} min',
    '{minutes} min',
  ]),
  de: new Set([
    'Status',
    'Online',
    'Offline',
    'Browser',
    'Desktop',
    'Tablet',
    'Edition',
    'Name',
    'Bot',
  ]),
  fr: new Set([
    'Activation',
    'Mode',
    'Active',
    'Inactive',
    'Actions',
    'Session',
    'Sessions',
    'Important',
    'Strict',
    'Mobile',
    'Notifications',
    'Total',
    '1 minute',
    '2 minutes',
    '5 minutes',
    '15 minutes',
    '{count, plural, one {# session} other {# sessions}}',
  ]),
  es: new Set(['General', 'Error', 'Total', 'Bot']),
  pt: new Set(['Status', 'Online', 'Offline', 'Tablet', 'Login', 'Logout', 'Total', 'Bot']),
};

test('no English is left in de, fr, es or pt', () => {
  const leftovers = [];
  for (const locale of LOCALES.slice(1)) {
    for (const [id, message] of Object.entries(catalogues[locale])) {
      if (message !== en[id]) continue;
      // Values without real words (placeholders, acronyms, numbers) are language-neutral.
      const words = message
        .replace(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, ' ')
        .replace(/\b[A-Z]{2,}\b/g, ' ');
      if (!/[A-Za-zÀ-ÿ]{3,}/.test(words)) continue;
      if (SAME_AS_ENGLISH.shared.has(message) || SAME_AS_ENGLISH[locale].has(message)) continue;
      leftovers.push(`${locale} ${id}: ${message}`);
    }
  }
  assert.deepEqual(leftovers, []);
});

test('no bracketed warning prefixes or developer field names in any locale (I18N-7, I18N-8)', () => {
  const problems = [];
  for (const locale of LOCALES) {
    for (const [id, message] of Object.entries(catalogues[locale])) {
      if (/\[[A-ZÄÖÜ]+\]/.test(message) || /\bisActive\b/.test(message))
        problems.push(`${locale} ${id}: ${message}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('German uses the formal Sie throughout (I18N-6, UX-07)', () => {
  const informal =
    /\b(du|dich|dir|dein\w*|euch|euer\w*)\b|\b(Versuche|Prüfe|Aktiviere|Verwende|Gib|Wähle|Klicke|Speichere|Füge|Lade|Kopiere|Öffne|Setze|Nutze|Beachte|Trage|Ändere|Lösche|Entferne|Überprüfe)\b(?! Sie)|Bitte erneut versuchen/;
  const hits = Object.entries(catalogues.de).filter(([, message]) => informal.test(message));
  assert.deepEqual(hits, []);
});

test('German uses Sitzung, Im Leerlauf, Beendet, Abgemeldet and sperren consistently (I18N-12, DUX-12, SET-12, IA A.1)', () => {
  const de = catalogues.de;
  assert.equal(de['common.status.idle'], 'Im Leerlauf');
  assert.equal(de['common.status.ended'], 'Beendet');
  assert.equal(de['common.endReason.logout'], 'Abgemeldet');
  assert.equal(de['common.status.active'], 'Aktiv');
  assert.equal(de['common.status.terminated'], undefined, 'Terminated is retired');
  assert.equal(de['homepage.stats.idle'], 'Sitzungen im Leerlauf');
  const problems = [];
  for (const [id, raw] of Object.entries(de)) {
    // Ignore code-like tokens: URLs, paths and environment variable names.
    const message = raw.replace(/\S*(?:https?:\/\/|\/|_)\S*/g, '');
    const withoutProduct = message.replace(/(Magic )?Session[- ]Manager\w*/g, '');
    if (/Session/i.test(withoutProduct))
      problems.push(`${id}: "Session" instead of "Sitzung": ${message}`);
    if (/\b(?:End)?[Nn]utzer/.test(message))
      problems.push(`${id}: "Nutzer" instead of "Benutzer": ${message}`);
    if (/blockier/i.test(message)) problems.push(`${id}: use sperren/entsperren: ${message}`);
    if (/\b(Log-?in|Logout|Lookup|Fallback|Rate Limit|License Key)\b/i.test(message))
      problems.push(`${id}: English term: ${message}`);
    if (/\bMin\b(?!\.)/.test(message))
      problems.push(`${id}: abbreviate minutes as "Min.": ${message}`);
    if (/\bK\.A\./.test(message))
      problems.push(`${id}: use "k. A." or "Nicht verfügbar": ${message}`);
    if (
      /\b[A-ZÄÖÜ]{4,}\b/.test(
        message.replace(/\b(?:HTML|JSON|MMDB|GeoIP|SESSION_ENCRYPTION_KEY|CSV)\b/g, '')
      )
    ) {
      problems.push(`${id}: no all-caps words, the design system handles casing: ${message}`);
    }
  }
  assert.deepEqual(problems, []);
});
