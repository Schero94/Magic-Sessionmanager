import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readSettingsFile } from './helpers/settingsSource.mjs';

const hook = readSettingsFile('hooks/useSettingsForm.js');
const page = readSettingsFile('index.jsx');

test('settings load failures cannot expose an editable default draft', () => {
  const fetch = hook.slice(hook.indexOf('const fetchSettings ='), hook.indexOf('useEffect(', hook.indexOf('const fetchSettings =')));
  const errorStart = page.indexOf('if (form.loadError)');
  const errorView = page.slice(errorStart, page.indexOf('\n  }', errorStart));
  assert.ok(fetch.length > 0 && errorStart >= 0);
  assert.match(fetch, /throw new Error\('Invalid settings response'\)/);
  assert.match(fetch, /setLoadError\(true\)/);
  assert.doesNotMatch(fetch, /Fallback to default settings/);
  assert.match(errorView, /<Alert/);
  assert.match(page, /import Alert from ['"].*PersistentAlert['"]/);
  assert.match(errorView, /onClick=\{form\.fetchSettings\}/);
  assert.match(errorView, /return \(/);
  assert.ok(page.indexOf('if (form.loadError)') < page.indexOf('<Tabs.Root'), 'the form is not rendered after a failed load');
});

test('settings retry state has text in every supported locale', () => {
  for (const locale of ['en', 'de', 'es', 'fr', 'pt']) {
    const translations = JSON.parse(readFileSync(new URL(`../admin/src/translations/${locale}.json`, import.meta.url), 'utf8'));
    for (const key of ['settings.error.loadTitle', 'settings.error.loadDescription', 'common.retry']) {
      assert.ok(translations[key], `${locale} must provide ${key}`);
    }
  }
});
