import pluginPkg from '../../package.json';
import pluginId from './pluginId';
import Initializer from './components/Initializer';
import PluginIcon from './components/PluginIcon';
import SessionInfoPanel from './components/SessionInfoPanel';
import permissions from './permissions';
import { logSafeAdminError } from './utils/safeAdminLog.mjs';

// Manual fallback for prefixPluginTranslations if helper-plugin is not available
const prefixPluginTranslations = (data, pluginId) => {
  const prefixed = {};
  Object.keys(data).forEach((key) => {
    prefixed[`${pluginId}.${key}`] = data[key];
  });
  return prefixed;
};

const name = pluginPkg.strapi.name;

export default {
  register(app) {
    const pluginPermissions = permissions.access;

    app.addMenuLink({
      to: `plugins/${pluginId}`,
      icon: PluginIcon,
      intlLabel: {
        id: `${pluginId}.plugin.name`,
        defaultMessage: pluginPkg.strapi.displayName,
      },
      Component: () => import('./pages/App'),
      permissions: pluginPermissions,
    });

    // Settings paths stay relative to /settings (never include that prefix).
    app.addSettingsLink(
      {
        id: pluginId,
        intlLabel: { id: `${pluginId}.settings.section`, defaultMessage: 'Session Manager' },
      },
      [
        {
          intlLabel: {
            id: `${pluginId}.settings.general`,
            defaultMessage: 'General',
          },
          id: 'general',
          to: `${pluginId}/general`,
          Component: () => import('./pages/Settings'),
          permissions: pluginPermissions,
        },
        {
          intlLabel: {
            id: `${pluginId}.settings.analytics`,
            defaultMessage: 'Analytics',
          },
          id: 'analytics',
          to: `${pluginId}/analytics`,
          Component: () => import('./pages/Analytics'),
          permissions: pluginPermissions,
        },
        {
          intlLabel: {
            id: `${pluginId}.settings.license`,
            defaultMessage: 'Activation',
          },
          id: 'license',
          to: `${pluginId}/license`,
          Component: () => import('./pages/License'),
          permissions: pluginPermissions,
        },
      ]
    );

    app.registerPlugin({
      id: pluginId,
      initializer: Initializer,
      isReady: true,
      name,
    });

    // Homepage widget (Strapi 5.13+). Older versions have no widgets API.
    if ('widgets' in app && app.widgets && typeof app.widgets.register === 'function') {
      app.widgets.register({
        icon: PluginIcon,
        title: {
          id: `${pluginId}.widget.online-users.title`,
          defaultMessage: 'Online users',
        },
        link: {
          label: {
            id: `${pluginId}.widget.link`,
            defaultMessage: 'Open Session Manager',
          },
          href: `/plugins/${pluginId}`,
        },
        component: async () => {
          const component = await import('./components/OnlineUsersWidget');
          return component.default;
        },
        id: 'online-users-widget',
        pluginId: pluginId,
        permissions: pluginPermissions,
      });
    }
  },

  bootstrap(app) {
    // Session side panel in the Content Manager edit view. The panel itself
    // renders nothing for models other than Users & Permissions users.
    try {
      const contentManagerPlugin = app.getPlugin('content-manager');
      if (contentManagerPlugin?.apis?.addEditViewSidePanel) {
        contentManagerPlugin.apis.addEditViewSidePanel([SessionInfoPanel]);
      }
    } catch (error) {
      logSafeAdminError('plugin.bootstrap', error);
    }
  },

  async registerTrads({ locales }) {
    const importedTrads = {
      en: () => import('./translations/en.json'),
      de: () => import('./translations/de.json'),
      es: () => import('./translations/es.json'),
      fr: () => import('./translations/fr.json'),
      pt: () => import('./translations/pt.json'),
    };

    const translatedLanguages = Object.keys(importedTrads).filter((lang) =>
      locales.includes(lang)
    );

    const translations = await Promise.all(
      translatedLanguages.map((language) =>
        importedTrads[language]()
          .then(({ default: data }) => ({
            data: prefixPluginTranslations(data, pluginId),
            locale: language,
          }))
          .catch(() => ({
            data: {},
            locale: language,
          }))
      )
    );

    return Promise.resolve(translations);
  },
};
