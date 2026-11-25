import { Flex } from '@strapi/design-system';
import { useRBAC } from '@strapi/strapi/admin';
import { SectionCard } from '../../components/ui';
import ReadableText from '../../components/ReadableText';
import SettingsToggleRow from '../../components/SettingsToggleRow';
import ActiveImpersonationsCard from '../../components/impersonation/ActiveImpersonationsCard';
import pluginPermissions from '../../permissions';
import { IntroText, ProtectedNotice } from './SettingsBlocks';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

/**
 * Tab "Impersonation" (4.20): the switch that allows admins with "Impersonate
 * app users" to act as an app user for a limited time, the privacy note next
 * to it, and the list of running impersonations with End. The switch is a
 * protected setting (`settings.update`); the list needs the impersonate
 * permission.
 *
 * @param {{ form: ReturnType<typeof import('./hooks/useSettingsForm').useSettingsForm> }} props Settings form.
 * @returns {import('react').ReactElement} Tab content.
 */
const ImpersonationTab = ({ form }) => {
  const { t } = useSettingsTranslate();
  const { settings, handleChange } = form;
  const locked = form.canChangeProtected === false;
  const {
    isLoading,
    allowedActions: { canUsers },
  } = useRBAC(pluginPermissions.impersonateUsers);

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <IntroText>
        {t(
          'settings.impersonation.intro',
          'Support staff can act as an app user for up to an hour to reproduce a problem, with a reason that is recorded. Who may do this is set per role under Settings > Roles > Session Manager.'
        )}
      </IntroText>
      {locked ? <ProtectedNotice /> : null}

      <SectionCard title={t('settings.impersonation.title', 'Impersonation of app users')}>
        <SettingsToggleRow
          id="impersonation-enabled"
          title={t('settings.impersonation.enable.label', 'Allow impersonation')}
          description={t(
            'settings.impersonation.enable.hint',
            'Off by default. Turning it off ends every running impersonation at once.'
          )}
          checked={settings.impersonationEnabled === true}
          disabled={locked}
          onChange={(checked) => handleChange('impersonationEnabled', checked)}
        >
          <ReadableText variant="pi" textColor="neutral700" tag="p" data-privacy-note="">
            {t(
              'settings.impersonation.notice',
              'Acting as a person processes their personal data. Tell your users in the privacy notice, and in Germany check whether the works council must agree, because the log shows what each admin did.'
            )}
          </ReadableText>
        </SettingsToggleRow>
      </SectionCard>

      {!isLoading && canUsers ? <ActiveImpersonationsCard /> : null}
    </Flex>
  );
};

export default ImpersonationTab;
