'use strict';

// @ts-check

/**
 * Settings of the security event log (4.15). They live in the plugin store
 * next to the other settings; this module owns their defaults, bounds and the
 * normalised runtime view.
 *
 * Recording switches, per event family:
 * - `adminSignInHistory` (default ON): admin sign-ins, failed attempts,
 *   lockouts, sign-outs and who signed out whom.
 * - `adminContentActivity` (default OFF): what each admin opens and changes
 *   in the Content Manager. It records work activity, which in many
 *   countries (Germany: works council, BetrVG section 87(1) no. 6) needs
 *   informing or agreeing with employees first.
 *
 * Options of the whole log:
 * - `securityLogStoreIp` (default ON) and `securityLogAnonymizeIp` (default
 *   OFF: removes the last IPv4 octet / the last 80 IPv6 bits before storage),
 * - `securityLogRetentionDays` (default 90), enforced by a daily job.
 */

/** Defaults in user-facing units (days). */
const SECURITY_LOG_DEFAULTS = Object.freeze({
  adminSignInHistory: true,
  adminContentActivity: false,
  securityLogStoreIp: true,
  securityLogAnonymizeIp: false,
  securityLogRetentionDays: 90,
});

/** Boolean settings of the log. */
const SECURITY_LOG_BOOLEAN_KEYS = Object.freeze([
  'adminSignInHistory',
  'adminContentActivity',
  'securityLogStoreIp',
  'securityLogAnonymizeIp',
]);

/** Inclusive bounds of the retention, in days. */
const SECURITY_LOG_RETENTION_RANGE = Object.freeze({ min: 1, max: 730 });

/** Every settings key of the log. */
const SECURITY_LOG_KEYS = Object.freeze(Object.keys(SECURITY_LOG_DEFAULTS));

/**
 * Runtime view of the log settings. Unknown or invalid stored values fall
 * back to the defaults; a stored `false` always wins.
 *
 * @param {Record<string, unknown>|null|undefined} settings Merged plugin settings.
 * @returns {{signIns: boolean, content: boolean, storeIp: boolean, anonymizeIp: boolean,
 *   retentionDays: number}} Normalised flags.
 */
function resolveSecurityLogSettings(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};
  /** @param {string} key */
  const flag = (key) =>
    typeof source[key] === 'boolean'
      ? /** @type {boolean} */ (source[key])
      : /** @type {any} */ (SECURITY_LOG_DEFAULTS)[key];
  const days = Number(source.securityLogRetentionDays);
  const { min, max } = SECURITY_LOG_RETENTION_RANGE;
  return {
    signIns: flag('adminSignInHistory'),
    content: flag('adminContentActivity'),
    storeIp: flag('securityLogStoreIp'),
    anonymizeIp: flag('securityLogAnonymizeIp'),
    retentionDays:
      Number.isInteger(days) && days >= min && days <= max
        ? days
        : SECURITY_LOG_DEFAULTS.securityLogRetentionDays,
  };
}

/**
 * Validates the log keys of a settings PUT body. Missing keys keep their
 * stored value; invalid ones are reported, never clamped.
 *
 * @param {Record<string, unknown>} body Request body.
 * @returns {{values: Record<string, boolean|number>, errors: Array<{path: string[], message: string}>}}
 *   Valid values present in the body, and one error per invalid field.
 */
function validateSecurityLogSettings(body) {
  /** @type {Record<string, boolean|number>} */
  const values = {};
  /** @type {Array<{path: string[], message: string}>} */
  const errors = [];
  /** @param {string} key */
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
  for (const key of SECURITY_LOG_BOOLEAN_KEYS) {
    if (!has(key)) continue;
    if (typeof body[key] !== 'boolean') {
      errors.push({ path: [key], message: `${key} must be a boolean` });
    } else {
      values[key] = /** @type {boolean} */ (body[key]);
    }
  }
  if (has('securityLogRetentionDays')) {
    const raw = body.securityLogRetentionDays;
    const value =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && /^\s*\d+\s*$/.test(raw)
          ? Number.parseInt(raw, 10)
          : NaN;
    const { min, max } = SECURITY_LOG_RETENTION_RANGE;
    if (!Number.isInteger(value) || value < min || value > max) {
      errors.push({
        path: ['securityLogRetentionDays'],
        message: `securityLogRetentionDays must be an integer between ${min} and ${max}`,
      });
    } else {
      values.securityLogRetentionDays = value;
    }
  }
  return { values, errors };
}

module.exports = {
  SECURITY_LOG_BOOLEAN_KEYS,
  SECURITY_LOG_DEFAULTS,
  SECURITY_LOG_KEYS,
  SECURITY_LOG_RETENTION_RANGE,
  resolveSecurityLogSettings,
  validateSecurityLogSettings,
};
