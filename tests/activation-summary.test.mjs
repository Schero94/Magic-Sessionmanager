import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LICENSE_SUMMARY_MESSAGES,
  buildLicenseSummary,
} from '../admin/src/utils/activationSummary.mjs';
import { LICENSE_FEATURES_MESSAGE, LICENSE_STATE_MESSAGES } from '../admin/src/utils/licenseStatus.mjs';
import { formatSessionDate } from '../admin/src/utils/sessionDates.mjs';

const NOW = Date.parse('2026-11-06T09:30:00.000Z');

const GERMAN = {
  'license.download.heading': 'Session Manager: Lizenz',
  'license.download.status': 'Status',
  'license.key.title': 'Lizenzschlüssel',
  'license.details.holder': 'Inhaber',
  'license.account.email': 'E-Mail-Adresse',
  'license.details.expires': 'Läuft ab',
  'license.details.noExpiry': 'Kein Ablaufdatum',
  'license.details.deviceName': 'Gerätename',
  'license.details.ipAddress': 'IP-Adresse',
  'license.details.lastCheck': 'Letzte Prüfung',
  'license.system.deviceLimit': 'Gerätelimit',
  'license.system.deviceLimitValue': '{current} von {max}',
  'license.details.serverReachable': 'Lizenzserver erreichbar',
  'common.yes': 'Ja',
  'common.no': 'Nein',
  'license.download.generated': 'Erstellt',
  'license.value.notProvided': 'Nicht angegeben',
  'license.state.valid': 'Lizenz gültig bis {date}.',
  'license.state.unchecked': 'Der Lizenzstatus konnte nicht geprüft werden.',
  'license.features.always': 'Alle Funktionen sind mit und ohne Schlüssel verfügbar.',
};

/** Minimal ICU-free formatter for the synthetic catalogue above. */
const translateDe = (descriptor, values = {}) => {
  const template = GERMAN[descriptor.messageId];
  if (template === undefined) return `MISSING:${descriptor.messageId}`;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
};
const translateEn = (descriptor, values = {}) =>
  descriptor.defaultMessage.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
const formatDe = (value, options) => formatSessionDate(value, 'de', '', options);
const formatEn = (value, options) => formatSessionDate(value, 'en', '', options);

const RESPONSE = {
  success: true,
  hasKey: true,
  data: {
    licenseKey: 'SYNTHETIC-KEY-0001',
    email: 'holder@example.invalid',
    firstName: 'Ada',
    lastName: 'Beispiel',
    isActive: true,
    isOnline: true,
    expiresAt: '2027-03-01T12:00:00.000Z',
    lastPingAt: '2026-11-05T08:00:00.000Z',
    deviceName: 'build-server',
    ipAddress: '192.0.2.10',
    maxDevices: 3,
    currentDevices: 1,
  },
};

test('license download uses translated labels and admin-locale dates (F18, I18N-10)', () => {
  const summary = buildLicenseSummary({
    response: RESPONSE,
    translate: translateDe,
    formatDate: formatDe,
    generatedAt: '2026-11-06T09:30:00.000Z',
    now: NOW,
  });

  assert.doesNotMatch(summary, /MISSING:/, 'every label has a translation id');
  assert.match(summary, /Status: Lizenz gültig bis 01\.03\.2027\./);
  assert.match(summary, /Alle Funktionen sind mit und ohne Schlüssel verfügbar\./);
  assert.match(summary, /Lizenzschlüssel: SYNTHETIC-KEY-0001/);
  assert.match(summary, /Inhaber: Ada Beispiel/);
  assert.match(summary, /Läuft ab: 01\.03\.2027/);
  assert.match(summary, /Gerätelimit: 1 von 3/);
  assert.match(summary, /Lizenzserver erreichbar: Ja/);
  assert.match(summary, /Erstellt: 06\.11\.2026/);
  for (const english of ['ACTIVE', 'Active', 'Inactive', 'Never', 'N/A', 'Expires', 'Generated', 'Online', 'Offline']) {
    assert.doesNotMatch(summary, new RegExp(`\\b${english}\\b`), `no English or retired literal "${english}"`);
  }
});

test('license download shows translated fallbacks and the unchecked state', () => {
  const summary = buildLicenseSummary({
    response: { hasKey: true, data: { licenseKey: 'SYNTHETIC-KEY-0002', isOnline: false } },
    translate: translateDe,
    formatDate: formatDe,
    generatedAt: 0,
    now: NOW,
  });

  assert.match(summary, /Status: Der Lizenzstatus konnte nicht geprüft werden\./);
  assert.match(summary, /Inhaber: Nicht angegeben/);
  assert.match(summary, /E-Mail-Adresse: Nicht angegeben/);
  assert.match(summary, /Läuft ab: Kein Ablaufdatum/);
  assert.match(summary, /Lizenzserver erreichbar: Nein/);
});

test('English defaults are complete and use the license vocabulary', () => {
  const summary = buildLicenseSummary({
    response: RESPONSE,
    translate: translateEn,
    formatDate: formatEn,
    generatedAt: 0,
    now: NOW,
  });

  assert.match(summary, /License key: SYNTHETIC-KEY-0001/);
  assert.match(summary, /Status: License valid until Mar 1, 2027\./);
  assert.match(summary, /License server reachable: Yes/);
  assert.doesNotMatch(summary, /activation/i);
  for (const descriptor of [...Object.values(LICENSE_SUMMARY_MESSAGES), ...Object.values(LICENSE_STATE_MESSAGES), LICENSE_FEATURES_MESSAGE]) {
    assert.match(descriptor.messageId, /^(?:license|common)\./);
    assert.ok(descriptor.defaultMessage.length > 0);
  }
});
