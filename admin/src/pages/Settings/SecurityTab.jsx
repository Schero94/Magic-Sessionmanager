import {
  Alert as DesignSystemAlert,
  Badge,
  Box,
  Flex,
  NumberInput,
  SingleSelect,
  SingleSelectOption,
} from '@strapi/design-system';
import { useNotification } from '@strapi/strapi/admin';
import styled from 'styled-components';
import { EqualGrid, SectionCard } from '../../components/ui';
import FormField from '../../components/FormField';
import { ReadableParagraphs } from '../../components/ReadableText';
import SettingsToggleRow from '../../components/SettingsToggleRow';
import { MAX_FAILED_LOGINS_RANGE } from '../../utils/settingsForm.mjs';
import EncryptionKeyCard from './EncryptionKeyCard';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

/**
 * The DS Alert puts title and body on one row. The relaxed-mode body has two
 * paragraphs, so it takes its own full-width row under the title. Only the
 * DS role container is targeted; a source-contract test pins this override
 * (SET-17).
 */
const RelaxedModeAlert = styled(DesignSystemAlert)`
  [role='status'] > p {
    flex: 0 0 100%;
    width: 100%;
    min-width: 0;
  }
`;

/**
 * Security tab: encryption key, session enforcement, threat protection and
 * IP geolocation with its privacy disclosure.
 *
 * @param {{ form: ReturnType<typeof import('./hooks/useSettingsForm').useSettingsForm> }} props Settings form.
 * @returns {import('react').ReactElement} Tab content.
 */
const SecurityTab = ({ form }) => {
  const { t, tError } = useSettingsTranslate();
  const { toggleNotification } = useNotification();
  const { settings, handleChange, errors, relaxedWarningDismissed, setRelaxedWarningDismissed } = form;
  const maxFailedError = tError(errors.maxFailedLogins);
  const maxFailedValue = Number(settings.maxFailedLogins);

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <EncryptionKeyCard copyValue={form.copyValue} notify={toggleNotification} />

      <SectionCard
        title={t('settings.security.enforcement.title', 'Session Enforcement Policy')}
        action={(
          <Badge
            backgroundColor={settings.strictSessionEnforcement ? 'success100' : 'warning100'}
            textColor={settings.strictSessionEnforcement ? 'success700' : 'warning700'}
          >
            {settings.strictSessionEnforcement
              ? t('settings.security.enforcement.badgeStrict', 'Strict')
              : t('settings.security.enforcement.badgeRelaxed', 'Relaxed')}
          </Badge>
        )}
      >
        <ReadableParagraphs
          variant="omega"
          textColor="neutral600"
          tag="p"
          text={t(
            'settings.security.enforcement.description',
            'Controls how aggressively JWT tokens are tied to an active session record.\n\nStrict mode rejects any token without a matching session. This is more secure, but tokens issued before this plugin was installed will also be rejected.'
          )}
        />

        <SettingsToggleRow
          id="strict-session-enforcement"
          title={t('settings.security.enforcement.strict.title', 'Strict Session Enforcement')}
          description={t('settings.security.enforcement.strict.description', 'Reject every authenticated request that does not have a matching session record.\n\nRecommended for production.')}
          checked={settings.strictSessionEnforcement}
          onChange={(checked) => handleChange('strictSessionEnforcement', checked)}
        />

        {!settings.strictSessionEnforcement && !relaxedWarningDismissed && (
          <RelaxedModeAlert
            variant="warning"
            closeLabel={t('settings.common.close', 'Close')}
            onClose={() => setRelaxedWarningDismissed(true)}
            title={t('settings.security.enforcement.warning.title', 'Running in Relaxed Mode')}
          >
            <ReadableParagraphs
              variant="omega"
              textColor="neutral800"
              tag="span"
              text={t(
                'settings.security.enforcement.warning.body',
                'Tokens without a matching session record are allowed through.\n\nManual session termination is still enforced via the token hash. We strongly recommend enabling strict mode in production.'
              )}
            />
          </RelaxedModeAlert>
        )}

        <EqualGrid columns={2} stackBelow="medium" gap={6}>
          <FormField
            id="max-session-age"
            name="maxSessionAgeDays"
            label={t('settings.security.enforcement.maxAge.title', 'Max Session Age')}
            description={t('settings.security.enforcement.maxAge.hint', 'Sessions older than {days} days are automatically terminated, even if they are still active.', { days: settings.maxSessionAgeDays })}
          >
            <SingleSelect
              value={String(settings.maxSessionAgeDays)}
              onChange={(value) => handleChange('maxSessionAgeDays', parseInt(value, 10))}
            >
              <SingleSelectOption value="1">{t('settings.security.enforcement.maxAge.1day', '1 day (very strict)')}</SingleSelectOption>
              <SingleSelectOption value="7">{t('settings.security.enforcement.maxAge.7days', '7 days')}</SingleSelectOption>
              <SingleSelectOption value="14">{t('settings.security.enforcement.maxAge.14days', '14 days')}</SingleSelectOption>
              <SingleSelectOption value="30">{t('settings.security.enforcement.maxAge.30days', '30 days (recommended)')}</SingleSelectOption>
              <SingleSelectOption value="60">{t('settings.security.enforcement.maxAge.60days', '60 days')}</SingleSelectOption>
              <SingleSelectOption value="90">{t('settings.security.enforcement.maxAge.90days', '90 days')}</SingleSelectOption>
              <SingleSelectOption value="180">{t('settings.security.enforcement.maxAge.180days', '180 days')}</SingleSelectOption>
              <SingleSelectOption value="365">{t('settings.security.enforcement.maxAge.365days', '1 year')}</SingleSelectOption>
            </SingleSelect>
          </FormField>

          <SettingsToggleRow
            id="trusted-proxies"
            title={t('settings.security.enforcement.trustedProxies.title', 'Trust Upstream Proxy')}
            description={t('settings.security.enforcement.trustedProxies.description', 'Only enable this when Strapi runs behind a trusted reverse proxy such as nginx or Cloudflare.\n\nOtherwise, clients can spoof the X-Forwarded-For header.')}
            checked={settings.trustedProxies}
            onChange={(checked) => handleChange('trustedProxies', checked)}
          />
        </EqualGrid>
      </SectionCard>

      <SectionCard
        title={t('settings.security.protection.title', 'Threat protection')}
        subtitle={t('settings.security.description', 'Security policies and threat protection')}
      >
        <SettingsToggleRow
          id="block-suspicious-sessions"
          title={t('settings.security.blockSuspicious.title', 'Block Suspicious Sessions')}
          description={t('settings.security.blockSuspicious.description', 'Automatically block sessions from VPNs, proxies, or threat IPs')}
          checked={settings.blockSuspiciousSessions}
          onChange={(checked) => handleChange('blockSuspiciousSessions', checked)}
        />
        <SettingsToggleRow
          id="enable-security-scoring"
          title={t('settings.security.scoring.title', 'Security Scoring')}
          description={t('settings.security.scoring.description', 'Calculate security scores and detect threats')}
          checked={settings.enableSecurityScoring}
          onChange={(checked) => handleChange('enableSecurityScoring', checked)}
        />

        <FormField
          id="max-failed-logins"
          name="maxFailedLogins"
          label={t('settings.security.maxFailed.title', 'Max Failed Login Attempts')}
          description={t('settings.security.maxFailed.fieldHint', 'Set how many consecutive login failures are allowed before the protective action applies.')}
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
                ? t('settings.security.maxFailed.disabled', 'Login lockout is disabled')
                : t('settings.security.maxFailed.hint', 'User will be blocked after {count} failed attempts', { count: maxFailedValue })}
            />
          </Box>
        ) : null}
      </SectionCard>

      <SectionCard
        title={t('settings.security.geolocation.title', 'IP Geolocation')}
        subtitle={t('settings.security.geolocation.sectionSubtitle', 'Where location data for sessions comes from')}
      >
        <SettingsToggleRow
          id="enable-ip-geolocation"
          title={t('settings.security.geolocation.title', 'IP Geolocation')}
          description={t(
            'settings.security.geolocation.description',
            'Looks up the location of each session from its IP address.\n\nPrivacy: depending on the GeoIP provider below, IP addresses can be sent to the third-party service ipapi.co. Choose Local MMDB to keep lookups on this server.'
          )}
          checked={settings.enableGeolocation}
          onChange={(checked) => handleChange('enableGeolocation', checked)}
        />

        <EqualGrid columns={2} stackBelow="medium" gap={6}>
          <FormField
            id="geoip-provider"
            name="geoIpProvider"
            label={t('settings.geofencing.provider.title', 'GeoIP Provider')}
            description={t('settings.geofencing.provider.hint', 'Auto uses a local MMDB if available. If the database is missing, or its lookup fails (unless lookup failure mode is Block), it can send the user\'s IP address to ipapi.co. The ipapi.co option sends IP addresses to that service. Local MMDB uses only local lookups; Disabled turns off GeoIP lookups.')}
          >
            <SingleSelect
              value={settings.geoIpProvider || 'auto'}
              onChange={(value) => handleChange('geoIpProvider', value)}
            >
              <SingleSelectOption value="auto">{t('settings.geofencing.provider.auto', 'Auto')}</SingleSelectOption>
              <SingleSelectOption value="local-mmdb">{t('settings.geofencing.provider.local', 'Local MMDB')}</SingleSelectOption>
              <SingleSelectOption value="ipapi">{t('settings.geofencing.provider.ipapi', 'ipapi.co')}</SingleSelectOption>
              <SingleSelectOption value="disabled">{t('settings.geofencing.provider.disabled', 'Disabled')}</SingleSelectOption>
            </SingleSelect>
          </FormField>

          <FormField
            id="geoip-lookup-failure-mode"
            name="geoLookupFailureMode"
            label={t('settings.geofencing.failureMode.title', 'Lookup Failure Mode')}
            description={t('settings.geofencing.failureMode.hint', 'Choose whether login is allowed when location lookup is unavailable.')}
          >
            <SingleSelect
              value={settings.geoLookupFailureMode || 'auto'}
              onChange={(value) => handleChange('geoLookupFailureMode', value)}
            >
              <SingleSelectOption value="auto">{t('settings.geofencing.failureMode.auto', 'Auto')}</SingleSelectOption>
              <SingleSelectOption value="allow">{t('settings.geofencing.failureMode.allow', 'Allow')}</SingleSelectOption>
              <SingleSelectOption value="block">{t('settings.geofencing.failureMode.block', 'Block')}</SingleSelectOption>
            </SingleSelect>
          </FormField>
        </EqualGrid>
      </SectionCard>
    </Flex>
  );
};

export default SecurityTab;
