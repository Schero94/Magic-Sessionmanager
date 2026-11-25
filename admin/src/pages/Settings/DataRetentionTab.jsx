import { Button, Flex, SingleSelect, SingleSelectOption } from '@strapi/design-system';
import { useRBAC } from '@strapi/strapi/admin';
import FormField from '../../components/FormField';
import SettingsToggleRow from '../../components/SettingsToggleRow';
import pluginPermissions from '../../permissions';
import { RETENTION_PRESETS, currentRetentionPreset } from '../../utils/signalsForm.mjs';
import { Trash } from '@strapi/icons';
import styled from 'styled-components';
import { ConfirmAction, EqualGrid, SectionCard } from '../../components/ui';
import ReadableText from '../../components/ReadableText';
import { SELECT_PRESETS } from './settingsTabs.mjs';
import { IntroText, PresetSelect, ProtectedNotice } from './SettingsBlocks';
import { useOptionLabels } from './hooks/useOptionLabels';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

/**
 * The danger action keeps its label on one line. Beside the description it
 * would otherwise shrink first and break "Delete ended sessions" over two
 * lines (768 px with the Settings sub-navigation).
 */
const DangerButton = styled(Button)`
  flex: none;
  white-space: nowrap;
`;

/**
 * Tab "Data and retention" (IA F Tab 5): how long session history is kept,
 * and the danger card that deletes all ended sessions now (IA E.1).
 *
 * @param {{ form: ReturnType<typeof import('./hooks/useSettingsForm').useSettingsForm> }} props Settings form.
 * @returns {import('react').ReactElement} Tab content.
 */
const DataRetentionTab = ({ form }) => {
  const { t } = useSettingsTranslate();
  const units = useOptionLabels();
  const { settings, handleChange, handleCleanInactive } = form;
  // The security log retention is changed only by admins who may see the log
  // and change protected settings (4.17).
  const {
    allowedActions: { canRead: canReadLog },
  } = useRBAC(pluginPermissions.adminActivityRead);
  const locked = form.canChangeProtected === false;
  const canChangeLogRetention = canReadLog && !locked;
  const preset = currentRetentionPreset(settings);
  const applyPreset = (key) => {
    const values = RETENTION_PRESETS[key];
    if (!values) return;
    handleChange('retentionDays', values.retentionDays);
    if (canChangeLogRetention) {
      handleChange('securityLogRetentionDays', values.securityLogRetentionDays);
    }
  };

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <IntroText>
        {t(
          'settings.config.retention.intro',
          'Ended sessions stay in the history until they are deleted. The tokens of deleted sessions stay revoked.'
        )}
      </IntroText>

      <SectionCard title={t('settings.config.retention.title', 'History retention')}>
        <EqualGrid columns={2} stackBelow="medium" gap={6}>
          <FormField
            id="retention-preset"
            name="retentionPreset"
            label={t('settings.config.retention.preset.label', 'Retention preset')}
            description={
              canChangeLogRetention
                ? t(
                    'settings.config.retention.preset.hint',
                    'Sets how long ended sessions and security events are kept. You can still change each value.'
                  )
                : t(
                    'settings.config.retention.preset.hintSessionsOnly',
                    'Sets how long ended sessions are kept. The security log retention needs "View admin activity" and "Change protected settings".'
                  )
            }
          >
            <SingleSelect value={preset} onChange={(value) => applyPreset(value)}>
              <SingleSelectOption value="minimal">
                {t('settings.config.retention.preset.minimal', 'Minimal: 7 days, events 30 days')}
              </SingleSelectOption>
              <SingleSelectOption value="standard">
                {t(
                  'settings.config.retention.preset.standard',
                  'Standard: 90 days, events 90 days'
                )}
              </SingleSelectOption>
              <SingleSelectOption value="extended">
                {t(
                  'settings.config.retention.preset.extended',
                  'Extended: 365 days, events 365 days'
                )}
              </SingleSelectOption>
              <SingleSelectOption value="custom" disabled>
                {t('settings.config.retention.preset.custom', 'Custom values')}
              </SingleSelectOption>
            </SingleSelect>
          </FormField>
          <PresetSelect
            id="session-retention-period"
            name="retentionDays"
            label={t('settings.config.retention.keep.label', 'Keep ended sessions for')}
            description={t(
              'settings.config.retention.keep.hint',
              "Checked once a day, the first time about 24 hours after the server starts. Open sessions are never deleted by retention. 'Forever' keeps them."
            )}
            value={settings.retentionDays}
            presets={SELECT_PRESETS.retentionDays}
            format={units.retentionDays}
            onChange={(value) => handleChange('retentionDays', value)}
          />
        </EqualGrid>
      </SectionCard>

      <SectionCard
        title={t('settings.config.privacy.title', 'Privacy')}
        subtitle={t(
          'settings.config.privacy.intro',
          'What Session Manager records about app users. The README has a fact sheet for data protection and works councils.'
        )}
      >
        <SettingsToggleRow
          id="session-ip-anonymize"
          title={t('settings.config.privacy.shortIp.label', 'Shorten IP addresses of sessions')}
          description={t(
            'settings.config.privacy.shortIp.hint',
            'Stores 203.0.113.0 instead of 203.0.113.42 (IPv6: the first 48 bits) for new sessions. Country rules and lockouts still use the full address while the request runs. Existing sessions are not changed.'
          )}
          checked={settings.sessionIpAnonymize === true}
          disabled={locked}
          onChange={(checked) => handleChange('sessionIpAnonymize', checked)}
        />
        {locked ? <ProtectedNotice /> : null}
      </SectionCard>

      <SectionCard
        title={t('settings.config.deleteEnded.title', 'Delete ended sessions')}
        tone="danger"
      >
        <Flex
          direction={{ initial: 'column', small: 'row' }}
          alignItems={{ initial: 'flex-start', small: 'center' }}
          justifyContent="space-between"
          gap={4}
          data-danger-zone=""
        >
          <ReadableText variant="pi" textColor="neutral600" tag="p">
            {t(
              'settings.config.deleteEnded.description',
              'Deletes the records of all ended sessions of all users now. Open sessions, including idle ones, stay.'
            )}
          </ReadableText>
          <ConfirmAction
            trigger={
              <DangerButton
                variant="danger-light"
                startIcon={<Trash aria-hidden focusable={false} />}
              >
                {t('settings.config.deleteEnded.action', 'Delete ended sessions')}
              </DangerButton>
            }
            title={t('settings.config.deleteEnded.confirmTitle', 'Delete all ended sessions?')}
            body={t(
              'settings.config.deleteEnded.confirmBody',
              'The records of every ended session of every user are removed permanently from history, statistics and exports. Open sessions, including idle ones, are not affected. This cannot be undone.'
            )}
            confirmLabel={t('settings.config.deleteEnded.action', 'Delete ended sessions')}
            onConfirm={handleCleanInactive}
          />
        </Flex>
      </SectionCard>
    </Flex>
  );
};

export default DataRetentionTab;
