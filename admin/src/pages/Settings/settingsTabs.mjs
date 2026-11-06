/**
 * Configuration page layout (IA section F): tab ids, which tab owns which
 * setting, select presets and the settings that the UI never shows but must
 * send back unchanged. Pure data and helpers, so tests can import them.
 */

/** Tab ids in display order; also the values of the `?tab=` query (IA C). */
export const SETTINGS_TAB_IDS = Object.freeze([
  'sessions',
  'login-protection',
  'location-data',
  'alerts',
  'data-retention',
]);

export const DEFAULT_SETTINGS_TAB = 'sessions';

/** Tab label descriptors (sentence case, H.3). */
export const SETTINGS_TAB_LABELS = Object.freeze({
  sessions: ['settings.config.tab.sessions', 'Sessions'],
  'login-protection': ['settings.config.tab.loginProtection', 'Login protection'],
  'location-data': ['settings.config.tab.locationData', 'Location data'],
  alerts: ['settings.config.tab.alerts', 'Alerts'],
  'data-retention': ['settings.config.tab.dataRetention', 'Data and retention'],
});

/** Settings keys shown on each tab (for error markers and the adjusted-values message). */
export const SETTINGS_TAB_FIELDS = Object.freeze({
  sessions: [
    'inactivityTimeout',
    'maxSessionAgeDays',
    'lastSeenRateLimit',
    'cleanupInterval',
    'cleanupUseDbDirect',
    'strictSessionEnforcement',
    'sessionCreationGraceMs',
  ],
  'login-protection': [
    'maxFailedLogins',
    'trustedProxies',
    'blockSuspiciousSessions',
    'geoLookupFailureMode',
    'enableGeofencing',
    'allowedCountries',
    'blockedCountries',
  ],
  'location-data': ['enableGeolocation', 'enableSecurityScoring', 'geoIpProvider', 'geoIpDatabasePath'],
  alerts: [
    'enableEmailAlerts',
    'alertOnSuspiciousLogin',
    'alertOnNewLocation',
    'alertOnVpnProxy',
    'emailTemplates',
    'enableWebhooks',
    'discordWebhookUrl',
    'slackWebhookUrl',
  ],
  'data-retention': ['retentionDays'],
});

/**
 * Not shown in the UI (IA F "Not shown, preserved on Save"). PUT /settings
 * replaces the whole object, so Save sends the stored values back unchanged.
 */
export const PRESERVED_SETTINGS_KEYS = Object.freeze(['rateLimitWriteMax', 'rateLimitReadMax', 'rateLimitWindowSeconds']);

/** Field names used in "Some values were adjusted to the allowed limits: {fields}." */
export const SETTINGS_FIELD_LABELS = Object.freeze({
  inactivityTimeout: ['settings.config.sessions.inactivity.label', 'Inactivity timeout'],
  maxSessionAgeDays: ['settings.config.sessions.maxAge.label', 'Maximum session age'],
  lastSeenRateLimit: ['settings.config.sessions.lastSeen.label', 'Update "Last active" at most every'],
  cleanupInterval: ['settings.config.sessions.idleCheck.label', 'Run idle check every'],
  cleanupUseDbDirect: ['settings.config.sessions.idleMethod.label', 'Idle check method'],
  strictSessionEnforcement: ['settings.config.token.check.label', 'Strict token check'],
  sessionCreationGraceMs: ['settings.config.token.grace.label', 'Grace period after sign-in'],
  maxFailedLogins: ['settings.config.failed.lockout.label', 'Temporary IP lockout after'],
  trustedProxies: ['settings.config.clientIp.trustProxy.label', 'Trust proxy headers'],
  blockSuspiciousSessions: ['settings.config.suspicious.reject.label', 'Reject suspicious sign-ins'],
  geoLookupFailureMode: ['settings.config.suspicious.failureMode.label', 'If the location cannot be determined'],
  enableGeofencing: ['settings.config.countries.enable.label', 'Use country rules'],
  allowedCountries: ['settings.config.countries.list.label', 'Countries'],
  blockedCountries: ['settings.config.countries.list.label', 'Countries'],
  enableGeolocation: ['settings.config.lookup.enable.label', 'IP location lookup'],
  enableSecurityScoring: ['settings.config.lookup.scoring.label', 'Security scoring'],
  geoIpProvider: ['settings.config.provider.label', 'Provider'],
  geoIpDatabasePath: ['settings.config.database.fileName.label', 'Database file name'],
  enableEmailAlerts: ['settings.config.email.enable.label', 'Send security emails'],
  alertOnSuspiciousLogin: ['settings.config.email.suspicious.label', 'Suspicious sign-in'],
  alertOnNewLocation: ['settings.config.email.newCountry.label', 'Sign-in from a new country'],
  alertOnVpnProxy: ['settings.config.email.vpnProxy.label', 'VPN or proxy'],
  emailTemplates: ['settings.config.email.templates.field', 'Email templates'],
  enableWebhooks: ['settings.config.webhooks.enable.label', 'Send team notifications'],
  discordWebhookUrl: ['settings.config.webhooks.discord.label', 'Discord webhook URL'],
  slackWebhookUrl: ['settings.config.webhooks.slack.label', 'Slack webhook URL'],
  retentionDays: ['settings.config.retention.keep.label', 'Keep ended sessions for'],
});

/** Select presets (IA F). Units are added by the page; -1 means "Forever". */
export const SELECT_PRESETS = Object.freeze({
  inactivityTimeout: Object.freeze([5, 10, 15, 30, 60, 120]),
  maxSessionAgeDays: Object.freeze([1, 7, 14, 30, 60, 90, 180, 365]),
  lastSeenRateLimit: Object.freeze([10, 30, 60, 120, 300]),
  cleanupInterval: Object.freeze([15, 30, 60, 120]),
  sessionCreationGraceMs: Object.freeze([0, 2000, 5000, 10000, 30000]),
  retentionDays: Object.freeze([7, 30, 60, 90, 180, 365, -1]),
});

/**
 * @param {unknown} value Raw `tab` query value.
 * @returns {string} A known tab id, else the default tab.
 */
export function resolveSettingsTab(value) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return SETTINGS_TAB_IDS.includes(candidate) ? candidate : DEFAULT_SETTINGS_TAB;
}

/**
 * Builds the URL search string for a tab while keeping other query values.
 *
 * @param {string} search Current `location.search` (with or without "?").
 * @param {string} tab Tab id.
 * @returns {string} Search string starting with "?".
 */
export function buildTabSearch(search, tab) {
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  params.set('tab', resolveSettingsTab(tab));
  return `?${params.toString()}`;
}

/**
 * @param {Record<string, unknown>} errors Errors from validateSettings().
 * @param {string} field Settings key.
 * @returns {boolean} Whether the field or one of its nested paths has an error.
 */
export function fieldHasError(errors, field) {
  return Object.keys(errors || {}).some((path) => path === field || path.startsWith(`${field}.`));
}

/**
 * @param {Record<string, unknown>} errors Errors from validateSettings().
 * @param {string} tab Tab id.
 * @returns {boolean} Whether a field on the tab is invalid.
 */
export function tabHasFieldErrors(errors, tab) {
  return (SETTINGS_TAB_FIELDS[tab] || []).some((field) => fieldHasError(errors, field));
}

/**
 * @param {Record<string, unknown>} errors Errors from validateSettings().
 * @returns {string|undefined} The first tab with an invalid field.
 */
export function getErrorTab(errors) {
  return SETTINGS_TAB_IDS.find((tab) => tabHasFieldErrors(errors, tab));
}

/**
 * Select options for a stored value. A value outside the presets (for example
 * set through config) is kept as an extra "custom" option instead of being
 * replaced (IA F).
 *
 * @param {readonly number[]} presets Preset values.
 * @param {unknown} current Stored value.
 * @returns {Array<{value: number, custom: boolean}>} Options in display order.
 */
export function buildSelectOptions(presets, current) {
  const options = presets.map((value) => ({ value, custom: false }));
  const number = typeof current === 'number' ? current : Number.parseInt(String(current ?? ''), 10);
  if (Number.isInteger(number) && !presets.includes(number)) {
    options.push({ value: number, custom: true });
  }
  return options;
}

/**
 * Payload for PUT /settings: the draft, with the hidden rate-limit keys taken
 * from the stored settings so they are never changed or dropped by the UI.
 *
 * @param {object} draft Current settings draft.
 * @param {object} saved Stored settings baseline.
 * @returns {object} Settings to send.
 */
export function buildSavePayload(draft, saved) {
  const payload = { ...(draft || {}) };
  for (const key of PRESERVED_SETTINGS_KEYS) {
    if (saved && Object.prototype.hasOwnProperty.call(saved, key)) payload[key] = saved[key];
  }
  return payload;
}

/**
 * Whether the GeoIP database controls apply to the selected provider.
 *
 * @param {unknown} provider Draft `geoIpProvider`.
 * @returns {boolean} True for Automatic and Local database.
 */
export function usesLocalDatabase(provider) {
  return provider === undefined || provider === null || provider === '' || provider === 'auto' || provider === 'local-mmdb';
}
