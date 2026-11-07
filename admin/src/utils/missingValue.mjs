/** Visible glyph for a value that is not available. */
export const MISSING_VALUE_GLYPH = '—';

/** Accessible name announced instead of the glyph. */
export const MISSING_VALUE_MESSAGE = Object.freeze({
  messageId: 'common.value.missing',
  defaultMessage: 'Not available',
});

/**
 * Detects values that should render as the missing-value glyph: null,
 * undefined, empty or whitespace strings, non-finite numbers, invalid dates
 * and the literal sentinel "unknown" sent by older server versions.
 *
 * @param {unknown} value Any display value.
 * @returns {boolean} Whether the value is missing.
 */
export function isMissingValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number') return !Number.isFinite(value);
  if (value instanceof Date) return !Number.isFinite(value.getTime());
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' || trimmed.toLowerCase() === 'unknown';
  }
  return false;
}

/**
 * Returns the trimmed text for a value, or an empty string when missing.
 *
 * @param {unknown} value Any display value.
 * @returns {string} Present text or ''.
 */
export function presentText(value) {
  if (isMissingValue(value)) return '';
  return String(value).trim();
}
