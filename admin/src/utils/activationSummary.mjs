/**
 * Builds the downloadable activation summary (UX-16, F18, I18N-11). Every
 * label goes through the caller's translate function and every date through
 * the caller's locale-bound formatter, so the file matches the admin language
 * instead of being English with browser-locale dates.
 */

/** Translation descriptors (ids relative to the plugin namespace). */
export const ACTIVATION_SUMMARY_MESSAGES = Object.freeze({
  heading: Object.freeze({ messageId: 'license.download.heading', defaultMessage: 'Magic Session Manager: optional activation key' }),
  key: Object.freeze({ messageId: 'license.download.key', defaultMessage: 'Activation key' }),
  holderSection: Object.freeze({ messageId: 'license.download.holderSection', defaultMessage: 'Activation holder' }),
  name: Object.freeze({ messageId: 'license.download.name', defaultMessage: 'Name' }),
  email: Object.freeze({ messageId: 'license.account.email', defaultMessage: 'Email address' }),
  statusSection: Object.freeze({ messageId: 'license.system.activation', defaultMessage: 'Activation status' }),
  status: Object.freeze({ messageId: 'license.download.status', defaultMessage: 'Status' }),
  expires: Object.freeze({ messageId: 'license.details.expiresOn', defaultMessage: 'Expires on' }),
  expired: Object.freeze({ messageId: 'license.details.expiredOn', defaultMessage: 'Expired on' }),
  featuresSection: Object.freeze({ messageId: 'license.features.title', defaultMessage: 'Features and capabilities' }),
  features: Object.freeze({ messageId: 'license.download.features', defaultMessage: 'All Session Manager features are included without a paid key.' }),
  generated: Object.freeze({ messageId: 'license.download.generated', defaultMessage: 'Generated' }),
  active: Object.freeze({ messageId: 'license.active', defaultMessage: 'Active' }),
  inactive: Object.freeze({ messageId: 'license.inactive', defaultMessage: 'Inactive' }),
  never: Object.freeze({ messageId: 'license.value.never', defaultMessage: 'Never' }),
  notProvided: Object.freeze({ messageId: 'license.value.notProvided', defaultMessage: 'Not provided' }),
});

const RULE = '========================================';
const SUB_RULE = '----------------------------------------';

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * @param {object} options
 * @param {object} options.data `data` object of GET /license/status.
 * @param {(descriptor: {messageId: string, defaultMessage: string}) => string} options.translate Bound formatMessage.
 * @param {(value: unknown, options?: Intl.DateTimeFormatOptions) => string} options.formatDate Locale-bound date formatter.
 * @param {Date|number|string} [options.generatedAt] Timestamp written into the file.
 * @returns {string} Plain-text summary, one label/value pair per line.
 */
export function buildActivationSummary({ data = {}, translate, formatDate, generatedAt = Date.now() }) {
  const row = data || {};
  const m = ACTIVATION_SUMMARY_MESSAGES;
  const fullName = [text(row.firstName), text(row.lastName)].filter(Boolean).join(' ');
  const expiresAt = row.expiresAt ? formatDate(row.expiresAt, { dateStyle: 'long' }) : '';

  const line = (descriptor, value) => `${translate(descriptor)}: ${value}`;

  return [
    translate(m.heading),
    RULE,
    '',
    line(m.key, text(row.licenseKey) || translate(m.notProvided)),
    '',
    translate(m.holderSection),
    SUB_RULE,
    line(m.name, fullName || translate(m.notProvided)),
    line(m.email, text(row.email) || translate(m.notProvided)),
    '',
    translate(m.statusSection),
    SUB_RULE,
    line(m.status, translate(row.isActive ? m.active : m.inactive)),
    line(row.isExpired ? m.expired : m.expires, expiresAt || translate(m.never)),
    '',
    translate(m.featuresSection),
    SUB_RULE,
    translate(m.features),
    '',
    RULE,
    line(m.generated, formatDate(generatedAt, { dateStyle: 'long', timeStyle: 'short' })),
    '',
  ].join('\n');
}
