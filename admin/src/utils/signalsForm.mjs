/**
 * Sign-in signals, webhooks and privacy (4.17, part 2) in the settings
 * form: client defaults, the event list shown as a checklist, inline
 * validation with the server's bounds, retention presets and the webhook
 * secret generator. Pure functions, so `node --test` covers them.
 *
 * The signed webhook URL and secret are write-only: the server returns only
 * `hasGenericWebhook` (with `genericWebhookHint`) / `hasGenericWebhookSecret`,
 * and the draft holds the
 * keys only while the admin enters a new value.
 */

/** Client defaults; they mirror DETECTION_DEFAULTS on the server. */
export const SIGNALS_FORM_DEFAULTS = Object.freeze({
  alertOnNewDevice: false,
  alertOnImpossibleTravel: false,
  impossibleTravelEnabled: false,
  impossibleTravelSpeedKmh: 1000,
  impossibleTravelMinDistanceKm: 500,
  impossibleTravelAction: 'alert',
  webhookEvents: Object.freeze([
    'login.suspicious',
    'login.new_location',
    'login.new_device',
    'login.impossible_travel',
    'lockout',
    'user.not_me',
  ]),
  genericWebhookEnabled: false,
  // Read-only facts from the server: the URL and the secret are write-only.
  hasGenericWebhook: false,
  genericWebhookHint: null,
  hasGenericWebhookSecret: false,
  sessionIpAnonymize: false,
});

/** Events of the checklist, with their label message, in display order. */
export const WEBHOOK_EVENT_OPTIONS = Object.freeze([
  ['login.success', 'settings.webhookEvents.loginSuccess', 'Every successful sign-in'],
  ['login.suspicious', 'settings.webhookEvents.loginSuspicious', 'Suspicious sign-in'],
  ['login.new_location', 'settings.webhookEvents.loginNewLocation', 'Sign-in from a new country'],
  ['login.new_device', 'settings.webhookEvents.loginNewDevice', 'Sign-in from a new device'],
  ['login.impossible_travel', 'settings.webhookEvents.impossibleTravel', 'Impossible travel'],
  ['login.failed', 'settings.webhookEvents.loginFailed', 'Failed sign-in'],
  ['login.refused', 'settings.webhookEvents.loginRefused', 'Refused sign-in'],
  ['lockout', 'settings.webhookEvents.lockout', 'IP address or account locked'],
  ['lockout.lifted', 'settings.webhookEvents.lockoutLifted', 'Lock lifted by an admin'],
  ['session.limit', 'settings.webhookEvents.sessionLimit', 'Session limit reached'],
  [
    'password.changed',
    'settings.webhookEvents.passwordChanged',
    'Sessions ended after a password change',
  ],
  ['user.not_me', 'settings.webhookEvents.notMe', '"This wasn\'t me" used'],
]);

export const SIGNALS_RANGES = Object.freeze({
  impossibleTravelSpeedKmh: Object.freeze({ min: 100, max: 5000 }),
  impossibleTravelMinDistanceKm: Object.freeze({ min: 50, max: 20000 }),
});

/** Retention presets: ended sessions and security events, in days. */
export const RETENTION_PRESETS = Object.freeze({
  minimal: Object.freeze({ retentionDays: 7, securityLogRetentionDays: 30 }),
  standard: Object.freeze({ retentionDays: 90, securityLogRetentionDays: 90 }),
  extended: Object.freeze({ retentionDays: 365, securityLogRetentionDays: 365 }),
});

const message = (messageId, defaultMessage, values) => ({ messageId, defaultMessage, values });

/**
 * The preset that matches the current values, or 'custom'.
 *
 * @param {{retentionDays?: number, securityLogRetentionDays?: number}} settings Draft.
 * @returns {string} Preset key or 'custom'.
 */
export function currentRetentionPreset(settings) {
  const match = Object.entries(RETENTION_PRESETS).find(
    ([, values]) =>
      Number(settings?.retentionDays) === values.retentionDays &&
      Number(settings?.securityLogRetentionDays) === values.securityLogRetentionDays
  );
  return match ? match[0] : 'custom';
}

/**
 * Whether a URL is an https URL without credentials (the server checks the
 * resolved address before every delivery).
 *
 * @param {unknown} value Draft value.
 * @returns {boolean} True when acceptable.
 */
export function isWebhookUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !!host &&
      host !== 'localhost' &&
      !host.endsWith('.localhost') &&
      !host.endsWith('.local')
    );
  } catch {
    return false;
  }
}

/**
 * Inline errors of the signal and webhook fields.
 *
 * @param {Record<string, any>} settings Draft.
 * @returns {Record<string, {messageId: string, defaultMessage: string, values?: object}>} Errors.
 */
export function validateSignalFields(settings) {
  const source = settings || {};
  /** @type {Record<string, any>} */
  const errors = {};
  for (const [key, { min, max }] of Object.entries(SIGNALS_RANGES)) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    const number = Number(value);
    if (value === undefined || value === null || value === '') {
      errors[key] = message('settings.validation.required', 'Enter a value.');
    } else if (!Number.isInteger(number) || number < min || number > max) {
      errors[key] = message(
        'settings.validation.range',
        'Enter a whole number from {min} to {max}.',
        {
          min,
          max,
        }
      );
    }
  }
  if (
    typeof source.genericWebhookUrl === 'string' &&
    source.genericWebhookUrl &&
    !isWebhookUrl(source.genericWebhookUrl)
  ) {
    errors.genericWebhookUrl = message(
      'settings.validation.webhookUrl',
      'Enter an https address without a user name or password, for example https://hooks.example.com/sessions.'
    );
  }
  if (
    typeof source.genericWebhookSecret === 'string' &&
    source.genericWebhookSecret &&
    !/^[\x21-\x7e]{32,256}$/.test(source.genericWebhookSecret)
  ) {
    errors.genericWebhookSecret = message(
      'settings.validation.webhookSecret',
      'Use 32 to 256 characters without spaces, or generate one.'
    );
  }
  return errors;
}

/**
 * A new random secret (48 bytes, base64url, 64 characters).
 *
 * @param {{getRandomValues: (array: Uint8Array) => Uint8Array}} [cryptoApi] Web Crypto.
 * @returns {string} Secret.
 */
export function generateWebhookSecret(cryptoApi = globalThis.crypto) {
  const bytes = cryptoApi.getRandomValues(new Uint8Array(48));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The message of a "Send test" result.
 *
 * @param {{ok: boolean, status: number|null, code: string|null}} result Server result.
 * @returns {{messageId: string, defaultMessage: string, values?: object, tone: 'success'|'danger'}} Message.
 */
export function describeWebhookTest(result) {
  if (result?.ok) {
    return {
      ...message('settings.signedWebhook.test.ok', 'Delivered. The receiver answered {status}.', {
        status: result.status,
      }),
      tone: 'success',
    };
  }
  const code = String(result?.code || 'network_error');
  const known = {
    no_url: ['settings.signedWebhook.test.noUrl', 'Save a URL first.'],
    no_secret: ['settings.signedWebhook.test.noSecret', 'Save a secret first.'],
    invalid_url: [
      'settings.signedWebhook.test.invalidUrl',
      'The saved URL is not a valid https address.',
    ],
    dns_failed: ['settings.signedWebhook.test.dns', 'The host name could not be resolved.'],
    address_not_allowed: [
      'settings.signedWebhook.test.blocked',
      'Not sent: the host resolves to a private, local or reserved address.',
    ],
    timeout: [
      'settings.signedWebhook.test.timeout',
      'The receiver did not answer within 5 seconds.',
    ],
    redirect_not_followed: [
      'settings.signedWebhook.test.redirect',
      'The receiver answered with a redirect. Redirects are not followed; use the final URL.',
    ],
    network_error: ['settings.signedWebhook.test.network', 'The connection failed.'],
  };
  if (known[code]) return { ...message(known[code][0], known[code][1]), tone: 'danger' };
  const status = /^http_(\d{3})$/.exec(code);
  if (status) {
    return {
      ...message('settings.signedWebhook.test.http', 'The receiver answered {status}.', {
        status: Number(status[1]),
      }),
      tone: 'danger',
    };
  }
  return { ...message(known.network_error[0], known.network_error[1]), tone: 'danger' };
}
