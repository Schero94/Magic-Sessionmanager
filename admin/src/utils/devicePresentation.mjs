import { parseUserAgent } from './parseUserAgent.mjs';
import { getBrowserVersionFromUserAgent } from './sessionPresentation.mjs';
import { presentText } from './missingValue.mjs';

/** Normalised device types shared by every screen. '' means not available. */
export const DEVICE_TYPES = Object.freeze(['desktop', 'mobile', 'tablet', 'api', 'bot']);

/** Translation ids (relative to the plugin namespace) for each device type. */
export const DEVICE_TYPE_MESSAGES = Object.freeze({
  desktop: Object.freeze({ messageId: 'common.device.type.desktop', defaultMessage: 'Desktop' }),
  mobile: Object.freeze({ messageId: 'common.device.type.mobile', defaultMessage: 'Mobile' }),
  tablet: Object.freeze({ messageId: 'common.device.type.tablet', defaultMessage: 'Tablet' }),
  api: Object.freeze({ messageId: 'common.device.type.api', defaultMessage: 'API client' }),
  bot: Object.freeze({ messageId: 'common.device.type.bot', defaultMessage: 'Bot' }),
  unknown: Object.freeze({ messageId: 'common.device.type.unknown', defaultMessage: 'Unknown device' }),
});

/** "Safari 17 · macOS" style summary with both values present. */
export const DEVICE_SUMMARY_MESSAGE = Object.freeze({
  messageId: 'common.device.summary',
  defaultMessage: '{browser} · {os}',
});

/** One message when neither browser nor OS is known (never "Unavailable on Unavailable"). */
export const DEVICE_SUMMARY_UNAVAILABLE_MESSAGE = Object.freeze({
  messageId: 'common.device.summaryUnavailable',
  defaultMessage: 'Browser and OS unavailable',
});

const DEVICE_TYPE_ALIASES = Object.freeze({
  desktop: 'desktop',
  laptop: 'desktop',
  pc: 'desktop',
  computer: 'desktop',
  mobile: 'mobile',
  phone: 'mobile',
  smartphone: 'mobile',
  tablet: 'tablet',
  'api client': 'api',
  api: 'api',
  apiclient: 'api',
  bot: 'bot',
  crawler: 'bot',
});

/**
 * Case-insensitively maps server and legacy device labels ('desktop',
 * 'Mobile', 'Laptop', 'API Client') to the shared device type key.
 *
 * @param {unknown} value Raw device type.
 * @returns {''|'desktop'|'mobile'|'tablet'|'api'|'bot'} Normalised type, '' when unknown.
 */
export function normalizeDeviceType(value) {
  if (typeof value !== 'string') return '';
  const key = value.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  return DEVICE_TYPE_ALIASES[key] || DEVICE_TYPE_ALIASES[key.replace(/ /g, '')] || '';
}

/**
 * @param {string} deviceType Normalised device type ('' for unknown).
 * @returns {{messageId: string, defaultMessage: string}} Translation descriptor.
 */
export function getDeviceTypeMessage(deviceType) {
  return DEVICE_TYPE_MESSAGES[deviceType] || DEVICE_TYPE_MESSAGES.unknown;
}

const majorVersion = (version) => {
  const text = presentText(version);
  const major = text.split('.')[0];
  return /^\d+$/.test(major) ? major : '';
};

/**
 * Builds the device presentation for one session row. Every user-visible
 * word is a translation descriptor; only proper names (browser, OS) and
 * numbers are passed through as data. Unknown devices are never shown as
 * "Desktop".
 *
 * @param {object} session Session row (userAgent and/or native deviceType, browserName, osName, browserVersion).
 * @returns {{
 *   deviceType: ''|'desktop'|'mobile'|'tablet'|'api'|'bot',
 *   hasDeviceType: boolean,
 *   icon: string,
 *   deviceTypeMessage: {messageId: string, defaultMessage: string},
 *   browser: string,
 *   browserVersion: string,
 *   browserLabel: string,
 *   os: string,
 *   summary: {messageId?: string, defaultMessage?: string, values?: object, text?: string},
 * }} Presentation; empty strings mean "missing".
 */
export function getDevicePresentation(session = {}) {
  const row = session || {};
  const userAgent = presentText(row.userAgent);
  const parsed = userAgent ? parseUserAgent(userAgent) : null;

  const deviceType = normalizeDeviceType(row.deviceType) || parsed?.deviceType || '';
  const browser = presentText(row.browserName) || parsed?.browser || '';
  const os = presentText(row.osName) || parsed?.os || '';
  const browserVersion = (userAgent && getBrowserVersionFromUserAgent(userAgent)) || presentText(row.browserVersion);
  const major = majorVersion(browserVersion);
  const browserLabel = browser ? [browser, major].filter(Boolean).join(' ') : '';

  let summary;
  if (browserLabel && os) {
    summary = { ...DEVICE_SUMMARY_MESSAGE, values: { browser: browserLabel, os } };
  } else if (browserLabel || os) {
    summary = { text: browserLabel || os };
  } else {
    summary = { ...DEVICE_SUMMARY_UNAVAILABLE_MESSAGE };
  }

  return {
    deviceType,
    hasDeviceType: Boolean(deviceType),
    icon: deviceType || 'unknown',
    deviceTypeMessage: getDeviceTypeMessage(deviceType),
    browser,
    browserVersion,
    browserLabel,
    os,
    summary,
  };
}
