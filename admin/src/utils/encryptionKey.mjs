/** Name of the environment variable read by server/src/utils/encryption.js. */
export const ENCRYPTION_KEY_ENV_NAME = 'SESSION_ENCRYPTION_KEY';

/** Bytes of entropy in a generated key (256 bit). */
export const ENCRYPTION_KEY_BYTES = 32;

const HEX = '0123456789abcdef';

/**
 * Generates a 256-bit key as 64 lowercase hexadecimal characters.
 *
 * Hex only uses characters that are safe in every .env parser (no '#',
 * quotes, '$' or whitespace), and a straight byte-to-hex conversion has no
 * modulo bias (SET-01).
 *
 * @param {{getRandomValues: (array: Uint8Array) => Uint8Array}} [randomSource]
 *   Web Crypto implementation, replaceable in tests.
 * @returns {string} 64 hexadecimal characters.
 * @throws {Error} When no cryptographic random source is available.
 */
export function generateEncryptionKey(randomSource = globalThis.crypto) {
  if (!randomSource || typeof randomSource.getRandomValues !== 'function') {
    throw new Error('secure_random_unavailable');
  }
  const bytes = new Uint8Array(ENCRYPTION_KEY_BYTES);
  randomSource.getRandomValues(bytes);
  let key = '';
  for (const byte of bytes) key += HEX[byte >> 4] + HEX[byte & 15];
  return key;
}

/**
 * Formats a quoted `.env` line so dotenv keeps the whole value, including
 * characters such as '#' that end an unquoted value (SET-01).
 *
 * dotenv has no escape for the quote character itself, so the first quote
 * style that does not occur in the value is used.
 *
 * @param {string} name Variable name.
 * @param {string} value Variable value.
 * @returns {string} `NAME="value"` (or single/back-quoted when needed).
 * @throws {TypeError} When the value cannot be represented on one quoted line.
 */
export function formatEnvLine(name, value) {
  const text = String(value ?? '');
  if (/[\r\n]/.test(text)) throw new TypeError('env_value_must_be_single_line');
  const quote = ['"', "'", '`'].find((candidate) => !text.includes(candidate));
  if (!quote) throw new TypeError('env_value_contains_all_quote_styles');
  return `${name}=${quote}${text}${quote}`;
}
