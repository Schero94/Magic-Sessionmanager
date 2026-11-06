import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createIntl, createIntlCache } = require('react-intl');
const read = (path) => readFileSync(new URL(`../admin/src/${path}`, import.meta.url), 'utf8');

test('persistent notices use the shared non-dismissible Strapi alert', () => {
  assert.ok(existsSync(new URL('../admin/src/components/PersistentAlert.jsx', import.meta.url)));
  const component = read('components/PersistentAlert.jsx');
  assert.match(component, /styled\(Alert\)/);
  assert.match(component, /& > button:last-child\s*\{\s*display: none;/);
  for (const path of ['pages/HomePage.jsx', 'pages/Analytics.jsx', 'pages/License.jsx', 'pages/Settings.jsx', 'components/OnlineUsersWidget.jsx', 'components/SessionInfoPanel.jsx']) {
    const source = read(path);
    assert.match(source, /import Alert from ['"].*PersistentAlert['"]/, `${path} must use persistent notices`);
    assert.doesNotMatch(source, /closeLabel=""/);
    assert.doesNotMatch(source, /onClose=\{\(\) => \{\}\}/);
  }
  const settings = read('pages/Settings.jsx');
  assert.match(settings, /styled\(DesignSystemAlert\)/);
  assert.match(settings, /onClose=\{\(\) => setRelaxedWarningDismissed\(true\)\}/);
});

test('user panel passes the locale and translated values without English fragments', () => {
  const panel = read('components/SessionInfoPanel.jsx');
  assert.match(panel, /formatSessionDateTime\(session\.loginTime, locale, unavailableValue\)/);
  assert.match(panel, /panel\.sessions\.browserOnOs/);
  assert.match(panel, /panel\.sessions\.more[\s\S]*?count: sessions\.length - 5/);
  assert.doesNotMatch(panel, /toLocaleString\('en-US'/);
  assert.doesNotMatch(panel, /\{deviceInfo\.browser\} on \{deviceInfo\.os\}/);
  assert.doesNotMatch(panel, /sessions\.length - 5 !== 1/);
});

test('user panel messages format singular, plural and device values in every locale', () => {
  for (const locale of ['en', 'de', 'es', 'fr', 'pt']) {
    const messages = JSON.parse(read(`translations/${locale}.json`));
    const intl = createIntl({ locale, messages }, createIntlCache());
    for (const count of [1, 2]) {
      const text = intl.formatMessage({ id: 'panel.sessions.more' }, { count });
      assert.ok(text.includes(String(count)), `${locale} must interpolate count ${count}`);
      assert.doesNotMatch(text, /\{count/);
      assert.ok(!text.includes('(s)') && !text.includes('(en)') && !text.includes('(es)') && !text.includes('(ões)'), `${locale} needs real plural forms`);
    }
    const device = intl.formatMessage({ id: 'panel.sessions.browserOnOs' }, { browser: 'Browser-X', os: 'System-Y' });
    assert.ok(device.includes('Browser-X') && device.includes('System-Y'), locale);
  }
});
