import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SETTINGS_TAB,
  PRESERVED_SETTINGS_KEYS,
  SELECT_PRESETS,
  SETTINGS_FIELD_LABELS,
  SETTINGS_TAB_FIELDS,
  SETTINGS_TAB_IDS,
  buildSavePayload,
  buildSelectOptions,
  buildTabSearch,
  fieldHasError,
  getErrorTab,
  getRevealScrollDelta,
  resolveSettingsTab,
  usesLocalDatabase,
} from '../admin/src/pages/Settings/settingsTabs.mjs';
import {
  SETTINGS_DEFAULTS,
  getAdjustedFields,
  normalizeSettings,
  validateSettings,
} from '../admin/src/utils/settingsForm.mjs';

test('?tab= resolves to a known tab and falls back to Sessions (IA C)', () => {
  for (const tab of SETTINGS_TAB_IDS) assert.equal(resolveSettingsTab(tab), tab);
  for (const value of [
    undefined,
    null,
    '',
    'general',
    'security',
    'SESSIONS',
    '../x',
    ['alerts', 'sessions'],
  ]) {
    assert.equal(
      resolveSettingsTab(value),
      Array.isArray(value) ? 'alerts' : DEFAULT_SETTINGS_TAB,
      String(value)
    );
  }
  assert.equal(DEFAULT_SETTINGS_TAB, 'sessions');
});

test('tab links keep other query values and replace only tab', () => {
  assert.equal(buildTabSearch('', 'alerts'), '?tab=alerts');
  assert.equal(buildTabSearch('?tab=sessions&x=1', 'location-data'), '?tab=location-data&x=1');
  assert.equal(buildTabSearch('?x=1', 'nope'), '?x=1&tab=sessions');
});

test('every editable setting belongs to exactly one tab and has a field label', () => {
  const owned = Object.values(SETTINGS_TAB_FIELDS).flat();
  assert.equal(new Set(owned).size, owned.length, 'no setting is shown on two tabs');
  const editable = Object.keys(SETTINGS_DEFAULTS);
  assert.deepEqual([...owned].sort(), [...editable, 'emailTemplates'].sort());
  for (const key of owned)
    assert.ok(SETTINGS_FIELD_LABELS[key], `${key} has a label for the adjusted-values message`);
  assert.equal(
    SETTINGS_TAB_FIELDS['login-protection'].includes('trustedProxies'),
    true,
    'trust proxy moved to Login protection'
  );
  assert.equal(
    SETTINGS_TAB_FIELDS.sessions.includes('cleanupInterval'),
    true,
    'idle check moved to Sessions'
  );
  assert.equal(SETTINGS_TAB_FIELDS['data-retention'].includes('retentionDays'), true);
});

test('the error marker points at the tab of the invalid field', () => {
  assert.equal(getErrorTab({}), undefined);
  assert.equal(getErrorTab(validateSettings({ maxFailedLogins: 500 })), 'login-protection');
  assert.equal(
    getErrorTab(validateSettings({ maxFailedLogins: 1, geoIpDatabasePath: '../x' })),
    'location-data'
  );
  assert.equal(
    getErrorTab(validateSettings({ maxFailedLogins: 1, slackWebhookUrl: 'https://example.com' })),
    'alerts'
  );
  assert.equal(fieldHasError({ 'emailTemplates.vpnProxy.html': {} }, 'emailTemplates'), true);
  assert.equal(fieldHasError({ 'emailTemplates.vpnProxy.html': {} }, 'email'), false);
});

test('select options keep a stored value outside the presets as a custom option (IA F)', () => {
  assert.deepEqual(
    buildSelectOptions(SELECT_PRESETS.inactivityTimeout, 15).filter((option) => option.custom),
    []
  );
  assert.deepEqual(buildSelectOptions(SELECT_PRESETS.inactivityTimeout, 45).at(-1), {
    value: 45,
    custom: true,
  });
  assert.deepEqual(
    buildSelectOptions(SELECT_PRESETS.retentionDays, -1).filter((option) => option.custom),
    []
  );
  assert.deepEqual(buildSelectOptions(SELECT_PRESETS.sessionCreationGraceMs, 2500).at(-1), {
    value: 2500,
    custom: true,
  });
  assert.equal(
    buildSelectOptions(SELECT_PRESETS.cleanupInterval, undefined).length,
    SELECT_PRESETS.cleanupInterval.length
  );
  assert.deepEqual([...SELECT_PRESETS.inactivityTimeout], [5, 10, 15, 30, 60, 120]);
  assert.deepEqual([...SELECT_PRESETS.maxSessionAgeDays], [1, 7, 14, 30, 60, 90, 180, 365]);
  assert.deepEqual([...SELECT_PRESETS.lastSeenRateLimit], [10, 30, 60, 120, 300]);
  assert.deepEqual([...SELECT_PRESETS.cleanupInterval], [15, 30, 60, 120]);
  assert.deepEqual([...SELECT_PRESETS.sessionCreationGraceMs], [0, 2000, 5000, 10000, 30000]);
  assert.deepEqual([...SELECT_PRESETS.retentionDays], [7, 30, 60, 90, 180, 365, -1]);
});

test('Save sends the hidden rate-limit keys back unchanged (IA F "Not shown, preserved on Save")', () => {
  assert.deepEqual(
    [...PRESERVED_SETTINGS_KEYS],
    ['rateLimitWriteMax', 'rateLimitReadMax', 'rateLimitWindowSeconds']
  );
  const saved = normalizeSettings({
    rateLimitWriteMax: 25,
    rateLimitReadMax: 300,
    rateLimitWindowSeconds: 120,
  });
  const draft = { ...saved, inactivityTimeout: 30, rateLimitWriteMax: 1 };
  const payload = buildSavePayload(draft, saved);
  assert.equal(payload.rateLimitWriteMax, 25, 'the UI never changes a hidden key');
  assert.equal(payload.rateLimitReadMax, 300);
  assert.equal(payload.rateLimitWindowSeconds, 120);
  assert.equal(payload.inactivityTimeout, 30);
  assert.equal(draft.rateLimitWriteMax, 1, 'the draft is not mutated');
  // Nothing to preserve when the server did not send the keys.
  assert.equal('rateLimitReadMax' in buildSavePayload({ a: 1 }, {}), false);
  // Preserved keys never show up as "adjusted".
  assert.deepEqual(getAdjustedFields(payload, { ...payload }, saved), []);
});

test('the GeoIP database controls apply to the Automatic and Local database providers only', () => {
  for (const provider of [undefined, '', 'auto', 'local-mmdb'])
    assert.equal(usesLocalDatabase(provider), true, String(provider));
  for (const provider of ['ipapi', 'disabled'])
    assert.equal(usesLocalDatabase(provider), false, provider);
});

test('getRevealScrollDelta scrolls a cut-off tab fully into its scrolling tab list', () => {
  const list = { left: 16, right: 374 };
  assert.equal(getRevealScrollDelta(list, { left: 40, right: 120 }), 0, 'visible tab: no scroll');
  assert.equal(
    getRevealScrollDelta(list, { left: 300, right: 460 }),
    86,
    'tab cut off on the right'
  );
  assert.equal(
    getRevealScrollDelta(list, { left: -50, right: 30 }),
    -66,
    'tab cut off on the left'
  );
  assert.equal(
    getRevealScrollDelta(list, { left: 300, right: 374.4 }),
    0,
    'sub-pixel overhang is ignored'
  );
  assert.equal(getRevealScrollDelta(null, { left: 0, right: 10 }), 0);
  assert.equal(getRevealScrollDelta(list, undefined), 0);
});
