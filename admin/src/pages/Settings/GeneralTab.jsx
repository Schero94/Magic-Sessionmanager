import { Button, Flex, SingleSelect, SingleSelectOption } from '@strapi/design-system';
import { Trash } from '@strapi/icons';
import { ConfirmAction, EqualGrid, SectionCard } from '../../components/ui';
import FormField from '../../components/FormField';
import ReadableText, { ReadableParagraphs } from '../../components/ReadableText';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

/**
 * General tab: session timeout, cleanup and retention, and the danger zone.
 *
 * @param {{ form: ReturnType<typeof import('./hooks/useSettingsForm').useSettingsForm> }} props Settings form.
 * @returns {import('react').ReactElement} Tab content.
 */
const GeneralTab = ({ form }) => {
  const { t } = useSettingsTranslate();
  const { settings, handleChange, handleCleanInactive } = form;

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <SectionCard title={t('settings.general.timeout.title', 'Session timeout')}>
        <EqualGrid columns={2} stackBelow="medium" gap={6}>
          <FormField
            id="inactivity-timeout"
            name="inactivityTimeout"
            label={t('settings.general.timeout.inactivity', 'Inactivity Timeout')}
            description={t('settings.general.timeout.inactivityHint', 'Sessions inactive for more than {minutes} minutes will be marked as offline', { minutes: settings.inactivityTimeout })}
          >
            <SingleSelect
              value={String(settings.inactivityTimeout)}
              onChange={(value) => handleChange('inactivityTimeout', parseInt(value, 10))}
            >
              <SingleSelectOption value="5">{t('settings.general.timeout.5min', '5 minutes (Very Strict)')}</SingleSelectOption>
              <SingleSelectOption value="10">{t('settings.general.timeout.10min', '10 minutes (Strict)')}</SingleSelectOption>
              <SingleSelectOption value="15">{t('settings.general.timeout.15min', '15 minutes (Recommended)')}</SingleSelectOption>
              <SingleSelectOption value="30">{t('settings.general.timeout.30min', '30 minutes (Moderate)')}</SingleSelectOption>
              <SingleSelectOption value="60">{t('settings.general.timeout.1hour', '1 hour (Relaxed)')}</SingleSelectOption>
              <SingleSelectOption value="120">{t('settings.general.timeout.2hours', '2 hours (Very Relaxed)')}</SingleSelectOption>
            </SingleSelect>
          </FormField>

          <FormField
            id="last-seen-rate-limit"
            name="lastSeenRateLimit"
            label={t('settings.general.rateLimit.title', 'Last Seen Rate Limit')}
            description={t('settings.general.rateLimit.hint', 'Prevents excessive database writes. Updates throttled to once every {seconds} seconds', { seconds: settings.lastSeenRateLimit })}
          >
            <SingleSelect
              value={String(settings.lastSeenRateLimit)}
              onChange={(value) => handleChange('lastSeenRateLimit', parseInt(value, 10))}
            >
              <SingleSelectOption value="10">{t('settings.general.rateLimit.10sec', '10 seconds')}</SingleSelectOption>
              <SingleSelectOption value="30">{t('settings.general.rateLimit.30sec', '30 seconds (Recommended)')}</SingleSelectOption>
              <SingleSelectOption value="60">{t('settings.general.rateLimit.1min', '1 minute')}</SingleSelectOption>
              <SingleSelectOption value="120">{t('settings.general.rateLimit.2min', '2 minutes')}</SingleSelectOption>
              <SingleSelectOption value="300">{t('settings.general.rateLimit.5min', '5 minutes')}</SingleSelectOption>
            </SingleSelect>
          </FormField>
        </EqualGrid>
      </SectionCard>

      <SectionCard title={t('settings.general.cleanup.title', 'Cleanup and retention')}>
        <EqualGrid columns={2} stackBelow="medium" gap={6}>
          <FormField
            id="cleanup-interval"
            name="cleanupInterval"
            label={t('settings.general.cleanup.interval', 'Cleanup Interval')}
            description={t('settings.general.cleanup.intervalHint', 'Inactive sessions are automatically cleaned every {minutes} minutes', { minutes: settings.cleanupInterval })}
          >
            <SingleSelect
              value={String(settings.cleanupInterval)}
              onChange={(value) => handleChange('cleanupInterval', parseInt(value, 10))}
            >
              <SingleSelectOption value="15">{t('settings.general.cleanup.15min', '15 minutes')}</SingleSelectOption>
              <SingleSelectOption value="30">{t('settings.general.cleanup.30min', '30 minutes (Recommended)')}</SingleSelectOption>
              <SingleSelectOption value="60">{t('settings.general.cleanup.1hour', '1 hour')}</SingleSelectOption>
              <SingleSelectOption value="120">{t('settings.general.cleanup.2hours', '2 hours')}</SingleSelectOption>
            </SingleSelect>
          </FormField>

          <FormField
            id="session-retention-period"
            name="retentionDays"
            label={t('settings.general.retention.title', 'Retention Period')}
            description={settings.retentionDays === -1
              ? t('settings.general.retention.hintNever', 'Old sessions are never deleted')
              : t('settings.general.retention.hint', 'Old sessions are deleted after {days, plural, one {# day} other {# days}}', { days: settings.retentionDays })}
          >
            <SingleSelect
              value={String(settings.retentionDays)}
              onChange={(value) => handleChange('retentionDays', parseInt(value, 10))}
            >
              <SingleSelectOption value="7">{t('settings.general.retention.7days', '7 days')}</SingleSelectOption>
              <SingleSelectOption value="30">{t('settings.general.retention.30days', '30 days')}</SingleSelectOption>
              <SingleSelectOption value="60">{t('settings.general.retention.60days', '60 days')}</SingleSelectOption>
              <SingleSelectOption value="90">{t('settings.general.retention.90days', '90 days (Recommended)')}</SingleSelectOption>
              <SingleSelectOption value="180">{t('settings.general.retention.180days', '180 days')}</SingleSelectOption>
              <SingleSelectOption value="365">{t('settings.general.retention.1year', '1 year')}</SingleSelectOption>
              <SingleSelectOption value="-1">{t('settings.general.retention.forever', 'Forever')}</SingleSelectOption>
            </SingleSelect>
          </FormField>

          <FormField
            id="session-creation-grace-period"
            name="sessionCreationGraceMs"
            label={t('settings.general.grace.title', 'Post-Login Grace Period')}
            description={t(
              'settings.general.grace.hint',
              'Accepts a freshly-issued JWT without a matching session row for this window, preventing strict-enforcement races right after login.'
            )}
          >
            <SingleSelect
              value={String(settings.sessionCreationGraceMs ?? 5000)}
              onChange={(value) => handleChange('sessionCreationGraceMs', parseInt(value, 10))}
            >
              <SingleSelectOption value="0">{t('settings.general.grace.off', 'Off (strict from first request)')}</SingleSelectOption>
              <SingleSelectOption value="2000">{t('settings.general.grace.2s', '2 seconds')}</SingleSelectOption>
              <SingleSelectOption value="5000">{t('settings.general.grace.5s', '5 seconds (Recommended)')}</SingleSelectOption>
              <SingleSelectOption value="10000">{t('settings.general.grace.10s', '10 seconds')}</SingleSelectOption>
              <SingleSelectOption value="30000">{t('settings.general.grace.30s', '30 seconds')}</SingleSelectOption>
            </SingleSelect>
          </FormField>

          <FormField
            id="cleanup-strategy"
            name="cleanupUseDbDirect"
            label={t('settings.general.cleanupMode.title', 'Cleanup Strategy')}
            description={t(
              'settings.general.cleanupMode.hint',
              'Document Service is the recommended safe strategy. Direct SQL can drain very large idle-session backlogs in one statement but bypasses lifecycle hooks; use it only above 50,000 active sessions.'
            )}
          >
            <SingleSelect
              value={settings.cleanupUseDbDirect ? 'db' : 'document-service'}
              onChange={(value) => handleChange('cleanupUseDbDirect', value === 'db')}
            >
              <SingleSelectOption value="document-service">
                {t('settings.general.cleanupMode.ds', 'Document Service')}
              </SingleSelectOption>
              <SingleSelectOption value="db">
                {t('settings.general.cleanupMode.db', 'Direct SQL')}
              </SingleSelectOption>
            </SingleSelect>
          </FormField>
        </EqualGrid>
      </SectionCard>

      <SectionCard title={t('settings.footer.title', 'Database-Backed Settings')}>
        <ReadableParagraphs
          variant="omega"
          textColor="neutral600"
          tag="p"
          text={t(
            'settings.footer.description',
            'All settings are stored in your Strapi database and shared across all admin users.\n\nChanges take effect immediately - no server restart required!\n\nEmail templates, webhooks, and security options are all managed from this interface.'
          )}
        />
      </SectionCard>

      <SectionCard title={t('settings.general.danger.title', 'Danger Zone')} tone="danger">
        <Flex
          direction={{ initial: 'column', small: 'row' }}
          alignItems={{ initial: 'flex-start', small: 'center' }}
          justifyContent="space-between"
          gap={4}
          data-danger-zone=""
        >
          <ReadableText variant="omega" textColor="neutral700" tag="p">
            {t('settings.general.danger.description', 'Clean All Inactive removes session details while keeping unexpired access-token hashes revoked until expiry.')}
          </ReadableText>
          <ConfirmAction
            trigger={(
              <Button variant="danger-light" startIcon={<Trash aria-hidden focusable={false} />}>
                {t('settings.general.danger.cleanNow', 'Clean Now')}
              </Button>
            )}
            title={t('settings.general.danger.confirmTitle', 'Remove inactive session details?')}
            body={t(
              'settings.general.danger.confirm',
              'Remove all inactive session details? Any unexpired access tokens remain revoked until they expire.'
            )}
            confirmLabel={t('settings.general.danger.cleanNow', 'Clean Now')}
            onConfirm={handleCleanInactive}
          />
        </Flex>
      </SectionCard>
    </Flex>
  );
};

export default GeneralTab;
