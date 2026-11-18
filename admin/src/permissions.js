import pluginId from './pluginId';

/** RBAC actions of the plugin. One source for menu, settings, widget and side panel. */
const pluginPermissions = {
  access: [{ action: `plugin::${pluginId}.access`, subject: null }],
  /** Strapi admin panel sessions (view). The server also requires `access`. */
  adminSessionsRead: [{ action: `plugin::${pluginId}.admin-sessions.read`, subject: null }],
  /** Signing admins out. The server also requires `access` and `admin-sessions.read`. */
  adminSessionsRevoke: [{ action: `plugin::${pluginId}.admin-sessions.revoke`, subject: null }],
};

export default pluginPermissions;
