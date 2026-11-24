/**
 * Risk data availability for the admin. VPN, proxy and Tor checks, the
 * security score and every setting built on them need a risk data source on
 * the server; location data alone has none. The server reports the source in
 * GET /geoip/status (`status.risk`) and on lookup results (`riskSource`).
 */

/** Risk sources the server can report. */
export const RISK_SOURCES = Object.freeze(['anonymous-ip', 'asn-heuristic']);

/** Path of the settings tab that sets up risk data. */
export const RISK_SETTINGS_PATH = '/settings/magic-sessionmanager/general?tab=location-data';

/**
 * Whether a value names a known risk source.
 *
 * @param {unknown} value Reported source.
 * @returns {boolean} True for a known source.
 */
export const isRiskSource = (value) => RISK_SOURCES.includes(/** @type {string} */ (value));

/**
 * Reads the risk data availability from the GeoIP status response.
 * 'unknown' while the status is loading, failed, or comes from a server
 * that does not report it; the UI then keeps the controls as they are
 * instead of guessing.
 *
 * @param {object|null|undefined} geoIpStatus `status` of GET /geoip/status.
 * @returns {{state: 'available'|'missing'|'unknown', source: string|null}} Availability.
 */
export function getRiskAvailability(geoIpStatus) {
  const risk = geoIpStatus?.risk;
  if (!risk || typeof risk !== 'object' || typeof risk.available !== 'boolean') {
    return { state: 'unknown', source: null };
  }
  if (risk.available && isRiskSource(risk.source)) {
    return { state: 'available', source: risk.source };
  }
  return { state: 'missing', source: null };
}

/**
 * How a risk-dependent boolean setting is shown. Without a risk source the
 * control is disabled and shown as off, because it has no effect; the saved
 * value is kept untouched so it applies again once a source exists.
 *
 * @param {boolean} saved Value in the form.
 * @param {'available'|'missing'|'unknown'} state Risk data availability.
 * @returns {{checked: boolean, disabled: boolean, savedOnButInactive: boolean}} Display state.
 */
export function riskDependentControl(saved, state) {
  if (state !== 'missing')
    return { checked: Boolean(saved), disabled: false, savedOnButInactive: false };
  return { checked: false, disabled: true, savedOnButInactive: Boolean(saved) };
}
