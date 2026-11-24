'use strict';

/**
 * Risk data (VPN, proxy, Tor, hosting) for sign-in checks.
 *
 * Location providers answer "where is this address?". They do not answer
 * "is this address an anonymiser?": ipapi.co documents no such field and the
 * GeoLite2 City/Country databases carry none. A lookup result therefore only
 * has risk data when a dedicated risk source filled it in, which is recorded
 * in `riskSource`. Without a source every flag stays `false` (unchanged field
 * names, so stored data and custom templates keep working), the score is
 * `null` and nothing may be treated as suspicious.
 */

/** Risk sources the plugin knows. `null` means "no risk data". */
const RISK_SOURCES = Object.freeze(['anonymous-ip', 'asn-heuristic']);

/** Score below which a sign-in counts as suspicious (alerts, `login.suspicious`). */
const SUSPICIOUS_SCORE_BELOW = 70;

/** Score below which "Reject suspicious sign-ins" refuses the sign-in. */
const REJECT_SCORE_BELOW = 50;

/**
 * Risk fields of a lookup result without any risk data. The flags keep their
 * historic names and stay booleans for backwards compatibility; `riskSource`
 * and the `null` score are what say "unknown".
 *
 * @returns {{
 *   isVpn: false, isProxy: false, isThreat: false, isAnonymous: false,
 *   isTor: false, isHosting: false, securityScore: null, riskLevel: 'Unknown',
 *   riskSource: null,
 * }} Neutral risk fields.
 */
function noRiskData() {
  return {
    isVpn: false,
    isProxy: false,
    isThreat: false,
    isAnonymous: false,
    isTor: false,
    isHosting: false,
    securityScore: null,
    riskLevel: 'Unknown',
    riskSource: null,
  };
}

/**
 * Whether a lookup result carries risk data from a known source.
 *
 * @param {object|null|undefined} geoData Lookup result or stored geo record.
 * @returns {boolean} True only when a risk source filled the flags.
 */
function hasRiskData(geoData) {
  return Boolean(geoData) && RISK_SOURCES.includes(geoData.riskSource);
}

/**
 * Normalized security score (0-100, higher is safer) from risk flags.
 *
 * @param {{isVpn?: boolean, isProxy?: boolean, isThreat?: boolean,
 *   isAnonymous?: boolean, isTor?: boolean, isHosting?: boolean}} flags Risk flags.
 * @returns {number} Score.
 */
function calculateSecurityScore({ isVpn, isProxy, isThreat, isAnonymous, isTor, isHosting }) {
  let score = 100;
  if (isTor) score -= 50;
  if (isThreat) score -= 40;
  if (isVpn) score -= 20;
  if (isHosting) score -= 20;
  if (isProxy) score -= 15;
  if (isAnonymous) score -= 10;
  return Math.max(0, score);
}

/**
 * Maps risk flags to the English risk label the admin translates.
 *
 * @param {{isVpn?: boolean, isProxy?: boolean, isThreat?: boolean,
 *   isTor?: boolean, isHosting?: boolean}} flags Risk flags.
 * @returns {'High'|'Medium-High'|'Medium'|'Low'} Risk label.
 */
function getRiskLevel({ isVpn, isProxy, isThreat, isTor, isHosting }) {
  if (isThreat || isTor) return 'High';
  if (isVpn && isProxy) return 'Medium-High';
  if (isVpn || isProxy || isHosting) return 'Medium';
  return 'Low';
}

/**
 * Decides what a sign-in's risk data means for alerts. Without risk data the
 * answer is always "not suspicious": the plugin never invents a signal.
 *
 * @param {object} settings Effective plugin settings.
 * @param {object|null|undefined} geoData Lookup result of the sign-in.
 * @returns {{hasRiskData: boolean, isSuspicious: boolean, isVpnOrProxy: boolean}}
 *   Alert decision.
 */
function evaluateLoginRisk(settings = {}, geoData = null) {
  if (!hasRiskData(geoData)) {
    return { hasRiskData: false, isSuspicious: false, isVpnOrProxy: false };
  }
  const scoreEvaluationEnabled = settings.enableSecurityScoring !== false;
  const lowScore =
    scoreEvaluationEnabled &&
    typeof geoData.securityScore === 'number' &&
    geoData.securityScore < SUSPICIOUS_SCORE_BELOW;
  const isVpnOrProxy = Boolean(geoData.isVpn || geoData.isProxy);
  const isSuspicious = Boolean(
    isVpnOrProxy || geoData.isThreat || geoData.isTor || geoData.isHosting || lowScore
  );
  return { hasRiskData: true, isSuspicious, isVpnOrProxy };
}

module.exports = {
  REJECT_SCORE_BELOW,
  RISK_SOURCES,
  SUSPICIOUS_SCORE_BELOW,
  calculateSecurityScore,
  evaluateLoginRisk,
  getRiskLevel,
  hasRiskData,
  noRiskData,
};
