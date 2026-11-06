/**
 * License status for the License page and its text download (IA D7). The
 * license never gates features; this only answers "is a key stored, and is
 * it valid?" with exactly one state.
 */

/** Translation descriptors for the single status sentence (ids relative to the plugin namespace). */
export const LICENSE_STATE_MESSAGES = Object.freeze({
  noKey: Object.freeze({ messageId: 'license.state.noKey', defaultMessage: 'No license key stored.' }),
  valid: Object.freeze({ messageId: 'license.state.valid', defaultMessage: 'License valid until {date}.' }),
  validNoExpiry: Object.freeze({ messageId: 'license.state.validNoExpiry', defaultMessage: 'License valid. It has no expiry date.' }),
  expired: Object.freeze({ messageId: 'license.state.expired', defaultMessage: 'License expired on {date}.' }),
  expiredNoDate: Object.freeze({ messageId: 'license.state.expiredNoDate', defaultMessage: 'License expired.' }),
  invalid: Object.freeze({ messageId: 'license.state.invalid', defaultMessage: 'This license key is not valid.' }),
  unchecked: Object.freeze({ messageId: 'license.state.unchecked', defaultMessage: 'The license status could not be checked.' }),
});

/** Fixed sentence shown with every state. */
export const LICENSE_FEATURES_MESSAGE = Object.freeze({
  messageId: 'license.features.always',
  defaultMessage: 'All features are available with or without a key.',
});

/** Date format for expiry dates (date only, admin locale). */
export const LICENSE_EXPIRY_DATE_OPTIONS = Object.freeze({ dateStyle: 'medium' });

const present = (value) => (typeof value === 'string' ? value.trim() !== '' : value !== null && value !== undefined);

/**
 * Derives the single license state from a GET /license/status body.
 *
 * - noKey: no key is stored (informational, not an error);
 * - unchecked: a key is stored but the license server returned no details;
 * - expired / expiredNoDate: flagged as expired or past its expiry date;
 * - invalid: the license server reports the key as not active;
 * - valid / validNoExpiry: otherwise.
 *
 * @param {object|null|undefined} response Response body of GET /license/status.
 * @param {number} [now] Reference clock in epoch milliseconds.
 * @returns {{
 *   state: 'noKey'|'unchecked'|'expired'|'expiredNoDate'|'invalid'|'valid'|'validNoExpiry',
 *   hasKey: boolean,
 *   expiresAt: string|null,
 *   serverReachable: boolean,
 *   data: object,
 * }} License state and the details it was derived from.
 */
export function getLicenseState(response, now = Date.now()) {
  const data = response?.data && typeof response.data === 'object' ? response.data : {};
  const hasKey = typeof response?.hasKey === 'boolean' ? response.hasKey : present(data.licenseKey);
  const expiresAt = present(data.expiresAt) ? data.expiresAt : null;
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  const base = { hasKey, expiresAt, serverReachable: data.isOnline === true, data };

  if (!hasKey) return { ...base, state: 'noKey' };

  const described = ['email', 'firstName', 'lastName', 'expiresAt', 'lastPingAt', 'deviceName']
    .some((field) => present(data[field]));
  if (!described) return { ...base, state: 'unchecked' };

  const expired = data.isExpired === true || (Number.isFinite(expiresAtMs) && expiresAtMs <= now);
  if (expired) return { ...base, state: Number.isFinite(expiresAtMs) ? 'expired' : 'expiredNoDate' };
  if (data.isActive === false) return { ...base, state: 'invalid' };
  return { ...base, state: Number.isFinite(expiresAtMs) ? 'valid' : 'validNoExpiry' };
}

/**
 * Status sentence for a license state, with its date already formatted in
 * the admin locale.
 *
 * @param {{state: string, expiresAt: string|null}} licenseState Result of getLicenseState.
 * @param {(value: unknown, options?: Intl.DateTimeFormatOptions) => string} formatDate Locale-bound date formatter.
 * @returns {{messageId: string, defaultMessage: string, values?: {date: string}}} Translation descriptor.
 */
export function describeLicenseState(licenseState, formatDate) {
  const descriptor = LICENSE_STATE_MESSAGES[licenseState?.state] || LICENSE_STATE_MESSAGES.unchecked;
  if (licenseState?.state === 'valid' || licenseState?.state === 'expired') {
    return { ...descriptor, values: { date: formatDate(licenseState.expiresAt, LICENSE_EXPIRY_DATE_OPTIONS) } };
  }
  return { ...descriptor };
}
