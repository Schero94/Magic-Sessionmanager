/**
 * Builds the "Download as text" file of the License page (IA D7, F18). Every
 * label goes through the caller's translate function and every date through
 * the caller's admin-locale formatter, so the file matches the admin language
 * instead of being English with browser-locale dates.
 */
import {
  LICENSE_EXPIRY_DATE_OPTIONS,
  LICENSE_FEATURES_MESSAGE,
  describeLicenseState,
  getLicenseState,
} from './licenseStatus.mjs';

/** Translation descriptors (ids relative to the plugin namespace). */
export const LICENSE_SUMMARY_MESSAGES = Object.freeze({
  heading: Object.freeze({ messageId: 'license.download.heading', defaultMessage: 'Session Manager license' }),
  status: Object.freeze({ messageId: 'license.download.status', defaultMessage: 'Status' }),
  key: Object.freeze({ messageId: 'license.key.title', defaultMessage: 'License key' }),
  holder: Object.freeze({ messageId: 'license.details.holder', defaultMessage: 'Holder' }),
  email: Object.freeze({ messageId: 'license.account.email', defaultMessage: 'Email address' }),
  expires: Object.freeze({ messageId: 'license.details.expires', defaultMessage: 'Expires' }),
  noExpiry: Object.freeze({ messageId: 'license.details.noExpiry', defaultMessage: 'No expiry date' }),
  deviceName: Object.freeze({ messageId: 'license.details.deviceName', defaultMessage: 'Device name' }),
  ipAddress: Object.freeze({ messageId: 'license.details.ipAddress', defaultMessage: 'IP address' }),
  lastCheck: Object.freeze({ messageId: 'license.details.lastCheck', defaultMessage: 'Last check' }),
  deviceLimit: Object.freeze({ messageId: 'license.system.deviceLimit', defaultMessage: 'Device limit' }),
  deviceLimitValue: Object.freeze({ messageId: 'license.system.deviceLimitValue', defaultMessage: '{current} of {max}' }),
  serverReachable: Object.freeze({ messageId: 'license.details.serverReachable', defaultMessage: 'License server reachable' }),
  yes: Object.freeze({ messageId: 'common.yes', defaultMessage: 'Yes' }),
  no: Object.freeze({ messageId: 'common.no', defaultMessage: 'No' }),
  generated: Object.freeze({ messageId: 'license.download.generated', defaultMessage: 'Generated' }),
  notProvided: Object.freeze({ messageId: 'license.value.notProvided', defaultMessage: 'Not provided' }),
});

const RULE = '========================================';

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Holder name from the license details.
 *
 * @param {object} data `data` of GET /license/status.
 * @returns {string} "First Last", or an empty string.
 */
export function getLicenseHolderName(data) {
  return [text(data?.firstName), text(data?.lastName)].filter(Boolean).join(' ');
}

/**
 * @param {object} options
 * @param {object} options.response Body of GET /license/status.
 * @param {(descriptor: {messageId: string, defaultMessage: string}, values?: object) => string} options.translate Bound formatMessage.
 * @param {(value: unknown, options?: Intl.DateTimeFormatOptions) => string} options.formatDate Admin-locale date formatter.
 * @param {Date|number|string} [options.generatedAt] Timestamp written into the file.
 * @param {number} [options.now] Reference clock for the expiry check.
 * @returns {string} Plain-text summary, one label/value pair per line.
 */
export function buildLicenseSummary({ response, translate, formatDate, generatedAt = Date.now(), now = Date.now() }) {
  const m = LICENSE_SUMMARY_MESSAGES;
  const licenseState = getLicenseState(response, now);
  const data = licenseState.data;
  const statusMessage = describeLicenseState(licenseState, formatDate);
  const notProvided = translate(m.notProvided);
  const orMissing = (value) => text(value) || notProvided;
  const line = (descriptor, value) => `${translate(descriptor)}: ${value}`;

  return [
    translate(m.heading),
    RULE,
    line(m.status, translate(statusMessage, statusMessage.values)),
    translate(LICENSE_FEATURES_MESSAGE),
    '',
    line(m.key, orMissing(data.licenseKey)),
    line(m.holder, getLicenseHolderName(data) || notProvided),
    line(m.email, orMissing(data.email)),
    line(m.expires, licenseState.expiresAt
      ? formatDate(licenseState.expiresAt, LICENSE_EXPIRY_DATE_OPTIONS)
      : translate(m.noExpiry)),
    line(m.deviceName, orMissing(data.deviceName)),
    line(m.ipAddress, orMissing(data.ipAddress)),
    line(m.lastCheck, data.lastPingAt ? formatDate(data.lastPingAt) : notProvided),
    line(m.deviceLimit, translate(m.deviceLimitValue, {
      current: Number(data.currentDevices) || 0,
      max: Number(data.maxDevices) || 1,
    })),
    line(m.serverReachable, translate(licenseState.serverReachable ? m.yes : m.no)),
    RULE,
    line(m.generated, formatDate(generatedAt)),
    '',
  ].join('\n');
}
