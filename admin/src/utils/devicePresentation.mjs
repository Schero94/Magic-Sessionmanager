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
  unknown: Object.freeze({
    messageId: 'common.device.type.unknown',
    defaultMessage: 'Unknown device',
  }),
});

/** "Safari · macOS" with both values present (IA D1 Device column, H.9). */
export const DEVICE_SUMMARY_MESSAGE = Object.freeze({
  messageId: 'common.device.summary',
  defaultMessage: '{browser} · {os}',
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
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ');
  return DEVICE_TYPE_ALIASES[key] || DEVICE_TYPE_ALIASES[key.replace(/ /g, '')] || '';
}

/**
 * @param {string} deviceType Normalised device type ('' for unknown).
 * @returns {{messageId: string, defaultMessage: string}} Translation descriptor.
 */
export function getDeviceTypeMessage(deviceType) {
  return DEVICE_TYPE_MESSAGES[deviceType] || DEVICE_TYPE_MESSAGES.unknown;
}

const TRAILING_VERSION = /\s+v?\d[\w./-]*$/i;

/**
 * Splits a stored "Chrome 124.0.0.0" / "macOS 10.15.7" / "Windows 10/11"
 * value into the name and its trailing version. The server stores names with
 * the version appended; the UI shows names only (IA I.1 item 8), so a
 * version is never shown twice ("Chrome 124.0.0.0 124").
 *
 * @param {unknown} value Stored browser or OS value.
 * @returns {{name: string, version: string}} Name without version, and the version ('' when none).
 */
export function splitNameAndVersion(value) {
  let name = presentText(value);
  const versions = [];
  while (TRAILING_VERSION.test(name)) {
    const match = name.match(TRAILING_VERSION);
    versions.unshift(match[0].trim());
    name = name.slice(0, match.index).trim();
  }
  return { name: presentText(name), version: versions.join(' ') };
}

/**
 * Builds the device presentation for one session row. Every user-visible
 * word is a translation descriptor; only proper names (browser, OS) are
 * passed through as data. The user agent is parsed first because the stored
 * fields come from a looser server parser (it calls every unrecognised agent
 * "desktop" and an iPhone "macOS"). Unknown devices are never shown as
 * "Desktop", and no browser version appears in the summary.
 *
 * @param {object} session Session row (userAgent and/or stored deviceType, browserName, osName).
 * @returns {{
 *   deviceType: ''|'desktop'|'mobile'|'tablet'|'api'|'bot',
 *   hasDeviceType: boolean,
 *   icon: string,
 *   deviceTypeMessage: {messageId: string, defaultMessage: string},
 *   browser: string,
 *   browserVersion: string,
 *   browserLabel: string,
 *   os: string,
 *   hasSummary: boolean,
 *   summary: {messageId?: string, defaultMessage?: string, values?: object, text?: string},
 * }} Presentation; empty strings mean "missing".
 */
export function getDevicePresentation(session = {}) {
  const row = session || {};
  const userAgent = presentText(row.userAgent);
  const parsed = userAgent ? parseUserAgent(userAgent) : null;
  const storedBrowser = splitNameAndVersion(row.browserName);
  const storedOs = splitNameAndVersion(row.osName);

  const deviceType = parsed ? parsed.deviceType : normalizeDeviceType(row.deviceType);
  const browser = parsed?.browser || storedBrowser.name;
  const os = parsed?.os || storedOs.name;
  const browserVersion =
    (userAgent && getBrowserVersionFromUserAgent(userAgent)) ||
    presentText(row.browserVersion) ||
    storedBrowser.version;

  // Without browser and OS the summary is empty text: the caller shows
  // "Unknown device" instead of a sentence about missing data (IA H.9).
  let summary = { text: '' };
  if (browser && os) {
    summary = { ...DEVICE_SUMMARY_MESSAGE, values: { browser, os } };
  } else if (browser || os) {
    summary = { text: browser || os };
  }

  return {
    deviceType,
    hasDeviceType: Boolean(deviceType),
    icon: deviceType || 'unknown',
    deviceTypeMessage: getDeviceTypeMessage(deviceType),
    browser,
    browserVersion,
    browserLabel: browser,
    os,
    hasSummary: Boolean(browser || os),
    summary,
  };
}
