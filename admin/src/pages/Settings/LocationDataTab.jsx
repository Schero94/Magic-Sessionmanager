import { Flex } from '@strapi/design-system';
import { SectionCard } from '../../components/ui';
import ReadableText from '../../components/ReadableText';
import SettingsToggleRow from '../../components/SettingsToggleRow';
import GeoIpDatabaseCard from './GeoIpDatabaseCard';
import { IntroText, RequiresNotice } from './SettingsBlocks';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

/**
 * Tab "Location data" (IA F Tab 3): where IP location and risk data come
 * from. Turning the lookup off stops all location processing; the privacy
 * note sits directly under the switch that enables lookups (SET-08).
 *
 * @param {{ form: ReturnType<typeof import('./hooks/useSettingsForm').useSettingsForm> }} props Settings form.
 * @returns {import('react').ReactElement} Tab content.
 */
const LocationDataTab = ({ form }) => {
  const { t } = useSettingsTranslate();
  const { settings, handleChange } = form;

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <Flex direction="column" alignItems="stretch" gap={2}>
        <IntroText>
          {t(
            'settings.config.locationData.intro',
            'Location and risk data power country rules, suspicious-sign-in checks and alerts. Turn the lookup off to stop all location processing.'
          )}
        </IntroText>
        <RequiresNotice tab="login-protection">
          {t(
            'settings.config.locationData.clientIpLink',
            'The client IP address source is set under Login protection › Client IP address.'
          )}
        </RequiresNotice>
      </Flex>

      <SectionCard title={t('settings.config.lookup.title', 'IP location lookup')}>
        <SettingsToggleRow
          id="enable-ip-geolocation"
          title={t('settings.config.lookup.enable.label', 'IP location lookup')}
          description={t(
            'settings.config.lookup.enable.hint',
            'Looks up country and city at every sign-in and for listed sessions without a location.'
          )}
          checked={settings.enableGeolocation}
          onChange={(checked) => handleChange('enableGeolocation', checked)}
        >
          <ReadableText variant="pi" textColor="neutral700" tag="p" data-privacy-note="">
            {t(
              'settings.config.lookup.enable.privacy',
              'With the Automatic or ipapi.co provider, IP addresses can be sent to ipapi.co.'
            )}
          </ReadableText>
        </SettingsToggleRow>
        <SettingsToggleRow
          id="enable-security-scoring"
          title={t('settings.config.lookup.scoring.label', 'Security scoring')}
          description={t(
            'settings.config.lookup.scoring.hint',
            'Applies the score thresholds: below 70 triggers a suspicious-sign-in email, below 50 a rejection if enabled. Local database results always score 100.'
          )}
          checked={settings.enableSecurityScoring}
          disabled={!settings.enableGeolocation}
          onChange={(checked) => handleChange('enableSecurityScoring', checked)}
        >
          {!settings.enableGeolocation ? (
            <RequiresNotice>
              {t('settings.config.requires.geolocation', 'Requires IP location lookup')}
            </RequiresNotice>
          ) : null}
        </SettingsToggleRow>
      </SectionCard>

      <GeoIpDatabaseCard form={form} />
    </Flex>
  );
};

export default LocationDataTab;
