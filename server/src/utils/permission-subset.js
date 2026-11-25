'use strict';
// @ts-check

/**
 * Whether one admin's effective permissions are a subset of another's
 * (4.20): the anti-escalation rule of the admin permission preview. A
 * non-Super-Admin may only preview an admin whose every permission they
 * hold themselves.
 *
 * The rules mirror Strapi's own permission ceiling (installed 5.63.0,
 * `@strapi/admin/dist/server/server/src/domain/permission/ceiling.js`,
 * `isPermissionWithinCeiling`): conditions are OR-ed (an unconditional
 * permission covers every condition; an unconditional one needs an
 * unconditional holder), a property the holder does not restrict covers
 * every value, a nested field (`seo.title`) is covered by its parent, and a
 * permission with an empty `fields` list grants nothing. That module is
 * internal and missing on the 5.50 floor, so the rules are implemented here
 * and fed with what `strapi.admin.services.permission.findUserPermissions`
 * returns, after `toEnforced` below has applied what the engine enforces.
 */

/**
 * A permission as the subset check reads it.
 *
 * @typedef {{action: string, subject?: string|null, properties?: Record<string, unknown>|null,
 *   conditions?: string[]|null, actionParameters?: Record<string, unknown>|null}} PermissionLike
 */

/**
 * Whether a permission grants nothing: an empty `fields` list.
 *
 * @param {PermissionLike} permission Permission.
 * @returns {boolean}
 */
function grantsNothing(permission) {
  const fields = permission?.properties?.fields;
  return Array.isArray(fields) && fields.length === 0;
}

/**
 * Stable JSON of action parameters (keys sorted, string arrays as sets).
 *
 * @param {unknown} value Parameters.
 * @returns {string} Comparable text.
 */
function parametersKey(value) {
  const normalize = (input) => {
    if (Array.isArray(input)) {
      return input.every((item) => typeof item === 'string')
        ? [...new Set(input)].sort()
        : input.map(normalize);
    }
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.keys(input)
          .filter((key) => input[key] !== undefined)
          .sort()
          .map((key) => [key, normalize(input[key])])
      );
    }
    return input;
  };
  return JSON.stringify(normalize(value ?? {}));
}

/**
 * Whether the held permission covers one requested property value. A held
 * permission that does not restrict the property covers every value; a
 * nested field (`seo.title`) is covered by its parent (`seo`).
 *
 * @param {PermissionLike} held Held permission.
 * @param {string} property Property name.
 * @param {string|null} value Requested value; null means "unrestricted".
 * @returns {boolean}
 */
function coversValue(held, property, value) {
  const allowed = held.properties?.[property];
  if (allowed === undefined || allowed === null) return true;
  if (value === null || !Array.isArray(allowed)) return false;
  return allowed.some(
    (entry) => entry === value || (property === 'fields' && value.startsWith(`${entry}.`))
  );
}

/**
 * Whether the held permission covers a requested condition. Conditions are
 * OR-ed by the permission engine: an unconditional held permission covers
 * everything; an unconditional request needs an unconditional holder.
 *
 * @param {PermissionLike} held Held permission.
 * @param {string|null} condition Requested condition, null for none.
 * @returns {boolean}
 */
function coversCondition(held, condition) {
  const conditions = held.conditions ?? [];
  if (conditions.length === 0) return true;
  return condition !== null && conditions.includes(condition);
}

/**
 * Whether one permission of the target is within the actor's permissions:
 * same action, subject and action parameters, and every combination of a
 * requested property value and condition covered by one held permission.
 *
 * @param {PermissionLike} requested Target permission.
 * @param {PermissionLike[]} held Actor permissions.
 * @returns {boolean}
 */
function isPermissionCovered(requested, held) {
  if (grantsNothing(requested)) return true;
  const subject = requested.subject ?? null;
  const parameters = parametersKey(requested.actionParameters);
  const matching = held.filter(
    (permission) =>
      permission.action === requested.action &&
      (permission.subject ?? null) === subject &&
      parametersKey(permission.actionParameters) === parameters &&
      !grantsNothing(permission)
  );
  if (matching.length === 0) return false;
  const properties = [
    ...new Set([
      ...Object.keys(requested.properties ?? {}),
      ...matching.flatMap((permission) => Object.keys(permission.properties ?? {})),
    ]),
  ];
  /** @type {Array<{property: string, values: Array<string|null>}>} */
  const dimensions = [];
  for (const property of properties) {
    const values = requested.properties?.[property];
    if (!Array.isArray(values)) dimensions.push({ property, values: [null] });
    else if (values.length > 0) {
      dimensions.push({ property, values: [...new Set(values.map(String))] });
    }
  }
  const conditions =
    (requested.conditions ?? []).length === 0 ? [null] : [...new Set(requested.conditions)];
  // Bounded: fields and locales lists are bounded by the schema; the walk
  // stops at the first uncovered combination.
  const walk = (index, picked, condition) => {
    if (index === dimensions.length) {
      return matching.some(
        (permission) =>
          Object.entries(picked).every(([property, value]) =>
            coversValue(permission, property, value)
          ) && coversCondition(permission, condition)
      );
    }
    const { property, values } = dimensions[index];
    return values.every((value) => walk(index + 1, { ...picked, [property]: value }, condition));
  };
  return conditions.every((condition) => walk(0, {}, condition));
}

/**
 * The target permissions the actor does not hold (empty when the target's
 * permissions are a subset of the actor's).
 *
 * @param {PermissionLike[]} target Target admin's effective permissions.
 * @param {PermissionLike[]} actor Actor admin's effective permissions.
 * @returns {PermissionLike[]} Uncovered permissions.
 */
function uncoveredPermissions(target, actor) {
  return target.filter((permission) => !isPermissionCovered(permission, actor));
}

/**
 * The permissions as the engine enforces them: unregistered conditions are
 * dropped, and a permission whose conditions are all unregistered grants
 * nothing (the engine does not register it). Where `locales` applies to a
 * subject, a missing `locales` key means "no locale", like i18n enforces it.
 *
 * @param {PermissionLike[]} permissions Raw permissions.
 * @param {{isConditionRegistered: (id: string) => boolean,
 *   appliesLocales: (permission: PermissionLike) => boolean}} context Engine facts.
 * @returns {PermissionLike[]} Enforced permissions.
 */
function toEnforced(permissions, context) {
  /** @type {PermissionLike[]} */
  const out = [];
  for (const permission of permissions) {
    const conditions = permission.conditions ?? [];
    const registered = conditions.filter((id) => context.isConditionRegistered(id));
    if (conditions.length > 0 && registered.length === 0) continue;
    const properties = { ...(permission.properties ?? {}) };
    if (context.appliesLocales(permission)) {
      if (properties.locales === undefined) properties.locales = [];
    } else {
      delete properties.locales;
    }
    out.push({ ...permission, conditions: registered, properties });
  }
  return out;
}

module.exports = { isPermissionCovered, toEnforced, uncoveredPermissions };
