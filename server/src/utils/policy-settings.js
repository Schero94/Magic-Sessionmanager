'use strict';

// @ts-check

/**
 * Sign-in and session policies (4.17): account and IP lockout, trusted
 * addresses, the concurrent session limit, ending other sessions after a
 * password change, and per-role overrides. The values live in the plugin
 * store next to the other settings, in user-facing units (minutes, counts).
 * This module owns their defaults, bounds, request validation and the
 * normalised runtime view, so every rule is unit-tested without Strapi.
 *
 * Defaults keep the behaviour of earlier versions: the IP lockout stays at
 * 5 failures, a 15-minute window and a 15-minute lock; the account lockout,
 * the session limit and every role rule are off. Ending other sessions after
 * a password change is on for new installations and stays off for existing
 * ones (see `utils/upgrade-defaults.js`).
 */

const net = require('node:net');

/** Defaults in user-facing units. */
const POLICY_DEFAULTS = Object.freeze({
  maxFailedLoginsPerAccount: 0,
  lockoutWindowMinutes: 15,
  lockoutDurationMinutes: 15,
  lockoutTrustedAddresses: Object.freeze([]),
  lockoutNotifyUser: false,
  recordUserSignInEvents: true,
  maxSessionsPerUser: 0,
  sessionLimitPolicy: 'end-oldest',
  endOtherSessionsOnPasswordChange: true,
  roleRules: Object.freeze([]),
});

/** Every settings key of this module. */
const POLICY_KEYS = Object.freeze(Object.keys(POLICY_DEFAULTS));

/** Inclusive integer bounds. */
const POLICY_RANGES = Object.freeze({
  maxFailedLoginsPerAccount: Object.freeze([0, 100]),
  lockoutWindowMinutes: Object.freeze([1, 1440]),
  lockoutDurationMinutes: Object.freeze([1, 10080]),
  maxSessionsPerUser: Object.freeze([0, 100]),
});

/** Bounds of a role rule's overrides; `null` means "use the general value". */
const ROLE_RULE_RANGES = Object.freeze({
  maxSessionsPerUser: Object.freeze([0, 100]),
  inactivityTimeout: Object.freeze([1, 1440]),
  maxFailedLoginsPerAccount: Object.freeze([0, 100]),
});

const ROLE_RULE_FIELDS = Object.freeze(Object.keys(ROLE_RULE_RANGES));
const SESSION_LIMIT_POLICIES = Object.freeze(['end-oldest', 'refuse']);
const BOOLEAN_KEYS = Object.freeze([
  'lockoutNotifyUser',
  'recordUserSignInEvents',
  'endOtherSessionsOnPasswordChange',
]);
const MAX_TRUSTED_ADDRESSES = 100;
const MAX_ROLE_RULES = 50;
const ROLE_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/;

/**
 * Parses an integer the admin UI may send as a number or a numeric string.
 *
 * @param {unknown} value Raw input.
 * @returns {number|null} Integer, or null.
 */
function parseInteger(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value === 'string' && /^\s*-?\d{1,9}\s*$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  return null;
}

/**
 * Parses one trusted address: an IPv4 or IPv6 address, or a CIDR range.
 * IPv4-mapped IPv6 addresses are stored in their IPv4 form.
 *
 * @param {unknown} value Candidate.
 * @returns {{text: string, address: string, prefix: number|null, family: 'ipv4'|'ipv6'}|null}
 *   Parsed entry, or null when invalid.
 */
function parseTrustedAddress(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > 64) return null;
  const [rawAddress, rawPrefix, extra] = text.split('/');
  if (extra !== undefined) return null;
  let address = rawAddress;
  if (address.toLowerCase().startsWith('::ffff:') && net.isIPv4(address.slice(7))) {
    address = address.slice(7);
  }
  const version = net.isIP(address);
  if (version === 0) return null;
  const family = version === 4 ? 'ipv4' : 'ipv6';
  if (rawPrefix === undefined) {
    return { text: address.toLowerCase(), address, prefix: null, family };
  }
  if (!/^\d{1,3}$/.test(rawPrefix)) return null;
  const prefix = Number(rawPrefix);
  if (prefix > (family === 'ipv4' ? 32 : 128)) return null;
  return { text: `${address.toLowerCase()}/${prefix}`, address, prefix, family };
}

/** @type {Map<string, import('node:net').BlockList>} */
const blockListCache = new Map();

/**
 * Builds (and caches) a `net.BlockList` of trusted addresses.
 *
 * @param {readonly string[]} entries Stored entries (already validated).
 * @returns {import('node:net').BlockList} Block list used as an allow list.
 */
function trustedAddressList(entries) {
  const key = entries.join('\n');
  const cached = blockListCache.get(key);
  if (cached) return cached;
  const list = new net.BlockList();
  for (const entry of entries) {
    const parsed = parseTrustedAddress(entry);
    if (!parsed) continue;
    if (parsed.prefix === null) list.addAddress(parsed.address, parsed.family);
    else list.addSubnet(parsed.address, parsed.prefix, parsed.family);
  }
  if (blockListCache.size > 20) blockListCache.clear();
  blockListCache.set(key, list);
  return list;
}

/**
 * Whether an IP address is on the trusted list.
 *
 * @param {readonly string[]} entries Stored trusted entries.
 * @param {unknown} ip Client IP.
 * @returns {boolean} True when the address matches an entry.
 */
function isTrustedAddress(entries, ip) {
  if (!entries.length || typeof ip !== 'string') return false;
  let address = ip.trim();
  if (address.toLowerCase().startsWith('::ffff:') && net.isIPv4(address.slice(7))) {
    address = address.slice(7);
  }
  const version = net.isIP(address);
  if (version === 0) return false;
  try {
    return trustedAddressList(entries).check(address, version === 4 ? 'ipv4' : 'ipv6');
  } catch {
    return false;
  }
}

/**
 * Cleans stored role rules: unknown fields are dropped, invalid entries are
 * skipped, so a damaged store value can never break sign-ins.
 *
 * @param {unknown} value Stored rules.
 * @returns {Array<{role: string, maxSessionsPerUser: number|null,
 *   inactivityTimeout: number|null, maxFailedLoginsPerAccount: number|null}>} Rules.
 */
function normalizeRoleRules(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value.slice(0, MAX_ROLE_RULES)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const role = typeof raw.role === 'string' ? raw.role : '';
    if (!ROLE_ID_PATTERN.test(role) || seen.has(role)) continue;
    /** @type {any} */
    const rule = { role };
    for (const field of ROLE_RULE_FIELDS) {
      const [min, max] = /** @type {any} */ (ROLE_RULE_RANGES)[field];
      const number =
        raw[field] === null || raw[field] === undefined ? null : parseInteger(raw[field]);
      rule[field] = number !== null && number >= min && number <= max ? number : null;
    }
    seen.add(role);
    out.push(rule);
  }
  return out;
}

/**
 * Cleans the stored policy values (user-facing units). Invalid values fall
 * back to the defaults.
 *
 * @param {Record<string, unknown>|null|undefined} stored Raw stored settings.
 * @returns {Record<string, unknown>} Clean values for the keys that are present.
 */
function normalizePolicySettings(stored) {
  /** @type {Record<string, unknown>} */
  const out = {};
  if (!stored || typeof stored !== 'object') return out;
  for (const [key, [min, max]] of Object.entries(POLICY_RANGES)) {
    if (stored[key] === undefined) continue;
    const number = parseInteger(stored[key]);
    out[key] =
      number !== null && number >= min && number <= max
        ? number
        : /** @type {any} */ (POLICY_DEFAULTS)[key];
  }
  for (const key of BOOLEAN_KEYS) {
    if (stored[key] !== undefined) out[key] = stored[key] === true;
  }
  if (stored.sessionLimitPolicy !== undefined) {
    out.sessionLimitPolicy = SESSION_LIMIT_POLICIES.includes(
      /** @type {string} */ (stored.sessionLimitPolicy)
    )
      ? stored.sessionLimitPolicy
      : POLICY_DEFAULTS.sessionLimitPolicy;
  }
  if (stored.lockoutTrustedAddresses !== undefined) {
    out.lockoutTrustedAddresses = Array.isArray(stored.lockoutTrustedAddresses)
      ? stored.lockoutTrustedAddresses
          .slice(0, MAX_TRUSTED_ADDRESSES)
          .map(parseTrustedAddress)
          .filter(Boolean)
          .map((entry) => /** @type {any} */ (entry).text)
      : [];
  }
  if (stored.roleRules !== undefined) out.roleRules = normalizeRoleRules(stored.roleRules);
  return out;
}

/**
 * Validates the policy keys of a settings PUT body. Missing keys keep their
 * stored value; invalid ones are reported (never clamped).
 *
 * @param {Record<string, unknown>} body Request body.
 * @returns {{values: Record<string, unknown>, errors: Array<{path: Array<string|number>, message: string}>}}
 *   Valid values present in the body, and one error per invalid field.
 */
function validatePolicySettings(body) {
  /** @type {Record<string, unknown>} */
  const values = {};
  /** @type {Array<{path: Array<string|number>, message: string}>} */
  const errors = [];
  /** @param {string} key */
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;

  for (const [key, [min, max]] of Object.entries(POLICY_RANGES)) {
    if (!has(key)) continue;
    const number = parseInteger(body[key]);
    if (number === null || number < min || number > max) {
      errors.push({ path: [key], message: `${key} must be an integer between ${min} and ${max}` });
    } else {
      values[key] = number;
    }
  }

  for (const key of BOOLEAN_KEYS) {
    if (!has(key)) continue;
    if (typeof body[key] !== 'boolean') {
      errors.push({ path: [key], message: `${key} must be a boolean` });
    } else {
      values[key] = body[key];
    }
  }

  if (has('sessionLimitPolicy')) {
    if (!SESSION_LIMIT_POLICIES.includes(/** @type {string} */ (body.sessionLimitPolicy))) {
      errors.push({
        path: ['sessionLimitPolicy'],
        message: `sessionLimitPolicy must be one of: ${SESSION_LIMIT_POLICIES.join(', ')}`,
      });
    } else {
      values.sessionLimitPolicy = body.sessionLimitPolicy;
    }
  }

  if (has('lockoutTrustedAddresses')) {
    const list = body.lockoutTrustedAddresses;
    if (!Array.isArray(list) || list.length > MAX_TRUSTED_ADDRESSES) {
      errors.push({
        path: ['lockoutTrustedAddresses'],
        message: `lockoutTrustedAddresses must be a list of at most ${MAX_TRUSTED_ADDRESSES} IP addresses or CIDR ranges`,
      });
    } else {
      const parsed = list.map(parseTrustedAddress);
      const invalid = parsed.findIndex((entry) => entry === null);
      if (invalid !== -1) {
        errors.push({
          path: ['lockoutTrustedAddresses', invalid],
          message:
            'Each trusted address must be an IP address or a CIDR range such as 192.0.2.0/24',
        });
      } else {
        values.lockoutTrustedAddresses = [
          ...new Set(parsed.map((entry) => /** @type {any} */ (entry).text)),
        ];
      }
    }
  }

  if (has('roleRules')) {
    const rules = body.roleRules;
    if (!Array.isArray(rules) || rules.length > MAX_ROLE_RULES) {
      errors.push({
        path: ['roleRules'],
        message: `roleRules must be a list of at most ${MAX_ROLE_RULES} rules`,
      });
    } else {
      const seen = new Set();
      /** @type {any[]} */
      const clean = [];
      rules.forEach((raw, index) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          errors.push({ path: ['roleRules', index], message: 'A role rule must be an object' });
          return;
        }
        const role = raw.role;
        if (typeof role !== 'string' || !ROLE_ID_PATTERN.test(role)) {
          errors.push({ path: ['roleRules', index, 'role'], message: 'Choose a role' });
          return;
        }
        if (seen.has(role)) {
          errors.push({
            path: ['roleRules', index, 'role'],
            message: 'This role already has a rule',
          });
          return;
        }
        seen.add(role);
        /** @type {any} */
        const rule = { role };
        let overrides = 0;
        for (const field of ROLE_RULE_FIELDS) {
          const [min, max] = /** @type {any} */ (ROLE_RULE_RANGES)[field];
          const rawValue = raw[field];
          if (rawValue === null || rawValue === undefined || rawValue === '') {
            rule[field] = null;
            continue;
          }
          const number = parseInteger(rawValue);
          if (number === null || number < min || number > max) {
            errors.push({
              path: ['roleRules', index, field],
              message: `${field} must be empty or an integer between ${min} and ${max}`,
            });
            continue;
          }
          rule[field] = number;
          overrides += 1;
        }
        if (overrides === 0 && !errors.some((e) => e.path[1] === index)) {
          errors.push({
            path: ['roleRules', index],
            message: 'A role rule needs at least one value',
          });
          return;
        }
        clean.push(rule);
      });
      if (!errors.some((e) => e.path[0] === 'roleRules')) values.roleRules = clean;
    }
  }

  return { values, errors };
}

/**
 * The value of a policy key from merged settings, or its default.
 *
 * @param {Record<string, any>} settings Merged settings.
 * @param {keyof typeof POLICY_DEFAULTS} key Key.
 * @returns {any} Value.
 */
function policyValue(settings, key) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const clean = normalizePolicySettings({ [key]: source[key] });
  return clean[key] !== undefined ? clean[key] : POLICY_DEFAULTS[key];
}

/**
 * The role rule for a users-permissions role, or null.
 *
 * @param {Record<string, any>} settings Merged settings.
 * @param {string|null|undefined} roleDocumentId Role documentId.
 * @returns {{role: string, maxSessionsPerUser: number|null, inactivityTimeout: number|null,
 *   maxFailedLoginsPerAccount: number|null}|null} Rule.
 */
function roleRuleFor(settings, roleDocumentId) {
  if (!roleDocumentId) return null;
  const rules = /** @type {any[]} */ (policyValue(settings, 'roleRules'));
  return rules.find((rule) => rule.role === roleDocumentId) || null;
}

/**
 * Whether any role rule overrides `field`.
 *
 * @param {Record<string, any>} settings Merged settings.
 * @param {string} field Rule field.
 * @returns {boolean} True when at least one rule sets the field.
 */
function hasRoleOverride(settings, field) {
  const rules = /** @type {any[]} */ (policyValue(settings, 'roleRules'));
  return rules.some((rule) => rule[field] !== null && rule[field] !== undefined);
}

/**
 * Runtime view of the lockout: thresholds, window and lock duration in
 * milliseconds, trusted addresses and the switches.
 *
 * @param {Record<string, any>} settings Merged settings (`maxFailedLogins` is the IP threshold).
 * @returns {{ipMax: number, accountMax: number, accountMaxByRole: boolean, windowMs: number,
 *   durationMs: number, trusted: string[], notifyUser: boolean, record: boolean}} Policy.
 */
function resolveLockoutPolicy(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const ipRaw = parseInteger(source.maxFailedLogins);
  return {
    ipMax: ipRaw !== null && ipRaw >= 0 && ipRaw <= 100 ? ipRaw : 0,
    accountMax: policyValue(source, 'maxFailedLoginsPerAccount'),
    accountMaxByRole: hasRoleOverride(source, 'maxFailedLoginsPerAccount'),
    windowMs: policyValue(source, 'lockoutWindowMinutes') * 60 * 1000,
    durationMs: policyValue(source, 'lockoutDurationMinutes') * 60 * 1000,
    trusted: policyValue(source, 'lockoutTrustedAddresses'),
    notifyUser: policyValue(source, 'lockoutNotifyUser'),
    record: policyValue(source, 'recordUserSignInEvents'),
  };
}

/**
 * The account threshold that applies to a user's role.
 *
 * @param {Record<string, any>} settings Merged settings.
 * @param {string|null|undefined} roleDocumentId Role documentId, if the account exists.
 * @returns {number} Threshold; 0 means no account lockout.
 */
function accountThresholdFor(settings, roleDocumentId) {
  const rule = roleRuleFor(settings, roleDocumentId);
  if (rule && rule.maxFailedLoginsPerAccount !== null) return rule.maxFailedLoginsPerAccount;
  return policyValue(settings, 'maxFailedLoginsPerAccount');
}

/**
 * The concurrent session limit and its policy for a user's role.
 *
 * @param {Record<string, any>} settings Merged settings.
 * @param {string|null|undefined} roleDocumentId Role documentId.
 * @returns {{limit: number, policy: 'end-oldest'|'refuse'}} Limit (0 = none) and policy.
 */
function sessionLimitFor(settings, roleDocumentId) {
  const rule = roleRuleFor(settings, roleDocumentId);
  const limit =
    rule && rule.maxSessionsPerUser !== null
      ? rule.maxSessionsPerUser
      : policyValue(settings, 'maxSessionsPerUser');
  return { limit, policy: policyValue(settings, 'sessionLimitPolicy') };
}

/**
 * The inactivity timeout, in milliseconds, for a user's role.
 *
 * @param {Record<string, any>} settings Merged runtime settings (`inactivityTimeout` in ms).
 * @param {string|null|undefined} roleDocumentId Role documentId.
 * @returns {number} Timeout in milliseconds.
 */
function inactivityTimeoutFor(settings, roleDocumentId) {
  const rule = roleRuleFor(settings, roleDocumentId);
  if (rule && rule.inactivityTimeout !== null) return rule.inactivityTimeout * 60 * 1000;
  const general = Number(settings?.inactivityTimeout);
  return Number.isFinite(general) && general > 0 ? general : 15 * 60 * 1000;
}

module.exports = {
  POLICY_DEFAULTS,
  POLICY_KEYS,
  POLICY_RANGES,
  ROLE_RULE_FIELDS,
  ROLE_RULE_RANGES,
  SESSION_LIMIT_POLICIES,
  MAX_ROLE_RULES,
  MAX_TRUSTED_ADDRESSES,
  accountThresholdFor,
  hasRoleOverride,
  inactivityTimeoutFor,
  isTrustedAddress,
  normalizePolicySettings,
  normalizeRoleRules,
  parseTrustedAddress,
  policyValue,
  resolveLockoutPolicy,
  roleRuleFor,
  sessionLimitFor,
  validatePolicySettings,
};
