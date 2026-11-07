import assert from 'node:assert/strict';
import test from 'node:test';
import { readSettingsFile } from './helpers/settingsSource.mjs';
import { LOCALES, readCatalogue } from './helpers/settingsCatalogue.mjs';

const hook = readSettingsFile('hooks/useSettingsForm.js');
const page = readSettingsFile('index.jsx');
const LOAD_KEYS = ['settings.config.load.error', 'settings.config.load.retry'];

test('settings load failures cannot expose an editable default draft (IA G)', () => {
  const fetch = hook.slice(
    hook.indexOf('const fetchSettings ='),
    hook.indexOf('useEffect(', hook.indexOf('const fetchSettings ='))
  );
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
  assert.ok(
    page.indexOf('if (form.loadError)') < page.indexOf('<Tabs.Root'),
    'the form is not rendered after a failed load'
  );
  for (const key of LOAD_KEYS) assert.match(errorView, new RegExp(key.replace(/\./g, '\\.')), key);
});

test('settings retry state has text in every supported locale', () => {
  for (const locale of LOCALES) {
    const translations = readCatalogue(locale);
    for (const key of LOAD_KEYS) {
      assert.ok(translations[key], `${locale} must provide ${key}`);
    }
  }
});
