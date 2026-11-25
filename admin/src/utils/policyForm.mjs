/**
 * Sign-in and session policies (4.17) in the settings form: client defaults,
 * the server's bounds, inline validation, the trusted-address text and the
 * role rule helpers. Pure functions, so `node --test` covers them.
 *
 * The bounds mirror server/src/utils/policy-settings.js; the server stays the
 * authority and reports anything this file misses.
 */

/** Client defaults; they mirror POLICY_DEFAULTS on the server. */
export const POLICY_FORM_DEFAULTS = Object.freeze({
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

/** Inclusive integer bounds of the policy fields. */
export const POLICY_RANGES = Object.freeze({
  maxFailedLoginsPerAccount: Object.freeze({ min: 0, max: 100 }),
  lockoutWindowMinutes: Object.freeze({ min: 1, max: 1440 }),
  lockoutDurationMinutes: Object.freeze({ min: 1, max: 10080 }),
  maxSessionsPerUser: Object.freeze({ min: 0, max: 100 }),
});

/** Bounds of a role rule's values; empty means "use the general value". */
export const ROLE_RULE_RANGES = Object.freeze({
  maxSessionsPerUser: Object.freeze({ min: 0, max: 100 }),
  inactivityTimeout: Object.freeze({ min: 1, max: 1440 }),
  maxFailedLoginsPerAccount: Object.freeze({ min: 0, max: 100 }),
});

export const ROLE_RULE_FIELDS = Object.freeze(Object.keys(ROLE_RULE_RANGES));
export const MAX_TRUSTED_ADDRESSES = 100;

const message = (messageId, defaultMessage, values) => ({ messageId, defaultMessage, values });

/**
 * Validates a whole number from a NumberInput (number or undefined).
 *
 * @param {unknown} value Draft value.
 * @param {{min: number, max: number}} range Bounds.
 * @returns {null|{messageId: string, defaultMessage: string, values?: object}} Error or null.
 */
export function validateWholeNumber(value, { min, max }) {
  if (value === undefined || value === null || value === '') {
    return message('settings.validation.required', 'Enter a value.');
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    return message('settings.validation.range', 'Enter a whole number from {min} to {max}.', {
      min,
      max,
    });
  }
  return null;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6_CHARS = /^[0-9a-f:.]{2,45}$/i;

/**
 * Whether a line is an IP address or a CIDR range. A light check: the
 * server parses each entry with Node's `net` module and reports the rest.
 *
 * @param {string} line One line of the trusted address field.
 * @returns {boolean} True when the line looks valid.
 */
export function isTrustedAddressLine(line) {
  const value = String(line || '').trim();
  if (!value || value.length > 64) return false;
  const [address, prefix, extra] = value.split('/');
  if (extra !== undefined) return false;
  const v4 = IPV4.test(address);
  const v6 = !v4 && address.includes(':') && IPV6_CHARS.test(address) && !address.includes(':::');
  if (!v4 && !v6) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (v4 ? 32 : 128);
}

/**
 * Splits the trusted-address text into entries (one per line, commas allowed).
 *
 * @param {string} text Textarea value.
 * @returns {string[]} Non-empty trimmed entries.
 */
export function parseTrustedAddressText(text) {
  return String(text || '')
    .split(/[\n,]/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Joins stored entries for the textarea.
 *
 * @param {unknown} list Stored entries.
 * @returns {string} One entry per line.
 */
export function formatTrustedAddressText(list) {
  return Array.isArray(list) ? list.join('\n') : '';
}

/**
 * Inline errors of the policy fields.
 *
 * @param {Record<string, any>} settings Settings draft.
 * @returns {Record<string, {messageId: string, defaultMessage: string, values?: object}>}
 *   Errors by field path.
 */
export function validatePolicyFields(settings) {
  const source = settings || {};
  /** @type {Record<string, any>} */
  const errors = {};
  for (const [key, range] of Object.entries(POLICY_RANGES)) {
    // A key missing from the draft keeps its stored value on the server.
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const error = validateWholeNumber(source[key], range);
    if (error) errors[key] = error;
  }
  const entries = Array.isArray(source.lockoutTrustedAddresses)
    ? source.lockoutTrustedAddresses
    : [];
  if (entries.length > MAX_TRUSTED_ADDRESSES) {
    errors.lockoutTrustedAddresses = message(
      'settings.validation.trustedTooMany',
      'Enter at most {max} addresses.',
      { max: MAX_TRUSTED_ADDRESSES }
    );
  } else {
    const invalid = entries.find((entry) => !isTrustedAddressLine(entry));
    if (invalid !== undefined) {
      errors.lockoutTrustedAddresses = message(
        'settings.validation.trustedAddress',
        '"{value}" is not an IP address or CIDR range. Use for example 192.0.2.10 or 192.0.2.0/24.',
        { value: String(invalid).slice(0, 64) }
      );
    }
  }
  return errors;
}

/**
 * Validates one role rule in the "Add rule" / "Edit rule" dialog.
 *
 * @param {{role?: string, maxSessionsPerUser?: any, inactivityTimeout?: any,
 *   maxFailedLoginsPerAccount?: any}} draft Dialog values (empty = general value).
 * @param {string[]} takenRoles Roles that already have a rule (excluding this one).
 * @returns {Record<string, {messageId: string, defaultMessage: string, values?: object}>} Errors.
 */
export function validateRoleRule(draft, takenRoles = []) {
  /** @type {Record<string, any>} */
  const errors = {};
  if (!draft?.role) {
    errors.role = message('settings.roleRules.validation.role', 'Choose a role.');
  } else if (takenRoles.includes(draft.role)) {
    errors.role = message(
      'settings.roleRules.validation.duplicate',
      'This role already has a rule.'
    );
  }
  let values = 0;
  for (const field of ROLE_RULE_FIELDS) {
    const value = draft?.[field];
    if (value === undefined || value === null || value === '') continue;
    const error = validateWholeNumber(value, ROLE_RULE_RANGES[field]);
    if (error) errors[field] = error;
    else values += 1;
  }
  if (values === 0 && !ROLE_RULE_FIELDS.some((field) => errors[field])) {
    errors.form = message(
      'settings.roleRules.validation.empty',
      'Set at least one value. Empty fields use the general setting.'
    );
  }
  return errors;
}

/**
 * Turns dialog values into a stored rule (empty fields become null).
 *
 * @param {Record<string, any>} draft Dialog values.
 * @returns {{role: string, maxSessionsPerUser: number|null, inactivityTimeout: number|null,
 *   maxFailedLoginsPerAccount: number|null}} Rule.
 */
export function toRoleRule(draft) {
  /** @type {any} */
  const rule = { role: draft.role };
  for (const field of ROLE_RULE_FIELDS) {
    const value = draft[field];
    rule[field] = value === undefined || value === null || value === '' ? null : Number(value);
  }
  return rule;
}

/**
 * Adds or replaces the rule of a role, keeping the list order.
 *
 * @param {unknown} rules Current rules.
 * @param {{role: string}} rule New rule.
 * @param {string|null} [previousRole] Role of the rule being edited (it may change).
 * @returns {Array<object>} New list.
 */
export function upsertRoleRule(rules, rule, previousRole = null) {
  const list = Array.isArray(rules) ? rules : [];
  const key = previousRole || rule.role;
  const index = list.findIndex((candidate) => candidate.role === key);
  if (index === -1) return [...list, rule];
  return list.map((candidate, position) => (position === index ? rule : candidate));
}

/**
 * Removes the rule of a role.
 *
 * @param {unknown} rules Current rules.
 * @param {string} role Role documentId.
 * @returns {Array<object>} New list.
 */
export function removeRoleRule(rules, role) {
  return (Array.isArray(rules) ? rules : []).filter((rule) => rule.role !== role);
}

/**
 * The lock list in display order: account locks of known users first, then
 * by the time left (longest first).
 *
 * @param {unknown} locks Locks from GET /lockouts.
 * @returns {Array<object>} Sorted copy.
 */
export function sortLocks(locks) {
  return (Array.isArray(locks) ? locks : []).slice().sort((a, b) => {
    const until = Date.parse(b.until) - Date.parse(a.until);
    return Number.isFinite(until) && until !== 0 ? until : String(a.id).localeCompare(b.id);
  });
}
