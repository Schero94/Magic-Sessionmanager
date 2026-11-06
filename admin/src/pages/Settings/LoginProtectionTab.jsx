import { Box, Flex, NumberInput, SingleSelect, SingleSelectOption } from '@strapi/design-system';
import { PropertyList, SectionCard } from '../../components/ui';
import FormField from '../../components/FormField';
import ReadableText, { ReadableParagraphs } from '../../components/ReadableText';
import SettingsToggleRow from '../../components/SettingsToggleRow';
import { MAX_FAILED_LOGINS_RANGE } from '../../utils/settingsForm.mjs';
import { fieldHasError } from './settingsTabs.mjs';
import CountryListEditor from './CountryListEditor';
import { AdvancedSection, IntroText, RequiresGeolocation } from './SettingsBlocks';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

/**
 * Tab "Login protection" (IA F Tab 2): which new sign-ins are refused and
 * why. Rules that need IP location lookup stay visible but disabled with a
 * link to Location data while the lookup is off.
 *
 * @param {{ form: ReturnType<typeof import('./hooks/useSettingsForm').useSettingsForm> }} props Settings form.
 * @returns {import('react').ReactElement} Tab content.
 */
const LoginProtectionTab = ({ form }) => {
  const { t, tError } = useSettingsTranslate();
  const { settings, handleChange, errors } = form;
  const maxFailedError = tError(errors.maxFailedLogins);
  const maxFailedValue = Number(settings.maxFailedLogins);
  const lookupOff = !settings.enableGeolocation;

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <IntroText>
        {t(
          'settings.config.loginProtection.intro',
          'These rules check new sign-ins before they succeed. Existing sessions are not affected, and refused sign-ins are not recorded.'
        )}
      </IntroText>

      <SectionCard
        title={t('settings.config.failed.title', 'Failed sign-ins')}
        subtitle={t('settings.config.failed.intro', 'Slows down password guessing from one IP address.')}
      >
        <FormField
          id="max-failed-logins"
          name="maxFailedLogins"
          label={t('settings.config.failed.lockout.label', 'Temporary IP lockout after')}
          description={t('settings.config.failed.lockout.hint', 'A whole number from 0 to 100. 0 turns the lockout off.')}
          suffix={t('settings.config.failed.lockout.suffix', 'failed sign-ins')}
          error={maxFailedError}
          required
        >
          <NumberInput
            value={settings.maxFailedLogins}
            onValueChange={(value) => handleChange('maxFailedLogins', value)}
            min={MAX_FAILED_LOGINS_RANGE.min}
            max={MAX_FAILED_LOGINS_RANGE.max}
            step={1}
          />
        </FormField>
        {!maxFailedError ? (
          <Box padding={3} background={maxFailedValue === 0 ? 'warning100' : 'neutral100'} hasRadius aria-live="polite">
            <ReadableParagraphs
              variant="pi"
              textColor={maxFailedValue === 0 ? 'warning700' : 'neutral700'}
              tag="p"
              text={maxFailedValue === 0
                ? t('settings.config.failed.lockout.off', 'The temporary IP lockout is off. Failed sign-ins are not limited.')
                : t(
                  'settings.config.failed.lockout.preview',
                  'After {count, plural, one {# failed sign-in} other {# failed sign-ins}} from one IP address within 15 minutes, that address is refused for 15 minutes. User accounts are not blocked. Counted per server process.',
                  { count: maxFailedValue }
                )}
            />
          </Box>
        ) : null}
      </SectionCard>

      <SectionCard
        id="client-ip-address"
        title={t('settings.config.clientIp.title', 'Client IP address')}
        subtitle={t('settings.config.clientIp.intro', 'All IP-based rules depend on reading the real client address.')}
      >
        <SettingsToggleRow
          id="trusted-proxies"
          title={t('settings.config.clientIp.trustProxy.label', 'Trust proxy headers')}
          description={t(
            'settings.config.clientIp.trustProxy.hint',
            'Turn on only behind a proxy you control. Affects the recorded IP address, the IP lockout and location lookups.'
          )}
          checked={settings.trustedProxies}
          onChange={(checked) => handleChange('trustedProxies', checked)}
        />
      </SectionCard>

      <SectionCard
        title={t('settings.config.suspicious.title', 'Suspicious sign-ins')}
        subtitle={t('settings.config.suspicious.intro', 'Refuses new sign-ins that look risky.')}
      >
        {lookupOff ? <RequiresGeolocation /> : null}
        <SettingsToggleRow
          id="block-suspicious-sessions"
          title={t('settings.config.suspicious.reject.label', 'Reject suspicious sign-ins')}
          description={t(
            'settings.config.suspicious.reject.hint',
            'Refuses sign-ins from VPN, proxy or known threat addresses and, with security scoring on, scores below 50.'
          )}
          checked={settings.blockSuspiciousSessions}
          disabled={lookupOff}
          onChange={(checked) => handleChange('blockSuspiciousSessions', checked)}
        >
          {settings.geoIpProvider === 'local-mmdb' ? (
            <ReadableText variant="pi" textColor="neutral600" tag="p">
              {t(
                'settings.config.suspicious.reject.localNote',
                'The local database has no VPN, proxy or threat data and always scores 100, so only failed lookups can be refused.'
              )}
            </ReadableText>
          ) : null}
        </SettingsToggleRow>

        <AdvancedSection hasError={fieldHasError(errors, 'geoLookupFailureMode')}>
          <FormField
            id="geoip-lookup-failure-mode"
            name="geoLookupFailureMode"
            label={t('settings.config.suspicious.failureMode.label', 'If the location cannot be determined')}
            description={t(
              'settings.config.suspicious.failureMode.hint',
              "Automatic rejects only when 'Reject suspicious sign-ins' is on. A rejected sign-in gets 'Login temporarily unavailable'. With 'Reject sign-in', the Automatic provider no longer falls back to ipapi.co."
            )}
          >
            <SingleSelect
              value={settings.geoLookupFailureMode || 'auto'}
              disabled={lookupOff}
              onChange={(value) => handleChange('geoLookupFailureMode', value)}
            >
              <SingleSelectOption value="auto">{t('settings.config.suspicious.failureMode.auto', 'Automatic')}</SingleSelectOption>
              <SingleSelectOption value="allow">{t('settings.config.suspicious.failureMode.allow', 'Allow sign-in')}</SingleSelectOption>
              <SingleSelectOption value="block">{t('settings.config.suspicious.failureMode.block', 'Reject sign-in')}</SingleSelectOption>
            </SingleSelect>
          </FormField>
        </AdvancedSection>
      </SectionCard>

      <SectionCard
        title={t('settings.config.countries.title', 'Country rules')}
        subtitle={t('settings.config.countries.intro', 'Allow or reject new sign-ins by the country of the IP address.')}
      >
        {lookupOff ? <RequiresGeolocation /> : null}
        <SettingsToggleRow
          id="enable-geofencing"
          title={t('settings.config.countries.enable.label', 'Use country rules')}
          checked={!!settings.enableGeofencing}
          disabled={lookupOff}
          onChange={(checked) => handleChange('enableGeofencing', checked)}
        />
        <CountryListEditor settings={settings} handleChange={handleChange} />
      </SectionCard>

      <SectionCard title={t('settings.config.refused.title', 'Why sign-ins are refused')}>
        <PropertyList
          columns={1}
          label={t('settings.config.refused.title', 'Why sign-ins are refused')}
          items={[
            {
              id: 'lockout',
              label: t('settings.config.refused.lockout.response', '429 with Retry-After'),
              value: t('settings.config.refused.lockout.cause', 'Temporary IP lockout'),
            },
            {
              id: 'rule',
              label: t('settings.config.refused.rule.response', '403'),
              value: t('settings.config.refused.rule.cause', 'Country rule, or suspicious address / low score'),
            },
            {
              id: 'unavailable',
              label: t('settings.config.refused.unavailable.response', '403 "Login temporarily unavailable"'),
              value: t('settings.config.refused.unavailable.cause', 'Location could not be determined and the rule says reject'),
            },
          ]}
        />
        <ReadableText variant="pi" textColor="neutral600" tag="p">
          {t('settings.config.refused.noLog', 'Session Manager keeps no log of refused sign-ins.')}
        </ReadableText>
      </SectionCard>
    </Flex>
  );
};

export default LoginProtectionTab;
