import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const homepageSource = readFileSync(new URL('../admin/src/pages/HomePage.jsx', import.meta.url), 'utf8');
const exportSource = readFileSync(new URL('../admin/src/utils/sessionExports.mjs', import.meta.url), 'utf8');
const userPanelSource = readFileSync(new URL('../admin/src/components/SessionInfoPanel.jsx', import.meta.url), 'utf8');
const detailSource = readFileSync(new URL('../admin/src/components/SessionDetailModal.jsx', import.meta.url), 'utf8');
const readmeSource = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const changelogSource = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

test('native-only session IDs remain the display, export, and action key', () => {
  assert.match(homepageSource, /key=\{session\.id\}/);
  assert.match(exportSource, /id:\s*session\.id/);
  assert.match(homepageSource, /handleTerminateSession\(session\.id\)/);
  assert.match(detailSource, /sessions\/\$\{session\.id\}\/terminate/);
  assert.doesNotMatch(homepageSource, /session\.documentId/);
  assert.doesNotMatch(detailSource, /session\.documentId/);
});

test('session list and exports label missing device and IP values as unavailable', () => {
  assert.ok(
    (homepageSource.match(/getSessionDeviceInfo\(session, unavailableValue\)/g) || []).length >= 3,
    'search, desktop table, and mobile cards should use the same optional-user-agent handling'
  );
  assert.ok(
    (exportSource.match(/getDeviceInfo\(session, unavailableValue\)/g) || []).length >= 2,
    'CSV and JSON exports should use the same optional-user-agent handling'
  );
  assert.ok(
    (homepageSource.match(/session\.ipAddress \|\| unavailableValue/g) || []).length >= 2,
    'desktop table and mobile cards should preserve an explicit missing-IP value'
  );
  assert.ok(
    (exportSource.match(/session\.ipAddress \|\| unavailableValue/g) || []).length >= 2,
    'CSV and JSON should preserve an explicit missing-IP value'
  );
  assert.ok(/getSessionDeviceInfo\(session, unavailableValue\)/.test(detailSource));
  assert.ok(/session\.ipAddress \|\| unavailableValue/.test(detailSource));
  assert.ok(/session\.userAgent[\s\S]{0,180}\?\s*session\.userAgent[\s\S]{0,100}: unavailableValue/.test(detailSource));
});

test('native device metadata is shown when the session has no user-agent', () => {
  assert.ok(/session\?\.deviceName/.test(homepageSource), 'session list should retain the actual native device label');
  assert.ok(/session\?\.deviceName/.test(detailSource), 'session details should retain the actual native device label');
  assert.match(homepageSource, /toLowerCase\(\) !== 'unknown'/, 'session list should not present unknown placeholders as device facts');
  assert.match(detailSource, /toLowerCase\(\) !== 'unknown'/, 'session details should not present unknown placeholders as device facts');
});

test('unsaved Users & Permissions entries explain the save requirement without no-op session actions', () => {
  const unsavedUserBranch = userPanelSource.indexOf('if (!userId) {');
  const actionButtons = userPanelSource.indexOf('{/* Action Buttons */}');

  assert.ok(unsavedUserBranch >= 0, 'the panel should handle a create form with no persisted user ID');
  assert.ok(actionButtons > unsavedUserBranch, 'the unsaved-state guard must run before action controls are rendered');

  const unsavedUserState = userPanelSource.slice(unsavedUserBranch, actionButtons);
  assert.match(unsavedUserState, /panel\.user\.saveBeforeManagingSessions/);
  assert.doesNotMatch(unsavedUserState, /handleLogoutAll|handleToggleBlock/);
});

test('session details do not leave missing GeoIP data loading or invent security values', () => {
  const storedGeoCheck = detailSource.indexOf('if (storedGeoData)');
  const missingIpCheck = detailSource.indexOf('if (!ipAddress)');

  assert.ok(storedGeoCheck >= 0 && missingIpCheck > storedGeoCheck, 'stored GeoIP data should remain usable without an IP address');
  assert.match(detailSource, /country: unavailableValue/);
  assert.match(detailSource, /city: unavailableValue/);
  assert.match(detailSource, /timezone: unavailableValue/);
  assert.match(detailSource, /typeof securityData\.securityScore === 'number'/);
  assert.match(detailSource, /typeof securityData\.isVpn === 'boolean'/);
  assert.match(detailSource, /typeof securityData\.isProxy === 'boolean'/);
  assert.doesNotMatch(detailSource, /securityScore:\s*(?:0|50|100)\b/);
  assert.doesNotMatch(detailSource, /isVpn:\s*false/);
  assert.doesNotMatch(detailSource, /isProxy:\s*false/);
});

test('README and changelog describe the approved native and legacy modes', () => {
  assert.ok(/jwtManagement:\s*'refresh'/.test(readmeSource));
  assert.ok(/legacy-support/.test(readmeSource));
  assert.ok(/does not change the host application's authentication configuration/i.test(readmeSource));
  assert.ok(/existing Magic endpoints keep their paths/i.test(readmeSource));
  assert.ok(/administrator-account sessions are not managed by this plugin/i.test(readmeSource));
  assert.ok(/native Strapi Users & Permissions end-user session support/i.test(changelogSource));
});
