import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readAdminFile = (relativePath) =>
  readFileSync(new URL(`../admin/src/${relativePath}`, import.meta.url), 'utf8');

test('readable copy has a shared measure, line-height, and paragraph rhythm', () => {
  const source = readAdminFile('components/ReadableText.jsx');

  assert.ok(/max-width:\s*72ch/.test(source), 'copy has a readable maximum line length');
  assert.ok(/line-height:\s*1\.6/.test(source), 'copy uses comfortable leading');
  assert.ok(/text-wrap:\s*pretty/.test(source), 'copy wraps more naturally');
  assert.ok(/&\s*\+\s*&\s*\{[^}]*margin-block-start:\s*12px/s.test(source), 'adjacent paragraphs have clear separation');
  assert.ok(/paragraphRhythm/.test(source), 'the shared paragraph rhythm is exported');
  assert.ok(/li\s*\+\s*li\s*\{[^}]*margin-block-start:\s*6px/s.test(source), 'list items have consistent separation');
});

test('field hints use the same comfortable line-height and control spacing', () => {
  const source = readAdminFile('components/FormField.jsx');

  assert.ok(/const FieldHint = styled\(Field\.Hint\)/.test(source), 'field hints have a shared style');
  assert.ok(/FieldHint[\s\S]*?line-height:\s*1\.6/.test(source), 'field hints use comfortable leading');
  assert.ok(/FieldHint[\s\S]*?margin-top:\s*8px/.test(source), 'field hints have space below controls');
  assert.ok(/<FieldHint id=\{hintId\}>/.test(source), 'field descriptions use the shared style and an explicit id');
});

test('settings render multi-idea copy as readable paragraphs', () => {
  const readableText = readAdminFile('components/ReadableText.jsx');
  const row = readAdminFile('components/SettingsToggleRow.jsx');
  const settings = readAdminFile('pages/Settings.jsx');

  assert.match(readableText, /export const ReadableParagraphs/);
  assert.match(readableText, /split\(/, 'paragraphs are split from translated double line breaks');
  assert.match(row, /ReadableParagraphs/, 'switch descriptions support multiple paragraphs');
  assert.ok((settings.match(/<ReadableParagraphs\b/g) || []).length >= 3, 'policy, warning, and footer copy retain paragraph boundaries');

  for (const locale of ['de', 'en', 'es', 'fr', 'pt']) {
    const translations = JSON.parse(
      readFileSync(new URL(`../admin/src/translations/${locale}.json`, import.meta.url), 'utf8')
    );
    for (const key of [
      'settings.security.enforcement.description',
      'settings.security.enforcement.strict.description',
      'settings.security.enforcement.trustedProxies.description',
      'settings.security.enforcement.warning.body',
      'settings.footer.description',
    ]) {
      assert.match(translations[key], /\n\s*\n/, `${locale} ${key} keeps separate ideas in separate paragraphs`);
    }
  }
});

test('page prose uses shared paragraph rhythm while analytics metrics stay compact', () => {
  const layout = readAdminFile('components/PluginPageLayout.jsx');
  const analytics = readAdminFile('pages/Analytics.jsx');

  assert.ok(/paragraphRhythm/.test(layout), 'plugin pages use the shared paragraph rhythm');
  assert.ok(/const StatCard = styled\(Box\)[\s\S]*?p\s*\+\s*p[\s\S]*?margin-block-start:\s*0/.test(analytics), 'adjacent metric labels remain compact');
  assert.ok(!/tag="p" style=\{\{\s*margin:\s*0\s*\}\}/.test(analytics), 'metric spacing is controlled by the metric card');
});

test('explanatory copy across plugin surfaces opts into shared readable text', () => {
  const paths = [
    'pages/HomePage.jsx',
    'pages/ActiveSessions.jsx',
    'pages/Settings.jsx',
    'pages/Analytics.jsx',
    'pages/License.jsx',
    'components/SessionInfoPanel.jsx',
    'components/SessionDetailModal.jsx',
    'components/OnlineUsersWidget.jsx',
  ];

  for (const path of paths) {
    const source = readAdminFile(path);
    assert.match(source, /ReadableText/, `${path} should use readable copy styling`);
  }
});
