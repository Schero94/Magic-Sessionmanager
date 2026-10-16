const BROWSER_VERSION_PATTERNS = [
  /\bEdg(?:A|iOS)?\/([\d.]+)/i,
  /\bOPR\/([\d.]+)/i,
  /\b(?:Chrome|CriOS)\/([\d.]+)/i,
  /\bFirefox\/([\d.]+)/i,
  /\bVersion\/([\d.]+).*Safari/i,
];

/**
 * Extracts a browser version from a user-agent string without storing or
 * returning the rest of that string.
 *
 * @param {string} userAgent Raw user-agent value from one session.
 * @returns {string} Browser version, or an empty string when it is unavailable.
 */
export function getBrowserVersionFromUserAgent(userAgent) {
  if (typeof userAgent !== 'string' || !userAgent.trim() || userAgent.trim().toLowerCase() === 'unknown') {
    return '';
  }

  for (const pattern of BROWSER_VERSION_PATTERNS) {
    const match = userAgent.match(pattern);
    if (match?.[1]) return match[1];
  }

  return '';
}

/**
 * Formats a session timestamp for the administrator's active Strapi locale.
 * Invalid and missing timestamps return the caller's localized fallback.
 *
 * @param {string|number|Date|null|undefined} value Session timestamp.
 * @param {string} locale Active Strapi interface locale.
 * @param {string} fallback Localized text for unavailable timestamps.
 * @returns {string} A localized date and time or the supplied fallback.
 */
export function formatSessionDateTime(value, locale, fallback) {
  if (value === null || value === undefined || value === '') return fallback;

  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;

  const options = { dateStyle: 'medium', timeStyle: 'short' };
  try {
    return new Intl.DateTimeFormat(locale || 'en', options).format(date);
  } catch {
    return new Intl.DateTimeFormat('en', options).format(date);
  }
}
