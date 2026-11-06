import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../admin/src/pages/Settings.jsx', import.meta.url), 'utf8');
const ids = [...new Set([...source.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]))];

test('every statically referenced General settings message exists in all five locales', () => {
  for (const locale of ['en', 'de', 'es', 'fr', 'pt']) {
    const messages = JSON.parse(readFileSync(new URL(`../admin/src/translations/${locale}.json`, import.meta.url)));
    const missing = ids.filter((id) => typeof messages[id] !== 'string' || !messages[id].trim());
    assert.deepEqual(missing, [], `${locale}: missing ${missing.join(', ')}`);
  }
});

test('country picker and removal label use the active admin locale', () => {
  assert.match(source, /const \{ formatMessage, locale \} = useIntl\(\)/);
  assert.match(source, /locale=\{locale\}/);
  assert.match(source, /formatCountry\(code, locale\)/);
  assert.match(source, /formatCountry\(c\.code, locale\)/);
});

test('country labels follow the locale and preserve unknown codes', async () => {
  const moduleSource = readFileSync(new URL('../admin/src/utils/countries.js', import.meta.url), 'utf8');
  const { formatCountry } = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);
  for (const [locale, expected] of Object.entries({ en: 'Germany', de: 'Deutschland', es: 'Alemania', fr: 'Allemagne', pt: 'Alemanha' })) {
    assert.match(formatCountry('DE', locale), new RegExp(expected));
  }
  assert.equal(formatCountry('ZZ', 'pt'), 'ZZ');
});
