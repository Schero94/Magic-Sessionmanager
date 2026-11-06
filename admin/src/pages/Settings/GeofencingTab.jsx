import { Flex } from '@strapi/design-system';
import { SectionCard } from '../../components/ui';
import SettingsToggleRow from '../../components/SettingsToggleRow';
import Alert from '../../components/PersistentAlert';
import CountryListEditor from './CountryListEditor';
import GeoIpDatabaseCard from './GeoIpDatabaseCard';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

/**
 * Geofencing tab: enable switch, mode and country list, local database.
 *
 * @param {{ form: ReturnType<typeof import('./hooks/useSettingsForm').useSettingsForm> }} props Settings form.
 * @returns {import('react').ReactElement} Tab content.
 */
const GeofencingTab = ({ form }) => {
  const { t } = useSettingsTranslate();
  const { settings, handleChange } = form;

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <SectionCard
        title={t('settings.geofencing.title', 'Geofencing')}
        subtitle={t('settings.geofencing.description', 'Allow or block sign-ins by country')}
      >
        <SettingsToggleRow
          id="enable-geofencing"
          title={t('settings.geofencing.enable.title', 'Enable Geofencing')}
          description={t(
            'settings.geofencing.enable.description',
            'When enabled, the pre-login guard compares the caller\'s country against the configured list and rejects logins that do not match.'
          )}
          checked={!!settings.enableGeofencing}
          onChange={(checked) => handleChange('enableGeofencing', checked)}
        />

        {!settings.enableGeofencing && (
          <Alert variant="default" closeLabel={t('common.close', 'Close')} title="">
            {t('settings.geofencing.disabled', 'Geofencing is currently disabled. Enable it above to enforce the configured country list.')}
          </Alert>
        )}

        {settings.enableGeofencing && !settings.enableGeolocation && (
          <Alert variant="warning" closeLabel={t('common.close', 'Close')} title="">
            {t('settings.geofencing.needsGeolocation', 'Geofencing requires Geolocation to be enabled (Security tab).')}
          </Alert>
        )}

        <CountryListEditor settings={settings} handleChange={handleChange} />
      </SectionCard>

      <GeoIpDatabaseCard form={form} />
    </Flex>
  );
};

export default GeofencingTab;
