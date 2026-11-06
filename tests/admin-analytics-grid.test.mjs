import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../admin/src/pages/Analytics.jsx', import.meta.url), 'utf8');

/** Source without comments, so documentation cannot satisfy or trip a check. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('analytics uses the shared PageShell, StatGrid and SectionCard blocks', () => {
  assert.match(code, /from '\.\.\/components\/ui'/);
  assert.match(code, /<PageShell\b/);
  assert.doesNotMatch(code, /<PluginPageLayout\b/);
  assert.doesNotMatch(code, /styled\.div`[\s\S]*?grid-template-columns:\s*repeat\(auto-fit/, 'no hand-made KPI grid');
});

test('analytics shows exactly four KPI cards in one StatGrid with distinct icons (F16)', () => {
  const grid = code.match(/<StatGrid\b[\s\S]*?<\/StatGrid>/)?.[0] || '';
  const cards = grid.match(/<StatCard\b[\s\S]*?\/>/g) || [];
  assert.equal(cards.length, 4);
  assert.equal((code.match(/<StatCard\b/g) || []).length, 4, 'no KPI card outside the StatGrid');

  const icons = cards.map((card) => card.match(/icon=\{(\w+)\}/)?.[1]);
  assert.ok(icons.every(Boolean), 'every KPI has an icon');
  assert.equal(new Set(icons).size, icons.length, `icons must be distinct: ${icons.join(', ')}`);
});

test('device and browser cards share one equal-height row (F6)', () => {
  const row = code.match(/<EqualGrid\b[^>]*>[\s\S]*?<\/EqualGrid>/)?.[0] || '';
  assert.match(row, /columns=\{2\}/);
  assert.equal((row.match(/<SectionCard\b[^>]*\bfill\b/g) || []).length, 2, 'both cards fill the row height');
  assert.match(code, /const devicesTitle = t\('analytics\.devices\.title'/);
  assert.match(code, /const browsersTitle = t\('analytics\.browsers\.title'/);
  assert.match(row, /title=\{devicesTitle\}/);
  assert.match(row, /title=\{browsersTitle\}/);
  assert.doesNotMatch(code, /<Flex[^>]*wrap="wrap"[^>]*style=\{\{\s*marginBottom/, 'no centred flex row with px margins');
});

test('bar value labels sit outside the fill so contrast does not depend on the value (UX-02, F4)', () => {
  assert.doesNotMatch(code, /position:\s*['"]?absolute/, 'no label overlaid on the bar');
  const tracks = code.match(/<BarTrack\b[\s\S]*?<\/BarTrack>/g) || [];
  assert.ok(tracks.length >= 1, 'bars use the shared track');
  for (const track of tracks) {
    assert.match(track, /aria-hidden/, 'the track is decorative; the numbers are text');
    assert.doesNotMatch(track, /Typography|\{row\.count\}/, 'the count is not rendered inside the track');
  }
  assert.match(code, /data-bar-count/, 'the count has its own column');
  assert.match(code, /textColor="neutral800"/, 'labels use body text colour on the card background');
});

test('bucket labels are translated, only browser names are shown as-is (UX-09, I18N-11)', () => {
  assert.match(code, /getDeviceTypeMessage\(/);
  assert.match(code, /ANALYTICS_OTHER_KEY/);
  assert.match(code, /analytics\.browser\.other/);
  assert.doesNotMatch(code, />\{device\}</);
  assert.doesNotMatch(code, />\{browser\}</);
  assert.doesNotMatch(code, /['"](?:Desktop|Mobile|Tablet|Other|Unknown|API Client)['"]/);
});

test('average duration copy states what is measured (F5)', () => {
  const description = code.match(/'analytics\.duration\.description',\s*'([^']*)'/)?.[1] || '';
  assert.match(description, /last recorded activity/i);
  assert.match(description, /not counted/i);
});

test('analytics uses DS tokens only: no media queries, px spacing, colour literals or console output (UX-11)', () => {
  assert.doesNotMatch(code, /@media/);
  assert.doesNotMatch(code, /\b\d+px\b/);
  assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  assert.doesNotMatch(code, /console\./);
  assert.doesNotMatch(code, /style=\{\{[^}]*(?:margin|padding|gap)/);
});

test('decorative icons are hidden from assistive technology', () => {
  for (const icon of code.match(/<(?:ChartBubble|Clock|Calendar|User|Monitor|Earth)\b[^>]*\/>/g) || []) {
    assert.match(icon, /aria-hidden/, icon);
  }
});
