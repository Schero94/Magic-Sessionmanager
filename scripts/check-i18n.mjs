#!/usr/bin/env node
/**
 * Admin translation catalogue checker.
 *
 * Extracts every translation id used in admin/src and compares it with the
 * five locale files in admin/src/translations. Used by
 * tests/admin-i18n-completeness.test.mjs and runnable on its own:
 *
 *   node scripts/check-i18n.mjs          # prints a report, exit 1 on problems
 *   node scripts/check-i18n.mjs --json   # machine-readable report
 *
 * Recognised id forms (plugin-relative ids, without the plugin prefix):
 *   t('id', 'default', values)            any helper call: t, header, message, …
 *   fn(arg, 'id', 'default')              id literal followed by its default
 *   ['id', 'default']                     label tuples
 *   { messageId: 'id', defaultMessage }   descriptor objects
 *   getTranslation('id') / `${pluginId}.id` followed by defaultMessage
 *   t(cond ? 'a' : 'b', cond ? 'A' : 'B') ternary ids
 *
 * Template-literal ids (`t(`x.${y}`)`) are reported as dynamic so that their
 * prefixes are never treated as orphans.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOCALES = ['en', 'de', 'fr', 'es', 'pt'];
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ADMIN_SRC = join(ROOT, 'admin', 'src');
export const TRANSLATIONS_DIR = join(ADMIN_SRC, 'translations');

const STRING = String.raw`'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|\`(?:[^\`\\$]|\\.)*\``;
/** Top-level namespaces of the plugin catalogue; other dotted strings (file names, hosts) are not ids. */
export const NAMESPACES = [
  'plugin',
  'common',
  'homepage',
  'modal',
  'panel',
  'widget',
  'analytics',
  'settings',
  'notifications',
];
const ID = String.raw`(?:${NAMESPACES.join('|')})(?:\.[A-Za-z0-9_-]+)+`;

/**
 * Decodes a JS string literal without evaluating code.
 *
 * @param {string} literal Literal including its quotes.
 * @returns {string} Value.
 */
export const decodeLiteral = (literal) => {
  const body = literal.slice(1, -1);
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|\n|.)/g, (_, esc) => {
    if (esc[0] === 'u') return String.fromCodePoint(parseInt(esc.replace(/[u{}]/g, ''), 16));
    if (esc[0] === 'x') return String.fromCharCode(parseInt(esc.slice(1), 16));
    return { n: '\n', t: '\t', r: '\r', '\n': '', 0: '\0' }[esc] ?? esc;
  });
};

/** Lists every admin source file except the translation catalogues. */
export const listSourceFiles = (dir = ADMIN_SRC) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'translations' ? [] : listSourceFiles(path);
    return /\.(jsx?|mjs|cjs|tsx?)$/.test(name) ? [path] : [];
  });

/** Reads one locale catalogue. */
export const readLocale = (locale) =>
  JSON.parse(readFileSync(join(TRANSLATIONS_DIR, `${locale}.json`), 'utf8'));

/**
 * Extracts translation usages from one source text.
 *
 * @param {string} text Source.
 * @param {string} file File label for reports.
 * @returns {{usages: Array<{id: string, defaultMessage: string|null, file: string, line: number}>, dynamic: Array<{prefix: string, file: string, line: number}>}}
 */
export const extractFromSource = (text, file = '<source>') => {
  const usages = [];
  const dynamic = [];
  const lineAt = (index) => text.slice(0, index).split('\n').length;
  const push = (id, literal, index) =>
    usages.push({
      id,
      defaultMessage: literal == null ? null : decodeLiteral(literal),
      file,
      line: lineAt(index),
    });

  // 1. 'id', 'default'   (calls with the id as any argument, and tuples)
  const pair = new RegExp(String.raw`(['"])(${ID})\1\s*,\s*(${STRING})`, 'g');
  for (const match of text.matchAll(pair)) push(match[2], match[3], match.index);

  // 1b. t('id') / header('id') without a default (still a used id).
  const bare = new RegExp(
    String.raw`\b(?:t|header|formatTranslation)\(\s*(['"])(${ID})\1\s*\)`,
    'g'
  );
  for (const match of text.matchAll(bare)) push(match[2], null, match.index);

  // 2. messageId: 'id', defaultMessage: 'default'
  const descriptor = new RegExp(
    String.raw`messageId:\s*(['"])(${ID})\1\s*,\s*defaultMessage:\s*(${STRING})`,
    'g'
  );
  for (const match of text.matchAll(descriptor)) push(match[2], match[3], match.index);

  // 3. getTranslation('id') or `${pluginId}.id`, followed by defaultMessage
  const prefixed = new RegExp(
    String.raw`(?:getTranslation\(\s*(['"])(${ID})\1\s*\)|\`\$\{(?:pluginId|PLUGIN_ID)\}\.(${ID})\`)\s*,?\s*(?:defaultMessage:\s*(${STRING}))?`,
    'g'
  );
  for (const match of text.matchAll(prefixed))
    push(match[2] || match[3], match[4] ?? null, match.index);

  // 4. t(cond ? 'a' : 'b', cond ? 'A' : 'B')
  const ternary = new RegExp(
    String.raw`\(\s*[^,()?]+\?\s*(['"])(${ID})\1\s*:\s*(['"])(${ID})\3\s*,\s*[^,()?]+\?\s*(${STRING})\s*:\s*(${STRING})`,
    'g'
  );
  for (const match of text.matchAll(ternary)) {
    push(match[2], match[5], match.index);
    push(match[4], match[6], match.index);
  }

  // 5. Template-literal ids: keep their static prefix.
  const templated = /(?:\b(?:t|header|message|getTranslation)\(\s*|messageId:\s*)`([^`$]*)\$\{/g;
  for (const match of text.matchAll(templated))
    dynamic.push({
      prefix: match[1].replace(/^\$\{(?:pluginId|PLUGIN_ID)\}\./, ''),
      file,
      line: lineAt(match.index),
    });

  return { usages, dynamic };
};

/**
 * Extracts translation usages from admin/src.
 *
 * @returns {{usages: Array<{id: string, defaultMessage: string|null, file: string, line: number}>, dynamic: Array<{prefix: string, file: string, line: number}>, ids: string[]}}
 */
export const extractUsages = () => {
  const usages = [];
  const dynamic = [];
  for (const path of listSourceFiles()) {
    const result = extractFromSource(readFileSync(path, 'utf8'), relative(ROOT, path));
    usages.push(...result.usages);
    dynamic.push(...result.dynamic);
  }
  return { usages, dynamic, ids: [...new Set(usages.map((usage) => usage.id))].sort() };
};

/**
 * Collects the ICU argument names of a message (simple, plural, select).
 *
 * @param {string} message ICU message.
 * @returns {string[]} Sorted unique argument names.
 */
export const placeholdersOf = (message) => {
  const names = new Set();
  // Skip quoted literal sections ('{...}') per ICU apostrophe rules.
  const unquoted = message.replace(/'[{}][^']*'/g, '');
  for (const match of unquoted.matchAll(/\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:,|\})/g))
    names.add(match[1]);
  return [...names].sort();
};

/**
 * Builds the full catalogue report.
 *
 * @returns {object} Report with one array per problem class.
 */
export const buildReport = () => {
  const { usages, dynamic, ids } = extractUsages();
  const catalogues = Object.fromEntries(LOCALES.map((locale) => [locale, readLocale(locale)]));
  const en = catalogues.en;
  const isDynamic = (key) => dynamic.some((entry) => entry.prefix && key.startsWith(entry.prefix));

  const missing = [];
  for (const locale of LOCALES) {
    for (const id of ids) {
      const value = catalogues[locale][id];
      if (typeof value !== 'string' || !value.trim()) missing.push({ locale, id });
    }
  }

  const used = new Set(ids);
  const orphans = Object.keys(en)
    .filter((key) => !used.has(key) && !isDynamic(key))
    .sort();
  const extra = LOCALES.filter((locale) => locale !== 'en').flatMap((locale) =>
    Object.keys(catalogues[locale])
      .filter((key) => !(key in en))
      .map((id) => ({ locale, id }))
  );

  const defaultDrift = usages
    .filter(
      (usage) =>
        usage.defaultMessage != null &&
        typeof en[usage.id] === 'string' &&
        usage.defaultMessage !== en[usage.id]
    )
    .map((usage) => ({ ...usage, en: en[usage.id] }));

  const placeholderMismatch = [];
  for (const key of Object.keys(en)) {
    const expected = placeholdersOf(en[key]).join(',');
    for (const locale of LOCALES.slice(1)) {
      const value = catalogues[locale][key];
      if (typeof value !== 'string') continue;
      const actual = placeholdersOf(value).join(',');
      if (actual !== expected) placeholderMismatch.push({ locale, id: key, expected, actual });
    }
  }

  const untranslated = [];
  for (const key of Object.keys(en)) {
    for (const locale of LOCALES.slice(1)) {
      if (
        catalogues[locale][key] === en[key] &&
        /[a-z]{4,}/.test(en[key].replace(/\{[^}]*\}/g, ''))
      ) {
        untranslated.push({ locale, id: key, value: en[key] });
      }
    }
  }

  return {
    ids,
    usages,
    dynamic,
    missing,
    orphans,
    extra,
    defaultDrift,
    placeholderMismatch,
    untranslated,
  };
};

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const report = buildReport();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ...report, usages: undefined }, null, 2));
  } else {
    const sections = [
      'missing',
      'orphans',
      'extra',
      'defaultDrift',
      'placeholderMismatch',
      'untranslated',
    ];
    console.log(
      `Used ids: ${report.ids.length}; dynamic prefixes: ${report.dynamic.map((d) => d.prefix).join(', ') || 'none'}`
    );
    for (const name of sections) {
      console.log(`\n${name}: ${report[name].length}`);
      for (const entry of report[name])
        console.log('  ', typeof entry === 'string' ? entry : JSON.stringify(entry));
    }
    const failing = ['missing', 'orphans', 'extra', 'defaultDrift', 'placeholderMismatch'].some(
      (name) => report[name].length > 0
    );
    process.exitCode = failing ? 1 : 0;
  }
}
