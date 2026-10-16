const KEY_MASK = '••••••••';

/**
 * Masks a sensitive string while preserving only a short identifying suffix.
 *
 * @param {unknown} value Value that should not be displayed in full by default.
 * @returns {string} A fixed mask and, when available, the final four characters.
 */
export function maskSensitiveValue(value) {
  if (typeof value !== 'string' || value.length <= 4) {
    return KEY_MASK;
  }

  return `${KEY_MASK}${value.slice(-4)}`;
}
