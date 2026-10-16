'use strict';

const CONTENT_API_PERMISSIONS_VERSION = 2;
const MAGIC_SESSIONMANAGER_STORE = 'magic-sessionmanager';
const CONTENT_API_PERMISSIONS_VERSION_KEY = 'contentApiPermissionsVersion';
const AUTHENTICATED_ROLE_UID = 'plugin::users-permissions.role';

/**
 * Records that an administrator saved the Authenticated role before Magic's
 * first deferred permission setup. This prevents the first end-user request
 * from re-enabling actions the administrator deliberately left disabled.
 *
 * @param {object} strapi - Strapi instance with the Core Store available.
 * @param {object} role - Updated Users & Permissions role.
 * @returns {Promise<boolean>} Whether the choice marker was written.
 */
async function preserveAuthenticatedRolePermissionChoice(strapi, role) {
  if (role?.type !== 'authenticated') return false;

  const pluginStore = strapi.store({ type: 'plugin', name: MAGIC_SESSIONMANAGER_STORE });
  const storedVersion = await pluginStore.get({ key: CONTENT_API_PERMISSIONS_VERSION_KEY });
  if (Number(storedVersion) >= CONTENT_API_PERMISSIONS_VERSION) return false;

  await pluginStore.set({
    key: CONTENT_API_PERMISSIONS_VERSION_KEY,
    value: CONTENT_API_PERMISSIONS_VERSION,
  });
  return true;
}

/**
 * Watches Users & Permissions role saves so a deliberate role configuration
 * made before the first Magic Content API call remains authoritative.
 *
 * @param {object} strapi - Strapi instance.
 * @returns {object} Database lifecycle subscriber for the Authenticated role.
 */
function createContentApiPermissionsLifecycle(strapi) {
  return {
    models: [AUTHENTICATED_ROLE_UID],

    /**
     * @param {{result?: object}} event - Updated role lifecycle event.
     * @returns {Promise<void>}
     */
    async afterUpdate(event) {
      await preserveAuthenticatedRolePermissionChoice(strapi, event?.result);
    },
  };
}

module.exports = {
  AUTHENTICATED_ROLE_UID,
  CONTENT_API_PERMISSIONS_VERSION,
  createContentApiPermissionsLifecycle,
  preserveAuthenticatedRolePermissionChoice,
};
