'use strict';

/**
 * "View as admin" as a read-only permission preview (4.20).
 *
 * Strapi 5.63 offers no sound, documented way to sign a browser in as
 * another admin: a plugin can create an admin session
 * (`strapi.sessionManager('admin').generateRefreshToken`), but the admin
 * panel keeps its access token in internal storage (`localStorage.jwtToken`
 * or a build-inlined cookie, `@strapi/admin/dist/admin/admin/src/reducer.mjs`)
 * that no public admin API can set (`useAuth` exposes `login` with
 * credentials only), every tab adopts a changed token, there is no global
 * admin injection zone for a persistent banner (`admin.injectionZones` is
 * empty; the `initializer` unmounts once plugins are ready), and Strapi's
 * logout without a device id revokes every session of the signed-in admin.
 * So the plugin shows which content types and actions an admin can use,
 * computed from their role permissions, without any session.
 *
 * Anti-escalation (all enforced here, server-side):
 * - nobody previews themselves;
 * - nobody previews a Super Admin (Super Admins included);
 * - a non-Super-Admin previews only an admin whose effective permissions are
 *   a subset of their own (`utils/permission-subset.js`).
 */

const { toEnforced, uncoveredPermissions } = require('./permission-subset');

const SUPER_ADMIN_CODE = 'strapi-super-admin';

/**
 * Whether an admin user (with `roles` populated) is a Super Admin.
 *
 * @param {any} user Admin user.
 * @returns {boolean}
 */
function isSuperAdmin(user) {
  return (user?.roles || []).some((role) => role?.code === SUPER_ADMIN_CODE);
}

/**
 * An admin with roles, or null.
 *
 * @param {any} strapi Strapi.
 * @param {number} id Admin id.
 * @returns {Promise<any|null>}
 */
async function loadAdmin(strapi, id) {
  return strapi.db.query('admin::user').findOne({
    where: { id },
    select: ['id', 'firstname', 'lastname', 'username', 'email', 'isActive'],
    populate: { roles: { select: ['id', 'name', 'code'] } },
  });
}

/**
 * Effective permissions of an admin as the engine enforces them.
 *
 * @param {any} strapi Strapi.
 * @param {any} user Admin user.
 * @returns {Promise<any[]>}
 */
async function effectivePermissions(strapi, user) {
  const service = strapi.admin.services.permission;
  const raw = await service.findUserPermissions(user);
  const appliesCache = new Map();
  for (const permission of raw) {
    const key = `${permission.action}::${permission.subject}`;
    if (appliesCache.has(key)) continue;
    let applies;
    try {
      applies =
        Boolean(permission.subject) &&
        service.actionProvider.has(permission.action) &&
        (await service.actionProvider.appliesToProperty(
          'locales',
          permission.action,
          permission.subject
        )) === true;
    } catch {
      applies = false;
    }
    appliesCache.set(key, applies);
  }
  return toEnforced(raw, {
    isConditionRegistered: (id) => {
      try {
        return service.conditionProvider.has(id) === true;
      } catch {
        return false;
      }
    },
    appliesLocales: (permission) =>
      appliesCache.get(`${permission.action}::${permission.subject}`) === true,
  });
}

/**
 * Why an actor may not preview a target, or null when allowed.
 *
 * @param {any} strapi Strapi.
 * @param {any} actor Calling admin (with roles).
 * @param {any} target Target admin (with roles).
 * @returns {Promise<null|{reason: 'self'|'super-admin'|'not-subset', uncovered?: number}>}
 */
async function previewRefusal(strapi, actor, target) {
  if (String(actor.id) === String(target.id)) return { reason: 'self' };
  if (isSuperAdmin(target)) return { reason: 'super-admin' };
  if (isSuperAdmin(actor)) return null;
  const [held, wanted] = await Promise.all([
    effectivePermissions(strapi, actor),
    effectivePermissions(strapi, target),
  ]);
  const uncovered = uncoveredPermissions(wanted, held);
  return uncovered.length > 0 ? { reason: 'not-subset', uncovered: uncovered.length } : null;
}

/**
 * Short action name of a content-manager action (`create`, `read`, …).
 *
 * @param {string} action Action id.
 * @returns {string}
 */
function contentAction(action) {
  const match = /^plugin::content-manager\.explorer\.([a-z-]+)$/.exec(action);
  return match ? match[1] : action;
}

/**
 * The preview of an admin: roles, content types with their actions and
 * restrictions, and the other permissions by section. Names only; no
 * entries, no data.
 *
 * @param {any} strapi Strapi.
 * @param {any} target Target admin (with roles).
 * @returns {Promise<object>} Preview DTO.
 */
async function buildPreview(strapi, target) {
  const permissions = await effectivePermissions(strapi, target);
  const provider = strapi.admin.services.permission.actionProvider;
  /** @type {Map<string, any>} */
  const types = new Map();
  /** @type {Array<{action: string, name: string, section: string, scope: string|null}>} */
  const other = [];
  for (const permission of permissions) {
    const contentType = permission.subject ? strapi.contentTypes?.[permission.subject] : null;
    if (contentType && permission.action.startsWith('plugin::content-manager.explorer.')) {
      const entry = types.get(permission.subject) || {
        uid: permission.subject,
        name: String(contentType.info?.displayName || permission.subject).slice(0, 120),
        kind: contentType.kind === 'singleType' ? 'single' : 'collection',
        actions: [],
      };
      const fields = permission.properties?.fields;
      const locales = permission.properties?.locales;
      entry.actions.push({
        action: contentAction(permission.action),
        fields: Array.isArray(fields) ? fields.length : null,
        locales: Array.isArray(locales) ? locales.slice(0, 20) : null,
        conditions: (permission.conditions || []).slice(0, 10),
      });
      types.set(permission.subject, entry);
      continue;
    }
    let definition;
    try {
      definition = provider.get(permission.action);
    } catch {
      definition = null;
    }
    other.push({
      action: permission.action,
      name: String(definition?.displayName || permission.action).slice(0, 160),
      section: String(definition?.section || 'other'),
      scope: definition?.pluginName ? String(definition.pluginName) : null,
    });
  }
  const order = ['create', 'read', 'update', 'delete', 'publish'];
  const contentTypes = [...types.values()]
    .map((entry) => ({
      ...entry,
      actions: entry.actions.sort(
        (a, b) =>
          (order.indexOf(a.action) + 1 || 99) - (order.indexOf(b.action) + 1 || 99) ||
          a.action.localeCompare(b.action)
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  other.sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name));
  return {
    admin: {
      id: target.id,
      name:
        [target.firstname, target.lastname].filter(Boolean).join(' ').trim() ||
        target.username ||
        '',
      active: target.isActive === true,
      roles: (target.roles || []).map((role) => ({ name: role.name })),
    },
    contentTypes,
    otherPermissions: other.slice(0, 500),
  };
}

module.exports = {
  buildPreview,
  effectivePermissions,
  isSuperAdmin,
  loadAdmin,
  previewRefusal,
};
