import { Flex } from '@strapi/design-system';
import { EqualGrid, SectionCard } from '../../components/ui';
import ReadableText from '../../components/ReadableText';
import SettingsToggleRow from '../../components/SettingsToggleRow';
import { SELECT_PRESETS } from './settingsTabs.mjs';
import { IntroText, PresetSelect, RequiresNotice } from './SettingsBlocks';
import { useOptionLabels } from './hooks/useOptionLabels';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

/**
 * Tab "Admin activity" (4.15): what the security log records about admin
 * panel users, and how IP addresses and retention are handled for the whole
 * log. Only admins with "View admin activity" see this tab; the server
 * rejects changes from anyone else. The works-council note sits directly
 * under the switch that turns activity recording on.
 *
 * @param {{ form: ReturnType<typeof import('./hooks/useSettingsForm').useSettingsForm> }} props Settings form.
 * @returns {import('react').ReactElement} Tab content.
 */
const AdminActivityTab = ({ form }) => {
  const { t } = useSettingsTranslate();
  const units = useOptionLabels();
  const { settings, handleChange } = form;

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <IntroText>
        {t(
          'settings.config.adminActivity.intro',
          'The security log records sign-ins and work in this admin panel. Each admin’s history is under Session Manager > Admin panel; only admins with “View admin activity” can open it.'
        )}
      </IntroText>

      <SectionCard title={t('settings.config.adminActivity.recording.title', 'What is recorded')}>
        <SettingsToggleRow
          id="admin-sign-in-history"
          title={t('settings.config.adminActivity.signIns.label', 'Record admin sign-ins')}
          description={t(
            'settings.config.adminActivity.signIns.hint',
            'Every sign-in, failed attempt, lockout and sign-out, and who signed out whom, with time, browser and operating system.'
          )}
          checked={settings.adminSignInHistory}
          onChange={(checked) => handleChange('adminSignInHistory', checked)}
        />
        <SettingsToggleRow
          id="admin-content-activity"
          title={t(
            'settings.config.adminActivity.content.label',
            'Record Content Manager activity'
          )}
          description={t(
            'settings.config.adminActivity.content.hint',
            'Which entries each admin opens, creates, edits, publishes, unpublishes or deletes, with content type, title, locale and time.'
          )}
          checked={settings.adminContentActivity}
          onChange={(checked) => handleChange('adminContentActivity', checked)}
        >
          <ReadableText variant="pi" textColor="neutral700" tag="p" data-privacy-note="">
            {t(
              'settings.config.adminActivity.content.notice',
              'This records how people work. In many countries employees must be told first, and in Germany the works council usually has a say. Check this before you turn it on.'
            )}
          </ReadableText>
        </SettingsToggleRow>
      </SectionCard>

      <SectionCard
        title={t('settings.config.adminActivity.privacy.title', 'IP addresses and retention')}
        subtitle={t(
          'settings.config.adminActivity.privacy.subtitle',
          'These options apply to every event in the security log.'
        )}
      >
        <SettingsToggleRow
          id="security-log-store-ip"
          title={t('settings.config.adminActivity.storeIp.label', 'Store IP addresses')}
          description={t(
            'settings.config.adminActivity.storeIp.hint',
            'The address comes from Strapi’s client IP (server.proxy settings). The location uses the IP location lookup under Location data.'
          )}
          checked={settings.securityLogStoreIp}
          onChange={(checked) => handleChange('securityLogStoreIp', checked)}
        />
        <SettingsToggleRow
          id="security-log-anonymize-ip"
          title={t(
            'settings.config.adminActivity.anonymize.label',
            'Anonymise the last part of IP addresses'
          )}
          description={t(
            'settings.config.adminActivity.anonymize.hint',
            'Stores 203.0.113.0 instead of 203.0.113.42 (IPv6: the first 48 bits only).'
          )}
          checked={settings.securityLogAnonymizeIp}
          disabled={!settings.securityLogStoreIp}
          onChange={(checked) => handleChange('securityLogAnonymizeIp', checked)}
        >
          {!settings.securityLogStoreIp ? (
            <RequiresNotice>
              {t('settings.config.adminActivity.requiresIp', 'Requires Store IP addresses')}
            </RequiresNotice>
          ) : null}
        </SettingsToggleRow>
        <EqualGrid columns={2} stackBelow="medium" gap={6}>
          <PresetSelect
            id="security-log-retention"
            name="securityLogRetentionDays"
            label={t('settings.config.adminActivity.retention.label', 'Keep security events for')}
            description={t(
              'settings.config.adminActivity.retention.hint',
              'Older events are deleted once a day. Events of a deleted admin are deleted with the account.'
            )}
            value={settings.securityLogRetentionDays}
            presets={SELECT_PRESETS.securityLogRetentionDays}
            format={units.days}
            onChange={(value) => handleChange('securityLogRetentionDays', value)}
          />
        </EqualGrid>
      </SectionCard>
    </Flex>
  );
};

export default AdminActivityTab;
