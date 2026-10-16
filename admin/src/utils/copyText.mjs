/**
 * Copies a string after an explicit user action and waits for browser success.
 *
 * @param {string} value Text to copy.
 * @param {{writeText: (text: string) => Promise<void>} | null} [clipboard]
 *   Clipboard provider, replaceable with a test double.
 * @returns {Promise<void>}
 * @throws {Error} When the clipboard API is unavailable or rejects the write.
 */
export async function copyText(value, clipboard = globalThis.navigator?.clipboard) {
  if (typeof value !== 'string') {
    throw new TypeError('clipboard_value_must_be_text');
  }
  if (!clipboard || typeof clipboard.writeText !== 'function') {
    throw new Error('clipboard_unavailable');
  }

  await clipboard.writeText(value);
}
