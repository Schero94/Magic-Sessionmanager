import { presentText } from './missingValue.mjs';

/**
 * Location and security presentation for the session detail modal. The
 * server sends English risk labels ('None', 'Low', 'Medium', 'Medium-High',
 * 'High', 'Unknown'); they are mapped to translation descriptors here so the
 * modal never shows raw server English (DASH-15, DUX-04).
 */

/** Normalised risk levels, lowest first. */
export const RISK_LEVELS = Object.freeze(['none', 'low', 'medium', 'mediumHigh', 'high']);

/**
 * Translated risk levels (IA H.12). Shown only for a live lookup result,
 * never derived from a stored score.
 */
export const RISK_LEVEL_MESSAGES = Object.freeze({
  none: Object.freeze({ messageId: 'modal.security.risk.none', defaultMessage: 'None' }),
  low: Object.freeze({ messageId: 'modal.security.risk.low', defaultMessage: 'Low' }),
  medium: Object.freeze({ messageId: 'modal.security.risk.medium', defaultMessage: 'Medium' }),
  mediumHigh: Object.freeze({
    messageId: 'modal.security.risk.mediumHigh',
    defaultMessage: 'Medium-high',
  }),
  high: Object.freeze({ messageId: 'modal.security.risk.high', defaultMessage: 'High' }),
});

/** DS Badge variant for each risk level. */
export const RISK_LEVEL_TONES = Object.freeze({
  none: 'success',
  low: 'success',
  medium: 'warning',
  mediumHigh: 'warning',
  high: 'danger',
});

const RISK_ALIASES = Object.freeze({
  none: 'none',
  low: 'low',
  medium: 'medium',
  'medium high': 'mediumHigh',
  mediumhigh: 'mediumHigh',
  high: 'high',
});

/**
 * Maps a server risk label to a normalised level.
 *
 * @param {unknown} value Server risk label, for example 'Medium-High'.
 * @returns {''|'none'|'low'|'medium'|'mediumHigh'|'high'} Level, '' when unknown.
 */
export function normalizeRiskLevel(value) {
  if (typeof value !== 'string') return '';
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ');
  return RISK_ALIASES[key] || RISK_ALIASES[key.replace(/ /g, '')] || '';
}

/**
 * @param {unknown} value Boolean flag from the server.
 * @returns {boolean|null} The flag, or null when it is not a boolean.
 */
const booleanOrNull = (value) => (typeof value === 'boolean' ? value : null);

/**
 * Normalises a geolocation record (stored on the session or returned by the
 * lookup endpoint) into display facts. Missing values are null or '' so the
 * shared missing-value marker is shown; nothing is invented. Flag emoji are
 * dropped (no emoji in the admin UI). The risk level comes only from the
 * record itself; a score is never mapped to a level on the client.
 *
 * @param {object|null|undefined} geo Geolocation record.
 * @param {{securityScore?: unknown}} [fallback] Session-level score when the record has none.
 * @returns {null|{
 *   country: string, city: string, timezone: string,
 *   securityScore: number|null, riskLevel: string,
 *   isVpn: boolean|null, isProxy: boolean|null,
 * }} Display facts, or null without any location fact.
 */
export function normalizeGeoData(geo, fallback = {}) {
  if (!geo || typeof geo !== 'object') return null;
  const country = presentText(geo.country) || presentText(geo.country_code);
  const city = presentText(geo.city);
  const timezone = presentText(geo.timezone);
  if (!country && !city && !timezone) return null;

  const rawScore =
    typeof geo.securityScore === 'number' ? geo.securityScore : fallback?.securityScore;
  const securityScore = typeof rawScore === 'number' && Number.isFinite(rawScore) ? rawScore : null;

  return {
    country,
    city,
    timezone,
    securityScore,
    riskLevel: normalizeRiskLevel(geo.riskLevel),
    isVpn: booleanOrNull(geo.isVpn),
    isProxy: booleanOrNull(geo.isProxy),
  };
}

/**
 * Reads the geolocation stored on a session row (object or JSON string).
 * The security score lives on the session itself. Risk level, VPN and proxy
 * flags are not stored for past sign-ins, so they stay empty here and the
 * dialog says so instead of showing "No" (IA D2.6).
 *
 * @param {object} session Session row.
 * @returns {ReturnType<typeof normalizeGeoData>} Display facts or null.
 */
export function getStoredGeoData(session) {
  let geoLocation = session?.geoLocation;
  if (typeof geoLocation === 'string') {
    try {
      geoLocation = JSON.parse(geoLocation);
    } catch {
      geoLocation = null;
    }
  }
  if (!geoLocation || typeof geoLocation !== 'object') return null;
  // The stored record never carries a score of its own; only the session's
  // score is trusted, so a stale record cannot claim "no risk".
  const {
    securityScore: _ignored,
    riskLevel: _ignoredLevel,
    isVpn: _ignoredVpn,
    isProxy: _ignoredProxy,
    ...facts
  } = geoLocation;
  return normalizeGeoData(facts, { securityScore: session?.securityScore });
}

/**
 * Interprets the response of the on-demand lookup (GET /geolocation/:ip).
 * `disabled` means IP location lookup is off on the server; any other
 * non-ok status (private address, failed provider) or a result without a
 * location fact means the location could not be determined.
 *
 * @param {unknown} payload Response body ({ success, data }).
 * @returns {{status: 'ok', geo: NonNullable<ReturnType<typeof normalizeGeoData>>}|{status: 'disabled'|'failed', geo: null}} Outcome.
 */
export function interpretLookupResult(payload) {
  const data = /** @type {any} */ (payload)?.data;
  if (!data || typeof data !== 'object') return { status: 'failed', geo: null };
  if (data._status === 'disabled') return { status: 'disabled', geo: null };
  if (data._status && data._status !== 'ok') return { status: 'failed', geo: null };
  const geo = normalizeGeoData(data);
  return geo ? { status: 'ok', geo } : { status: 'failed', geo: null };
}
