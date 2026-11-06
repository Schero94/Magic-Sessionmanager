import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const homeSource = readFileSync(new URL('../admin/src/pages/HomePage.jsx', import.meta.url), 'utf8');
const panelSource = readFileSync(new URL('../admin/src/components/SessionInfoPanel.jsx', import.meta.url), 'utf8');
import { readSettingsSource } from './helpers/settingsSource.mjs';

const settingsSource = readSettingsSource();
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
  const actionsSource = readFileSync(new URL('../admin/src/pages/Dashboard/SessionActions.jsx', import.meta.url), 'utf8');
  const removeConfirm = actionsSource.slice(actionsSource.indexOf('const removeConfirm'), actionsSource.indexOf('onConfirm: () => onRemove'));

  // ConfirmAction (Strapi ConfirmDialog) confirms before the handler runs; never window.confirm.
  assert.ok(removeConfirm.length > 0, 'the remove action has its own confirmation');
  assert.match(removeConfirm, /unexpired access token remains blocked until it expires/i);
  assert.doesNotMatch(homeSource + actionsSource, /\bconfirm\(/);
  assert.match(handler, /remains blocked until expiry/i);
});

test('bulk logout confirms before sending its mutation request', () => {
  const handler = handlerSource(panelSource, 'handleLogoutAll');

  // The request only runs from the ConfirmAction dialog's confirm button.
  assert.ok(handler.indexOf('postRequest(') >= 0);
  assert.match(panelSource, /<ConfirmAction\b[\s\S]*?onConfirm=\{handleLogoutAll\}/);
  assert.doesNotMatch(panelSource, /onClick=\{handleLogoutAll\}/);
  assert.doesNotMatch(panelSource, /\bconfirm\(/, 'no browser confirm dialog');
});

test('block and unblock confirm before changing user access', () => {
  const handler = handlerSource(panelSource, 'handleToggleBlock');

  assert.match(panelSource, /<ConfirmAction\b[\s\S]*?onConfirm=\{handleToggleBlock\}/);
  assert.doesNotMatch(panelSource, /onClick=\{handleToggleBlock\}/);
  assert.match(handler, /postRequest\([^\n]+\{\s*blocked:\s*!isBlocked\s*\}/);
});

test('inactive-session cleanup confirmation explains token revocation retention', () => {
  // The cleanup runs only from the onConfirm of a DS ConfirmAction dialog (no window.confirm).
  const trigger = settingsSource.slice(settingsSource.indexOf("settings.general.danger.cleanNow"), settingsSource.indexOf('onConfirm={handleCleanInactive}') + 40);
  assert.match(trigger, /<\/ConfirmAction|confirmLabel=/);
  assert.match(settingsSource, /<ConfirmAction\b[\s\S]*?body=\{t\(\s*'settings\.general\.danger\.confirm',\s*'[^']*access tokens remain revoked until they expire[^']*'/i);
  assert.match(settingsSource, /onConfirm=\{handleCleanInactive\}/);
  const handlerStart = settingsSource.indexOf('const handleCleanInactive = useCallback(async () => {');
  const handler = settingsSource.slice(handlerStart, settingsSource.indexOf('\n  }, [', handlerStart));
  assert.ok(handlerStart >= 0, 'cleanup handler exists');
  assert.doesNotMatch(handler, /\bconfirm\(/, 'no browser dialog');
  assert.match(handler, /revoked until expiry/i);
  assert.match(handler, /logSafeAdminError\('settings\.cleanInactive', err\)/);
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
