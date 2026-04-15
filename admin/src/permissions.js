const pluginId = 'magic-sessionmanager';

const pluginPermissions = {
  access: [{ action: `plugin::${pluginId}.access`, subject: null }],
};

export default pluginPermissions;
