import { Fragment, useRef } from 'react';
import { Badge, Button, Divider, Flex, SingleSelect, SingleSelectOption, TextInput, Typography } from '@strapi/design-system';
import { Trash } from '@strapi/icons';
import { ConfirmAction, EqualGrid, PropertyList, SectionCard } from '../../components/ui';
import FormField from '../../components/FormField';
import ReadableText from '../../components/ReadableText';
import Alert from '../../components/PersistentAlert';
import { formatSessionDate } from '../../utils/sessionDates.mjs';
import { refocusIfLost } from '../../utils/restoreDialogFocus.mjs';
import { fieldHasError, usesLocalDatabase } from './settingsTabs.mjs';
import { AdvancedSection, RequiresNotice } from './SettingsBlocks';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

const BUILD_DATE_OPTIONS = Object.freeze({ dateStyle: 'medium' });

/**
 * A file path that may wrap after each "/" (and only mid-segment as a last
 * resort), so "data/magic-sessionmanager/geoip/GeoLite2-City.mmdb" breaks
 * between folders on phones instead of inside the file name.
 *
 * @param {{ path: string }} props Path.
 * @returns {import('react').ReactElement} Path text.
 */
const PathValue = ({ path }) => {
  const parts = String(path).split('/');
  return (
    <Typography variant="omega" textColor="neutral800">
      {parts.map((part, index) => (
        // eslint-disable-next-line react/no-array-index-key -- segments are positional
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 ? <>/<wbr /></> : null}
        </Fragment>
      ))}
    </Typography>
  );
};

/**
 * Card "Provider and database" (IA F 3.2): lookup provider, local MaxMind
 * database status, credentials, download and the advanced file name. A
 * status failure shows an alert inside this card only (IA G).
 *
 * @param {{ form: ReturnType<typeof import('./hooks/useSettingsForm').useSettingsForm> }} props Settings form.
 * @returns {import('react').ReactElement} Provider and database card.
 */
const GeoIpDatabaseCard = ({ form }) => {
  const { t, tError, locale } = useSettingsTranslate();
  const { settings, handleChange, errors, hasChanges, geoIp } = form;
  const geoIpStatus = geoIp.status;
  // Removing stored credentials also removes the Remove button; focus then
  // moves to the account ID field instead of falling back to the page body.
  const accountIdRef = useRef(null);
  const saveCredentialsRef = useRef(null);
  const updateRef = useRef(null);
  const forceRef = useRef(null);

  // These buttons are disabled while their request runs, which drops keyboard
  // focus on <body>; afterwards it returns to the button (or the account ID).
  const keepFocus = (action, buttonRef) => async () => {
    await action();
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      refocusIfLost(buttonRef.current, accountIdRef.current);
    }));
  };
  const lookupOff = !settings.enableGeolocation;
  const localDatabase = usesLocalDatabase(settings.geoIpProvider);
  const databaseDisabled = lookupOff || !localDatabase;
  const credentialSource = geoIpStatus?.credentialSource;
  const fromEnvironment = credentialSource === 'env';
  const credentialSourceLabels = {
    env: t('settings.config.database.credentials.env', 'Environment variables'),
    store: t('settings.config.database.credentials.store', 'Stored in Strapi'),
    missing: t('settings.config.database.credentials.missing', 'Missing'),
  };

  return (
    <SectionCard
      title={t('settings.config.provider.title', 'Provider and database')}
      action={geoIpStatus ? (
        <Badge
          backgroundColor={geoIpStatus.exists ? 'success100' : 'neutral150'}
          textColor={geoIpStatus.exists ? 'success700' : 'neutral700'}
        >
          {geoIpStatus.exists
            ? t('settings.config.database.downloaded', 'Downloaded')
            : t('settings.config.database.notDownloaded', 'Not downloaded')}
        </Badge>
      ) : null}
    >
      {lookupOff ? (
        <RequiresNotice>
          {t('settings.config.requires.geolocation', 'Requires IP location lookup')}
        </RequiresNotice>
      ) : null}

      <EqualGrid columns={2} stackBelow="medium" gap={6}>
        <FormField
          id="geoip-provider"
          name="geoIpProvider"
          label={t('settings.config.provider.label', 'Provider')}
          description={t(
            'settings.config.provider.hint',
            'Automatic uses the local database, else ipapi.co unless lookup failures are set to reject. Local database keeps lookups on this server. ipapi.co sends IP addresses to that service. Off turns lookups off.'
          )}
        >
          <SingleSelect
            value={settings.geoIpProvider || 'auto'}
            disabled={lookupOff}
            onChange={(value) => handleChange('geoIpProvider', value)}
          >
            <SingleSelectOption value="auto">{t('settings.config.provider.auto', 'Automatic')}</SingleSelectOption>
            <SingleSelectOption value="local-mmdb">{t('settings.config.provider.local', 'Local database')}</SingleSelectOption>
            <SingleSelectOption value="ipapi">{t('settings.config.provider.ipapi', 'ipapi.co')}</SingleSelectOption>
            <SingleSelectOption value="disabled">{t('settings.config.provider.off', 'Off')}</SingleSelectOption>
          </SingleSelect>
        </FormField>
      </EqualGrid>

      {!lookupOff && !localDatabase ? (
        <RequiresNotice>
          {t('settings.config.requires.localDatabase', 'The database settings below require the Automatic or Local database provider.')}
        </RequiresNotice>
      ) : null}

      <Divider />

      {geoIp.statusError && (
        <Alert
          variant="danger"
          closeLabel={t('common.close', 'Close')}
          title=""
          action={<Button size="S" variant="secondary" onClick={geoIp.fetchStatus}>{t('settings.config.load.retry', 'Try again')}</Button>}
        >
          {t('settings.config.database.statusError', 'The database status could not be loaded.')}
        </Alert>
      )}

      {geoIpStatus ? (
        <Flex direction="column" alignItems="stretch" gap={2}>
          {!geoIpStatus.exists ? (
            <ReadableText variant="omega" textColor="neutral600" tag="p">
              {t('settings.config.database.none', 'No database downloaded yet.')}
            </ReadableText>
          ) : null}
          <PropertyList
            label={t('settings.config.database.statusLabel', 'Database status')}
            items={[
              {
                id: 'edition',
                label: t('settings.config.database.edition', 'Edition'),
                value: geoIpStatus.editionId,
              },
              {
                id: 'built',
                label: t('settings.config.database.built', 'Build date'),
                value: formatSessionDate(geoIpStatus.metadata?.lastModified, locale, '', BUILD_DATE_OPTIONS),
              },
              {
                id: 'file',
                label: t('settings.config.database.file', 'File'),
                value: geoIpStatus.databasePath,
                render: geoIpStatus.databasePath ? <PathValue path={geoIpStatus.databasePath} /> : undefined,
                kind: 'id',
              },
              {
                id: 'credentials',
                label: t('settings.config.database.credentials', 'MaxMind credentials'),
                value: credentialSourceLabels[credentialSource],
              },
            ]}
          />
        </Flex>
      ) : null}

      {fromEnvironment ? (
        <Alert variant="default" closeLabel={t('common.close', 'Close')} title="">
          {t('settings.config.database.credentials.envNote', 'Environment variables are set and take precedence; stored values are ignored.')}
        </Alert>
      ) : null}

      <EqualGrid columns={2} stackBelow="medium" gap={6}>
        <FormField
          id="maxmind-account-id"
          name="maxmindAccountId"
          label={t('settings.config.database.accountId', 'MaxMind account ID')}
          description={t('settings.config.database.accountId.hint', 'Up to 64 characters. Environment variables take precedence.')}
        >
          <TextInput
            ref={accountIdRef}
            name="maxmindAccountId"
            value={geoIp.credentials.accountId || ''}
            autoComplete="off"
            maxLength={64}
            disabled={databaseDisabled}
            readOnly={fromEnvironment}
            onChange={(event) => geoIp.setCredentials((prev) => ({ ...prev, accountId: event.target.value }))}
          />
        </FormField>
        <FormField
          id="maxmind-license-key"
          name="maxmindLicenseKey"
          label={t('settings.config.database.licenseKey', 'MaxMind license key')}
          description={t('settings.config.database.licenseKey.hint', 'Up to 256 characters. The key is masked and never shown again after saving.')}
        >
          <TextInput
            name="maxmindLicenseKey"
            type="password"
            autoComplete="new-password"
            maxLength={256}
            disabled={databaseDisabled}
            readOnly={fromEnvironment}
            value={geoIp.credentials.licenseKey || ''}
            onChange={(event) => geoIp.setCredentials((prev) => ({ ...prev, licenseKey: event.target.value }))}
            placeholder={credentialSource === 'store'
              ? t('settings.config.database.licenseKey.stored', 'A license key is stored')
              : undefined}
          />
        </FormField>
      </EqualGrid>

      <Flex gap={2} wrap="wrap">
        <Button
          ref={saveCredentialsRef}
          variant="secondary"
          onClick={keepFocus(geoIp.saveCredentials, saveCredentialsRef)}
          loading={geoIp.savingCredentials}
          disabled={databaseDisabled || fromEnvironment || geoIp.savingCredentials || !geoIp.credentials.accountId || !geoIp.credentials.licenseKey}
        >
          {t('settings.config.database.saveCredentials', 'Save credentials')}
        </Button>
        {credentialSource === 'store' ? (
          <ConfirmAction
            variant="danger"
            trigger={(
              <Button variant="danger-light" startIcon={<Trash aria-hidden focusable={false} />}>
                {t('settings.config.database.removeCredentials', 'Remove credentials')}
              </Button>
            )}
            title={t('settings.config.database.remove.title', 'Remove stored MaxMind credentials?')}
            body={t(
              'settings.config.database.remove.body',
              'Updates of the GeoIP database stop working unless credentials are set as environment variables.'
            )}
            confirmLabel={t('settings.config.database.remove.action', 'Remove')}
            onConfirm={geoIp.removeCredentials}
            fallbackFocusRef={accountIdRef}
          />
        ) : null}
      </Flex>

      <Divider />

      <Flex direction="column" alignItems="stretch" gap={2}>
        <Flex gap={2} wrap="wrap">
          <Button
            ref={updateRef}
            onClick={keepFocus(() => geoIp.updateDatabase(false), updateRef)}
            loading={geoIp.updating}
            disabled={databaseDisabled || geoIp.updating || !geoIpStatus?.hasCredentials || hasChanges}
          >
            {t('settings.config.database.update', 'Update database')}
          </Button>
          <Button
            ref={forceRef}
            variant="tertiary"
            onClick={keepFocus(() => geoIp.updateDatabase(true), forceRef)}
            disabled={databaseDisabled || geoIp.updating || !geoIpStatus?.hasCredentials || hasChanges}
          >
            {t('settings.config.database.force', 'Force download')}
          </Button>
        </Flex>
        {geoIpStatus && !geoIpStatus.hasCredentials ? (
          <RequiresNotice>
            {t('settings.config.requires.credentials', 'Add MaxMind credentials first.')}
          </RequiresNotice>
        ) : null}
        {hasChanges ? (
          <RequiresNotice>
            {t('settings.config.database.saveFirst', 'Save your changes first, so the download uses the current settings.')}
          </RequiresNotice>
        ) : null}
      </Flex>

      <AdvancedSection hasError={fieldHasError(errors, 'geoIpDatabasePath')}>
        <EqualGrid columns={2} stackBelow="medium" gap={6}>
          <FormField
            id="geoip-database-filename"
            name="geoIpDatabasePath"
            label={t('settings.config.database.fileName.label', 'Database file name')}
            description={t(
              'settings.config.database.fileName.hint',
              "File name only, inside the plugin's GeoIP folder. Leave empty for the default."
            )}
            error={tError(errors.geoIpDatabasePath)}
          >
            <TextInput
              name="geoIpDatabasePath"
              value={settings.geoIpDatabasePath || ''}
              disabled={databaseDisabled && !errors.geoIpDatabasePath}
              onChange={(event) => handleChange('geoIpDatabasePath', event.target.value)}
              placeholder="GeoLite2-City.mmdb"
              autoComplete="off"
              spellCheck={false}
            />
          </FormField>
        </EqualGrid>
      </AdvancedSection>
    </SectionCard>
  );
};

export default GeoIpDatabaseCard;
