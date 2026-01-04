import pluginPkg from '../../package.json';
import pluginId from './pluginId';
import Initializer from './components/Initializer';
import PluginIcon from './components/PluginIcon';
import SessionInfoPanel from './components/SessionInfoPanel';

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
    // Menu link - path should be relative to root (no leading slash)
    app.addMenuLink({
      to: `plugins/${pluginId}`,
      icon: PluginIcon,
      intlLabel: {
        id: `${pluginId}.plugin.name`,
        defaultMessage: pluginPkg.strapi.displayName,
      },
      Component: () => import('./pages/App'),
    });

    // Settings section - paths should be relative to /settings (no /settings/ prefix)
    app.createSettingSection(
      {
        intlLabel: { id: `${pluginId}.settings.section`, defaultMessage: 'Sessions' },
        id: pluginId,
        to: pluginId,
      },
      [
        {
          intlLabel: {
            id: `${pluginId}.settings.upgrade`,
            defaultMessage: 'Upgrade',
          },
          id: 'upgrade',
          to: `${pluginId}/upgrade`,
          Component: () => import('./pages/UpgradePage'),
        },
        {
          intlLabel: {
            id: `${pluginId}.settings.general`,
            defaultMessage: 'General',
          },
          id: 'general',
          to: `${pluginId}/general`,
          Component: () => import('./pages/Settings'),
        },
        {
          intlLabel: {
            id: `${pluginId}.settings.analytics`,
            defaultMessage: 'Analytics',
          },
          id: 'analytics',
          to: `${pluginId}/analytics`,
          Component: () => import('./pages/Analytics'),
        },
        {
          intlLabel: {
            id: `${pluginId}.settings.license`,
            defaultMessage: 'License',
          },
          id: 'license',
          to: `${pluginId}/license`,
          Component: () => import('./pages/License'),
        },
      ]
    );

    app.registerPlugin({
      id: pluginId,
      initializer: Initializer,
      isReady: true,
      name,
    });

    // Register Online Users Widget for Homepage (Strapi v5.13+)
    if ('widgets' in app) {
      app.widgets.register({
        icon: PluginIcon,
        title: {
          id: `${pluginId}.widget.online-users.title`,
          defaultMessage: 'Online Users',
        },
        component: async () => {
          const component = await import('./components/OnlineUsersWidget');
          return component.default;
        },
        id: 'online-users-widget',
        pluginId: pluginId,
      });
      console.log(`[${pluginId}] [SUCCESS] Online Users Widget registered`);
    }
  },

  bootstrap(app) {
    console.log(`[${pluginId}] Bootstrapping plugin...`);

    // Inject Session Info Panel into Content Manager edit view
    try {
      const contentManagerPlugin = app.getPlugin('content-manager');
      if (contentManagerPlugin && contentManagerPlugin.apis) {
        console.log(`[${pluginId}] Injecting SessionInfoPanel into edit view sidebar...`);
        contentManagerPlugin.apis.addEditViewSidePanel([SessionInfoPanel]);
        console.log(`[${pluginId}] [SUCCESS] SessionInfoPanel injected successfully`);
      } else {
        console.warn(`[${pluginId}] Content Manager plugin or APIs not available`);
      }
    } catch (error) {
      console.error(`[${pluginId}] Error injecting SessionInfoPanel:`, error);
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
