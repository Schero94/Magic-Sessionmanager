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
  assert.doesNotMatch(
    code,
    /styled\.div`[\s\S]*?grid-template-columns:\s*repeat\(auto-fit/,
    'no hand-made KPI grid'
  );
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
  assert.equal(
    (row.match(/<SectionCard\b[^>]*\bfill\b/g) || []).length,
    2,
    'both cards fill the row height'
  );
  assert.match(code, /const devicesTitle = t\('analytics\.devices\.title'/);
  assert.match(code, /const browsersTitle = t\('analytics\.browsers\.title'/);
  assert.match(row, /title=\{devicesTitle\}/);
  assert.match(row, /title=\{browsersTitle\}/);
  assert.doesNotMatch(
    code,
    /<Flex[^>]*wrap="wrap"[^>]*style=\{\{\s*marginBottom/,
    'no centred flex row with px margins'
  );
});

test('bar value labels sit outside the fill so contrast does not depend on the value (UX-02, F4)', () => {
  assert.doesNotMatch(code, /position:\s*['"]?absolute/, 'no label overlaid on the bar');
  const tracks = code.match(/<BarTrack\b[\s\S]*?<\/BarTrack>/g) || [];
  assert.ok(tracks.length >= 1, 'bars use the shared track');
  for (const track of tracks) {
    assert.match(track, /aria-hidden/, 'the track is decorative; the numbers are text');
    assert.doesNotMatch(
      track,
      /Typography|\{row\.count\}/,
      'the count is not rendered inside the track'
    );
  }
  assert.match(code, /data-bar-count/, 'the count has its own column');
  assert.match(
    code,
    /textColor="neutral800"/,
    'labels use body text colour on the card background'
  );
});

test('bucket labels are translated, only browser names are shown as-is (UX-09, I18N-11, decision I.2-3)', () => {
  assert.match(code, /getDeviceTypeMessage\(/);
  assert.match(code, /ANALYTICS_UNKNOWN_KEY/);
  assert.match(code, /analytics\.bucket\.unknown/);
  assert.doesNotMatch(code, />\{device\}</);
  assert.doesNotMatch(code, />\{browser\}</);
  const withoutMessages = code.replace(/\bt\(\s*'[\w.]+',\s*'(?:[^'\\]|\\.)*'/g, 't(');
  assert.doesNotMatch(
    withoutMessages,
    /['"](?:Desktop|Mobile|Tablet|Other|Unknown|API Client)['"]/,
    'labels only as translated defaults'
  );
  const note = code.match(/'analytics\.detection\.note',\s*'((?:[^'\\]|\\.)*)'/)?.[1] || '';
  assert.match(note, /user agent/, 'the footnote says where devices come from');
  assert.match(note, /Unknown/, 'the footnote explains the Unknown bucket');
});

test('KPIs are named after what they count, with rolling windows (IA D6, I.1-24)', () => {
  const grid = code.match(/<StatGrid\b[\s\S]*?<\/StatGrid>/)?.[0] || '';
  const labels = [
    ...(grid.match(/<StatCard\b[\s\S]*?\/>/g) || [])
      .join('\n')
      .matchAll(/label=\{t\('([\w.]+)',\s*'([^']*)'\)\}/g),
  ].map((match) => match[2]);
  assert.deepEqual(labels, [
    'All sessions',
    'Active sessions',
    'Sign-ins in the last 24 hours',
    'Sign-ins in the last 7 days',
  ]);
  assert.doesNotMatch(code, /Online now|today|this week/i, 'no retired KPI wording');
});

test('average session length states the measured span, including idle time (IA D6, I.1-25)', () => {
  assert.match(code, /'analytics\.duration\.title',\s*'Average session length'/);
  const description = code.match(/'analytics\.duration\.description',\s*'([^']*)'/)?.[1] || '';
  assert.equal(
    description,
    'From sign-in to the end of the session, or to its last activity while it is still open. Sessions that timed out include the unused time before they were closed.'
  );
});

test('no hour-of-day timeline: hidden analytics stay deferred (I.1-26, decision I.2-8)', () => {
  assert.doesNotMatch(code, /analytics\.timeline\./);
  assert.equal(
    (code.match(/<SectionCard\b/g) || []).length,
    3,
    'Devices, Browsers and Average session length'
  );
});

test('header: subtitle names the loaded sessions, Refresh keeps the page mounted, link back to the sessions (IA D6)', () => {
  assert.match(
    code,
    /'analytics\.subtitle',\s*'\{count, plural,[^']*Based on the latest # loaded sessions\.\}\}'/
  );
  assert.match(code, /<LinkButton\b[^>]*tag=\{NavLink\}[^>]*to=\{SESSION_MANAGER_PATH\}/);
  assert.match(code, /analytics\.openSessionManager/);
  const refresh =
    code.match(
      /<Button\b(?:(?!<\/Button>)[\s\S])*?onClick=\{fetchAnalytics\}[\s\S]*?<\/Button>/
    )?.[0] || '';
  assert.match(refresh, /aria-busy=\{refreshing\}/);
  assert.doesNotMatch(refresh, /\bdisabled=|\bloading=/, 'a disabled button would drop focus');
  const fetcher = code.match(/const fetchAnalytics = async[\s\S]*?\n {2}\};/)?.[0] || '';
  assert.doesNotMatch(fetcher, /setLoading\(true\)/, 'a refresh never returns to the page loader');
});

test('truncation alert appears only when the API reports meta.truncated (IA D1, D6)', () => {
  assert.match(code, /data\?\.meta\?\.truncated === true/);
  const alert = code.match(/\{truncated \? \([\s\S]*?\) : null\}/)?.[0] || '';
  assert.match(alert, /analytics\.truncated/);
  assert.match(
    alert,
    /Only the latest \{count, number\} sessions are loaded\. Counts, filters and exports cover these sessions only\./
  );
});

test('loading, empty, error and no-permission states follow IA G', () => {
  assert.match(code, /<Page\.Loading\b/);
  assert.match(code, /<Page\.NoPermissions\b/);
  assert.match(
    code,
    /'analytics\.empty',\s*'No sessions to analyse yet\. Analytics appear after the first sign-ins\.'/
  );
  assert.match(code, /'analytics\.error\.title',\s*'Analytics could not be loaded\.'/);
  assert.match(code, /'analytics\.error\.retry',\s*'Try again'/);
});

test('analytics uses DS tokens only: no media queries, px spacing, colour literals or console output (UX-11)', () => {
  assert.doesNotMatch(code, /@media/);
  assert.doesNotMatch(code, /\b\d+px\b/);
  assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  assert.doesNotMatch(code, /console\./);
  assert.doesNotMatch(code, /style=\{\{[^}]*(?:margin|padding|gap)/);
});

test('decorative icons are hidden from assistive technology', () => {
  for (const icon of code.match(/<(?:ChartBubble|Clock|Calendar|User|Monitor|Earth)\b[^>]*\/>/g) ||
    []) {
    assert.match(icon, /aria-hidden/, icon);
  }
});

test('the load time sits in the header subtitle, not as a lonely line above the KPIs (desktop acceptance)', () => {
  const subtitle = code.match(/const subtitle = analytics \? \([\s\S]*?\) : undefined;/)?.[0] || '';
  assert.match(
    subtitle,
    /<Typography variant="epsilon" textColor="neutral600" tag="p">/,
    'same typography as a string subtitle'
  );
  assert.match(subtitle, /analytics\.subtitle/);
  assert.match(subtitle, /analytics\.lastUpdated/);
  assert.match(subtitle, /aria-live="polite"/, 'a refresh is announced');
  assert.equal((code.match(/analytics\.lastUpdated/g) || []).length, 1, 'shown once');
});

test('the empty state uses the native Strapi illustration, not a text-sized icon (desktop acceptance)', () => {
  const empty = code.match(/<EmptyStateLayout\b[\s\S]*?\n\s*\/>/)?.[0] || '';
  assert.match(code, /import \{ EmptyDocuments \} from '@strapi\/icons\/symbols';/);
  assert.match(
    empty,
    /icon=\{<EmptyDocuments width="16rem" height="8\.8rem" aria-hidden="true" \/>\}/
  );
  assert.match(
    empty,
    /analytics\.empty', 'No sessions to analyse yet\. Analytics appear after the first sign-ins\.'/
  );
});

test('analytics KPIs have no secondary lines, so their values share one line across the row (desktop acceptance)', () => {
  const grid = code.match(/<StatGrid\b[^>]*>/)?.[0] || '';
  assert.match(grid, /\balignValues\b/);
  const cards = code.match(/<StatGrid\b[\s\S]*?<\/StatGrid>/)?.[0] || '';
  assert.doesNotMatch(cards, /description=/, 'a secondary line would break the shared value line');
});

test('bar rows switch to label, track, count by the width of their card, not the viewport', () => {
  // At 768 px the two breakdown cards are only about 18rem wide each, while the
  // viewport is past the DS small breakpoint: a viewport query squeezed the label
  // column until "Desktop" and "Unknown" broke mid-word.
  const list = code.match(/const BarList = styled\.ul`[\s\S]*?`;/)?.[0] || '';
  const row = code.match(/const BarRow = styled\.li`[\s\S]*?`;/)?.[0] || '';
  assert.match(list, /container-type:\s*inline-size/, 'the bar list is a size container');
  assert.match(
    row,
    /@container \(min-width: \$\{BAR_ROW_INLINE_REM\}rem\)/,
    'three columns only when the list is wide enough'
  );
  assert.doesNotMatch(row, /theme\.breakpoints/, 'no viewport breakpoint for the bar row');
  assert.doesNotMatch(
    row,
    /overflow-wrap:\s*anywhere/,
    'labels never break inside a word that fits'
  );
});
