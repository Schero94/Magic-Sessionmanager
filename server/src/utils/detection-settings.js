'use strict';

// @ts-check

/**
 * Settings of the sign-in signals, integrations and privacy controls
 * (4.17, part 2): new-device and impossible-travel detection, the event
 * selection shared by Discord, Slack and the signed webhook, the signed
 * webhook target, and shortened IP addresses for app-user sessions.
 *
 * Every feature is off by default. The event selection of a new
 * installation leaves out "every sign-in" (`login.success`); an
 * installation upgraded from 4.16 or earlier keeps posting every sign-in to
 * Discord and Slack until an administrator changes the selection (see
 * `utils/upgrade-defaults.js`).
 */

/** Events that Discord, Slack and the signed webhook can receive. */
const WEBHOOK_EVENTS = Object.freeze([
  'login.success',
  'login.suspicious',
  'login.new_location',
  'login.new_device',
  'login.impossible_travel',
  'login.failed',
  'login.refused',
  'lockout',
  'lockout.lifted',
  'session.limit',
  'password.changed',
  'user.not_me',
]);

/** Event selection of a new installation (no "every sign-in"). */
const DEFAULT_WEBHOOK_EVENTS = Object.freeze([
  'login.suspicious',
  'login.new_location',
  'login.new_device',
  'login.impossible_travel',
  'lockout',
  'user.not_me',
]);

/** What Discord and Slack received before 4.17: one post per sign-in. */
const LEGACY_WEBHOOK_EVENTS = Object.freeze([
  'login.success',
  'login.suspicious',
  'login.new_location',
]);

const IMPOSSIBLE_TRAVEL_ACTIONS = Object.freeze(['alert', 'reauthenticate']);

/** Defaults in user-facing units. */
const DETECTION_DEFAULTS = Object.freeze({
  alertOnNewDevice: false,
  alertOnImpossibleTravel: false,
  impossibleTravelEnabled: false,
  impossibleTravelSpeedKmh: 1000,
  impossibleTravelMinDistanceKm: 500,
  impossibleTravelAction: 'alert',
  webhookEvents: DEFAULT_WEBHOOK_EVENTS,
  genericWebhookEnabled: false,
  genericWebhookUrl: '',
  sessionIpAnonymize: false,
});

const DETECTION_KEYS = Object.freeze(Object.keys(DETECTION_DEFAULTS));

/**
 * Detection keys that need `settings.update` to change: where sign-in data
 * is sent (signed webhook, event selection), whether a sign-in is ended
 * (impossible travel) and whether full IP addresses are kept. The two alert
 * email switches stay with plugin access, like the other alert emails.
 */
const PROTECTED_DETECTION_KEYS = Object.freeze([
  'impossibleTravelEnabled',
  'impossibleTravelSpeedKmh',
  'impossibleTravelMinDistanceKm',
  'impossibleTravelAction',
  'webhookEvents',
  'genericWebhookEnabled',
  'genericWebhookUrl',
  'genericWebhookSecret',
  'sessionIpAnonymize',
]);

const RANGES = Object.freeze({
  impossibleTravelSpeedKmh: Object.freeze([100, 5000]),
  impossibleTravelMinDistanceKm: Object.freeze([50, 20000]),
});

const BOOLEAN_KEYS = Object.freeze([
  'alertOnNewDevice',
  'alertOnImpossibleTravel',
  'impossibleTravelEnabled',
  'genericWebhookEnabled',
  'sessionIpAnonymize',
]);

const MAX_URL_LENGTH = 2048;

/**
 * @param {unknown} value Raw input.
 * @returns {number|null} Integer or null.
 */
function parseInteger(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string' && /^\s*\d{1,9}\s*$/.test(value)) return Number.parseInt(value, 10);
  return null;
}

/**
 * Checks the form of a webhook URL: https, no credentials, a host name that
 * is not obviously local. The address the name resolves to is checked again
 * before every delivery (utils/webhook-delivery.js).
 *
 * @param {unknown} value Candidate URL.
 * @returns {string|null} Normalised URL, or null when not acceptable.
 */
function normalizeWebhookUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return null;
  }
  return parsed.toString();
}

/**
 * Cleans a stored event list: known events only, no duplicates.
 *
 * @param {unknown} value Stored list.
 * @returns {string[]|null} Clean list, or null when not a list.
 */
function normalizeEventList(value) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter((event) => WEBHOOK_EVENTS.includes(event)))];
}

/**
 * Cleans stored values (keys that are present only).
 *
 * @param {Record<string, unknown>|null|undefined} stored Raw stored settings.
 * @returns {Record<string, unknown>} Clean values.
 */
function normalizeDetectionSettings(stored) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (!stored || typeof stored !== 'object') return out;
  for (const key of BOOLEAN_KEYS) if (stored[key] !== undefined) out[key] = stored[key] === true;
  for (const [key, [min, max]] of Object.entries(RANGES)) {
    if (stored[key] === undefined) continue;
    const number = parseInteger(stored[key]);
    out[key] =
      number !== null && number >= min && number <= max
        ? number
        : /** @type {any} */ (DETECTION_DEFAULTS)[key];
  }
  if (stored.impossibleTravelAction !== undefined) {
    out.impossibleTravelAction = IMPOSSIBLE_TRAVEL_ACTIONS.includes(
      /** @type {string} */ (stored.impossibleTravelAction)
    )
      ? stored.impossibleTravelAction
      : 'alert';
  }
  if (stored.webhookEvents !== undefined) {
    out.webhookEvents = normalizeEventList(stored.webhookEvents) || [...DEFAULT_WEBHOOK_EVENTS];
  }
  if (stored.genericWebhookUrl !== undefined) {
    out.genericWebhookUrl = normalizeWebhookUrl(stored.genericWebhookUrl) || '';
  }
  return out;
}

/**
 * Validates the keys of a settings PUT body; invalid values are reported.
 *
 * @param {Record<string, unknown>} body Request body.
 * @returns {{values: Record<string, unknown>, errors: Array<{path: Array<string|number>, message: string}>}}
 *   Valid values and errors.
 */
function validateDetectionSettings(body) {
  /** @type {Record<string, unknown>} */
  const values = {};
  /** @type {Array<{path: Array<string|number>, message: string}>} */
  const errors = [];
  /** @param {string} key */
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
  for (const key of BOOLEAN_KEYS) {
    if (!has(key)) continue;
    if (typeof body[key] !== 'boolean')
      errors.push({ path: [key], message: `${key} must be a boolean` });
    else values[key] = body[key];
  }
  for (const [key, [min, max]] of Object.entries(RANGES)) {
    if (!has(key)) continue;
    const number = parseInteger(body[key]);
    if (number === null || number < min || number > max) {
      errors.push({ path: [key], message: `${key} must be an integer between ${min} and ${max}` });
    } else {
      values[key] = number;
    }
  }
  if (has('impossibleTravelAction')) {
    if (!IMPOSSIBLE_TRAVEL_ACTIONS.includes(/** @type {string} */ (body.impossibleTravelAction))) {
      errors.push({
        path: ['impossibleTravelAction'],
        message: `impossibleTravelAction must be one of: ${IMPOSSIBLE_TRAVEL_ACTIONS.join(', ')}`,
      });
    } else {
      values.impossibleTravelAction = body.impossibleTravelAction;
    }
  }
  if (has('webhookEvents')) {
    const list = body.webhookEvents;
    if (
      !Array.isArray(list) ||
      list.length > WEBHOOK_EVENTS.length ||
      list.some((event) => !WEBHOOK_EVENTS.includes(event))
    ) {
      errors.push({
        path: ['webhookEvents'],
        message: `webhookEvents must be a list of: ${WEBHOOK_EVENTS.join(', ')}`,
      });
    } else {
      values.webhookEvents = [...new Set(list)];
    }
  }
  if (has('genericWebhookUrl')) {
    const raw = body.genericWebhookUrl;
    if (typeof raw !== 'string') {
      errors.push({ path: ['genericWebhookUrl'], message: 'genericWebhookUrl must be a string' });
    } else if (!raw.trim()) {
      values.genericWebhookUrl = '';
    } else {
      const url = normalizeWebhookUrl(raw);
      if (!url) {
        errors.push({
          path: ['genericWebhookUrl'],
          message:
            'genericWebhookUrl must be an https URL without credentials on a public host name',
        });
      } else {
        values.genericWebhookUrl = url;
      }
    }
  }
  return { values, errors };
}

/**
 * Runtime view.
 *
 * @param {Record<string, any>} settings Merged settings.
 * @returns {typeof DETECTION_DEFAULTS & {webhookEvents: string[]}} Clean values with defaults.
 */
function resolveDetectionSettings(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const clean = normalizeDetectionSettings(
    Object.fromEntries(
      DETECTION_KEYS.map((key) => [key, source[key]]).filter(([, v]) => v !== undefined)
    )
  );
  return /** @type {any} */ ({
    ...DETECTION_DEFAULTS,
    webhookEvents: [...DEFAULT_WEBHOOK_EVENTS],
    ...clean,
  });
}

module.exports = {
  DEFAULT_WEBHOOK_EVENTS,
  DETECTION_DEFAULTS,
  DETECTION_KEYS,
  PROTECTED_DETECTION_KEYS,
  IMPOSSIBLE_TRAVEL_ACTIONS,
  LEGACY_WEBHOOK_EVENTS,
  WEBHOOK_EVENTS,
  normalizeDetectionSettings,
  normalizeWebhookUrl,
  resolveDetectionSettings,
  validateDetectionSettings,
};
