import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Flex, Tabs, Typography } from '@strapi/design-system';
import { Blocker, Form, Page, useForm, useQueryParams } from '@strapi/strapi/admin';
import { Check } from '@strapi/icons';
import styled from 'styled-components';
import { ConfirmAction, PageShell } from '../../components/ui';
import ReadableText from '../../components/ReadableText';
import Alert from '../../components/PersistentAlert';
import {
  SETTINGS_TAB_IDS,
  SETTINGS_TAB_LABELS,
  buildTabSearch,
  getRevealScrollDelta,
  resolveSettingsTab,
} from './settingsTabs.mjs';
import SessionsTab from './SessionsTab';
import LoginProtectionTab from './LoginProtectionTab';
import LocationDataTab from './LocationDataTab';
import AlertsTab from './AlertsTab';
import DataRetentionTab from './DataRetentionTab';
import { SettingsNavigationProvider } from './SettingsNavigation';
import { useSettingsForm } from './hooks/useSettingsForm';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

const HEADING_ID = 'magic-sessionmanager-settings-title';

/**
 * Tab triggers stay on one row and scroll inside the tab list, never the page
 * (IA D5 mobile). The DS "simple" variant renders labels in the uppercase
 * sigma style; the labels are sentence case (IA H.3), so the transform is
 * reset and the label uses the body text size.
 */
const SettingsTabsList = styled(Tabs.List)`
  overflow-x: auto;
  overflow-y: hidden;
  max-width: 100%;
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};

  & > [role='tab'] {
    flex: 0 0 auto;
    white-space: nowrap;
  }

  & > [role='tab'] > span:first-child {
    text-transform: none;
    letter-spacing: normal;
    font-size: ${({ theme }) => theme.fontSizes[2]};
  }
`;

/**
 * Two-column field pairs fit when a column is at least 28rem wide. The DS
 * Grid only sees the viewport: at 768–1079 px the Settings sub-navigation
 * leaves a tab panel of about 49rem, which split fields into 18rem columns
 * with cut-off labels and placeholders. The panel is a size container; below
 * 60rem its field pairs stack, as they do below the medium breakpoint.
 * Wider panels (1024 px and up) keep two columns.
 */
const TAB_PANEL_FOLD_REM = 60;

const TabPanelFrame = styled.div`
  container-type: inline-size;
  min-width: 0;

  @container (max-width: ${TAB_PANEL_FOLD_REM - 0.01}rem) {
    [data-equal-grid='2'] > * {
      grid-column: span 12;
    }
  }
`;

const TAB_COMPONENTS = {
  sessions: SessionsTab,
  'login-protection': LoginProtectionTab,
  'location-data': LocationDataTab,
  alerts: AlertsTab,
  'data-retention': DataRetentionTab,
};

/**
 * Mirrors the settings draft into Strapi's Form state, so the native Blocker
 * can warn before in-app navigation and on tab close while the draft differs
 * from the saved settings (SET-04).
 *
 * @param {{ values: object }} props Current settings draft.
 * @returns {null} Renders nothing.
 */
const DraftSync = ({ values }) => {
  const setValues = useForm('DraftSync', (state) => state.setValues);
  useEffect(() => {
    setValues(values);
  }, [values, setValues]);
  return null;
};

/**
 * Writes the open tab to the address bar so the view can be shared and
 * reloaded (`?tab=…`, IA C). It replaces the history entry directly: a router
 * navigation changes `location.search`, which Strapi's Blocker treats as
 * leaving the page while there are unsaved changes.
 *
 * @param {string} tab Tab id.
 * @returns {void}
 */
const writeTabToAddressBar = (tab) => {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const { pathname, search, hash } = window.location;
  const nextSearch = buildTabSearch(search, tab);
  if (nextSearch === search) return;
  window.history.replaceState(window.history.state, '', `${pathname}${nextSearch}${hash}`);
};

/**
 * Settings › Session Manager › Configuration (IA D5): header with Save and
 * Discard changes, five deep-linkable tabs, unsaved-changes guard and the
 * storage note.
 *
 * @returns {import('react').ReactElement} Configuration page.
 */
const SettingsPage = () => {
  const { t } = useSettingsTranslate();
  const form = useSettingsForm();
  const [{ query }] = useQueryParams();
  const requestedTab = resolveSettingsTab(query?.tab);
  const [activeTab, setActiveTab] = useState(requestedTab);
  const tabsRef = useRef(null);

  // Follow links that change ?tab= while the page is open.
  useEffect(() => {
    setActiveTab(requestedTab);
  }, [requestedTab]);

  // On narrow screens the tab list scrolls; keep the open tab fully visible
  // (deep links, "Requires …" links). Only the list scrolls, never the page.
  useEffect(() => {
    const list = tabsRef.current?.querySelector('[role="tablist"]');
    const tab = list?.querySelector('[role="tab"][aria-selected="true"]');
    if (!list || !tab) return;
    const delta = getRevealScrollDelta(list.getBoundingClientRect(), tab.getBoundingClientRect());
    if (delta) list.scrollLeft += delta;
  }, [activeTab, form.loading]);

  const focusActiveTab = useCallback(() => {
    if (typeof window === 'undefined') return;
    // After Discard the trigger is disabled; keep keyboard focus in the page.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      tabsRef.current?.querySelector('[role="tab"][aria-selected="true"]')?.focus();
    }));
  }, []);

  // A successful save disables Save, which would drop keyboard focus to
  // <body>; it moves to the open tab, as after Discard.
  const handleSaveClick = useCallback(async () => {
    if (await form.handleSave()) focusActiveTab();
  }, [form.handleSave, focusActiveTab]);

  const changeTab = useCallback((tab) => {
    const next = resolveSettingsTab(tab);
    setActiveTab(next);
    writeTabToAddressBar(next);
  }, []);

  const navigation = useMemo(() => ({
    selectTab: (tab) => {
      changeTab(tab);
      focusActiveTab();
    },
  }), [changeTab, focusActiveTab]);

  const title = t('settings.config.title', 'Session Manager configuration');
  const subtitle = t('settings.config.subtitle', 'Applies to all end-user sessions of this Strapi instance.');

  if (form.loading) {
    return <Page.Loading />;
  }

  // A failed load never shows the form, so defaults cannot be saved over the
  // stored settings (IA G).
  if (form.loadError) {
    return (
      <PageShell headingId={HEADING_ID} title={title} subtitle={subtitle}>
        <Alert
          variant="danger"
          title=""
          closeLabel={t('common.close', 'Close')}
          action={<Button variant="secondary" onClick={form.fetchSettings}>{t('settings.config.load.retry', 'Try again')}</Button>}
        >
          <ReadableText variant="omega" tag="span">
            {t('settings.config.load.error', 'Settings could not be loaded. Nothing can be saved until they load.')}
          </ReadableText>
        </Alert>
      </PageShell>
    );
  }

  return (
    <PageShell
      headingId={HEADING_ID}
      title={title}
      subtitle={subtitle}
      primaryAction={(
        <Flex gap={2} wrap="wrap">
          <ConfirmAction
            variant="danger"
            disabled={!form.hasChanges || form.saving}
            trigger={(
              <Button variant="secondary" disabled={!form.hasChanges || form.saving}>
                {t('settings.config.discard', 'Discard changes')}
              </Button>
            )}
            title={t('settings.config.discard.confirmTitle', 'Discard unsaved changes?')}
            body={t('settings.config.discard.confirmBody', 'Your changes on all tabs are lost.')}
            confirmLabel={t('settings.config.discard.confirmAction', 'Discard')}
            onConfirm={() => {
              form.handleReset();
              focusActiveTab();
            }}
          />
          <Button
            onClick={handleSaveClick}
            loading={form.saving}
            startIcon={<Check aria-hidden focusable={false} />}
            disabled={!form.canSave}
          >
            {t('settings.config.save', 'Save')}
          </Button>
        </Flex>
      )}
    >
      <SettingsNavigationProvider value={navigation}>
        <Flex direction="column" alignItems="stretch" gap={6}>
          {form.errorCount > 0 ? (
            <Alert variant="danger" closeLabel={t('common.close', 'Close')} title="">
              {t('settings.validation.summary', 'Fix {count, plural, one {# field} other {# fields}} before saving.', { count: form.errorCount })}
            </Alert>
          ) : null}

          <Tabs.Root
            ref={tabsRef}
            variant="simple"
            value={activeTab}
            onValueChange={changeTab}
            hasError={form.errorTab}
          >
            <SettingsTabsList aria-label={t('settings.config.tabs.label', 'Configuration sections')}>
              {SETTINGS_TAB_IDS.map((tab) => (
                <Tabs.Trigger key={tab} value={tab}>
                  {t(SETTINGS_TAB_LABELS[tab][0], SETTINGS_TAB_LABELS[tab][1])}
                </Tabs.Trigger>
              ))}
            </SettingsTabsList>
            {/* All panels stay mounted (hidden) so drafts, local key state and validation survive tab switches. */}
            {SETTINGS_TAB_IDS.map((tab) => {
              const TabPanel = TAB_COMPONENTS[tab];
              return (
                <Tabs.Content key={tab} value={tab} forceMount hidden={activeTab !== tab}>
                  <TabPanelFrame data-settings-tab-panel="">
                    <Flex direction="column" alignItems="stretch" paddingTop={6}>
                      <TabPanel form={form} />
                    </Flex>
                  </TabPanelFrame>
                </Tabs.Content>
              );
            })}
            {/*
              Strapi's Form only carries the draft for the native Blocker. It
              stays empty on purpose: wrapping the fields in a <form> would turn
              DS Tag remove buttons (no type attribute) into submit buttons that
              fire on Enter in any text field.
            */}
            <Form method="PUT" initialValues={form.savedSettings}>
              <DraftSync values={form.settings} />
              <Blocker />
            </Form>
          </Tabs.Root>

          <Typography variant="pi" textColor="neutral600" tag="p" data-settings-footer="">
            {t('settings.config.footer', 'Saved in the database. Other server processes apply changes within 30 seconds.')}
          </Typography>
        </Flex>
      </SettingsNavigationProvider>
    </PageShell>
  );
};

export default SettingsPage;
