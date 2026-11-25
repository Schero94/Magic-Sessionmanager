import { EqualGrid, SectionCard } from '../../components/ui';
import ReadableText from '../../components/ReadableText';
import SettingsToggleRow from '../../components/SettingsToggleRow';
import { SELECT_PRESETS } from './settingsTabs.mjs';
import { PresetSelect, RequiresNotice } from './SettingsBlocks';
import { useOptionLabels } from './hooks/useOptionLabels';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

/**
 * Security log sections of "Data and retention" (4.15 as its own tab "Admin
 * activity", moved in 4.23.1): what the security log records about admin
 * panel users, and how IP addresses and retention are handled for the whole
 * log. Rendered only for admins with "View admin activity"; the server
 * rejects changes from anyone else. The works-council note sits directly
 * under the switch that turns activity recording on.
 *
 * @param {{ form: ReturnType<typeof import('./hooks/useSettingsForm').useSettingsForm> }} props Settings form.
 * @returns {import('react').ReactElement} Two section cards.
 */
const SecurityLogSettings = ({ form }) => {
  const { t } = useSettingsTranslate();
  const units = useOptionLabels();
  const { settings, handleChange } = form;
  // The security log settings are protected (4.17): admin-activity.read and settings.update.
  const locked = form.canChangeProtected === false;

  return (
    <>
      <SectionCard
        title={t('settings.config.adminActivity.recording.title', 'Security log: what is recorded')}
        subtitle={t(
          'settings.config.adminActivity.intro',
          'The security log records sign-ins and work in this admin panel. Each admin’s history is under Session Manager › Admin panel; only admins with “View admin activity” can open it.'
        )}
      >
        <SettingsToggleRow
          id="admin-sign-in-history"
          title={t('settings.config.adminActivity.signIns.label', 'Record admin sign-ins')}
          description={t(
            'settings.config.adminActivity.signIns.hint',
            'Every sign-in, failed attempt, lockout and sign-out, and who signed out whom, with time, browser and operating system.'
          )}
          checked={settings.adminSignInHistory}
          disabled={locked}
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
            'Which entries each admin opens, creates, edits, publishes, unpublishes or deletes, with content type, locale and time. Entry titles are not stored; the list shows them only to admins who may open the entry.'
          )}
          checked={settings.adminContentActivity}
          disabled={locked}
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
        title={t(
          'settings.config.adminActivity.privacy.title',
          'Security log: IP addresses and retention'
        )}
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
          disabled={locked}
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
          disabled={locked || !settings.securityLogStoreIp}
          onChange={(checked) => handleChange('securityLogAnonymizeIp', checked)}
        >
          {!settings.securityLogStoreIp ? (
            <RequiresNotice>
              {t('settings.config.adminActivity.requiresIp', 'Requires Store IP addresses')}
            </RequiresNotice>
          ) : null}
        </SettingsToggleRow>
        <SettingsToggleRow
          id="security-log-geo-lookup"
          title={t(
            'settings.config.adminActivity.geoLookup.label',
            'Look up the location of security events'
          )}
          description={t(
            'settings.config.adminActivity.geoLookup.hint',
            'Shows country and city next to each sign-in. Only the anonymised address is looked up, in the local GeoIP database; it goes to ipapi.co only if you chose ipapi.co as provider under Location data.'
          )}
          checked={settings.securityLogGeoLookup}
          disabled={locked || !settings.securityLogStoreIp}
          onChange={(checked) => handleChange('securityLogGeoLookup', checked)}
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
              'At least 7 days. Older events are deleted once a day; each deletion is itself recorded. Events of a deleted admin are deleted with the account.'
            )}
            value={settings.securityLogRetentionDays}
            presets={SELECT_PRESETS.securityLogRetentionDays}
            format={units.days}
            disabled={locked}
            onChange={(value) => handleChange('securityLogRetentionDays', value)}
          />
        </EqualGrid>
      </SectionCard>
    </>
  );
};

export default SecurityLogSettings;
