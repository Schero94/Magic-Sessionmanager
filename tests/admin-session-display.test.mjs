import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const homepageSource = readFileSync(
  new URL('../admin/src/pages/HomePage.jsx', import.meta.url),
  'utf8'
);
const actionsSource = readFileSync(
  new URL('../admin/src/pages/Dashboard/SessionActions.jsx', import.meta.url),
  'utf8'
);
const tableSource = readFileSync(
  new URL('../admin/src/pages/Dashboard/SessionTable.jsx', import.meta.url),
  'utf8'
);
const cardsSource = readFileSync(
  new URL('../admin/src/pages/Dashboard/SessionCardList.jsx', import.meta.url),
  'utf8'
);
const listSource = tableSource + cardsSource;
const exportSource = readFileSync(
  new URL('../admin/src/utils/sessionExports.mjs', import.meta.url),
  'utf8'
);
const userPanelSource = readFileSync(
  new URL('../admin/src/components/SessionInfoPanel.jsx', import.meta.url),
  'utf8'
);
const detailSource = readFileSync(
  new URL('../admin/src/components/SessionDetailModal.jsx', import.meta.url),
  'utf8'
);
const readmeSource = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const changelogSource = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

test('native-only session IDs remain the display, export, and action key', () => {
  assert.match(tableSource, /key=\{session\.id\}/);
  assert.match(cardsSource, /key=\{session\.id\}/);
  assert.match(exportSource, /id:\s*session\.id/);
  assert.match(homepageSource, /onEnd: handleTerminateSession/);
  assert.match(homepageSource, /onDelete: handleDeleteSession/);
  assert.match(
    homepageSource,
    /const sessionId = session\.id;[\s\S]*?sessions\/\$\{sessionId\}\/terminate/
  );
  assert.match(homepageSource, /del\(`\/\$\{pluginId\}\/sessions\/\$\{sessionId\}`\)/);
  assert.match(actionsSource, /onEnd\(session\)/);
  assert.match(actionsSource, /onDelete\(session\)/);
  assert.match(
    detailSource,
    /await onEndSession\(session\)/,
    'the dialog ends sessions through the same dashboard handler'
  );
  for (const source of [homepageSource, actionsSource, listSource, detailSource]) {
    assert.doesNotMatch(source, /session\.documentId/);
  }
});

test('session list, details and exports mark missing device and IP values as unavailable', () => {
  // One device presentation (native fields or user agent) for every surface.
  assert.match(tableSource, /getDevicePresentation\(session\)/);
  assert.match(tableSource, /deviceTypeLabel\(session\)/);
  assert.match(tableSource, /deviceSummary\(session\)/);
  assert.match(cardsSource, /<DeviceSummary session=\{session\} \/>/);
  assert.match(cardsSource, /<ValueOrMissing value=\{session\.ipAddress\} \/>/);
  assert.match(detailSource, /getDevicePresentation\(session\)/);
  assert.match(homepageSource, /getDeviceInfo: getExportDeviceInfo/);
  assert.ok(
    (exportSource.match(/getDeviceInfo\(session, unavailableValue\)/g) || []).length >= 2,
    'CSV and JSON exports should use the same optional-user-agent handling'
  );
  // Missing IPs render the shared accessible missing-value marker, never an invented value.
  assert.match(tableSource, /<ValueOrMissing value=\{session\.ipAddress\} \/>/);
  assert.match(detailSource, /value: session\.ipAddress/);
  assert.ok(
    (exportSource.match(/session\.ipAddress \|\| unavailableValue/g) || []).length >= 2,
    'CSV and JSON should preserve an explicit missing-IP value'
  );
  // The raw user agent lives in Technical details; a missing one shows the missing marker.
  assert.match(detailSource, /const userAgent = presentText\(session\.userAgent\)/);
  assert.match(detailSource, /id: 'userAgent',[\s\S]*?value: userAgent \|\| null/);
});

test('native device metadata is shown when the session has no user-agent', async () => {
  const { getDevicePresentation } = await import('../admin/src/utils/devicePresentation.mjs');
  const native = getDevicePresentation({
    deviceType: 'mobile',
    browserName: 'Firefox',
    osName: 'Android',
  });
  assert.equal(native.deviceType, 'mobile');
  assert.equal(native.browser, 'Firefox');
  assert.equal(native.os, 'Android');
  // Unknown placeholders are not presented as device facts, and nothing is inferred as Desktop.
  const placeholders = getDevicePresentation({
    deviceType: 'unknown',
    browserName: 'unknown',
    osName: 'Unknown',
  });
  assert.equal(placeholders.hasDeviceType, false);
  assert.equal(placeholders.browser, '');
  assert.equal(placeholders.os, '');
  assert.equal(getDevicePresentation({ userAgent: 'SyntheticAgent/1.0' }).deviceType, '');
});

test('unsaved Users & Permissions entries explain the save requirement without no-op session actions', () => {
  const unsavedUserBranch = userPanelSource.indexOf('if (!userId) {');
  const actionButtons = userPanelSource.indexOf('{/* Action Buttons */}');

  assert.ok(
    unsavedUserBranch >= 0,
    'the panel should handle a create form with no persisted user ID'
  );
  assert.ok(
    actionButtons > unsavedUserBranch,
    'the unsaved-state guard must run before action controls are rendered'
  );

  const unsavedUserState = userPanelSource.slice(unsavedUserBranch, actionButtons);
  assert.match(unsavedUserState, /panel\.unsaved\.description/);
  assert.doesNotMatch(unsavedUserState, /onConfirm=|onClick=\{handle/);
});

test('session details never send an IP address on open and never invent security values (decision I.2-7)', () => {
  // No automatic lookup: the request runs only from the "Look up location" button.
  const lookupHandler = detailSource.slice(
    detailSource.indexOf('const handleLookup = async'),
    detailSource.indexOf('const handleTerminate')
  );
  assert.match(lookupHandler, /geolocation\/\$\{encodeURIComponent\(ipAddress\)\}/);
  assert.equal((detailSource.match(/geolocation\/\$\{/g) || []).length, 1, 'one lookup call site');
  assert.match(detailSource, /onClick=\{handleLookup\}/);
  assert.doesNotMatch(
    detailSource.slice(0, detailSource.indexOf('const handleLookup')),
    /get\(`/,
    'nothing is fetched when the dialog opens'
  );
  assert.match(
    detailSource,
    /'Sends the IP address to the configured lookup service, which can be ipapi\.co\.'/
  );
  assert.match(detailSource, /'IP location lookup is off\.'/);
  assert.match(detailSource, /'The location could not be determined\.'/);
  // Stored data never claims VPN/proxy values; scores come from the record only.
  assert.match(detailSource, /storedGeo \? notStoredForPast : undefined/);
  assert.match(detailSource, /'Not stored for past sign-ins'/);
  assert.match(
    detailSource,
    /typeof value === 'boolean'/,
    'VPN/proxy badges only for real booleans'
  );
  assert.match(
    detailSource,
    /const riskMessage = liveGeo \? RISK_LEVEL_MESSAGES\[liveGeo\.riskLevel\] : null/
  );
  assert.doesNotMatch(detailSource, /securityScore:\s*(?:0|50|100)\b/);
  assert.doesNotMatch(detailSource, /isVpn:\s*false/);
  assert.doesNotMatch(detailSource, /isProxy:\s*false/);
  assert.doesNotMatch(detailSource, /getRiskLevelFromScore/);
});

test('README and changelog describe the approved native and legacy modes', () => {
  assert.ok(/jwtManagement:\s*'refresh'/.test(readmeSource));
  assert.ok(/legacy-support/.test(readmeSource));
  assert.ok(
    /does not change the host application's authentication configuration/i.test(readmeSource)
  );
  assert.ok(/existing Magic endpoints keep their paths/i.test(readmeSource));
  assert.ok(/administrator-account sessions are not managed by this plugin/i.test(readmeSource));
  assert.ok(/native Strapi Users & Permissions end-user session support/i.test(changelogSource));
});
