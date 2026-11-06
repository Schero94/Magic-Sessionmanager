import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (relativePath) =>
  readFileSync(new URL(`../admin/src/${relativePath}`, import.meta.url), 'utf8');

const UI_FILES = [
  'components/ui/PageShell.jsx',
  'components/ui/SectionCard.jsx',
  'components/ui/StatGrid.jsx',
  'components/ui/PropertyList.jsx',
  'components/ui/StatusBadge.jsx',
  'components/ui/EndReason.jsx',
  'components/ui/ConfirmAction.jsx',
  'components/ui/MissingValue.jsx',
  'components/ui/DeviceIcon.jsx',
];

test('the shared ui blocks exist and are exported from one barrel', () => {
  for (const file of [...UI_FILES, 'components/ui/index.js']) {
    assert.ok(existsSync(new URL(`../admin/src/${file}`, import.meta.url)), `${file} exists`);
  }
  const barrel = read('components/ui/index.js');
  for (const name of ['PageShell', 'SectionCard', 'StatGrid', 'StatCard', 'EqualGrid', 'PropertyList', 'StatusBadge', 'EndReason', 'ConfirmAction', 'MissingValue', 'DeviceIcon']) {
    assert.match(barrel, new RegExp(`\\b${name}\\b`), `${name} is exported`);
  }
});

test('PageShell is the native Strapi frame without extra content insets (DUX-10, DASH-03, SET-10, F14)', () => {
  const shell = read('components/ui/PageShell.jsx');
  assert.match(shell, /import \{[^}]*\bLayouts\b[^}]*\bPage\b[^}]*\} from '@strapi\/strapi\/admin'/);
  assert.match(shell, /<Page\.Main\b[^>]*aria-labelledby=\{titleId\}/);
  assert.match(shell, /<Layouts\.Header\b[\s\S]*?id=\{titleId\}/);
  for (const prop of ['title', 'subtitle', 'primaryAction', 'secondaryAction', 'navigationAction']) {
    assert.match(shell, new RegExp(`${prop}=\\{${prop}\\}`), `header forwards ${prop}`);
  }
  assert.match(shell, /hasActionBar \? <Layouts\.Action startActions=\{startActions\} endActions=\{endActions\} \/> : null/);
  assert.match(shell, /<Layouts\.Content>/);

  const content = shell.match(/<PageContent\b([^>]*)>/)?.[1] || '';
  assert.ok(content, 'content wrapper is present');
  assert.doesNotMatch(content, /\bpadding(?:Left|Right|X)?=/, 'no horizontal padding inside Layouts.Content');
  assert.doesNotMatch(content, /\bpadding=/, 'no shorthand padding inside Layouts.Content');
  assert.match(content, /gap=\{6\}/, 'sections are separated by spacing token 6');
  assert.match(shell, /paragraphRhythm/, 'page prose keeps the shared paragraph rhythm');
});

test('PluginPageLayout is a thin alias of PageShell', () => {
  const layout = read('components/PluginPageLayout.jsx');
  assert.match(layout, /export \{ default \} from '\.\/ui\/PageShell'/);
  assert.doesNotMatch(layout, /padding/);
});

test('SectionCard follows the white card recipe with responsive padding', () => {
  const card = read('components/ui/SectionCard.jsx');
  assert.match(card, /tag="section"/);
  assert.match(card, /background="neutral0"/);
  assert.match(card, /hasRadius/);
  assert.match(card, /shadow="tableShadow"/);
  assert.match(card, /padding=\{\{ initial: 4, medium: 6 \}\}/);
  assert.match(card, /variant="delta"/);
  assert.match(card, /headingTag = 'h2'/);
  assert.match(card, /variant="pi" textColor="neutral600"/);
  assert.match(card, /aria-labelledby=/, 'sections are labelled by their heading');
});

test('StatGrid renders compact equal-height cards in 4/2/1 DS columns', () => {
  const grid = read('components/ui/StatGrid.jsx');
  assert.match(grid, /<Grid\.Root\b/);
  assert.match(grid, /getGridItemSpans\(columns, stackBelow\)/);
  assert.match(grid, /<EqualGrid columns=\{columns\} stackBelow="small" gap=\{4\}/);
  assert.match(grid, /direction="column"\s+alignItems="stretch"/, 'items stretch to the row height');
  assert.match(grid, /minWidth=\{0\}/);
  assert.match(grid, /variant="beta"/, 'values use beta next to the label, so cards stay compact');
  assert.doesNotMatch(grid, /variant="alpha"/);
  assert.match(grid, /padding=\{4\}/, 'one compact padding token');
  assert.match(grid, /variant="sigma"/, 'labels use sigma');
  // Clickable cards are real toggle buttons (IA D1.4).
  assert.match(grid, /tag: 'button', type: 'button', onClick, 'aria-pressed': Boolean\(pressed\)/);
  assert.doesNotMatch(grid, /tag="p"/, 'no block elements inside a button card');
  assert.match(grid, /<Icon aria-hidden focusable=\{false\} \/>/, 'icons are decorative');
  assert.match(grid, /theme\.colors\[`\$\{\$tone\}600`\]/, 'icon tone comes from the DS theme');
  // A wrapped label must not push its icon or value off the row's line (Analytics desktop acceptance).
  assert.match(grid, /const IconTile = styled\(Flex\)`\s*align-self: flex-start;/, 'icons stay at the top of every card');
  // Settings pages lose ~230 px to the sub-navigation; a narrow KPI row folds to 2 x 2.
  assert.match(grid, /container-type: inline-size;/, 'the KPI row is a size container');
  assert.match(grid, /@container \(min-width: \$\{DS_SMALL_REM\}rem\) and \(max-width: \$\{STAT_GRID_FOLD_REM - 0\.01\}rem\)/, 'phones keep the DS one-column layout');
  assert.match(grid, /const STAT_GRID_FOLD_REM = \(4 \* 200 \+ 3 \* 16\) \/ 10;/, 'rem in the ten-pixel-root DS convention');
  assert.match(grid, /const DS_SMALL_REM = 52;/);
  // Values pin to the card bottom only on request: a row that mixes cards with and
  // without a secondary line (dashboard) keeps values directly under the labels.
  assert.match(grid, /&\[data-align-values\] \[data-stat-body\] \{\s*flex: 1 1 auto;/, 'opt-in: the body stretches to the row height');
  assert.match(grid, /&\[data-align-values\] \[data-stat-text\] \{\s*justify-content: space-between;/, 'opt-in: values share one line across a row');
  assert.match(grid, /<Flex gap=\{3\} alignItems="stretch" minWidth=\{0\} data-stat-body="">/, 'by default the body keeps its content height');
  assert.match(grid, /alignValues = false/);
});

test('PropertyList is a description list with equal columns and targeted wrapping', () => {
  const list = read('components/ui/PropertyList.jsx');
  assert.match(list, /styled\.dl`/);
  assert.match(list, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(list, /theme\.breakpoints\.small/);
  assert.match(list, /repeat\(\$\{\(\{ \$columns \}\) => \$columns\}, minmax\(0, 1fr\)\)/);
  assert.match(list, /<dt>/);
  assert.match(list, /<dd\b/);
  assert.match(list, /dd\[data-wrap='anywhere'\] \{\s*overflow-wrap: anywhere;/);
  assert.equal((list.match(/overflow-wrap: anywhere/g) || []).length, 1, 'only ids and emails break anywhere');
  assert.match(list, /item\.kind === 'id' \|\| item\.kind === 'email'/);
  assert.match(list, /<MissingValue/);
});

test('StatusBadge uses the shared state vocabulary and EndReason the shared reasons (I.1 items 1-2)', () => {
  const badge = read('components/ui/StatusBadge.jsx');
  assert.match(badge, /getSessionStatusPresentation/);
  assert.match(badge, /<Badge \{\.\.\.getBadgeColors\(presentation\.tone\)\}/);
  // The DS warning variant fails WCAG AA (3.6:1); Idle keeps the warning background with neutral800 text.
  assert.match(badge, /tone === 'warning'\s*\? \{ backgroundColor: 'warning200', textColor: 'neutral800' \}\s*: \{ variant: tone \}/);
  assert.match(badge, /const label = translate\(presentation\)/);
  assert.match(badge, /formatMessage\(\{ id: getTranslation\(descriptor\.messageId\), defaultMessage: descriptor\.defaultMessage \}\)/);
  assert.doesNotMatch(badge, /danger/, 'danger is not a session-state colour');
  const reason = read('components/ui/EndReason.jsx');
  assert.match(reason, /getEndReasonPresentation\(key\)/);
  assert.match(reason, /if \(!key\) return null;/);
});

test('ConfirmAction wraps Strapi ConfirmDialog and restores focus', () => {
  const confirm = read('components/ui/ConfirmAction.jsx');
  assert.match(confirm, /import \{ ConfirmDialog \} from '@strapi\/strapi\/admin'/);
  assert.match(confirm, /<Dialog\.Root open=\{open\} onOpenChange=\{handleOpenChange\}>/);
  assert.match(confirm, /<Dialog\.Trigger ref=\{triggerRef\}/);
  // Menu items open a controlled confirmation; focus returns to the menu button.
  assert.match(confirm, /const controlled = !trigger;/);
  assert.match(confirm, /controlled \? returnFocusRef\?\.current : triggerRef\.current/);
  assert.match(confirm, /<ConfirmDialog\b[\s\S]*?title=\{title\}/);
  assert.match(confirm, /variant = 'danger'/);
  assert.match(confirm, /\{confirmLabel\}/);
  assert.match(confirm, /pickFocusTarget\(ownTrigger, fallbackFocusRef\?\.current\)/,
    'a trigger that became disabled (End all sessions after the last session ended) hands focus to the fallback');
  assert.match(confirm, /if \(busy\) return;/, 'the dialog cannot be dismissed while the action runs');
  assert.doesNotMatch(confirm, /window\.confirm\s*\(/);
});

test('missing values show a dash with an accessible label', () => {
  const missing = read('components/ui/MissingValue.jsx');
  assert.match(missing, /<span aria-hidden="true">\{MISSING_VALUE_GLYPH\}<\/span>/);
  assert.match(missing, /<VisuallyHidden>\{label\}<\/VisuallyHidden>/);
});

test('device icons are decorative and the unknown device is not a monitor', () => {
  const icon = read('components/ui/DeviceIcon.jsx');
  assert.match(icon, /unknown: Information/);
  assert.match(icon, /aria-hidden/);
});

test('alert bodies align with the alert title (F7)', () => {
  const alert = read('components/PersistentAlert.jsx');
  assert.match(alert, /styled\(Alert\)/);
  assert.match(alert, /& \[role='status'\] > p > \*,\s*& \[role='alert'\] > p > \* \{[^}]*display: inline;[^}]*max-width: none;[^}]*font-size: inherit;[^}]*line-height: inherit;/);
});

test('readable text spacing uses DS spacing tokens', () => {
  const text = read('components/ReadableText.jsx');
  assert.doesNotMatch(text, /margin-block-start:\s*\d+px/);
  assert.match(text, /theme\.spaces\[3\]/);
});

test('useBreakpoint reads DS theme breakpoints through matchMedia (DUX-19)', () => {
  const hook = read('utils/useBreakpoint.js');
  assert.match(hook, /useTheme\(\)/);
  assert.match(hook, /getBreakpointQueries\(theme\)/);
  assert.match(hook, /window\.matchMedia/);
  assert.doesNotMatch(hook, /\d+px/, 'no hard-coded widths in the hook');
});

test('formatters use the admin locale from react-intl (DASH-05, I18N-10)', () => {
  const formatters = read('utils/useSessionFormatters.js');
  assert.match(formatters, /const \{ formatMessage, locale \} = useIntl\(\)/);
  assert.match(formatters, /formatSessionDate\(value, locale,/);
  assert.match(formatters, /formatRelative\(value, locale,/);
  assert.doesNotMatch(formatters, /toLocaleString\(\)/);
});

test('the user-agent entry point re-exports the tested parser', () => {
  const entry = read('utils/parseUserAgent.js');
  assert.match(entry, /from '\.\/parseUserAgent\.mjs'/);
  assert.doesNotMatch(read('utils/parseUserAgent.mjs'), /let device = 'Desktop'/);
});

test('shared blocks use DS tokens only', () => {
  for (const file of UI_FILES) {
    const source = read(file);
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, `${file} has no colour literals`);
    assert.doesNotMatch(source, /\d+px/, `${file} has no px values`);
    assert.doesNotMatch(source, /@media/, `${file} uses DS breakpoints only`);
  }
});

const collectDescriptors = () => {
  const descriptors = new Map();
  for (const file of ['utils/sessionStatus.mjs', 'utils/devicePresentation.mjs', 'utils/missingValue.mjs']) {
    const source = read(file);
    for (const match of source.matchAll(/messageId: '([^']+)',\s*defaultMessage: '([^']*)'/g)) {
      descriptors.set(match[1], match[2]);
    }
  }
  return descriptors;
};

const LOCALES = ['en', 'de', 'fr', 'es', 'pt'];
const translations = Object.fromEntries(
  LOCALES.map((locale) => [locale, JSON.parse(read(`translations/${locale}.json`))])
);
const descriptors = collectDescriptors();

test('foundation message ids exist in every locale with matching English defaults', () => {
  assert.ok(descriptors.size >= 15, 'status, end reason, device and missing-value messages are collected');
  for (const [key, defaultMessage] of descriptors) {
    for (const locale of LOCALES) {
      assert.ok(typeof translations[locale][key] === 'string' && translations[locale][key].trim(), `${key} exists in ${locale}`);
    }
    assert.equal(translations.en[key], defaultMessage, `${key} default matches en`);
  }
  assert.equal(translations.de['common.status.idle'], 'Im Leerlauf', 'German separates idle from ended (DUX-12, IA A.1)');
  assert.equal(translations.de['common.status.ended'], 'Beendet');
});
