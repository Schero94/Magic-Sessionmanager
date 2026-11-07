import assert from 'node:assert/strict';
import test from 'node:test';
import { readSettingsFile } from './helpers/settingsSource.mjs';
import { LOCALES, readCatalogue } from './helpers/settingsCatalogue.mjs';
import { unwrapSource } from './helpers/unwrapSource.mjs';

const fragments = {
  en: ['Automatic', 'ipapi.co', 'IP addresses', 'Local database', 'Off'],
  de: ['Automatisch', 'ipapi.co', 'IP-Adressen', 'Lokale Datenbank', 'Aus'],
  es: ['Automático', 'ipapi.co', 'direcciones IP', 'Base de datos local', 'Desactivado'],
  fr: ['Automatique', 'ipapi.co', 'adresses IP', 'Base de données locale', 'Désactivé'],
  pt: ['Automático', 'ipapi.co', 'endereços IP', 'Base de dados local', 'Desativado'],
};

test('GeoIP provider field discloses remote lookups in its associated hint', () => {
  const source = readSettingsFile('GeoIpDatabaseCard.jsx');
  const field = source.match(/<FormField\s+id="geoip-provider"[\s\S]*?<\/FormField>/)?.[0];
  assert.ok(field);
  assert.match(field, /description=\{t\(\s*'settings\.config\.provider\.hint'/);
  assert.match(
    field.match(/description=\{t\([\s\S]*?\)\}/)?.[0] || '',
    /ipapi\.co sends IP addresses to that service/
  );
  assert.match(field, /value=\{settings\.geoIpProvider \|\| 'auto'\}/);
  for (const [value, label] of [
    ['auto', 'Automatic'],
    ['local-mmdb', 'Local database'],
    ['ipapi', 'ipapi.co'],
    ['disabled', 'Off'],
  ]) {
    assert.match(
      unwrapSource(field),
      new RegExp(
        `<SingleSelectOption value="${value}">\\{t\\('settings\\.config\\.provider\\.\\w+', '${label.replace('.', '\\.')}'\\)\\}`
      ),
      value
    );
  }
});

test('the privacy note sits directly under the switch that enables lookups (SET-08, IA F 3.1)', () => {
  const source = readSettingsFile('LocationDataTab.jsx');
  const row =
    source.match(
      /<SettingsToggleRow\s+id="enable-ip-geolocation"[\s\S]*?<\/SettingsToggleRow>/
    )?.[0] || '';
  assert.match(
    row,
    /'settings\.config\.lookup\.enable\.privacy',\s*'With the Automatic or ipapi\.co provider, IP addresses can be sent to ipapi\.co\.'/
  );
  assert.match(row, /checked=\{settings\.enableGeolocation\}/);
  assert.ok(
    source.indexOf('id="enable-ip-geolocation"') < source.indexOf('<GeoIpDatabaseCard'),
    'lookup switch comes before the provider card'
  );
  assert.doesNotMatch(
    readSettingsFile('LoginProtectionTab.jsx'),
    /id="geoip-provider"/,
    'provider is filed under Location data'
  );
});

test('each supported locale discloses remote IP transmission and local alternatives', () => {
  for (const [locale, expected] of Object.entries(fragments)) {
    const hint = readCatalogue(locale)['settings.config.provider.hint'];
    for (const fragment of expected)
      assert.ok(hint.includes(fragment), `${locale} is missing ${fragment}`);
    assert.match(
      readCatalogue(locale)['settings.config.lookup.enable.privacy'],
      /ipapi\.co/,
      locale
    );
  }
  assert.equal(LOCALES.length, Object.keys(fragments).length);
});
