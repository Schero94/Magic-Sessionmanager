/**
 * Parses a user-agent string into neutral device, browser and OS facts.
 *
 * Contract:
 * - Missing facts are returned as empty strings, never as English words such
 *   as "Unknown" or "Desktop". Presentation (translation, missing-value glyph)
 *   belongs to devicePresentation.mjs.
 * - A desktop device is only reported when the user agent names a desktop OS.
 *   Unrecognised user agents get an empty device type (DUX-05).
 * - `device` keeps the legacy capitalised label ('Desktop', 'Mobile',
 *   'Tablet', 'API Client' or '') for screens that have not migrated yet;
 *   `deviceType` is the normalised key used by the shared presentation.
 */

const API_CLIENTS = [
  ['curl/', 'cURL'],
  ['postman', 'Postman'],
  ['insomnia', 'Insomnia'],
  ['okhttp', 'OkHttp'],
  ['python-requests', 'Python Requests'],
  ['axios/', 'Axios'],
  ['node-fetch', 'node-fetch'],
];

const BOT_PATTERN = /bot\b|crawler|spider|slurp|headlesschrome/i;
const TABLET_PATTERN = /(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i;
const MOBILE_PATTERN = /Mobile|Android|iP(?:hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(?:hpw|web)OS|Opera M(?:obi|ini)/;

/** Legacy capitalised labels for the normalised device types. */
export const LEGACY_DEVICE_LABELS = Object.freeze({
  desktop: 'Desktop',
  mobile: 'Mobile',
  tablet: 'Tablet',
  api: 'API Client',
  bot: 'Bot',
  '': '',
});

const detectBrowser = (ua) => {
  if (ua.includes('edg/') || ua.includes('edga/') || ua.includes('edgios/')) return 'Edge';
  if (ua.includes('opr/') || ua.includes('opera')) return 'Opera';
  if (ua.includes('firefox/') || ua.includes('fxios/')) return 'Firefox';
  if (ua.includes('chrome/') || ua.includes('crios/')) return 'Chrome';
  if (ua.includes('safari/')) return 'Safari';
  return '';
};

const detectOs = (ua) => {
  if (ua.includes('android')) return 'Android';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod')) return 'iOS';
  if (ua.includes('windows')) return 'Windows';
  if (ua.includes('cros')) return 'ChromeOS';
  if (ua.includes('mac os x') || ua.includes('macintosh')) return 'macOS';
  if (ua.includes('linux') || ua.includes('x11')) return 'Linux';
  return '';
};

const DESKTOP_OPERATING_SYSTEMS = new Set(['Windows', 'macOS', 'Linux', 'ChromeOS']);

/**
 * @param {string|null|undefined} userAgent Raw user agent.
 * @returns {{deviceType: ''|'desktop'|'mobile'|'tablet'|'api'|'bot', device: string, deviceIcon: string, browser: string, os: string}}
 *   Neutral parse result; empty strings mean "not available".
 */
export function parseUserAgent(userAgent) {
  const raw = typeof userAgent === 'string' ? userAgent.trim() : '';
  if (!raw || raw.toLowerCase() === 'unknown') {
    return { deviceType: '', device: '', deviceIcon: 'unknown', browser: '', os: '' };
  }

  const ua = raw.toLowerCase();
  const apiClient = API_CLIENTS.find(([needle]) => ua.includes(needle));
  if (apiClient) {
    return { deviceType: 'api', device: LEGACY_DEVICE_LABELS.api, deviceIcon: 'api', browser: apiClient[1], os: detectOs(ua) };
  }

  const browser = detectBrowser(ua);
  const os = detectOs(ua);

  /** @type {''|'desktop'|'mobile'|'tablet'|'api'|'bot'} */
  let deviceType = '';
  if (BOT_PATTERN.test(raw)) deviceType = 'bot';
  else if (TABLET_PATTERN.test(raw)) deviceType = 'tablet';
  else if (MOBILE_PATTERN.test(raw)) deviceType = 'mobile';
  else if (DESKTOP_OPERATING_SYSTEMS.has(os)) deviceType = 'desktop';

  return {
    deviceType,
    device: LEGACY_DEVICE_LABELS[deviceType],
    deviceIcon: deviceType || 'unknown',
    browser,
    os,
  };
}

export default parseUserAgent;
