// Admin-side helpers of the 4.17 signals, webhook and privacy settings.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { webcrypto } from 'node:crypto';

import {
  RETENTION_PRESETS,
  SIGNALS_FORM_DEFAULTS,
  WEBHOOK_EVENT_OPTIONS,
  currentRetentionPreset,
  describeWebhookTest,
  generateWebhookSecret,
  isWebhookUrl,
  validateSignalFields,
} from '../admin/src/utils/signalsForm.mjs';
import { SETTINGS_DEFAULTS } from '../admin/src/utils/settingsForm.mjs';
import { WEBHOOK_EVENTS, DEFAULT_WEBHOOK_EVENTS } from '../server/src/utils/detection-settings.js';

test('client and server agree on the events and the default selection', () => {
  assert.deepEqual(
    WEBHOOK_EVENT_OPTIONS.map(([event]) => event),
    [...WEBHOOK_EVENTS]
  );
  assert.deepEqual([...SIGNALS_FORM_DEFAULTS.webhookEvents], [...DEFAULT_WEBHOOK_EVENTS]);
  assert.ok(!SETTINGS_DEFAULTS.webhookEvents.includes('login.success'));
  assert.equal('genericWebhookUrl' in SETTINGS_DEFAULTS, false, 'write-only keys have no default');
});

test('inline validation of travel thresholds, URL and secret', () => {
  const errors = validateSignalFields({
    impossibleTravelSpeedKmh: 50,
    impossibleTravelMinDistanceKm: undefined,
    genericWebhookUrl: 'http://example.com',
    genericWebhookSecret: 'short',
  });
  assert.deepEqual(errors.impossibleTravelSpeedKmh.values, { min: 100, max: 5000 });
  assert.equal(errors.impossibleTravelMinDistanceKm.messageId, 'settings.validation.required');
  assert.equal(errors.genericWebhookUrl.messageId, 'settings.validation.webhookUrl');
  assert.equal(errors.genericWebhookSecret.messageId, 'settings.validation.webhookSecret');
  assert.deepEqual(validateSignalFields({}), {});
  assert.equal(isWebhookUrl('https://hooks.example.com/x'), true);
  assert.equal(isWebhookUrl('https://user:pw@hooks.example.com/x'), false);
  assert.equal(isWebhookUrl('https://localhost/x'), false);
});

test('retention presets and the generated secret', () => {
  assert.equal(
    currentRetentionPreset({ retentionDays: 90, securityLogRetentionDays: 90 }),
    'standard'
  );
  assert.equal(
    currentRetentionPreset({ retentionDays: 90, securityLogRetentionDays: 30 }),
    'custom'
  );
  assert.equal(RETENTION_PRESETS.minimal.retentionDays, 7);
  const secret = generateWebhookSecret(webcrypto);
  assert.match(secret, /^[A-Za-z0-9_-]{64}$/);
  assert.notEqual(generateWebhookSecret(webcrypto), secret);
});

test('test results are described with fixed messages', () => {
  assert.equal(describeWebhookTest({ ok: true, status: 204 }).tone, 'success');
  assert.equal(
    describeWebhookTest({ ok: false, code: 'address_not_allowed' }).messageId,
    'settings.signedWebhook.test.blocked'
  );
  assert.deepEqual(describeWebhookTest({ ok: false, code: 'http_500' }).values, { status: 500 });
  assert.equal(
    describeWebhookTest({ ok: false, code: 'weird' }).messageId,
    'settings.signedWebhook.test.network'
  );
});
