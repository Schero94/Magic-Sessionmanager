import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { readSettingsSource } from './helpers/settingsSource.mjs';
import { LOCALES, readCatalogue } from './helpers/settingsCatalogue.mjs';

const settings = readSettingsSource();
const dashboard = readFileSync(new URL('../admin/src/pages/HomePage.jsx', import.meta.url), 'utf8');

test('GeoIP status is invalidated on failure, malformed data is rejected, and retry is available', () => {
  assert.match(settings, /typeof status\?\.exists !== 'boolean'/);
  assert.match(settings, /setGeoIpStatus\(null\)/);
  assert.match(settings, /setGeoIpStatusError\(true\)/);
  assert.match(settings, /fetchStatus: fetchGeoIpStatus/);
  assert.match(settings, /onClick=\{geoIp\.fetchStatus\}/);
  assert.match(settings, /geoIp\.statusError && \([\s\S]*?settings\.config\.database\.statusError/);
  assert.match(settings, /geoIpStatus \? \([\s\S]*?settings\.config\.database\.notDownloaded/);
});

test('dashboard hides statistics, rows and exports until the first load succeeds; a refresh error keeps the data (IA G)', () => {
  assert.match(dashboard, /const showSessionData = !loading && hasData/);
  assert.match(dashboard, /setHasData\(true\)/);
  // Export stays in the header but is disabled without loaded, matching rows.
  assert.match(dashboard, /const canExport = showSessionData && filteredSessions\.length > 0/);
  assert.match(dashboard, /<SimpleMenu\b[\s\S]{0,200}?disabled=\{!canExport\}/);
  assert.match(dashboard, /\{showSessionData && \(\s*<Flex[^>]*>\s*<VisuallyHidden>[\s\S]*?<StatGrid\b/);
  assert.match(dashboard, /\{showSessionData && sessions\.length > 0/);
  assert.match(dashboard, /\{showSessionData && sessions\.length === 0/);
  // The error alert sits above the last data and offers Try again.
  assert.match(dashboard, /\{!loading && loadError \? \(\s*<Alert\b[\s\S]*?common\.tryAgain/);
  // Search and filters are only offered for loaded sessions.
  assert.match(dashboard, /const showToolbar = showSessionData && sessions\.length > 0/);
});

test('GeoIP error message is translated in all supported locales', () => {
  for (const locale of LOCALES) {
    assert.ok(readCatalogue(locale)['settings.config.database.statusError'], locale);
  }
});
