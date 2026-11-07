import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { readSettingsSource } from './helpers/settingsSource.mjs';

// pages/Settings.jsx re-exports the split settings page (pages/Settings/*).
const readAdminFile = (relativePath) =>
  relativePath === 'pages/Settings.jsx'
    ? readSettingsSource()
    : readFileSync(new URL(`../admin/src/${relativePath}`, import.meta.url), 'utf8');

test('readable copy has a shared measure, line-height, and paragraph rhythm', () => {
  const source = readAdminFile('components/ReadableText.jsx');

  assert.ok(/max-width:\s*72ch/.test(source), 'copy has a readable maximum line length');
  assert.ok(/line-height:\s*1\.6/.test(source), 'copy uses comfortable leading');
  assert.ok(/text-wrap:\s*pretty/.test(source), 'copy wraps more naturally');
  assert.ok(
    /&\s*\+\s*&\s*\{[^}]*margin-block-start:\s*\$\{\(\{ theme \}\) => theme\.spaces\[3\]\}/s.test(
      source
    ),
    'adjacent paragraphs have clear separation (DS spacing 3 = 12px)'
  );
  assert.ok(/paragraphRhythm/.test(source), 'the shared paragraph rhythm is exported');
  assert.ok(
    /li\s*\+\s*li\s*\{[^}]*margin-block-start:\s*\$\{\(\{ theme \}\) => theme\.spaces\[2\]\}/s.test(
      source
    ),
    'list items have consistent separation (DS spacing token)'
  );
});

test('field hints use the same comfortable line-height and control spacing', () => {
  const source = readAdminFile('components/FormField.jsx');

  assert.ok(
    /const FieldHint = styled\.div/.test(source),
    'field hints have a shared wrapper style'
  );
  assert.ok(
    /FieldHint[\s\S]*?line-height:\s*1\.6/.test(source),
    'field hints use comfortable leading'
  );
  assert.ok(
    /FieldHint[\s\S]*?margin-top:\s*\$\{\(\{ theme \}\) => theme\.spaces\[2\]\}/.test(source),
    'field hints have space below controls (DS spacing 2 = 8px)'
  );
  assert.ok(
    /<Field\.Root[^>]*hint=\{description\}/.test(source),
    'field descriptions use the Strapi hint context'
  );
});

test('settings render explanatory copy as readable text', () => {
  const readableText = readAdminFile('components/ReadableText.jsx');
  const row = readAdminFile('components/SettingsToggleRow.jsx');
  const settings = readAdminFile('pages/Settings.jsx');

  assert.match(readableText, /export const ReadableParagraphs/);
  assert.match(readableText, /split\(/, 'paragraphs are split from translated double line breaks');
  assert.match(row, /ReadableParagraphs/, 'switch descriptions support multiple paragraphs');
  // Lockout and rejection copy keep paragraph boundaries. The relaxed-mode
  // warning is one paragraph in the unmodified DS Alert body (SET-17), so it
  // is plain text there.
  assert.ok(
    (settings.match(/<ReadableParagraphs\b/g) || []).length >= 2,
    'lockout and rejection copy keep paragraph boundaries'
  );
  // Every tab starts with one intro sentence in the shared readable style (IA D5.3).
  assert.match(settings, /export const IntroText = \(\{ children \}\) => \(\s*<ReadableText\b/);
  assert.ok((settings.match(/<IntroText>/g) || []).length >= 5, 'one intro per tab');
});

test('page prose uses shared paragraph rhythm while analytics metrics stay compact', () => {
  const layout = readAdminFile('components/ui/PageShell.jsx');
  const analytics = readAdminFile('pages/Analytics.jsx');

  assert.ok(/paragraphRhythm/.test(layout), 'plugin pages use the shared paragraph rhythm');
  const statGrid = readAdminFile('components/ui/StatGrid.jsx');
  assert.ok(
    /import \{[^}]*\bStatCard\b[^}]*\} from '\.\.\/components\/ui'/.test(analytics),
    'analytics uses the shared metric card'
  );
  assert.ok(
    !/const StatCard = /.test(analytics),
    'analytics does not re-implement the metric card'
  );
  assert.ok(
    /export const StatCard[\s\S]*?<Flex direction="column" alignItems="stretch" gap=\{2\}/.test(
      statGrid
    ),
    'metric label and value stay compact through a DS gap'
  );
  assert.ok(
    !/tag="p" style=\{\{\s*margin:\s*0\s*\}\}/.test(analytics),
    'metric spacing is controlled by the metric card'
  );
});

test('explanatory copy across plugin surfaces opts into shared readable text', () => {
  const paths = [
    'pages/HomePage.jsx',
    'pages/Settings.jsx',
    'pages/Analytics.jsx',
    'components/SessionInfoPanel.jsx',
    'components/SessionDetailModal.jsx',
    'components/OnlineUsersWidget.jsx',
  ];

  for (const path of paths) {
    const source = readAdminFile(path);
    assert.match(source, /ReadableText/, `${path} should use readable copy styling`);
  }
});
