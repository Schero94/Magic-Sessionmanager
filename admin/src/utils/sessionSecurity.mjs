import { presentText } from './missingValue.mjs';

/**
 * Location and security presentation for the session detail modal. The
 * server sends English risk labels ('None', 'Low', 'Medium', 'Medium-High',
 * 'High', 'Unknown'); they are mapped to translation descriptors here so the
 * modal never shows raw server English (DASH-15, DUX-04).
 */

/** Normalised risk levels, lowest first. */
export const RISK_LEVELS = Object.freeze(['none', 'low', 'medium', 'mediumHigh', 'high']);

/** Translation ids (relative to the plugin namespace) for each risk level. */
export const RISK_LEVEL_MESSAGES = Object.freeze({
  none: Object.freeze({ messageId: 'modal.security.risk.none', defaultMessage: 'No known risk' }),
  low: Object.freeze({ messageId: 'modal.security.risk.low', defaultMessage: 'Low risk' }),
  medium: Object.freeze({ messageId: 'modal.security.risk.medium', defaultMessage: 'Medium risk' }),
  mediumHigh: Object.freeze({ messageId: 'modal.security.risk.mediumHigh', defaultMessage: 'Elevated risk' }),
  high: Object.freeze({ messageId: 'modal.security.risk.high', defaultMessage: 'High risk' }),
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
  const key = value.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  return RISK_ALIASES[key] || RISK_ALIASES[key.replace(/ /g, '')] || '';
}

/**
 * Derives a level from a stored security score when the server sent no label.
 * Keeps the historical rule: below 50 is high risk.
 *
 * @param {unknown} score Security score 0-100.
 * @returns {''|'low'|'high'} Level, '' without a finite score.
 */
export function getRiskLevelFromScore(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return '';
  return score < 50 ? 'high' : 'low';
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
 * dropped (no emoji in the admin UI).
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

  const rawScore = typeof geo.securityScore === 'number' ? geo.securityScore : fallback?.securityScore;
  const securityScore = typeof rawScore === 'number' && Number.isFinite(rawScore) ? rawScore : null;

  return {
    country,
    city,
    timezone,
    securityScore,
    riskLevel: normalizeRiskLevel(geo.riskLevel) || getRiskLevelFromScore(securityScore),
    isVpn: booleanOrNull(geo.isVpn),
    isProxy: booleanOrNull(geo.isProxy),
  };
}

/**
 * Reads the geolocation stored on a session row (object or JSON string).
 * The security score lives on the session itself.
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
  const { securityScore: _ignored, riskLevel: _ignoredLevel, ...facts } = geoLocation;
  return normalizeGeoData(facts, { securityScore: session?.securityScore });
}
