const DEFAULT_DATE_OPTIONS = Object.freeze({ dateStyle: 'medium', timeStyle: 'short' });

const RELATIVE_UNITS = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['week', 7 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
  ['second', 1],
];

/**
 * Converts a session timestamp into a valid Date, or null.
 *
 * @param {string|number|Date|null|undefined} value Timestamp.
 * @returns {Date|null} A valid date or null.
 */
export function toValidDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Formats a session timestamp with the Strapi admin locale (from react-intl),
 * never with the browser locale. Invalid and missing values return the
 * caller's fallback (usually the shared missing-value glyph).
 *
 * @param {string|number|Date|null|undefined} value Session timestamp.
 * @param {string} locale Active admin locale (useIntl().locale).
 * @param {string} [fallback] Text for missing values.
 * @param {Intl.DateTimeFormatOptions} [options] Format options.
 * @returns {string} Localized date/time or the fallback.
 */
export function formatSessionDate(value, locale, fallback = '', options = DEFAULT_DATE_OPTIONS) {
  const date = toValidDate(value);
  if (!date) return fallback;
  try {
    return new Intl.DateTimeFormat(locale || 'en', options).format(date);
  } catch {
    return new Intl.DateTimeFormat('en', options).format(date);
  }
}

/**
 * Picks the largest sensible unit for a relative time, for use with
 * react-intl's FormattedRelativeTime or Intl.RelativeTimeFormat.
 *
 * @param {string|number|Date|null|undefined} value Timestamp.
 * @param {number|Date} [now] Reference time.
 * @returns {null|{value: number, unit: Intl.RelativeTimeFormatUnit}} Signed value (negative = past) and unit.
 */
export function getRelativeTimeParts(value, now = Date.now()) {
  const date = toValidDate(value);
  const reference = toValidDate(now);
  if (!date || !reference) return null;

  const diffSeconds = Math.round((date.getTime() - reference.getTime()) / 1000);
  const absolute = Math.abs(diffSeconds);
  if (absolute < 45) return { value: 0, unit: 'second' };

  for (const [unit, seconds] of RELATIVE_UNITS) {
    if (absolute >= seconds) {
      const amount = Math.round(diffSeconds / seconds);
      return { value: amount === 0 ? Math.sign(diffSeconds) : amount, unit };
    }
  }
  return { value: 0, unit: 'second' };
}

/**
 * Formats a timestamp relative to now ("5 minutes ago", "vor 5 Minuten")
 * using the admin locale. Missing values return the fallback, so callers never
 * interpolate "undefined" or the word "Unavailable" into a sentence.
 *
 * @param {string|number|Date|null|undefined} value Timestamp.
 * @param {string} locale Active admin locale.
 * @param {{now?: number|Date, fallback?: string}} [options] Reference time and fallback.
 * @returns {string} Relative time or fallback.
 */
export function formatRelative(value, locale, { now = Date.now(), fallback = '' } = {}) {
  const parts = getRelativeTimeParts(value, now);
  if (!parts) return fallback;
  const options = { numeric: 'auto' };
  try {
    return new Intl.RelativeTimeFormat(locale || 'en', options).format(parts.value, parts.unit);
  } catch {
    return new Intl.RelativeTimeFormat('en', options).format(parts.value, parts.unit);
  }
}
