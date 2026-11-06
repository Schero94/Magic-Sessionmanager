import { Button, Flex } from '@strapi/design-system';
import { Trash } from '@strapi/icons';
import styled from 'styled-components';
import { ConfirmAction, EqualGrid, SectionCard } from '../../components/ui';
import ReadableText from '../../components/ReadableText';
import { SELECT_PRESETS } from './settingsTabs.mjs';
import { IntroText, PresetSelect } from './SettingsBlocks';
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
