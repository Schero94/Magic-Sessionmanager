import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { readSettingsSource } from './helpers/settingsSource.mjs';
import { LOCALES, readCatalogue } from './helpers/settingsCatalogue.mjs';

// pages/Settings.jsx re-exports the split settings page (pages/Settings/*).
const readAdminFile = (relativePath) =>
  relativePath === 'pages/Settings.jsx'
    ? readSettingsSource()
    : readFileSync(new URL(`../admin/src/${relativePath}`, import.meta.url), 'utf8');

test('dashboard, settings, analytics and activation use the shared Strapi page layout', () => {
  const pages = [
    'pages/HomePage.jsx',
    'pages/Settings.jsx',
    'pages/Analytics.jsx',
    'pages/License.jsx',
  ];

  for (const page of pages) {
    assert.match(
      readAdminFile(page),
      /<(?:PageShell|PluginPageLayout)\b/,
      `${page} should use the shared PageShell layout`
    );
  }
});

test('shared page layout uses Strapi Main and Layouts primitives', () => {
  assert.match(readAdminFile('components/PluginPageLayout.jsx'), /from '\.\/ui\/PageShell'/);
  const source = readAdminFile('components/ui/PageShell.jsx');

  assert.match(source, /<(?:Page\.)?Main\b/);
  assert.match(source, /<Layouts\.Header\b/);
  assert.match(source, /<Layouts\.Content\b/);
});

test('session detail status is shared with the dashboard and uses Strapi badges', () => {
  const source = readAdminFile('components/SessionDetailModal.jsx');
  const table = readAdminFile('pages/Dashboard/SessionTable.jsx');

  assert.match(source, /getSessionStatus\(session\)/);
  // One StatusBadge (DS Badge) for table, cards and dialog (DUX-03, DASH-10).
  assert.match(source, /<StatusBadge\b/);
  assert.match(table, /<StatusBadge\b/);
  assert.match(readAdminFile('components/ui/StatusBadge.jsx'), /<Badge\b/);
  assert.doesNotMatch(source, /ModalStatusBadge|StatusDot|modal\.status\./);
});

test('End session is unavailable when the authoritative session has ended', () => {
  const actions = readAdminFile('pages/Dashboard/SessionActions.jsx');
  const modal = readAdminFile('components/SessionDetailModal.jsx');

  assert.match(actions, /const canEnd = session\.isActive === true/);
  assert.ok((actions.match(/disabled=\{!canEnd[^}]*\}/g) || []).length >= 2);
  assert.match(modal, /const canEnd = session\.isActive === true/);
  assert.ok((modal.match(/disabled=\{!canEnd\}/g) || []).length >= 2);
});

test('end-user panel includes all current native sessions and uses Strapi actions', () => {
  const source = readAdminFile('components/SessionInfoPanel.jsx');

  assert.match(source, /setSessions\(requireSessionList\(data\)\)/);
  assert.match(source, /const openSessions = getManageableSessions\(sessions\);/);
  assert.match(source, /<Button\b/);
  assert.doesNotMatch(
    source,
    /const activeSessions = \(data\.data \|\| \[\]\)\.filter\(s => s\.isTrulyActive\)/
  );
});

test('analytics and activation labels are present in every supported locale', () => {
  const locales = ['en', 'de', 'es', 'fr', 'pt'];
  const requiredKeys = [
    'analytics.title',
    'analytics.empty',
    'analytics.error.title',
    'analytics.stats.total',
    'analytics.devices.title',
    'analytics.duration.title',
    'homepage.subtitle',
    'homepage.search.label',
    'homepage.filter.label',
    'homepage.noResults.reset',
    'license.title',
    'license.key.copy',
    'license.state.noKey',
    'license.details.title',
    'license.features.always',
    'license.status.title',
    'common.tryAgain',
    'settings.geofencing.pick.label',
    'settings.geofencing.pick.hint',
    'settings.geofencing.manual.label',
    'settings.geofencing.manual.hint',
    'settings.email.templates.subjectHint',
    'settings.email.templates.html.editorLabel',
    'settings.email.templates.text.editorLabel',
  ];

  for (const locale of locales) {
    const translations = JSON.parse(
      readFileSync(new URL(`../admin/src/translations/${locale}.json`, import.meta.url), 'utf8')
    );
    for (const key of requiredKeys) {
      assert.equal(typeof translations[key], 'string', `${locale}.json needs ${key}`);
    }
  }
});

test('analytics headings use the Strapi Typography tag prop', () => {
  const source = readAdminFile('pages/Analytics.jsx');
  const sectionCard = readAdminFile('components/ui/SectionCard.jsx');

  // Section headings come from the shared SectionCard (Typography tag={headingTag}, h2 by default).
  assert.match(sectionCard, /<Typography[\s\S]*?tag=\{headingTag\}/);
  assert.match(sectionCard, /headingTag = 'h2'/);
  // Devices, Browsers and Average session length (IA D6; no hour-of-day timeline, I.2-8).
  assert.equal((source.match(/<SectionCard\b[^>]*?\btitle=/g) || []).length, 3);
  assert.doesNotMatch(source, /<Typography[^>]*as="h2"/);
});

test('session detail section headings use the Strapi Typography tag prop', () => {
  const source = readAdminFile('components/SessionDetailModal.jsx');

  // Modal.Title is the dialog's h2; every section heading is one shared h3;
  // Technical details is a collapsed DS Accordion (IA D2.7).
  assert.match(source, /<Typography variant="delta" tag="h3"/);
  assert.equal((source.match(/<DetailSection\b/g) || []).length, 4);
  assert.match(source, /<Accordion\.Trigger>\{t\('modal\.section\.technical'/);
  assert.doesNotMatch(source, /<Typography[^>]*tag="h2"/);
  assert.doesNotMatch(source, /<Typography[^>]*as="h[23]"/);
});

test('online user statistic cards are not exposed as links without destinations', () => {
  const source = readAdminFile('components/OnlineUsersWidget.jsx');

  assert.doesNotMatch(source, /<Box\s+as="a"/);
});

test('settings grids define a mobile breakpoint for split fields', () => {
  const source = readAdminFile('pages/Settings.jsx');
  const splitGrids = source.match(/<EqualGrid\b[^>]*>/g) || [];

  assert.ok(splitGrids.length > 0, 'expected responsive split settings fields');
  for (const [index, grid] of splitGrids.entries()) {
    // EqualGrid maps to Grid.Item xs=12 s=12 below the DS medium breakpoint.
    assert.match(
      grid,
      /stackBelow="medium"/,
      `split grid ${index + 1} should stack below the Strapi medium breakpoint`
    );
  }
});

test('idle check method options stay compact and the helper names the trade-off (IA F 1.1 #5)', () => {
  for (const locale of LOCALES) {
    const translations = readCatalogue(locale);
    const documentService = translations['settings.general.cleanupMode.ds'];
    const directSql = translations['settings.general.cleanupMode.db'];
    const hint = translations['settings.config.sessions.idleMethod.hint'];

    assert.ok(typeof documentService === 'string', `${locale} has a Document Service label`);
    assert.ok(typeof directSql === 'string', `${locale} has a Direct SQL label`);
    assert.ok(
      typeof hint === 'string' && hint.toLowerCase().includes('direct sql'),
      `${locale} explains the Direct SQL trade-off`
    );
    assert.ok(
      documentService.length <= 24,
      `${locale} Document Service label fits a mobile select`
    );
    assert.ok(directSql.length <= 24, `${locale} Direct SQL label fits a mobile select`);
  }
});

test('settings dirty state compares against the persisted baseline without stale updates', () => {
  const source = readAdminFile('pages/Settings.jsx');

  assert.match(source, /const \[savedSettings, setSavedSettings\] = useState\(settings\)/);
  assert.match(source, /const hasChanges = !areSettingsEqual\(settings, savedSettings\)/);
  assert.match(
    source,
    /setSettings\(\(previousSettings\) => \(\{ \.\.\.previousSettings, \[key\]: value \}\)\)/
  );
  // After a save the baseline is what the server stored, not the submitted draft (SET-01 browser).
  assert.match(source, /setSavedSettings\(stored\)/);
  assert.doesNotMatch(source, /setSavedSettings\(settings\)/);
});

test('geofencing country controls wrap without fixed-width mobile overflow', () => {
  const source = readAdminFile('pages/Settings.jsx');
  const controlsStart = source.indexOf('id="country-picker"');
  const controlsEnd = source.indexOf('</EqualGrid>', controlsStart);
  const controls = source.slice(source.lastIndexOf('<EqualGrid', controlsStart), controlsEnd);

  assert.ok(controlsStart >= 0 && controlsEnd > controlsStart, 'geofencing country controls exist');
  assert.match(
    controls,
    /<EqualGrid\b[^>]*stackBelow="medium"/,
    'picker and code field share a responsive grid'
  );
  assert.match(
    source,
    /<ChipList ref=\{chipListRef\} tag="ul" gap=\{2\} wrap="wrap"/,
    'country chips wrap'
  );
  assert.match(
    source,
    /const ChipList = styled\(Flex\)`[\s\S]*?min-height:\s*\$\{\(\{ theme \}\) => theme\.spaces\[7\]\}/,
    'chip remove buttons reach 32 px on phones'
  );
  assert.doesNotMatch(controls, /12rem|width: '180px'/);
});

test('dashboard paginates the full filtered result set and keeps both layouts aligned', () => {
  const source = readAdminFile('pages/HomePage.jsx');
  const table = readAdminFile('pages/Dashboard/SessionTable.jsx');
  const cards = readAdminFile('pages/Dashboard/SessionCardList.jsx');
  const tableHeader = table.match(/<Thead>([\s\S]*?)<\/Thead>/)?.[1];
  const exportHandlers = source.slice(
    source.indexOf('const handleExportCSV'),
    source.indexOf('const handleSessionClick')
  );

  assert.match(
    source,
    /paginateSessions\(filteredSessions, dashboard\.page, dashboard\.pageSize\)/
  );
  // Table and cards render the same page of rows.
  assert.match(source, /sessions: pageResult\.items/);
  assert.match(table, /sessions\.map\(\(session\) =>/);
  assert.match(cards, /sessions\.map\(\(session\) =>/);
  assert.doesNotMatch(source, /\.slice\(0, parseInt\(/);
  // Native Strapi pagination (page links + page size) with URL query state.
  assert.match(source, /<Pagination\.Root\b[\s\S]*?pageCount=\{pageResult\.pageCount\}/);
  assert.match(source, /<Pagination\.Links \/>/);
  assert.match(source, /homepage\.caption/);
  assert.ok(tableHeader, 'desktop session table has a header row');
  assert.equal((tableHeader.match(/homepage\.table\.status/g) || []).length, 1);
  assert.match(exportHandlers, /buildSessionCsv\(filteredSessions/);
  assert.match(exportHandlers, /buildSessionJson\(filteredSessions/);
  assert.doesNotMatch(exportHandlers, /pageResult\.items/);
});

test('changed non-trivial admin handlers include JSDoc contracts', () => {
  const documentedHandlers = [
    ['pages/HomePage.jsx', 'fetchSessions'],
    ['pages/HomePage.jsx', 'handleTerminateSession'],
    ['pages/HomePage.jsx', 'handleExportCSV'],
    ['pages/HomePage.jsx', 'handleExportJSON'],
    ['pages/Settings/hooks/useSettingsForm.js', 'fetchSettings'],
    ['pages/Settings/hooks/useSettingsForm.js', 'handleChange'],
    ['pages/Settings/hooks/useSettingsForm.js', 'handleSave'],
    ['pages/Settings/hooks/useSettingsForm.js', 'handleReset'],
    ['pages/Analytics.jsx', 'fetchAnalytics'],
    ['pages/License.jsx', 'fetchLicenseStatus'],
    ['pages/License.jsx', 'handleCopyLicenseKey'],
    ['pages/License.jsx', 'handleDownloadLicenseKey'],
    ['components/SessionDetailModal.jsx', 'handleTerminate'],
    ['utils/sessionExports.mjs', 'buildSessionCsv'],
    ['utils/sessionExports.mjs', 'buildSessionJson'],
  ];

  for (const [path, handler] of documentedHandlers) {
    const source = readAdminFile(path);
    const escapedHandler = handler.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const declaration = `(?:const|export function) ${escapedHandler}`;
    assert.match(
      source,
      new RegExp(`/\\*\\*[\\s\\S]*?\\*/\\s*${declaration}\\b`),
      `${path} ${handler} needs JSDoc`
    );
  }
});
