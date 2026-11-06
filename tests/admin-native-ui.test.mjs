import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { readSettingsSource } from './helpers/settingsSource.mjs';

// pages/Settings.jsx re-exports the split settings page (pages/Settings/*).
const readAdminFile = (relativePath) => (relativePath === 'pages/Settings.jsx'
  ? readSettingsSource()
  : readFileSync(new URL(`../admin/src/${relativePath}`, import.meta.url), 'utf8'));

test('dashboard, settings, analytics and activation use the shared Strapi page layout', () => {
  const pages = [
    'pages/HomePage.jsx',
    'pages/Settings.jsx',
    'pages/Analytics.jsx',
    'pages/License.jsx',
  ];

  for (const page of pages) {
    assert.match(readAdminFile(page), /<(?:PageShell|PluginPageLayout)\b/, `${page} should use the shared PageShell layout`);
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
  // One StatusBadge (DS Badge) for table, cards and modal (DUX-03, DASH-10).
  assert.match(source, /<StatusBadge\b/);
  assert.match(table, /<StatusBadge\b/);
  assert.match(source, /<Badge\b/);
  assert.doesNotMatch(source, /ModalStatusBadge|StatusDot|modal\.status\./);
});

test('session terminate actions are disabled when the authoritative session is inactive', () => {
  const actions = readAdminFile('pages/Dashboard/SessionActions.jsx');
  const modal = readAdminFile('components/SessionDetailModal.jsx');

  assert.match(actions, /const canLogOut = session\.isActive === true/);
  assert.ok((actions.match(/disabled=\{!canLogOut[^}]*\}/g) || []).length >= 2);
  assert.match(modal, /const canLogOut = session\.isActive === true/);
  assert.ok((modal.match(/disabled=\{!canLogOut\}/g) || []).length >= 2);
});

test('end-user panel includes all current native sessions and uses Strapi actions', () => {
  const source = readAdminFile('components/SessionInfoPanel.jsx');

  assert.match(source, /getManageableSessions\(requireSessionList\(data\)\)/);
  assert.match(source, /<Button\b/);
  assert.doesNotMatch(source, /const activeSessions = \(data\.data \|\| \[\]\)\.filter\(s => s\.isTrulyActive\)/);
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
    'homepage.error.title',
    'homepage.pagination.range',
    'homepage.pagination.filteredRange',
    'license.title',
    'license.status.noKey.title',
    'license.key.copy',
    'license.account.title',
    'license.features.title',
    'license.status.title',
    'common.retry',
    'settings.geofencing.provider.hint',
    'settings.geofencing.failureMode.hint',
    'settings.geofencing.maxmind.accountId.hint',
    'settings.geofencing.maxmind.licenseKey.hint',
    'settings.geofencing.pick.label',
    'settings.geofencing.pick.hint',
    'settings.geofencing.manual.label',
    'settings.geofencing.manual.hint',
    'settings.security.enforcement.title',
    'settings.security.enforcement.badgeRelaxed',
    'settings.security.enforcement.badgeStrict',
    'settings.security.enforcement.description',
    'settings.security.enforcement.strict.title',
    'settings.security.enforcement.strict.description',
    'settings.security.enforcement.maxAge.title',
    'settings.security.enforcement.maxAge.hint',
    'settings.security.enforcement.maxAge.1day',
    'settings.security.enforcement.maxAge.7days',
    'settings.security.enforcement.maxAge.14days',
    'settings.security.enforcement.maxAge.30days',
    'settings.security.enforcement.maxAge.60days',
    'settings.security.enforcement.maxAge.90days',
    'settings.security.enforcement.maxAge.180days',
    'settings.security.enforcement.maxAge.365days',
    'settings.security.enforcement.trustedProxies.title',
    'settings.security.enforcement.trustedProxies.description',
    'settings.security.enforcement.warning.title',
    'settings.security.enforcement.warning.body',
    'settings.security.encryption.fieldHint',
    'settings.security.maxFailed.fieldHint',
    'settings.email.types.description',
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
  assert.equal((source.match(/<SectionCard\b[^>]*?\btitle=/g) || []).length, 4);
  assert.doesNotMatch(source, /<Typography[^>]*as="h2"/);
});

test('session detail section headings use the Strapi Typography tag prop', () => {
  const source = readAdminFile('components/SessionDetailModal.jsx');

  // Modal.Title is the dialog's h2; every section heading is one shared h3.
  assert.match(source, /<Typography variant="delta" tag="h3"/);
  assert.equal((source.match(/<DetailSection\b/g) || []).length, 5);
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
    assert.match(grid, /stackBelow="medium"/, `split grid ${index + 1} should stack below the Strapi medium breakpoint`);
  }
});

test('cleanup strategy options stay compact and keep the recommendation in helper text', () => {
  const locales = ['en', 'de', 'es', 'fr', 'pt'];

  for (const locale of locales) {
    const translations = JSON.parse(
      readFileSync(new URL(`../admin/src/translations/${locale}.json`, import.meta.url), 'utf8')
    );
    const documentService = translations['settings.general.cleanupMode.ds'];
    const directSql = translations['settings.general.cleanupMode.db'];
    const hint = translations['settings.general.cleanupMode.hint'];

    assert.ok(typeof documentService === 'string', `${locale} has a Document Service label`);
    assert.ok(typeof directSql === 'string', `${locale} has a Direct SQL label`);
    assert.ok(typeof hint === 'string' && hint.toLowerCase().includes('document service'), `${locale} explains the recommended strategy`);
    assert.ok(documentService.length <= 24, `${locale} Document Service label fits a mobile select`);
    assert.ok(directSql.length <= 24, `${locale} Direct SQL label fits a mobile select`);
  }
});

test('settings dirty state compares against the persisted baseline without stale updates', () => {
  const source = readAdminFile('pages/Settings.jsx');

  assert.match(source, /const \[savedSettings, setSavedSettings\] = useState\(settings\)/);
  assert.match(source, /const hasChanges = !areSettingsEqual\(settings, savedSettings\)/);
  assert.match(source, /setSettings\(\(previousSettings\) => \(\{ \.\.\.previousSettings, \[key\]: value \}\)\)/);
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
  assert.match(controls, /<EqualGrid\b[^>]*stackBelow="medium"/, 'picker and code field share a responsive grid');
  assert.match(source, /<Flex ref=\{chipListRef\} tag="ul" gap=\{2\} wrap="wrap"/, 'country chips wrap');
  assert.doesNotMatch(controls, /12rem|width: '180px'/);
});

test('dashboard paginates the full filtered result set and keeps both layouts aligned', () => {
  const source = readAdminFile('pages/HomePage.jsx');
  const table = readAdminFile('pages/Dashboard/SessionTable.jsx');
  const cards = readAdminFile('pages/Dashboard/SessionCardList.jsx');
  const tableHeader = table.match(/<Thead>([\s\S]*?)<\/Thead>/)?.[1];
  const exportHandlers = source.slice(source.indexOf('const handleExportCSV'), source.indexOf('const handleSessionClick'));

  assert.match(source, /paginateSessions\(filteredSessions, dashboard\.page, dashboard\.pageSize\)/);
  // Table and cards render the same page of rows.
  assert.match(source, /sessions: pageResult\.items/);
  assert.match(table, /sessions\.map\(\(session\) =>/);
  assert.match(cards, /sessions\.map\(\(session\) =>/);
  assert.doesNotMatch(source, /\.slice\(0, parseInt\(/);
  // Native Strapi pagination (page links + page size) with URL query state.
  assert.match(source, /<Pagination\.Root\b[\s\S]*?pageCount=\{pageResult\.pageCount\}/);
  assert.match(source, /<Pagination\.Links \/>/);
  assert.match(source, /homepage\.pagination\.range/);
  assert.match(source, /homepage\.pagination\.filteredRange/);
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
    assert.match(source, new RegExp(`/\\*\\*[\\s\\S]*?\\*/\\s*${declaration}\\b`), `${path} ${handler} needs JSDoc`);
  }
});
