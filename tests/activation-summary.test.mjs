import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTIVATION_SUMMARY_MESSAGES,
  buildActivationSummary,
} from '../admin/src/utils/activationSummary.mjs';
import { formatSessionDate } from '../admin/src/utils/sessionDates.mjs';

const GERMAN = {
  'license.download.heading': 'Magic Session Manager: optionaler Aktivierungsschlüssel',
  'license.download.key': 'Aktivierungsschlüssel',
  'license.download.holderSection': 'Inhaber',
  'license.download.name': 'Name',
  'license.account.email': 'E-Mail-Adresse',
  'license.system.activation': 'Aktivierungsstatus',
  'license.download.status': 'Status',
  'license.details.expiresOn': 'Läuft ab am',
  'license.details.expiredOn': 'Abgelaufen am',
  'license.features.title': 'Funktionen',
  'license.download.features': 'Alle Funktionen sind enthalten.',
  'license.download.generated': 'Erstellt',
  'license.active': 'Aktiv',
  'license.inactive': 'Inaktiv',
  'license.value.never': 'Nie',
  'license.value.notProvided': 'Nicht angegeben',
};

const translateDe = (descriptor) => GERMAN[descriptor.messageId] ?? `MISSING:${descriptor.messageId}`;
const translateEn = (descriptor) => descriptor.defaultMessage;
const formatDe = (value, options) => formatSessionDate(value, 'de', '', options);

test('activation summary uses the translated labels and admin-locale dates (UX-16, F18)', () => {
  const summary = buildActivationSummary({
    data: {
      licenseKey: 'SYNTHETIC-KEY-0001',
      email: 'holder@example.invalid',
      firstName: 'Ada',
      lastName: 'Beispiel',
      isActive: true,
      expiresAt: '2027-03-01T12:00:00.000Z',
    },
    translate: translateDe,
    formatDate: formatDe,
    generatedAt: '2026-11-06T09:30:00.000Z',
  });

  assert.doesNotMatch(summary, /MISSING:/, 'every label has a translation id');
  assert.match(summary, /Aktivierungsschlüssel: SYNTHETIC-KEY-0001/);
  assert.match(summary, /Name: Ada Beispiel/);
  assert.match(summary, /Status: Aktiv/);
  assert.match(summary, /Läuft ab am: 1\. März 2027/);
  assert.match(summary, /Erstellt: 6\. November 2026/);
  for (const english of ['ACTIVE', 'Never', 'N/A', 'Expires', 'Generated']) {
    assert.doesNotMatch(summary, new RegExp(`\\b${english}\\b`), `no English literal "${english}"`);
  }
});

test('activation summary shows translated fallbacks instead of N/A', () => {
  const summary = buildActivationSummary({
    data: { licenseKey: 'SYNTHETIC-KEY-0002', isActive: false, isExpired: true },
    translate: translateDe,
    formatDate: formatDe,
    generatedAt: 0,
  });

  assert.match(summary, /Name: Nicht angegeben/);
  assert.match(summary, /E-Mail-Adresse: Nicht angegeben/);
  assert.match(summary, /Status: Inaktiv/);
  assert.match(summary, /Abgelaufen am: Nie/);
});

test('English defaults are complete', () => {
  const summary = buildActivationSummary({
    data: { licenseKey: 'SYNTHETIC-KEY-0003' },
    translate: translateEn,
    formatDate: (value, options) => formatSessionDate(value, 'en', '', options),
    generatedAt: 0,
  });

  assert.match(summary, /Activation key: SYNTHETIC-KEY-0003/);
  assert.match(summary, /Expires on: Never/);
  for (const descriptor of Object.values(ACTIVATION_SUMMARY_MESSAGES)) {
    assert.match(descriptor.messageId, /^license\./);
    assert.ok(descriptor.defaultMessage.length > 0);
  }
});
