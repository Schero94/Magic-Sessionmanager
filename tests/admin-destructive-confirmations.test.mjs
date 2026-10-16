import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const homeSource = readFileSync(new URL('../admin/src/pages/HomePage.jsx', import.meta.url), 'utf8');
const panelSource = readFileSync(new URL('../admin/src/components/SessionInfoPanel.jsx', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../admin/src/pages/Settings.jsx', import.meta.url), 'utf8');
const translations = Object.fromEntries(['en', 'de', 'es', 'fr', 'pt'].map((locale) => [
  locale,
  JSON.parse(readFileSync(new URL(`../admin/src/translations/${locale}.json`, import.meta.url), 'utf8')),
]));

function handlerSource(source, name) {
  const start = source.indexOf(`const ${name} = async () => {`);
  assert.notEqual(start, -1, `expected handler ${name}`);
  const end = source.indexOf('\n  };', start);
  assert.notEqual(end, -1, `expected end of handler ${name}`);
  return source.slice(start, end);
}

test('removing a session explains that an unexpired access token remains revoked', () => {
  const handler = homeSource.slice(homeSource.indexOf('const handleDeleteSession'), homeSource.indexOf('const handleExportCSV'));

  assert.ok(handler.indexOf('confirm(') >= 0);
  assert.match(handler, /unexpired access token remains blocked until it expires/i);
  assert.match(handler, /revocation remains until expiry/i);
});

test('bulk logout confirms before sending its mutation request', () => {
  const handler = handlerSource(panelSource, 'handleLogoutAll');

  assert.ok(handler.indexOf('confirm(') >= 0);
  assert.ok(handler.indexOf('confirm(') < handler.indexOf('postRequest('));
});

test('block and unblock confirm before changing user access', () => {
  const handler = handlerSource(panelSource, 'handleToggleBlock');

  assert.ok(handler.indexOf('confirm(') >= 0);
  assert.ok(handler.indexOf('confirm(') < handler.indexOf('postRequest('));
});

test('inactive-session cleanup confirmation explains token revocation retention', () => {
  const handler = handlerSource(settingsSource, 'handleCleanInactive');

  assert.ok(handler.indexOf('confirm(') >= 0);
  assert.match(handler, /access tokens remain revoked until they expire/i);
  assert.match(handler, /revoked until expiry/i);
});

test('all supported admin locales explain that unexpired tokens remain blocked after cleanup', () => {
  for (const [locale, messages] of Object.entries(translations)) {
    assert.ok(messages['homepage.confirm.delete'], `${locale} session delete confirmation exists`);
    assert.ok(messages['notifications.success.deleted'], `${locale} session removal result exists`);
    assert.ok(messages['settings.general.danger.confirm'], `${locale} cleanup confirmation exists`);
    assert.ok(messages['notifications.success.cleaned'], `${locale} cleanup result exists`);
    assert.ok(messages['settings.general.danger.description'], `${locale} cleanup description exists`);
    assert.doesNotMatch(messages['homepage.confirm.delete'], /permanently|dauerhaft|définitivement|permanentemente/i);
    assert.doesNotMatch(messages['settings.general.danger.confirm'], /permanently|dauerhaft|définitivement|permanentemente/i);
  }
});
