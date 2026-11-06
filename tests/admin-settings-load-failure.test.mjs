import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../admin/src/pages/Settings.jsx', import.meta.url), 'utf8');

test('settings load failures cannot expose an editable default draft', () => {
  const fetch = source.slice(source.indexOf('const fetchSettings ='), source.indexOf('const fetchGeoIpStatus ='));
  const errorStart = source.indexOf('if (loadError)');
  const errorView = source.slice(errorStart, source.indexOf('\n  return (', errorStart));
  assert.match(fetch, /throw new Error\('Invalid settings response'\)/);
  assert.match(fetch, /setLoadError\(true\)/);
  assert.doesNotMatch(fetch, /Fallback to default settings/);
  assert.match(errorView, /<Alert/);
  assert.match(source, /import Alert from ['"].*PersistentAlert['"]/);
  assert.match(errorView, /onClick=\{fetchSettings\}/);
  assert.match(errorView, /return \(/);
});

test('settings retry state has text in every supported locale', () => {
  for (const locale of ['en', 'de', 'es', 'fr', 'pt']) {
    const translations = JSON.parse(readFileSync(new URL(`../admin/src/translations/${locale}.json`, import.meta.url), 'utf8'));
    for (const key of ['settings.error.loadTitle', 'settings.error.loadDescription', 'common.retry']) {
      assert.ok(translations[key], `${locale} must provide ${key}`);
    }
  }
});
