import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createIntl, createIntlCache } = require('react-intl');
import { readSettingsSource } from './helpers/settingsSource.mjs';
const read = (path) => (path === 'pages/Settings.jsx'
  ? readSettingsSource()
  : readFileSync(new URL(`../admin/src/${path}`, import.meta.url), 'utf8'));

test('persistent notices use the shared non-dismissible Strapi alert', () => {
  assert.ok(existsSync(new URL('../admin/src/components/PersistentAlert.jsx', import.meta.url)));
  const component = read('components/PersistentAlert.jsx');
  assert.match(component, /styled\(Alert\)/);
  assert.match(component, /& > button:last-child\s*\{\s*display: none;/);
  for (const path of ['pages/HomePage.jsx', 'pages/Analytics.jsx', 'pages/License.jsx', 'pages/Settings.jsx', 'components/OnlineUsersWidget.jsx', 'components/SessionInfoPanel.jsx']) {
    const source = read(path);
    // The home widget renders its states through Strapi's Widget helpers (or a
    // local fallback) and has no alerts; any alert it adds must be persistent too.
    if (path === 'components/OnlineUsersWidget.jsx' && !/<Alert\b/.test(source)) continue;
    assert.match(source, /import Alert from ['"].*PersistentAlert['"]/, `${path} must use persistent notices`);
    assert.doesNotMatch(source, /closeLabel=""/);
    assert.doesNotMatch(source, /onClose=\{\(\) => \{\}\}/);
  }
  const settings = read('pages/Settings.jsx');
  assert.match(settings, /styled\(DesignSystemAlert\)/);
  assert.match(settings, /onClose=\{\(\) => setRelaxedWarningDismissed\(true\)\}/);
});

test('user panel formats dates with the admin locale and translated values without English fragments', () => {
  const panel = read('components/SessionInfoPanel.jsx');
  assert.match(panel, /useSessionFormatters\(\)/, 'dates and relative times follow the admin locale');
  assert.match(panel, /formatRelativeTime\(lastActivity\)/);
  assert.match(panel, /title=\{formatDate\(lastActivity\)\}/);
  assert.match(panel, /translate\(device\.summary, device\.summary\.values\)/, 'browser and OS use the shared translated summary');
  assert.match(panel, /panel\.sessions\.more[\s\S]*?count: hiddenCount/);
  assert.doesNotMatch(panel, /toLocaleString\(/);
  assert.doesNotMatch(panel, /\{deviceInfo\.browser\} on \{deviceInfo\.os\}/);
  assert.doesNotMatch(panel, /sessions\.length - 5 !== 1/);
});

test('user panel messages format singular, plural and device values in every locale', () => {
  for (const locale of ['en', 'de', 'es', 'fr', 'pt']) {
    const messages = JSON.parse(read(`translations/${locale}.json`));
    const intl = createIntl({ locale, messages, onError: () => {} }, createIntlCache());
    for (const count of [1, 2]) {
      const text = intl.formatMessage({ id: 'panel.summary.openCount' }, { count });
      assert.ok(text.includes(String(count)), `${locale} must interpolate count ${count}`);
      assert.doesNotMatch(text, /\{count/);
      assert.ok(!text.includes('(s)') && !text.includes('(en)') && !text.includes('(es)') && !text.includes('(ões)'), `${locale} needs real plural forms`);
    }
  }
});
