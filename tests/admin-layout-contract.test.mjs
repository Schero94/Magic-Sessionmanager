import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { readSettingsSource } from './helpers/settingsSource.mjs';
import { unwrapSource } from './helpers/unwrapSource.mjs';

// pages/Settings.jsx re-exports the split settings page (pages/Settings/*).
const readAdminFile = (relativePath) =>
  relativePath === 'pages/Settings.jsx'
    ? readSettingsSource()
    : readFileSync(new URL(`../admin/src/${relativePath}`, import.meta.url), 'utf8');

test('shared form fields use Strapi labels and hints with full-width controls', () => {
  const source = readAdminFile('components/FormField.jsx');

  assert.ok(/<Field\.Root\b/.test(source), 'Field.Root provides the Strapi field context');
  assert.ok(/<Field\.Label>/.test(source), 'each control has an associated visible label');
  assert.ok(
    /<FieldHint><Field\.Hint\s*\/><Field\.Error\s*\/><\/FieldHint>/.test(unwrapSource(source)),
    'helper text and inline errors retain the Strapi Field.Hint/Field.Error primitives with shared readable styling'
  );
  const comboboxStyles = source.match(/\[role=['"]combobox['"]\]\s*\{([^}]*)\}/)?.[1] || '';
  assert.ok(/width:\s*100%/.test(comboboxStyles), 'selects fill their grid column');
  assert.ok(
    /min-width:\s*0/.test(comboboxStyles),
    'select text cannot impose an intrinsic minimum width'
  );
  assert.ok(
    /textarea[\s\S]*box-sizing:\s*border-box/.test(source),
    'textareas stay within their grid column'
  );

  const settings = readAdminFile('pages/Settings.jsx');
  // Settings field pairs use the shared EqualGrid (Grid items with minWidth 0,
  // one column below the DS medium breakpoint) instead of custom media queries.
  const equalGrid = readAdminFile('components/ui/StatGrid.jsx');
  assert.ok(
    /minWidth=\{0\}/.test(equalGrid),
    'settings grid items can shrink below their content width'
  );
  assert.ok(
    (settings.match(/<EqualGrid\b[^>]*stackBelow="medium"/g) || []).length >= 6,
    'settings grids opt into the shrink-safe layout'
  );
  assert.ok(
    !/@media\s*\(/.test(settings),
    'narrow settings grids use DS breakpoints, not custom media queries'
  );
});

test('settings use the page header for save actions and remove the empty save strip', () => {
  const source = readAdminFile('pages/Settings.jsx');

  assert.ok(
    /primaryAction=\{/.test(source),
    'save and reset actions belong in the Strapi page header'
  );
  assert.ok(!/StickySaveBar/.test(source), 'the empty full-width save strip is removed');
  assert.ok(
    /<FormField\b[\s\S]*?id="inactivity-timeout"/.test(source),
    'inactivity timeout is a shared field'
  );
  assert.ok(
    /<FormField\b[\s\S]*?id="cleanup-interval"/.test(source),
    'cleanup interval is a shared field'
  );
  assert.ok(
    /id=\{`email-template-html-\$\{templateKey\}`\}/.test(source),
    'each HTML template has a unique field id'
  );

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
  const layout = readAdminFile('components/ui/PageShell.jsx');
  const settings = readAdminFile('pages/Settings.jsx');

  // Layouts.Content already applies Strapi's responsive gutters (16px on phones);
  // the page shell must not add a second inset on top of them (DUX-10, DASH-03, F14).
  const pageContent = layout.match(/<PageContent\b([^>]*)>/)?.[1] || '';
  assert.ok(pageContent, 'page shell renders its content wrapper');
  assert.ok(
    !/\bpadding(?:Left|Right|X)?=/.test(pageContent),
    'page content relies on the native Layouts.Content gutters only'
  );
  // Settings content starts at the page-title edge: no extra horizontal inset (SET-10 browser).
  assert.ok(/<PageShell\b/.test(settings), 'settings use the shared page shell');
  assert.ok(
    !/padding(?:Left|Right)=\{\{\s*initial:\s*3/.test(settings),
    'settings add no second horizontal gutter'
  );
  // Sections are tabs with section cards; accordions only hold a card's advanced fields (IA D5.3).
  assert.equal(
    (settings.match(/<Accordion\.Root\b/g) || []).length,
    1,
    'one shared Advanced accordion block'
  );
  assert.match(settings, /export const AdvancedSection = /);
});

test('dashboard action bar sits above the list it filters, labelled and responsive (IA D1.5)', () => {
  const source = readAdminFile('pages/HomePage.jsx');
  const search = readAdminFile('pages/Dashboard/SessionSearch.jsx');

  // IA D1 order: header, native-only notice, "How sessions work", stat cards,
  // then the action bar (search left; Status, End reason and Refresh right),
  // "Last updated", the caption and the list. Page size lives in the footer.
  const order = [
    'homepage.nativeOnly.body',
    '<HowSessionsWork />',
    '<StatGrid',
    '{toolbar}',
    'data-session-caption',
    '<Pagination.Root',
  ];
  const positions = order.map((needle) => source.indexOf(needle));
  assert.ok(
    positions.every((position) => position > 0),
    `all parts present: ${positions}`
  );
  assert.deepEqual(
    [...positions].sort((a, b) => a - b),
    positions,
    'parts follow the IA order'
  );
  assert.ok(!/startActions=|endActions=/.test(source), 'the bar is not pinned under the header');
  assert.ok(
    /direction=\{\{ initial: 'column', medium: 'row' \}\}/.test(source),
    'search full width below the medium breakpoint'
  );
  assert.ok(
    /<Searchbar\b[\s\S]*?\{t\('homepage\.search\.label'/.test(search),
    'search has an accessible label'
  );
  assert.ok(
    /<SingleSelect\b[\s\S]*?aria-label=\{t\('homepage\.filter\.label'/.test(source),
    'status filter has an accessible label'
  );
  assert.ok(
    /<SingleSelect\b[\s\S]*?aria-label=\{t\('homepage\.filter\.reasonLabel'/.test(source),
    'end reason filter has an accessible label'
  );
  assert.ok(
    /<IconButton label=\{t\('homepage\.actions\.refresh'/.test(unwrapSource(source)),
    'refresh is a labelled icon button'
  );
  assert.ok(
    /<Pagination\.PageSize options=\{\[\.\.\.PAGE_SIZE_OPTIONS\]\} \/>/.test(source),
    'page size is the native pagination control'
  );
  assert.ok(
    !/@media|grid-template-columns/.test(source + search),
    'no custom breakpoints or hand-made grids'
  );
});

test('plugin surfaces use Strapi theme colors instead of removed legacy color variables', () => {
  const paths = [
    'pages/HomePage.jsx',
    'pages/Settings.jsx',
    'pages/Analytics.jsx',
    'components/SessionInfoPanel.jsx',
    'components/SessionDetailModal.jsx',
  ];
  const legacyColorVariable = /--colors-(?:neutral|primary|danger|success|warning)/;

  for (const path of paths) {
    assert.ok(
      !legacyColorVariable.test(readAdminFile(path)),
      `${path} should use current Strapi theme tokens`
    );
  }
});
