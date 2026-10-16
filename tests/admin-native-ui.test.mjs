import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readAdminFile = (relativePath) =>
  readFileSync(new URL(`../admin/src/${relativePath}`, import.meta.url), 'utf8');

test('dashboard, settings, analytics and activation use the shared Strapi page layout', () => {
  const pages = [
    'pages/HomePage.jsx',
    'pages/Settings.jsx',
    'pages/Analytics.jsx',
    'pages/License.jsx',
  ];

  for (const page of pages) {
    assert.match(readAdminFile(page), /<PluginPageLayout\b/, `${page} should use PluginPageLayout`);
  }
});

test('shared page layout uses Strapi Main and Layouts primitives', () => {
  const source = readAdminFile('components/PluginPageLayout.jsx');

  assert.match(source, /<Main\b/);
  assert.match(source, /<Layouts\.Header\b/);
  assert.match(source, /<Layouts\.Content\b/);
});

test('session detail status is shared with the dashboard and uses Strapi badges', () => {
  const source = readAdminFile('components/SessionDetailModal.jsx');

  assert.match(source, /getSessionStatus\(session\)/);
  assert.match(source, /<Badge\b/);
  assert.doesNotMatch(source, /ModalStatusBadge|StatusDot/);
});

test('session terminate actions are disabled when the authoritative session is inactive', () => {
  const source = readAdminFile('pages/HomePage.jsx');

  assert.ok((source.match(/disabled=\{[^}]*!session\.isActive[^}]*\}/gs) || []).length >= 2);
});

test('end-user panel includes all current native sessions and uses Strapi actions', () => {
  const source = readAdminFile('components/SessionInfoPanel.jsx');

  assert.match(source, /getManageableSessions\(data\.data \|\| \[\]\)/);
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
    'homepage.search.hint',
    'homepage.filter.label',
    'homepage.filter.hint',
    'homepage.entries.label',
    'homepage.entries.hint',
    'homepage.noResults.reset',
    'homepage.error.title',
    'homepage.pagination.previous',
    'homepage.pagination.next',
    'homepage.pagination.page',
    'homepage.pagination.range',
    'homepage.pagination.filteredRange',
    'homepage.pagination.label',
    'license.title',
    'license.status.noKey.title',
    'license.key.copy',
    'license.account.title',
    'license.features.title',
    'license.system.title',
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

  assert.equal((source.match(/<Typography[^>]*tag="h2"/g) || []).length, 3);
  assert.doesNotMatch(source, /<Typography[^>]*as="h2"/);
});

test('session detail section headings use the Strapi Typography tag prop', () => {
  const source = readAdminFile('components/SessionDetailModal.jsx');

  assert.equal((source.match(/<Typography[^>]*tag="h2"/g) || []).length, 5);
  assert.doesNotMatch(source, /<Typography[^>]*as="h2"/);
});

test('online user statistic cards are not exposed as links without destinations', () => {
  const source = readAdminFile('components/OnlineUsersWidget.jsx');

  assert.doesNotMatch(source, /<Box\s+as="a"/);
});

test('settings grids define a mobile breakpoint for split fields', () => {
  const source = readAdminFile('pages/Settings.jsx');
  const splitItems = source.match(/<Grid\.Item col=\{(?:4|6)\}[^>]*>/g) || [];

  assert.ok(splitItems.length > 0, 'expected responsive split settings fields');
  for (const [index, item] of splitItems.entries()) {
    assert.match(item, /s=\{12\}/, `split grid item ${index + 1} should stack at the Strapi small breakpoint`);
    assert.match(item, /xs=\{12\}/, `split grid item ${index + 1} should stack at the Strapi mobile breakpoint`);
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
  assert.match(source, /setSavedSettings\(settings\)/);
});

test('geofencing country controls wrap without fixed-width mobile overflow', () => {
  const source = readAdminFile('pages/Settings.jsx');
  const controlsStart = source.indexOf("t('settings.geofencing.pick'");
  const controlsEnd = source.indexOf('</Grid.Item>', controlsStart);
  const controls = source.slice(source.lastIndexOf('<Flex', controlsStart), controlsEnd);

  assert.ok(controlsStart >= 0 && controlsEnd > controlsStart, 'geofencing country controls exist');
  assert.match(controls, /<Flex\b[^>]*wrap="wrap"/);
  assert.match(controls, /flex: '1 1 12rem', minWidth: 0/);
  assert.doesNotMatch(controls, /width: '180px'/);
});

test('dashboard paginates the full filtered result set and keeps both layouts aligned', () => {
  const source = readAdminFile('pages/HomePage.jsx');
  const tableHeader = source.match(/<Thead>([\s\S]*?)<\/Thead>/)?.[1];
  const exportHandlers = source.slice(source.indexOf('const handleExportCSV'), source.indexOf('const getDeviceIcon'));

  assert.match(source, /paginateSessions\(filteredSessions, currentPage, entriesPerPage\)/);
  assert.equal((source.match(/pageResult\.items\.map\(\(session\) =>/g) || []).length, 2);
  assert.doesNotMatch(source, /\.slice\(0, parseInt\(entriesPerPage\)\)/);
  assert.match(source, /homepage\.pagination\.previous/);
  assert.match(source, /homepage\.pagination\.next/);
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
    ['pages/Settings.jsx', 'fetchSettings'],
    ['pages/Settings.jsx', 'handleChange'],
    ['pages/Settings.jsx', 'handleSave'],
    ['pages/Settings.jsx', 'handleReset'],
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
