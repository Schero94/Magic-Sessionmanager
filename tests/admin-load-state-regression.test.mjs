import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settings = readFileSync(new URL('../admin/src/pages/Settings.jsx', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../admin/src/pages/HomePage.jsx', import.meta.url), 'utf8');

test('GeoIP status is invalidated on failure, malformed data is rejected, and retry is available', () => {
  assert.match(settings, /typeof status\?\.exists !== 'boolean'/);
  assert.match(settings, /setGeoIpStatus\(null\)/);
  assert.match(settings, /setGeoIpStatusError\(true\)/);
  assert.match(settings, /onRetryGeoIpStatus=\{fetchGeoIpStatus\}/);
  assert.match(settings, /onClick=\{onRetryGeoIpStatus\}/);
  assert.match(settings, /geoIpStatusError[\s\S]*?settings\.geofencing\.database\.statusError/);
  assert.match(settings, /geoIpStatus \? \([\s\S]*?database\.notInstalled/);
});

test('dashboard hides statistics, rows and exports whenever loading or in error', () => {
  assert.match(dashboard, /const showSessionData = !loading && !loadError/);
  assert.match(dashboard, /const exportActions = showSessionData && filteredSessions\.length > 0/);
  assert.match(dashboard, /\{showSessionData && \(\s*<StatsGrid>/);
  assert.match(dashboard, /\{showSessionData && sessions\.length > 0/);
  assert.match(dashboard, /\{showSessionData && sessions\.length === 0/);
});

test('GeoIP error message is translated in all supported locales', () => {
  for (const locale of ['en', 'de', 'es', 'fr', 'pt']) {
    const messages = JSON.parse(readFileSync(new URL(`../admin/src/translations/${locale}.json`, import.meta.url)));
    assert.ok(messages['settings.geofencing.database.statusError'], locale);
  }
});
