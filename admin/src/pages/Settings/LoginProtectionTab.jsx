import { Box, Flex, NumberInput, SingleSelect, SingleSelectOption } from '@strapi/design-system';
import { EqualGrid, SectionCard } from '../../components/ui';
import FormField from '../../components/FormField';
import ReadableText, { ReadableParagraphs } from '../../components/ReadableText';
import SettingsToggleRow from '../../components/SettingsToggleRow';
import { MAX_FAILED_LOGINS_RANGE } from '../../utils/settingsForm.mjs';
import { POLICY_RANGES } from '../../utils/policyForm.mjs';
import LockedNowCard from './LockedNowCard';
import TrustedAddressesField from './TrustedAddressesField';
import ImpossibleTravelCard from './ImpossibleTravelCard';
import { getRiskAvailability, riskDependentControl } from '../../utils/riskData.mjs';
import Alert from '../../components/PersistentAlert';
import { fieldHasError } from './settingsTabs.mjs';
import CountryListEditor from './CountryListEditor';
import {
  AdvancedSection,
  IntroText,
  ProtectedNotice,
  RequiresGeolocation,
  RiskSourceNotice,
  TermList,
} from './SettingsBlocks';
import { SettingsTabLink } from './SettingsNavigation';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

/**
 * One sentence that says what the lockout settings do together.
 *
 * @param {(id: string, defaultMessage: string, values?: object) => string} t Translator.
 * @param {{ip: number, account: number, window: number, duration: number}} values Draft values.
 * @returns {string} Preview text.
 */
const describeLockout = (t, { ip, account, window, duration }) => {
  if (ip === 0 && account === 0) {
    return t(
      'settings.config.failed.lockout.offBoth',
      'The lockout is off. Failed sign-ins are not limited.'
    );
  }
  const parts = [];
  if (ip > 0) {
    parts.push(
      t(
        'settings.config.failed.preview.ip',
        '{count, plural, one {# failed sign-in} other {# failed sign-ins}} from one IP address within {window, plural, one {# minute} other {# minutes}} lock that address for {duration, plural, one {# minute} other {# minutes}}.',
        { count: ip, window, duration }
      )
    );
  }
  if (account > 0) {
    parts.push(
      t(
        'settings.config.failed.preview.account',
        '{count, plural, one {# failed sign-in} other {# failed sign-ins}} for one account within {window, plural, one {# minute} other {# minutes}} lock that account for {duration, plural, one {# minute} other {# minutes}}, from every address.',
        { count: account, window, duration }
      )
    );
  }
  return parts.join(' ');
};

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
  const accountValue = Number(settings.maxFailedLoginsPerAccount) || 0;
  const accountByRole = (settings.roleRules || []).some(
    (rule) =>
      rule.maxFailedLoginsPerAccount !== null && rule.maxFailedLoginsPerAccount !== undefined
  );
  const lockoutPreview = describeLockout(t, {
    ip: maxFailedValue,
    account: accountValue,
    window: Number(settings.lockoutWindowMinutes) || 15,
    duration: Number(settings.lockoutDurationMinutes) || 15,
  });
  const lookupOff = !settings.enableGeolocation;
  // The lookup failure mode is a protected setting (4.17).
  const locked = form.canChangeProtected === false;
  // The new account lockout, window, duration, trusted addresses and the
  // switches are protected settings; the IP threshold stays on `access`.
  const policyLocked = locked;
  const risk = getRiskAvailability(form.geoIp.status);
  const reject = riskDependentControl(settings.blockSuspiciousSessions, risk.state);
  // A saved "Reject suspicious sign-ins" still makes the Automatic failure
  // mode reject failed lookups; say so while the switch itself is inactive.
  const autoStillRejects =
    reject.savedOnButInactive && (settings.geoLookupFailureMode || 'auto') === 'auto';

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <IntroText>
        {t(
          'settings.config.loginProtection.intro',
          'These rules check new sign-ins before they succeed. Existing sessions are not affected. Failed and refused sign-ins are recorded in the security log while recording is on.'
        )}
      </IntroText>

      <SectionCard
        title={t('settings.config.failed.title', 'Failed sign-ins')}
        subtitle={t(
          'settings.config.failed.intro',
          'Slows down password guessing. Counts are shared by every server process.'
        )}
      >
        {policyLocked ? <ProtectedNotice /> : null}
        <EqualGrid columns={2} stackBelow="medium" gap={6}>
          <FormField
            id="max-failed-logins"
            name="maxFailedLogins"
            label={t('settings.config.failed.lockout.label', 'Lock an IP address after')}
            description={t(
              'settings.config.failed.lockout.hint',
              'A whole number from 0 to 100. 0 turns the IP lockout off.'
            )}
            suffix={t('settings.config.failed.lockout.suffix', 'failed sign-ins')}
            error={maxFailedError}
            required
          >
            <NumberInput
              key={form.draftVersion}
              value={settings.maxFailedLogins}
              onValueChange={(value) => handleChange('maxFailedLogins', value)}
              min={MAX_FAILED_LOGINS_RANGE.min}
              max={MAX_FAILED_LOGINS_RANGE.max}
              step={1}
            />
          </FormField>
          <FormField
            id="max-failed-logins-account"
            name="maxFailedLoginsPerAccount"
            label={t('settings.config.failed.account.label', 'Lock an account after')}
            description={t(
              'settings.config.failed.account.hint',
              'Counts failed sign-ins for one account from any address. 0 turns it off. Anyone who knows an account name can lock it, so keep this higher than the IP limit.'
            )}
            suffix={t('settings.config.failed.lockout.suffix', 'failed sign-ins')}
            error={tError(errors.maxFailedLoginsPerAccount)}
            required
          >
            <NumberInput
              key={form.draftVersion}
              value={settings.maxFailedLoginsPerAccount}
              onValueChange={(value) => handleChange('maxFailedLoginsPerAccount', value ?? '')}
              disabled={policyLocked}
              min={POLICY_RANGES.maxFailedLoginsPerAccount.min}
              max={POLICY_RANGES.maxFailedLoginsPerAccount.max}
              step={1}
            />
          </FormField>
          <FormField
            id="lockout-window"
            name="lockoutWindowMinutes"
            label={t('settings.config.failed.window.label', 'Count failed sign-ins within')}
            description={t(
              'settings.config.failed.window.hint',
              'Failures older than this no longer count.'
            )}
            suffix={t('settings.config.failed.minutes.suffix', 'minutes')}
            error={tError(errors.lockoutWindowMinutes)}
            required
          >
            <NumberInput
              key={form.draftVersion}
              value={settings.lockoutWindowMinutes}
              onValueChange={(value) => handleChange('lockoutWindowMinutes', value ?? '')}
              disabled={policyLocked}
              min={POLICY_RANGES.lockoutWindowMinutes.min}
              max={POLICY_RANGES.lockoutWindowMinutes.max}
              step={1}
            />
          </FormField>
          <FormField
            id="lockout-duration"
            name="lockoutDurationMinutes"
            label={t('settings.config.failed.duration.label', 'Lock for')}
            description={t(
              'settings.config.failed.duration.hint',
              'A locked IP address or account is refused for this long. Admins can unlock it earlier.'
            )}
            suffix={t('settings.config.failed.minutes.suffix', 'minutes')}
            error={tError(errors.lockoutDurationMinutes)}
            required
          >
            <NumberInput
              key={form.draftVersion}
              value={settings.lockoutDurationMinutes}
              onValueChange={(value) => handleChange('lockoutDurationMinutes', value ?? '')}
              disabled={policyLocked}
              min={POLICY_RANGES.lockoutDurationMinutes.min}
              max={POLICY_RANGES.lockoutDurationMinutes.max}
              step={1}
            />
          </FormField>
        </EqualGrid>
        {!maxFailedError && !errors.maxFailedLoginsPerAccount ? (
          <Box
            padding={3}
            background={maxFailedValue === 0 && accountValue === 0 ? 'warning100' : 'neutral100'}
            hasRadius
            aria-live="polite"
          >
            <ReadableParagraphs
              variant="pi"
              textColor={maxFailedValue === 0 && accountValue === 0 ? 'warning700' : 'neutral700'}
              tag="p"
              text={lockoutPreview}
            />
          </Box>
        ) : null}
        <SettingsToggleRow
          id="lockout-notify-user"
          title={t(
            'settings.config.failed.notify.label',
            'Email the user when their account is locked'
          )}
          description={t(
            'settings.config.failed.notify.hint',
            "Sent through Strapi's email plugin (and Magic Mail when installed). The text is in Alerts, Email templates."
          )}
          checked={!!settings.lockoutNotifyUser}
          disabled={policyLocked || (accountValue === 0 && !accountByRole)}
          onChange={(checked) => handleChange('lockoutNotifyUser', checked)}
        />
        <SettingsToggleRow
          id="record-user-sign-in-events"
          title={t('settings.config.failed.record.label', 'Record failed and refused sign-ins')}
          description={t(
            'settings.config.failed.record.hint',
            'Writes failed sign-ins, refused sign-ins and locks to the security log, with the IP address as the log stores it.'
          )}
          checked={settings.recordUserSignInEvents !== false}
          disabled={policyLocked}
          onChange={(checked) => handleChange('recordUserSignInEvents', checked)}
        />
        <AdvancedSection
          label={t('settings.config.failed.trusted.section', 'Trusted addresses')}
          hasError={fieldHasError(errors, 'lockoutTrustedAddresses')}
        >
          <TrustedAddressesField form={form} disabled={policyLocked} />
        </AdvancedSection>
      </SectionCard>

      <LockedNowCard />

      <SectionCard
        id="client-ip-address"
        title={t('settings.config.clientIp.title', 'Client IP address')}
        subtitle={t(
          'settings.config.clientIp.intro',
          'All IP-based rules depend on reading the real client address.'
        )}
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
        {!lookupOff && risk.state === 'missing' ? (
          <Alert
            variant="default"
            closeLabel={t('common.close', 'Close')}
            title={t('settings.config.risk.missing.title', 'No risk data source')}
            data-risk-missing=""
          >
            {t(
              'settings.config.risk.missing.body',
              'VPN, proxy and Tor detection needs a risk data source. Until one is set up, no sign-in is refused as suspicious.'
            )}{' '}
            <SettingsTabLink tab="location-data">
              {t('settings.config.risk.missing.link', 'Set up risk data')}
            </SettingsTabLink>
          </Alert>
        ) : null}
        <SettingsToggleRow
          id="block-suspicious-sessions"
          title={t('settings.config.suspicious.reject.label', 'Reject suspicious sign-ins')}
          description={t(
            'settings.config.suspicious.reject.hint',
            'Refuses sign-ins from VPN, proxy or Tor addresses and, with security scoring on, scores below 50. Hosting networks only trigger alerts.'
          )}
          checked={reject.checked}
          disabled={lookupOff || reject.disabled}
          onChange={(checked) => handleChange('blockSuspiciousSessions', checked)}
        >
          {!lookupOff && reject.disabled ? (
            <RiskSourceNotice savedOn={reject.savedOnButInactive} />
          ) : null}
        </SettingsToggleRow>

        <AdvancedSection hasError={fieldHasError(errors, 'geoLookupFailureMode')}>
          <EqualGrid columns={2} stackBelow="medium" gap={6}>
            <FormField
              id="geoip-lookup-failure-mode"
              name="geoLookupFailureMode"
              label={t(
                'settings.config.suspicious.failureMode.label',
                'If the location cannot be determined'
              )}
              description={t(
                'settings.config.suspicious.failureMode.hint',
                "Automatic rejects only when 'Reject suspicious sign-ins' is on. A rejected sign-in gets 'Login temporarily unavailable'. With 'Reject sign-in', the Automatic provider no longer falls back to ipapi.co."
              )}
            >
              <SingleSelect
                value={settings.geoLookupFailureMode || 'auto'}
                disabled={lookupOff || locked}
                onChange={(value) => handleChange('geoLookupFailureMode', value)}
              >
                <SingleSelectOption value="auto">
                  {t('settings.config.suspicious.failureMode.auto', 'Automatic')}
                </SingleSelectOption>
                <SingleSelectOption value="allow">
                  {t('settings.config.suspicious.failureMode.allow', 'Allow sign-in')}
                </SingleSelectOption>
                <SingleSelectOption value="block">
                  {t('settings.config.suspicious.failureMode.block', 'Reject sign-in')}
                </SingleSelectOption>
              </SingleSelect>
            </FormField>
          </EqualGrid>
          {autoStillRejects ? (
            <ReadableText variant="pi" textColor="neutral700" tag="p" data-auto-still-rejects="">
              {t(
                'settings.config.suspicious.failureMode.savedOnNote',
                "Automatic still rejects sign-ins whose location cannot be determined, because 'Reject suspicious sign-ins' is saved as on. Choose 'Allow sign-in' to change that."
              )}
            </ReadableText>
          ) : null}
        </AdvancedSection>
      </SectionCard>

      <ImpossibleTravelCard form={form} />

      <SectionCard
        title={t('settings.config.countries.title', 'Country rules')}
        subtitle={t(
          'settings.config.countries.intro',
          'Allow or reject new sign-ins by the country of the IP address.'
        )}
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
        <TermList
          label={t('settings.config.refused.title', 'Why sign-ins are refused')}
          items={[
            {
              id: 'lockout',
              term: t('settings.config.refused.lockout.response', '429 with Retry-After'),
              description: t(
                'settings.config.refused.lockout.cause',
                'Locked IP address or account after failed sign-ins'
              ),
            },
            {
              id: 'limit',
              term: t('settings.config.refused.limit.response', '403 SESSION_LIMIT_REACHED'),
              description: t(
                'settings.config.refused.limit.cause',
                'Session limit reached with "Refuse the new sign-in"'
              ),
            },
            {
              id: 'rule',
              term: t('settings.config.refused.rule.response', '403'),
              description: t(
                'settings.config.refused.rule.cause',
                'Country rule, or suspicious address / low score'
              ),
            },
            {
              id: 'unavailable',
              term: t(
                'settings.config.refused.unavailable.response',
                '403 "Login temporarily unavailable"'
              ),
              description: t(
                'settings.config.refused.unavailable.cause',
                'Location could not be determined and the rule says reject'
              ),
            },
          ]}
        />
        <ReadableText variant="pi" textColor="neutral600" tag="p">
          {t(
            'settings.config.refused.log',
            'Refused sign-ins are written to the security log while "Record failed and refused sign-ins" is on.'
          )}
        </ReadableText>
      </SectionCard>
    </Flex>
  );
};

export default LoginProtectionTab;
