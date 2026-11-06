import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { readSettingsSource } from './helpers/settingsSource.mjs';

const settings = readSettingsSource();
const dashboard = readFileSync(new URL('../admin/src/pages/HomePage.jsx', import.meta.url), 'utf8');

test('GeoIP status is invalidated on failure, malformed data is rejected, and retry is available', () => {
  assert.match(settings, /typeof status\?\.exists !== 'boolean'/);
  assert.match(settings, /setGeoIpStatus\(null\)/);
  assert.match(settings, /setGeoIpStatusError\(true\)/);
  assert.match(settings, /fetchStatus: fetchGeoIpStatus/);
  assert.match(settings, /onClick=\{geoIp\.fetchStatus\}/);
  assert.match(settings, /geoIp\.statusError && \([\s\S]*?settings\.geofencing\.database\.statusError/);
  assert.match(settings, /geoIpStatus \? \([\s\S]*?database\.notInstalled/);
});

test('dashboard hides statistics, rows and exports whenever loading or in error', () => {
  assert.match(dashboard, /const showSessionData = !loading && !loadError/);
  // Export stays in the header but is disabled without loaded, matching rows.
  assert.match(dashboard, /const canExport = showSessionData && filteredSessions\.length > 0/);
  assert.match(dashboard, /<SimpleMenu\b[\s\S]{0,200}?disabled=\{!canExport\}/);
  assert.match(dashboard, /\{showSessionData && \(\s*<Flex[^>]*>\s*<VisuallyHidden>[\s\S]*?<StatGrid\b/);
  assert.match(dashboard, /\{showSessionData && sessions\.length > 0/);
  assert.match(dashboard, /\{showSessionData && sessions\.length === 0/);
  // Search and filters are only offered for loaded sessions.
  assert.match(dashboard, /const showToolbar = showSessionData && sessions\.length > 0/);
});

test('GeoIP error message is translated in all supported locales', () => {
  for (const locale of ['en', 'de', 'es', 'fr', 'pt']) {
    const messages = JSON.parse(readFileSync(new URL(`../admin/src/translations/${locale}.json`, import.meta.url)));
    assert.ok(messages['settings.geofencing.database.statusError'], locale);
  }
});
