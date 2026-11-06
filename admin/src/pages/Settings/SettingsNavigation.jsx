import { createContext, useContext } from 'react';
import { Link } from '@strapi/design-system';
import { buildTabSearch } from './settingsTabs.mjs';

const SettingsNavigationContext = createContext({ selectTab: () => {} });

/** Provides `selectTab(tabId)` to links deep inside the configuration tabs. */
export const SettingsNavigationProvider = SettingsNavigationContext.Provider;

/**
 * @returns {{ selectTab: (tab: string) => void }} Tab switcher of the configuration page.
 */
export const useSettingsNavigation = () => useContext(SettingsNavigationContext);

/**
 * In-page link to another configuration tab (IA C: "Requires IP location
 * lookup" lands on Location data). The href is the deep link `?tab=…`, so it
 * also works when opened in a new tab; a normal click switches the tab in
 * place without a router navigation, which would trigger the unsaved-changes
 * Blocker.
 *
 * @param {{ tab: string, children: import('react').ReactNode }} props Target tab and link text.
 * @returns {import('react').ReactElement} DS Link.
 */
export const SettingsTabLink = ({ tab, children }) => {
  const { selectTab } = useSettingsNavigation();
  const search = typeof window === 'undefined' ? '' : window.location.search;
  return (
    <Link
      href={buildTabSearch(search, tab)}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        selectTab(tab);
      }}
    >
      {children}
    </Link>
  );
};
