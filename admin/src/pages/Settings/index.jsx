import { useEffect, useRef, useState } from 'react';
import { Button, Flex, Loader, Tabs } from '@strapi/design-system';
import { Blocker, Form, useForm } from '@strapi/strapi/admin';
import { Check } from '@strapi/icons';
import styled from 'styled-components';
import { ConfirmAction, PageShell } from '../../components/ui';
import ReadableText from '../../components/ReadableText';
import Alert from '../../components/PersistentAlert';
import { SETTINGS_TABS } from '../../utils/settingsForm.mjs';
import GeneralTab from './GeneralTab';
import SecurityTab from './SecurityTab';
import GeofencingTab from './GeofencingTab';
import NotificationsTab from './NotificationsTab';
import { useSettingsForm } from './hooks/useSettingsForm';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

const HEADING_ID = 'magic-sessionmanager-settings-title';

/** Tab triggers wrap onto a second row on narrow screens instead of overflowing. */
const SettingsTabsList = styled(Tabs.List)`
  flex-wrap: wrap;
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
`;

const TAB_LABELS = {
  general: ['settings.tabs.general', 'General'],
  security: ['settings.tabs.security', 'Security'],
  geofencing: ['settings.tabs.geofencing', 'Geofencing'],
  notifications: ['settings.tabs.notifications', 'Notifications'],
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
 * Session Manager settings: header actions, unsaved-changes guard and four
 * DS tabs (General, Security, Geofencing, Notifications).
 *
 * @returns {import('react').ReactElement} Settings page.
 */
const SettingsPage = () => {
  const { t } = useSettingsTranslate();
  const form = useSettingsForm();
  const [activeTab, setActiveTab] = useState('general');
  const tabsRef = useRef(null);

  const title = t('settings.title', 'Session Manager Settings');
  const subtitle = t('settings.subtitle', 'Configure session tracking, security, and email notifications');

  if (form.loading) {
    return (
      <PageShell headingId={HEADING_ID} title={title} subtitle={subtitle}>
        <Flex justifyContent="center" padding={8}>
          <Loader>{t('common.loading', 'Loading...')}</Loader>
        </Flex>
      </PageShell>
    );
  }

  if (form.loadError) {
    return (
      <PageShell headingId={HEADING_ID} title={title} subtitle={subtitle}>
        <Alert
          variant="danger"
          title={t('settings.error.loadTitle', 'Settings could not be loaded')}
          closeLabel={t('common.close', 'Close')}
          action={<Button variant="secondary" onClick={form.fetchSettings}>{t('common.retry', 'Retry')}</Button>}
        >
          <ReadableText variant="omega" tag="span">
            {t('settings.error.loadDescription', 'Try again before changing settings.')}
          </ReadableText>
        </Alert>
      </PageShell>
    );
  }

  const focusActiveTab = () => {
    if (typeof window === 'undefined') return;
    // After Reset the trigger is disabled; keep keyboard focus in the page.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      tabsRef.current?.querySelector('[role="tab"][aria-selected="true"]')?.focus();
    }));
  };

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
              <Button variant="tertiary" disabled={!form.hasChanges || form.saving}>
                {t('settings.reset', 'Reset')}
              </Button>
            )}
            title={t('settings.reset.confirmTitle', 'Discard unsaved changes?')}
            body={t('settings.reset.confirmBody', 'All changes on every tab are discarded and the saved settings are shown again.')}
            confirmLabel={t('settings.reset.confirmAction', 'Discard changes')}
            onConfirm={() => {
              form.handleReset();
              focusActiveTab();
            }}
          />
          <Button
            onClick={form.handleSave}
            loading={form.saving}
            startIcon={<Check aria-hidden focusable={false} />}
            disabled={!form.canSave}
          >
            {t('settings.save', 'Save Changes')}
          </Button>
        </Flex>
      )}
    >
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
          onValueChange={setActiveTab}
          hasError={form.errorTab}
        >
          <SettingsTabsList aria-label={t('settings.tabs.label', 'Settings sections')}>
            {SETTINGS_TABS.map((tab) => (
              <Tabs.Trigger key={tab} value={tab}>
                {t(TAB_LABELS[tab][0], TAB_LABELS[tab][1])}
              </Tabs.Trigger>
            ))}
          </SettingsTabsList>
          {/* All panels stay mounted (hidden) so drafts, local key state and validation survive tab switches. */}
          <Tabs.Content value="general" forceMount hidden={activeTab !== 'general'}>
            <Flex direction="column" alignItems="stretch" paddingTop={6}><GeneralTab form={form} /></Flex>
          </Tabs.Content>
          <Tabs.Content value="security" forceMount hidden={activeTab !== 'security'}>
            <Flex direction="column" alignItems="stretch" paddingTop={6}><SecurityTab form={form} /></Flex>
          </Tabs.Content>
          <Tabs.Content value="geofencing" forceMount hidden={activeTab !== 'geofencing'}>
            <Flex direction="column" alignItems="stretch" paddingTop={6}><GeofencingTab form={form} /></Flex>
          </Tabs.Content>
          <Tabs.Content value="notifications" forceMount hidden={activeTab !== 'notifications'}>
            <Flex direction="column" alignItems="stretch" paddingTop={6}><NotificationsTab form={form} /></Flex>
          </Tabs.Content>
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
      </Flex>
    </PageShell>
  );
};

export default SettingsPage;
