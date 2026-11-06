import { Alert as DesignSystemAlert, Badge, Flex, SingleSelect, SingleSelectOption, Typography } from '@strapi/design-system';
import styled from 'styled-components';
import { EqualGrid, SectionCard } from '../../components/ui';
import FormField from '../../components/FormField';
import { ReadableParagraphs } from '../../components/ReadableText';
import SettingsToggleRow from '../../components/SettingsToggleRow';
import { SELECT_PRESETS } from './settingsTabs.mjs';
import EncryptionKeyCard, { useEncryptionKeyDraft } from './EncryptionKeyCard';
import { AdvancedSection, IntroText, PresetSelect, TermList } from './SettingsBlocks';
import { useOptionLabels } from './hooks/useOptionLabels';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

/**
 * The DS Alert puts title and body on one row. The relaxed-mode body takes
 * its own full-width row under the title. Only the DS role container is
 * targeted; a source-contract test pins this override (SET-17).
 */
const RelaxedModeAlert = styled(DesignSystemAlert)`
  [role='status'] > p {
    flex: 0 0 100%;
    width: 100%;
    min-width: 0;
  }

  /* The DS close button is a bare 16 px icon; its hit area grows to 32 px
     while negative margins keep the icon where the DS draws it. */
  & > button:last-child {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: ${({ theme }) => theme.spaces[7]};
    min-height: ${({ theme }) => theme.spaces[7]};
    margin: -${({ theme }) => theme.spaces[2]};
    border-radius: ${({ theme }) => theme.borderRadius};
  }
`;

/** Session end reasons sent in X-Session-Terminated-Reason (IA A.4, F 1.3). */
const REJECTION_REASONS = [
  ['logout', 'settings.config.rejected.reason.logout', 'The user signed out.'],
  ['manual', 'settings.config.rejected.reason.manual', 'Ended from the Strapi admin, or by the user from another of their devices.'],
  ['idle', 'settings.config.rejected.reason.idle', 'Not used for longer than the inactivity timeout.'],
  ['expired', 'settings.config.rejected.reason.expired', 'Reached the maximum session age.'],
  ['blocked', 'settings.config.rejected.reason.blocked', 'Ended because the user account was blocked.'],
];

/**
 * Reason codes as a locale "or" list ("logout, manual, idle, expired or blocked").
 * The codes are protocol values and stay untranslated.
 *
 * @param {string} locale Admin locale.
 * @returns {string} Joined codes.
 */
const formatReasonCodes = (locale) => {
  const codes = REJECTION_REASONS.map(([code]) => code);
  try {
    return new Intl.ListFormat(locale || 'en', { style: 'long', type: 'disjunction' }).format(codes);
  } catch {
    return codes.join(', ');
  }
};


/**
 * Tab "Sessions" (IA F Tab 1): how long a session stays valid, the token
 * check with its advanced options, and what an app receives when a session
 * is rejected.
 *
 * @param {{ form: ReturnType<typeof import('./hooks/useSettingsForm').useSettingsForm> }} props Settings form.
 * @returns {import('react').ReactElement} Tab content.
 */
const SessionsTab = ({ form }) => {
  const { t, locale } = useSettingsTranslate();
  const units = useOptionLabels();
  const encryptionKeyDraft = useEncryptionKeyDraft();
  const { settings, handleChange, relaxedWarningDismissed, setRelaxedWarningDismissed } = form;
  const lastSeenTooSlow = Number(settings.lastSeenRateLimit) * 2 > Number(settings.inactivityTimeout) * 60;

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <IntroText>
        {t('settings.config.sessions.intro', "These rules decide when an end user's session ends. They are checked on every request the user makes.")}
      </IntroText>

      <SectionCard
        title={t('settings.config.sessions.lifetime.title', 'Session lifetime')}
        subtitle={t('settings.config.sessions.lifetime.intro', 'A session ends when it is unused for too long or reaches its maximum age.')}
      >
        <EqualGrid columns={2} stackBelow="medium" gap={6}>
          <PresetSelect
            id="inactivity-timeout"
            name="inactivityTimeout"
            label={t('settings.config.sessions.inactivity.label', 'Inactivity timeout')}
            description={t(
              'settings.config.sessions.inactivity.hint',
              "A session unused for this long becomes idle and ends as 'Timed out' on its next request or at the next idle check. Also decides who counts as online."
            )}
            value={settings.inactivityTimeout}
            presets={SELECT_PRESETS.inactivityTimeout}
            format={units.minutes}
            onChange={(value) => handleChange('inactivityTimeout', value)}
          />
          <PresetSelect
            id="max-session-age"
            name="maxSessionAgeDays"
            label={t('settings.config.sessions.maxAge.label', 'Maximum session age')}
            description={t(
              'settings.config.sessions.maxAge.hint',
              "Counted from sign-in, regardless of activity. Applied on the session's next request; until then the session can still show as active or idle."
            )}
            value={settings.maxSessionAgeDays}
            presets={SELECT_PRESETS.maxSessionAgeDays}
            format={units.days}
            onChange={(value) => handleChange('maxSessionAgeDays', value)}
          />
        </EqualGrid>

        <AdvancedSection>
          <EqualGrid columns={2} stackBelow="medium" gap={6}>
            <Flex direction="column" alignItems="stretch" gap={2}>
              <PresetSelect
                id="last-seen-rate-limit"
                name="lastSeenRateLimit"
                label={t('settings.config.sessions.lastSeen.label', 'Update "Last active" at most every')}
                description={t(
                  'settings.config.sessions.lastSeen.hint',
                  "Lower values make 'Last active' and idle detection more precise but write to the database more often."
                )}
                value={settings.lastSeenRateLimit}
                presets={SELECT_PRESETS.lastSeenRateLimit}
                format={units.seconds}
                onChange={(value) => handleChange('lastSeenRateLimit', value)}
              />
              {lastSeenTooSlow ? (
                <Typography variant="pi" textColor="warning700" tag="p" aria-live="polite">
                  {t(
                    'settings.config.sessions.lastSeen.warning',
                    'This is not clearly shorter than the inactivity timeout, so sessions in use can show as idle.'
                  )}
                </Typography>
              ) : null}
            </Flex>
            <PresetSelect
              id="cleanup-interval"
              name="cleanupInterval"
              label={t('settings.config.sessions.idleCheck.label', 'Run idle check every')}
              description={t(
                'settings.config.sessions.idleCheck.hint',
                "The idle check ends idle sessions as 'Timed out'. It deletes nothing. It also runs once at server start."
              )}
              value={settings.cleanupInterval}
              presets={SELECT_PRESETS.cleanupInterval}
              format={units.minutes}
              onChange={(value) => handleChange('cleanupInterval', value)}
            />
            <FormField
              id="cleanup-strategy"
              name="cleanupUseDbDirect"
              label={t('settings.config.sessions.idleMethod.label', 'Idle check method')}
              description={t(
                'settings.config.sessions.idleMethod.hint',
                "Direct SQL is faster but skips lifecycle hooks. Ignored when Strapi's refresh-token mode is on."
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
        </AdvancedSection>
      </SectionCard>

      <SectionCard
        title={t('settings.config.token.title', 'Token check')}
        subtitle={t(
          'settings.config.token.intro',
          'Decides what happens to a token that Session Manager has no record for. Ended, expired and revoked sessions and blocked users are always rejected.'
        )}
        action={(
          <Badge
            backgroundColor={settings.strictSessionEnforcement ? 'success100' : 'neutral150'}
            textColor={settings.strictSessionEnforcement ? 'success700' : 'neutral700'}
          >
            {settings.strictSessionEnforcement
              ? t('settings.config.token.strict', 'Strict')
              : t('settings.config.token.relaxed', 'Relaxed')}
          </Badge>
        )}
      >
        <SettingsToggleRow
          id="strict-session-enforcement"
          title={t('settings.config.token.check.label', 'Strict token check')}
          description={t(
            'settings.config.token.check.hint',
            'Rejects tokens without a session record and requests where the check itself fails.'
          )}
          checked={settings.strictSessionEnforcement}
          onChange={(checked) => handleChange('strictSessionEnforcement', checked)}
        />

        {!settings.strictSessionEnforcement && !relaxedWarningDismissed && (
          <RelaxedModeAlert
            variant="warning"
            closeLabel={t('common.close', 'Close')}
            onClose={() => setRelaxedWarningDismissed(true)}
            title={t('settings.config.token.relaxed', 'Relaxed')}
          >
            <ReadableParagraphs
              variant="omega"
              textColor="neutral800"
              tag="span"
              text={t(
                'settings.config.token.relaxedWarning',
                'Tokens without a session record are accepted. If the check itself fails, up to 10 requests per minute are still allowed.'
              )}
            />
          </RelaxedModeAlert>
        )}

        <AdvancedSection>
          <EqualGrid columns={2} stackBelow="medium" gap={6}>
            <PresetSelect
              id="session-creation-grace-period"
              name="sessionCreationGraceMs"
              label={t('settings.config.token.grace.label', 'Grace period after sign-in')}
              description={t(
                'settings.config.token.grace.hint',
                "Accepts a new token for a few seconds while its session record is being created. Only for tokens without a session record. Not used when Strapi's refresh-token mode (jwtManagement: 'refresh') is on."
              )}
              value={settings.sessionCreationGraceMs ?? 5000}
              presets={SELECT_PRESETS.sessionCreationGraceMs}
              format={units.graceMs}
              onChange={(value) => handleChange('sessionCreationGraceMs', value)}
            />
            <EncryptionKeyCard draft={encryptionKeyDraft} copyValue={form.copyValue} notify={form.notify} />
          </EqualGrid>
        </AdvancedSection>
      </SectionCard>

      <SectionCard
        title={t('settings.config.rejected.title', 'When a session is rejected')}
        subtitle={t('settings.config.rejected.intro', 'What your app receives when a request uses an ended session.')}
      >
        <ReadableParagraphs
          variant="omega"
          textColor="neutral700"
          tag="p"
          text={t(
            'settings.config.rejected.body',
            'The response is 401 with the header {header} and the reason: {reasons}.',
            { header: 'X-Session-Terminated-Reason', reasons: formatReasonCodes(locale) }
          )}
        />
        <TermList
          code
          label={t('settings.config.rejected.title', 'When a session is rejected')}
          items={REJECTION_REASONS.map(([code, id, defaultMessage]) => ({
            id: code,
            term: code,
            description: t(id, defaultMessage),
          }))}
        />
      </SectionCard>
    </Flex>
  );
};

export default SessionsTab;
