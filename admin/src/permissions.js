import pluginId from './pluginId';

/** RBAC actions of the plugin. One source for menu, settings, widget and side panel. */
const pluginPermissions = {
  access: [{ action: `plugin::${pluginId}.access`, subject: null }],
  /** Strapi admin panel sessions (view). The server also requires `access`. */
  adminSessionsRead: [{ action: `plugin::${pluginId}.admin-sessions.read`, subject: null }],
  /** Signing admins out. The server also requires `access` and `admin-sessions.read`. */
  adminSessionsRevoke: [{ action: `plugin::${pluginId}.admin-sessions.revoke`, subject: null }],
  /** Admin sign-in history and Content Manager activity. The server also requires `access` and `admin-sessions.read`. */
  adminActivityRead: [{ action: `plugin::${pluginId}.admin-activity.read`, subject: null }],
  /**
   * Protected settings (4.17): location lookup, webhooks and the security log.
   * The server also requires `access` (and `admin-activity.read` for the log).
   */
  settingsUpdate: [{ action: `plugin::${pluginId}.settings.update`, subject: null }],
  /** Lifting a sign-in lock. The server also requires `access`. */
  lockoutsUnlock: [{ action: `plugin::${pluginId}.lockouts.unlock`, subject: null }],
  /**
   * Impersonating app users (4.20): start, list and end. The server also
   * requires `access` and the Impersonation switch.
   */
  impersonateUsers: [{ action: `plugin::${pluginId}.impersonate.users`, subject: null }],
};

export default pluginPermissions;
