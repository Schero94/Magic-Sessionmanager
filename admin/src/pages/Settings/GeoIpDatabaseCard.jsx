import { Badge, Button, Flex, TextInput } from '@strapi/design-system';
import { EqualGrid, PropertyList, SectionCard } from '../../components/ui';
import FormField from '../../components/FormField';
import Alert from '../../components/PersistentAlert';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

/**
 * Local MaxMind database status, filename and download controls.
 *
 * @param {{ form: ReturnType<typeof import('./hooks/useSettingsForm').useSettingsForm> }} props Settings form.
 * @returns {import('react').ReactElement} GeoIP database section.
 */
const GeoIpDatabaseCard = ({ form }) => {
  const { t, tError } = useSettingsTranslate();
  const { settings, handleChange, errors, hasChanges, geoIp } = form;
  const geoIpStatus = geoIp.status;

  return (
    <SectionCard
      title={t('settings.geofencing.database.title', 'Local GeoIP Database (City recommended)')}
      subtitle={geoIpStatus
        ? (geoIpStatus.exists
          ? t('settings.geofencing.database.exists', 'Database is installed locally. GeoLite2-City enables city-level lookup; Country remains supported.')
          : t('settings.geofencing.database.missing', 'No local database installed yet. GeoLite2-City is recommended for city-level lookup.'))
        : undefined}
      action={geoIpStatus ? (
        <Badge
          backgroundColor={geoIpStatus.exists ? 'success100' : 'warning100'}
          textColor={geoIpStatus.exists ? 'success700' : 'warning700'}
        >
          {geoIpStatus.exists
            ? t('settings.geofencing.database.installed', 'Installed')
            : t('settings.geofencing.database.notInstalled', 'Missing')}
        </Badge>
      ) : null}
    >
      {geoIp.statusError && (
        <Alert
          variant="danger"
          closeLabel={t('common.close', 'Close')}
          title={t('settings.geofencing.database.statusError', 'Could not load the database status. Try again.')}
          action={<Button size="S" variant="secondary" onClick={geoIp.fetchStatus}>{t('common.retry', 'Retry')}</Button>}
        />
      )}

      <PropertyList
        items={[
          {
            id: 'path',
            label: t('settings.geofencing.database.path', 'Path'),
            value: geoIpStatus?.databasePath || settings.geoIpDatabasePath,
            kind: 'id',
          },
          {
            id: 'edition',
            label: t('settings.geofencing.database.edition', 'Edition'),
            value: geoIpStatus?.editionId,
          },
          {
            id: 'lastModified',
            label: t('settings.geofencing.database.lastModified', 'Last MaxMind update'),
            value: geoIpStatus?.metadata?.lastModified,
          },
        ]}
      />

      <FormField
        id="geoip-database-filename"
        name="geoIpDatabasePath"
        label={t('settings.geofencing.databasePath.title', 'Local MMDB filename')}
        description={t('settings.geofencing.databasePath.help', 'Downloads stay in data/magic-sessionmanager/geoip. Use a supported .mmdb filename.')}
        error={tError(errors.geoIpDatabasePath)}
      >
        <TextInput
          name="geoIpDatabasePath"
          value={settings.geoIpDatabasePath || ''}
          onChange={(event) => handleChange('geoIpDatabasePath', event.target.value)}
          placeholder="GeoLite2-City.mmdb"
          autoComplete="off"
          spellCheck={false}
        />
      </FormField>

      <EqualGrid columns={2} stackBelow="medium" gap={6}>
        <FormField
          id="maxmind-account-id"
          name="maxmindAccountId"
          label={t('settings.geofencing.maxmind.accountId', 'MaxMind Account ID')}
          description={t('settings.geofencing.maxmind.accountId.hint', 'Used only to download the local GeoIP database.')}
        >
          <TextInput
            name="maxmindAccountId"
            value={geoIp.credentials.accountId || ''}
            autoComplete="off"
            onChange={(event) => geoIp.setCredentials((prev) => ({ ...prev, accountId: event.target.value }))}
          />
        </FormField>
        <FormField
          id="maxmind-license-key"
          name="maxmindLicenseKey"
          label={t('settings.geofencing.maxmind.licenseKey', 'MaxMind License Key')}
          description={t('settings.geofencing.maxmind.licenseKey.hint', 'The key is masked while you enter it.')}
        >
          <TextInput
            name="maxmindLicenseKey"
            type="password"
            autoComplete="new-password"
            value={geoIp.credentials.licenseKey || ''}
            onChange={(event) => geoIp.setCredentials((prev) => ({ ...prev, licenseKey: event.target.value }))}
            placeholder={geoIpStatus?.hasCredentials
              ? t('settings.geofencing.maxmind.licenseStored', 'License key stored')
              : undefined}
          />
        </FormField>
      </EqualGrid>

      <Flex gap={2} wrap="wrap">
        <Button
          variant="secondary"
          onClick={geoIp.saveCredentials}
          loading={geoIp.savingCredentials}
          disabled={geoIp.savingCredentials || !geoIp.credentials.accountId || !geoIp.credentials.licenseKey}
        >
          {t('settings.geofencing.credentials.save', 'Save MaxMind Credentials')}
        </Button>
        <Button
          onClick={() => geoIp.updateDatabase(false)}
          loading={geoIp.updating}
          disabled={geoIp.updating || !geoIpStatus?.hasCredentials || hasChanges}
        >
          {t('settings.geofencing.database.update', 'Download / Update DB')}
        </Button>
        <Button
          variant="tertiary"
          onClick={() => geoIp.updateDatabase(true)}
          disabled={geoIp.updating || !geoIpStatus?.hasCredentials || hasChanges}
        >
          {t('settings.geofencing.database.force', 'Force Refresh')}
        </Button>
      </Flex>

      {hasChanges && (
        <Alert variant="warning" closeLabel={t('common.close', 'Close')} title="">
          {t('settings.geofencing.database.saveFirst', 'Save settings before downloading so the server uses the latest database path.')}
        </Alert>
      )}
    </SectionCard>
  );
};

export default GeoIpDatabaseCard;
