import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readAdminFile = (relativePath) =>
  readFileSync(new URL(`../admin/src/${relativePath}`, import.meta.url), 'utf8');

test('shared form fields use Strapi labels and hints with full-width controls', () => {
  const source = readAdminFile('components/FormField.jsx');

  assert.ok(/<Field\.Root\b/.test(source), 'Field.Root provides the Strapi field context');
  assert.ok(/<Field\.Label>/.test(source), 'each control has an associated visible label');
  assert.ok(/const FieldHint = styled\(Field\.Hint\)/.test(source), 'helper text retains the Strapi Field.Hint primitive with shared readable styling');
  const comboboxStyles = source.match(/\[role=['"]combobox['"]\]\s*\{([^}]*)\}/)?.[1] || '';
  assert.ok(/width:\s*100%/.test(comboboxStyles), 'selects fill their grid column');
  assert.ok(/min-width:\s*0/.test(comboboxStyles), 'select text cannot impose an intrinsic minimum width');
  assert.ok(/textarea[\s\S]*box-sizing:\s*border-box/.test(source), 'textareas stay within their grid column');

  const settings = readAdminFile('pages/Settings.jsx');
  assert.ok(/\.settings-grid\s*>\s*\*\s*\{\s*min-width:\s*0;?\s*\}/.test(settings), 'settings grid items can shrink below their content width');
  assert.ok((settings.match(/<Grid\.Root\b[^>]*className="settings-grid"/g) || []).length >= 8, 'settings grids opt into the shrink-safe layout');
  assert.ok(/@media\s*\(max-width:\s*519px\)[\s\S]*?\.settings-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)[\s\S]*?\.settings-grid\s*>\s*\*\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/.test(settings), 'narrow settings grids become a true single column');
});

test('settings use the page header for save actions and remove the empty save strip', () => {
  const source = readAdminFile('pages/Settings.jsx');

  assert.ok(/primaryAction=\{/.test(source), 'save and reset actions belong in the Strapi page header');
  assert.ok(!/StickySaveBar/.test(source), 'the empty full-width save strip is removed');
  assert.ok(/<FormField\b[\s\S]*?id="inactivity-timeout"/.test(source), 'inactivity timeout is a shared field');
  assert.ok(/<FormField\b[\s\S]*?id="cleanup-interval"/.test(source), 'cleanup interval is a shared field');
  assert.ok(/id=\{`email-template-html-\$\{templateKey\}`\}/.test(source), 'each HTML template has a unique field id');

  const requiredSettingsFieldIds = [
    'geoip-provider',
    'geoip-lookup-failure-mode',
    'geoip-database-filename',
    'maxmind-account-id',
    'maxmind-license-key',
    'country-picker',
    'country-code-manual',
    'last-seen-rate-limit',
    'session-retention-period',
    'session-creation-grace-period',
    'cleanup-strategy',
    'session-encryption-key',
    'max-session-age',
    'max-failed-logins',
    'email-template-subject-',
    'email-template-text-',
    'discord-webhook-url',
    'slack-webhook-url',
  ];

  for (const id of requiredSettingsFieldIds) {
    assert.ok(source.includes(id), `settings field ${id} is present`);
  }
});

test('Strapi page and settings gutters contract on narrow phones', () => {
  const layout = readAdminFile('components/PluginPageLayout.jsx');
  const settings = readAdminFile('pages/Settings.jsx');

  assert.ok(/padding=\{\{\s*initial:\s*3,\s*small:\s*6\s*\}\}/.test(layout), 'page padding is smaller below the Strapi small breakpoint');
  assert.ok(/paddingLeft=\{\{\s*initial:\s*3,\s*small:\s*6\s*\}\}/.test(settings), 'settings horizontal padding is smaller on narrow phones');
  assert.ok(/padding=\{\{\s*initial:\s*3,\s*small:\s*6\s*\}\}/.test(settings), 'accordion contents keep consistent responsive gutters');
});

test('dashboard search and filters use labelled described fields in an equal responsive grid', () => {
  const source = readAdminFile('pages/HomePage.jsx');

  assert.ok(/<FormField\b[\s\S]*?id="session-search"/.test(source), 'search is a shared field');
  assert.ok(/<FormField\b[\s\S]*?id="session-status-filter"/.test(source), 'status is a shared field');
  assert.ok(/<FormField\b[\s\S]*?id="sessions-per-page"/.test(source), 'page size is a shared field');
  assert.ok(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/.test(source), 'desktop search and filter columns have equal widths');
});

test('plugin surfaces use Strapi theme colors instead of removed legacy color variables', () => {
  const paths = [
    'pages/HomePage.jsx',
    'pages/Settings.jsx',
    'pages/Analytics.jsx',
    'pages/License.jsx',
    'components/SessionInfoPanel.jsx',
    'components/SessionDetailModal.jsx',
  ];
  const legacyColorVariable = /--colors-(?:neutral|primary|danger|success|warning)/;

  for (const path of paths) {
    assert.ok(!legacyColorVariable.test(readAdminFile(path)), `${path} should use current Strapi theme tokens`);
  }
});
