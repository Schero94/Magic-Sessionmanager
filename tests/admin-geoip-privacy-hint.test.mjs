import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readSettingsFile } from './helpers/settingsSource.mjs';

const read = (path) => readFileSync(new URL(`../admin/src/${path}`, import.meta.url), 'utf8');
const fragments = {
  en: ['Auto', 'ipapi.co', 'IP address', 'missing', 'fails', 'Block', 'Local MMDB', 'Disabled'],
  de: ['Automatisch', 'ipapi.co', 'IP-Adresse', 'fehlt', 'fehlschlägt', 'Sperren', 'Lokale MMDB', 'Deaktiviert'],
  es: ['Automático', 'ipapi.co', 'dirección IP', 'falta', 'falla', 'Bloquear', 'MMDB local', 'Desactivado'],
  fr: ['Automatique', 'ipapi.co', 'adresse IP', 'absente', 'échoue', 'Bloquer', 'MMDB locale', 'Désactivé'],
  pt: ['Automático', 'ipapi.co', 'endereço IP', 'ausente', 'falha', 'Bloquear', 'MMDB local', 'Desativado'],
};

test('GeoIP provider field exposes the disclosure using the existing associated hint', () => {
  const source = readSettingsFile('SecurityTab.jsx');
  const field = source.match(/<FormField\s+id="geoip-provider"[\s\S]*?<\/FormField>/)?.[0];
  assert.ok(field);
  assert.match(field, /description=\{t\('settings\.geofencing\.provider\.hint'/);
  assert.match(field.match(/description=\{t\([\s\S]*?\)\}/)?.[0] || '', /ipapi\.co/);
  assert.match(field, /value=\{settings\.geoIpProvider \|\| 'auto'\}/);
});

test('the privacy disclosure sits next to the IP geolocation switch that enables lookups (SET-08)', () => {
  const source = readSettingsFile('SecurityTab.jsx');
  const card = source.slice(source.indexOf("t('settings.security.geolocation.title'"), source.indexOf('</SectionCard>', source.indexOf('id="geoip-lookup-failure-mode"')));
  assert.match(card, /id="enable-ip-geolocation"/);
  assert.match(card, /settings\.security\.geolocation\.description'[\s\S]*?ipapi\.co/);
  assert.match(card, /id="geoip-provider"/);
  assert.match(card, /id="geoip-lookup-failure-mode"/);
  assert.doesNotMatch(readSettingsFile('GeofencingTab.jsx'), /id="geoip-provider"/, 'provider is no longer filed under geofencing');
});

test('each supported locale discloses remote IP transmission and local alternatives', () => {
  for (const [locale, expected] of Object.entries(fragments)) {
    const hint = JSON.parse(read(`translations/${locale}.json`))['settings.geofencing.provider.hint'];
    for (const fragment of expected) assert.ok(hint.includes(fragment), `${locale} is missing ${fragment}`);
  }
});
