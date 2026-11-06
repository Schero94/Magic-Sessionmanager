import pluginId from './pluginId';

/** RBAC actions of the plugin. One source for menu, settings, widget and side panel. */
const pluginPermissions = {
  access: [{ action: `plugin::${pluginId}.access`, subject: null }],
};

export default pluginPermissions;
