import { useState, useEffect } from 'react';
import { useIntl } from 'react-intl';
import {
  Box,
  Typography,
  Flex,
  Button,
  Loader,
  SingleSelect,
  SingleSelectOption,
  Checkbox,
  Alert,
  TextInput,
  Tabs,
  Divider,
  Badge,
  Accordion,
  Grid,
  NumberInput,
} from '@strapi/design-system';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import { Check, Duplicate, Trash, Mail, Code, Cog, Shield, Clock } from '@strapi/icons';
import styled from 'styled-components';
import pluginId from '../pluginId';
import { getTranslation } from '../utils/getTranslation';
import { COUNTRIES, normalizeCountryCode, formatCountry } from '../utils/countries';
import { areSettingsEqual } from '../utils/settingsEquality.mjs';
import { logSafeAdminError } from '../utils/safeAdminLog.mjs';
import {
  getGeofencingField,
  inferGeofencingMode,
  selectGeofencingMode,
} from '../utils/geofencingMode.mjs';
import { copyText } from '../utils/copyText.mjs';
import { maskSensitiveValue } from '../utils/maskSensitiveValue.mjs';
import PluginPageLayout from '../components/PluginPageLayout';
import FormField from '../components/FormField';
import ReadableText, { ReadableParagraphs } from '../components/ReadableText';
import SettingsToggleRow from '../components/SettingsToggleRow';

// ================ STYLED COMPONENTS ================
const Container = styled(Box)`
  width: 100%;
  min-width: 0;

  .settings-grid > * {
    min-width: 0;
  }

  @media (max-width: 519px) {
    .settings-grid {
      grid-template-columns: minmax(0, 1fr) !important;
      column-gap: 0;
      row-gap: 16px;
    }

    .settings-grid > * {
      grid-column: 1 / -1 !important;
    }
  }
`;

const SettingsSectionCard = styled(Box)`
  width: 100%;
  min-width: 0;
  border: 1px solid ${(props) => props.theme.colors.neutral150};
  border-radius: 4px;
  margin-bottom: 32px;
`;

const EncryptionKeyControls = styled(Flex)`
  width: 100%;
  min-width: 0;
  align-items: flex-end;

  @media (max-width: 519px) {
    flex-direction: column;
    align-items: stretch;

    & > div:first-child {
      flex: 0 0 auto !important;
      width: 100%;
    }

    & > button {
      align-self: flex-start;
    }
  }
`;

const SettingsFooterCard = styled(Box)`
  width: 100%;
  min-width: 0;
  margin-top: 32px;
  border: 1px solid ${(props) => props.theme.colors.neutral150};
  border-radius: 4px;
`;

const PrimaryShieldIcon = styled(Shield)`
  color: ${(props) => props.theme.colors.primary600};
  flex-shrink: 0;
`;

const DangerTrashIcon = styled(Trash)`
  color: ${(props) => props.theme.colors.danger600};
  flex-shrink: 0;
`;

const RelaxedModeAlert = styled(Alert)`
  [role='status'] > p {
    flex: 0 0 100%;
    width: 100%;
    min-width: 0;
  }

  @media (max-width: 519px) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: auto auto;
    align-items: flex-start;
    gap: 12px !important;

    & > div:first-child {
      grid-column: 1;
      grid-row: 1;
    }

    & > [role='status'] {
      grid-column: 1 / -1;
      grid-row: 2;
      width: 100%;
      min-width: 0;
    }

    & > button {
      grid-column: 2;
      grid-row: 1;
      margin-top: 0;
      justify-self: end;
    }
  }
`;

const PrimaryCodeIcon = styled(Code)`
  color: ${(props) => props.theme.colors.primary600};
  flex-shrink: 0;
`;

const PrimaryCheckIcon = styled(Check)`
  color: ${(props) => props.theme.colors.primary600};
  flex-shrink: 0;
`;

const EncryptionKeyValue = styled.code`
  color: ${(props) => props.theme.colors.primary600};
`;

const AlertTypeCard = styled(Box)`
  width: 100%;
  min-height: 64px;
  display: flex;
  align-items: center;
  border-radius: 4px;
  border: 1px solid ${(p) => p.$selected ? p.theme.colors.primary600 : p.theme.colors.neutral150};
  background: ${(p) => p.$selected ? p.theme.colors.primary100 : p.theme.colors.neutral0};
  transition: border-color 150ms ease-out, background-color 150ms ease-out;
`;

const WebhookInputFrame = styled(Box)`
  border: 1px solid ${(p) => p.theme.colors.neutral200};
  border-radius: 4px;
  overflow: hidden;
  background: ${(p) => p.theme.colors.neutral100};

  textarea {
    color: ${(p) => p.theme.colors.neutral800};
  }
`;

// Template variable definitions
const TEMPLATE_VARIABLES = {
  suspiciousLogin: [
    { var: '{{user.email}}', desc: 'User email address' },
    { var: '{{user.username}}', desc: 'Username' },
    { var: '{{session.loginTime}}', desc: 'Login timestamp' },
    { var: '{{session.ipAddress}}', desc: 'IP address' },
    { var: '{{geo.city}}', desc: 'City (if available)' },
    { var: '{{geo.country}}', desc: 'Country (if available)' },
    { var: '{{geo.timezone}}', desc: 'Timezone (if available)' },
    { var: '{{session.userAgent}}', desc: 'Browser/Device info' },
    { var: '{{reason.isVpn}}', desc: 'VPN detected (true/false)' },
    { var: '{{reason.isProxy}}', desc: 'Proxy detected (true/false)' },
    { var: '{{reason.isThreat}}', desc: 'Threat detected (true/false)' },
    { var: '{{reason.securityScore}}', desc: 'Security score (0-100)' },
  ],
  newLocation: [
    { var: '{{user.email}}', desc: 'User email address' },
    { var: '{{user.username}}', desc: 'Username' },
    { var: '{{session.loginTime}}', desc: 'Login timestamp' },
    { var: '{{session.ipAddress}}', desc: 'IP address' },
    { var: '{{geo.city}}', desc: 'City' },
    { var: '{{geo.country}}', desc: 'Country' },
    { var: '{{geo.timezone}}', desc: 'Timezone' },
    { var: '{{session.userAgent}}', desc: 'Browser/Device info' },
  ],
  vpnProxy: [
    { var: '{{user.email}}', desc: 'User email address' },
    { var: '{{user.username}}', desc: 'Username' },
    { var: '{{session.loginTime}}', desc: 'Login timestamp' },
    { var: '{{session.ipAddress}}', desc: 'IP address' },
    { var: '{{geo.city}}', desc: 'City (if available)' },
    { var: '{{geo.country}}', desc: 'Country (if available)' },
    { var: '{{session.userAgent}}', desc: 'Browser/Device info' },
    { var: '{{reason.isVpn}}', desc: 'VPN detected (true/false)' },
    { var: '{{reason.isProxy}}', desc: 'Proxy detected (true/false)' },
  ],
};

// Validate template variables
const validateTemplate = (template, templateType) => {
  const requiredVars = TEMPLATE_VARIABLES[templateType];
  const foundVars = [];

  requiredVars.forEach(({ var: variable }) => {
    if (template.includes(variable)) {
      foundVars.push(variable);
    }
  });

  return {
    isValid: foundVars.length > 0,
    foundVars,
    totalAvailable: requiredVars.length,
  };
};

// Get default email templates
const getDefaultTemplates = () => ({
  suspiciousLogin: {
    subject: '[ALERT] Suspicious Login Alert - Session Manager',
    html: `
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb; border-radius: 10px;">
    <h2 style="color: #dc2626;">[ALERT] Suspicious Login Detected</h2>
    <p>A potentially suspicious login was detected for your account.</p>

    <div style="background: white; padding: 15px; border-radius: 8px; margin: 20px 0;">
      <h3 style="margin-top: 0;">Account Information:</h3>
      <ul>
        <li><strong>Email:</strong> {{user.email}}</li>
        <li><strong>Username:</strong> {{user.username}}</li>
      </ul>

      <h3>Login Details:</h3>
      <ul>
        <li><strong>Time:</strong> {{session.loginTime}}</li>
        <li><strong>IP Address:</strong> {{session.ipAddress}}</li>
        <li><strong>Location:</strong> {{geo.city}}, {{geo.country}}</li>
        <li><strong>Timezone:</strong> {{geo.timezone}}</li>
        <li><strong>Device:</strong> {{session.userAgent}}</li>
      </ul>

      <h3 style="color: #dc2626;">Security Alert:</h3>
      <ul>
        <li>VPN Detected: {{reason.isVpn}}</li>
        <li>Proxy Detected: {{reason.isProxy}}</li>
        <li>Threat Detected: {{reason.isThreat}}</li>
        <li>Security Score: {{reason.securityScore}}/100</li>
      </ul>
    </div>

    <p>If this was you, you can safely ignore this email. If you don't recognize this activity, please secure your account immediately.</p>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;"/>
    <p style="color: #666; font-size: 12px;">This is an automated security notification from Magic Session Manager.</p>
  </div>
</body>
</html>`,
    text: `[ALERT] Suspicious Login Detected

A potentially suspicious login was detected for your account.

Account: {{user.email}}
Username: {{user.username}}

Login Details:
- Time: {{session.loginTime}}
- IP: {{session.ipAddress}}
- Location: {{geo.city}}, {{geo.country}}

Security: VPN={{reason.isVpn}}, Proxy={{reason.isProxy}}, Threat={{reason.isThreat}}, Score={{reason.securityScore}}/100`,
  },
  newLocation: {
    subject: '[LOCATION] New Location Login Detected',
    html: `
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f0f9ff; border-radius: 10px;">
    <h2 style="color: #0284c7;">[LOCATION] Login from New Location</h2>
    <p>Your account was accessed from a new location.</p>

    <div style="background: white; padding: 15px; border-radius: 8px; margin: 20px 0;">
      <h3 style="margin-top: 0;">Account:</h3>
      <p><strong>{{user.email}}</strong></p>

      <h3>New Location Details:</h3>
      <ul>
        <li><strong>Time:</strong> {{session.loginTime}}</li>
        <li><strong>Location:</strong> {{geo.city}}, {{geo.country}}</li>
        <li><strong>IP Address:</strong> {{session.ipAddress}}</li>
        <li><strong>Device:</strong> {{session.userAgent}}</li>
      </ul>
    </div>

    <p>If this was you, no action is needed. If you don't recognize this login, please secure your account.</p>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;"/>
    <p style="color: #666; font-size: 12px;">Magic Session Manager notification</p>
  </div>
</body>
</html>`,
    text: `[LOCATION] Login from New Location

Your account was accessed from a new location.

Account: {{user.email}}

New Location Details:
- Time: {{session.loginTime}}
- Location: {{geo.city}}, {{geo.country}}
- IP Address: {{session.ipAddress}}
- Device: {{session.userAgent}}

If this was you, no action is needed.`,
  },
  vpnProxy: {
    subject: '[WARNING] VPN/Proxy Login Detected',
    html: `
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px; background-color: #fffbeb; border-radius: 10px;">
    <h2 style="color: #d97706;">[WARNING] VPN/Proxy Detected</h2>
    <p>A login from a VPN or proxy service was detected on your account.</p>

    <div style="background: white; padding: 15px; border-radius: 8px; margin: 20px 0;">
      <h3 style="margin-top: 0;">Account:</h3>
      <p><strong>{{user.email}}</strong></p>

      <h3>Login Details:</h3>
      <ul>
        <li><strong>Time:</strong> {{session.loginTime}}</li>
        <li><strong>IP Address:</strong> {{session.ipAddress}}</li>
        <li><strong>Location:</strong> {{geo.city}}, {{geo.country}}</li>
        <li><strong>Device:</strong> {{session.userAgent}}</li>
        <li><strong>VPN:</strong> {{reason.isVpn}}</li>
        <li><strong>Proxy:</strong> {{reason.isProxy}}</li>
      </ul>
    </div>

    <p>VPN/Proxy usage may indicate suspicious activity. If this was you, you can safely ignore this email.</p>

    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;"/>
    <p style="color: #666; font-size: 12px;">Magic Session Manager notification</p>
  </div>
</body>
</html>`,
    text: `[WARNING] VPN/Proxy Detected

A login from a VPN or proxy service was detected on your account.

Account: {{user.email}}

Login Details:
- Time: {{session.loginTime}}
- IP Address: {{session.ipAddress}}
- Location: {{geo.city}}, {{geo.country}}
- VPN: {{reason.isVpn}}, Proxy: {{reason.isProxy}}`,
  },
});

// ================ HELPER FUNCTIONS ================
const generateSecureKey = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
  let key = '';
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);

  for (let i = 0; i < 32; i++) {
    key += chars[array[i] % chars.length];
  }

  return key;
};

/**
 * Geofencing section. Lets the admin choose between an allowlist (only
 * these countries may authenticate) or a blocklist (every country except
 * these). Enforces mutual exclusivity by clearing the other list on mode
 * switch — the backend would reject-and-allow inconsistent lists anyway,
 * but the UI should never put the admin in that state.
 *
 * @param {{ settings: object, handleChange: Function, t: Function }} props
 */
const GeofencingPanel = ({
  settings,
  handleChange,
  t,
  geoIpStatus,
  geoIpCredentials,
  setGeoIpCredentials,
  onSaveGeoIpCredentials,
  onUpdateGeoIp,
  geoIpUpdating,
  geoIpSavingCredentials,
  hasChanges,
}) => {
  const [pendingCode, setPendingCode] = useState('');

  const [mode, setMode] = useState(() => inferGeofencingMode(settings));
  const activeField = getGeofencingField(mode);
  const activeList = Array.isArray(settings[activeField]) ? settings[activeField] : [];

  /**
   * Keeps an empty list's selected mode in the form draft and clears the
   * opposite list before the next settings save.
   *
   * @param {'allowlist' | 'blocklist'} newMode The mode selected by the admin.
   * @returns {void}
   */
  const handleModeChange = (newMode) => {
    const selection = selectGeofencingMode(mode, newMode);
    if (selection.mode === mode) return;

    setMode(selection.mode);
    // Mutual exclusivity: switching modes clears the other list so the
    // server never receives both a non-empty allowlist AND a non-empty
    // blocklist — that would be a contradictory rule set.
    if (selection.clearField) handleChange(selection.clearField, []);
  };

  const addCode = (raw) => {
    const code = normalizeCountryCode(raw);
    if (!code) return;
    if (activeList.includes(code)) return;
    handleChange(activeField, [...activeList, code]);
    setPendingCode('');
  };

  const removeCode = (code) => {
    handleChange(activeField, activeList.filter((c) => c !== code));
  };

  return (
    <Grid.Root className="settings-grid" gap={5}>
      <Grid.Item col={12}>
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
      </Grid.Item>

      <Grid.Item col={6} s={12} xs={12}>
        <FormField
          id="geoip-provider"
          name="geoIpProvider"
          label={t('settings.geofencing.provider.title', 'GeoIP Provider')}
          description={t('settings.geofencing.provider.hint', 'Choose which source resolves approximate end-user session locations.')}
        >
          <SingleSelect
            value={settings.geoIpProvider || 'auto'}
            onChange={(value) => handleChange('geoIpProvider', value)}
          >
            <SingleSelectOption value="auto">
              {t('settings.geofencing.provider.auto', 'Auto')}
            </SingleSelectOption>
            <SingleSelectOption value="local-mmdb">
              {t('settings.geofencing.provider.local', 'Local MMDB')}
            </SingleSelectOption>
            <SingleSelectOption value="ipapi">
              {t('settings.geofencing.provider.ipapi', 'ipapi.co')}
            </SingleSelectOption>
            <SingleSelectOption value="disabled">
              {t('settings.geofencing.provider.disabled', 'Disabled')}
            </SingleSelectOption>
          </SingleSelect>
        </FormField>
      </Grid.Item>

      <Grid.Item col={6} s={12} xs={12}>
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
            <SingleSelectOption value="auto">
              {t('settings.geofencing.failureMode.auto', 'Auto')}
            </SingleSelectOption>
            <SingleSelectOption value="allow">
              {t('settings.geofencing.failureMode.allow', 'Allow')}
            </SingleSelectOption>
            <SingleSelectOption value="block">
              {t('settings.geofencing.failureMode.block', 'Block')}
            </SingleSelectOption>
          </SingleSelect>
        </FormField>
      </Grid.Item>

      <Grid.Item col={12}>
        <FormField
          id="geoip-database-filename"
          name="geoIpDatabasePath"
          label={t('settings.geofencing.databasePath.title', 'Local MMDB filename')}
          description={t(
            'settings.geofencing.databasePath.help',
            'Downloads stay in data/magic-sessionmanager/geoip. Use a supported .mmdb filename.'
          )}
        >
          <TextInput
            name="geoIpDatabasePath"
            value={settings.geoIpDatabasePath || ''}
            onChange={(e) => handleChange('geoIpDatabasePath', e.target.value)}
            placeholder="GeoLite2-City.mmdb"
          />
        </FormField>
      </Grid.Item>

      <Grid.Item col={12}>
        <Box padding={3} background="neutral100" hasRadius>
          <Flex direction="column" gap={3} alignItems="stretch">
            <Flex justifyContent="space-between" alignItems="center" gap={3}>
              <Box>
                <Typography variant="delta" style={{ display: 'block', marginBottom: '4px' }}>
                  {t('settings.geofencing.database.title', 'Local GeoIP Database (City recommended)')}
                </Typography>
                <Typography variant="pi" textColor="neutral600" style={{ fontSize: '12px' }}>
                  {geoIpStatus?.exists
                    ? t('settings.geofencing.database.exists', 'Database is installed locally. GeoLite2-City enables city-level lookup; Country remains supported.')
                    : t('settings.geofencing.database.missing', 'No local database installed yet. GeoLite2-City is recommended for city-level lookup.')}
                </Typography>
              </Box>
              <Badge backgroundColor={geoIpStatus?.exists ? 'success100' : 'warning100'}>
                {geoIpStatus?.exists
                  ? t('settings.geofencing.database.installed', 'Installed')
                  : t('settings.geofencing.database.notInstalled', 'Missing')}
              </Badge>
            </Flex>

            <Typography variant="pi" textColor="neutral600" style={{ fontSize: '12px' }}>
              {t('settings.geofencing.database.path', 'Path')}: {geoIpStatus?.databasePath || settings.geoIpDatabasePath || 'data/magic-sessionmanager/geoip/GeoLite2-City.mmdb'}
            </Typography>

            <Typography variant="pi" textColor="neutral600" style={{ fontSize: '12px' }}>
              {t('settings.geofencing.database.edition', 'Edition')}: {geoIpStatus?.editionId || 'GeoLite2-City'}
            </Typography>

            {geoIpStatus?.metadata?.lastModified && (
              <Typography variant="pi" textColor="neutral600" style={{ fontSize: '12px' }}>
                {t('settings.geofencing.database.lastModified', 'Last MaxMind update')}: {geoIpStatus.metadata.lastModified}
              </Typography>
            )}

            <Grid.Root className="settings-grid" gap={3}>
              <Grid.Item col={6} s={12} xs={12}>
                <FormField
                  id="maxmind-account-id"
                  name="maxmindAccountId"
                  label={t('settings.geofencing.maxmind.accountId', 'MaxMind Account ID')}
                  description={t('settings.geofencing.maxmind.accountId.hint', 'Used only to download the local GeoIP database.')}
                >
                  <TextInput
                    name="maxmindAccountId"
                    value={geoIpCredentials.accountId || ''}
                    onChange={(e) => setGeoIpCredentials(prev => ({ ...prev, accountId: e.target.value }))}
                  />
                </FormField>
              </Grid.Item>
              <Grid.Item col={6} s={12} xs={12}>
                <FormField
                  id="maxmind-license-key"
                  name="maxmindLicenseKey"
                  label={t('settings.geofencing.maxmind.licenseKey', 'MaxMind License Key')}
                  description={t('settings.geofencing.maxmind.licenseKey.hint', 'Stored on the server and kept masked in this form.')}
                >
                  <TextInput
                    name="maxmindLicenseKey"
                    type="password"
                    value={geoIpCredentials.licenseKey || ''}
                    onChange={(e) => setGeoIpCredentials(prev => ({ ...prev, licenseKey: e.target.value }))}
                    placeholder={geoIpStatus?.hasCredentials
                      ? t('settings.geofencing.maxmind.licenseStored', 'License key stored')
                      : t('settings.geofencing.maxmind.licenseKey', 'MaxMind License Key')}
                  />
                </FormField>
              </Grid.Item>
            </Grid.Root>

            <Flex gap={2} wrap="wrap">
              <Button
                variant="secondary"
                onClick={onSaveGeoIpCredentials}
                disabled={geoIpSavingCredentials || !geoIpCredentials.accountId || !geoIpCredentials.licenseKey}
              >
                {geoIpSavingCredentials
                  ? t('settings.geofencing.credentials.saving', 'Saving...')
                  : t('settings.geofencing.credentials.save', 'Save MaxMind Credentials')}
              </Button>
              <Button
                onClick={() => onUpdateGeoIp(false)}
                disabled={geoIpUpdating || !geoIpStatus?.hasCredentials || hasChanges}
              >
                {geoIpUpdating
                  ? t('settings.geofencing.database.updating', 'Updating...')
                  : t('settings.geofencing.database.update', 'Download / Update DB')}
              </Button>
              <Button
                variant="tertiary"
                onClick={() => onUpdateGeoIp(true)}
                disabled={geoIpUpdating || !geoIpStatus?.hasCredentials || hasChanges}
              >
                {t('settings.geofencing.database.force', 'Force Refresh')}
              </Button>
            </Flex>

            {hasChanges && (
              <Alert variant="warning" closeLabel="" title="" onClose={() => {}}>
                {t('settings.geofencing.database.saveFirst', 'Save settings before downloading so the server uses the latest database path.')}
              </Alert>
            )}
          </Flex>
        </Box>
      </Grid.Item>

      <Grid.Item col={12}>
        <Box>
          <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
            {t('settings.geofencing.mode.title', 'Mode')}
          </Typography>
          <Flex gap={2}>
            <Button
              variant={mode === 'allowlist' ? 'default' : 'tertiary'}
              onClick={() => handleModeChange('allowlist')}
              disabled={!settings.enableGeofencing}
            >
              {t('settings.geofencing.mode.allowlist', 'Allowlist (only selected countries)')}
            </Button>
            <Button
              variant={mode === 'blocklist' ? 'default' : 'tertiary'}
              onClick={() => handleModeChange('blocklist')}
              disabled={!settings.enableGeofencing}
            >
              {t('settings.geofencing.mode.blocklist', 'Blocklist (block selected countries)')}
            </Button>
          </Flex>
          <Typography variant="pi" textColor="neutral600" style={{ fontSize: '11px', marginTop: '8px' }}>
            {mode === 'allowlist'
              ? t(
                  'settings.geofencing.mode.allowlist.hint',
                  'Only countries in the list may authenticate. Empty list = no geo restriction.'
                )
              : t(
                  'settings.geofencing.mode.blocklist.hint',
                  'Every country EXCEPT those in the list may authenticate.'
                )}
          </Typography>
        </Box>
      </Grid.Item>

      <Grid.Item col={12}>
        <Box>
          <Typography variant="pi" fontWeight="bold" style={{ marginBottom: '8px', display: 'block' }}>
            {mode === 'allowlist'
              ? t('settings.geofencing.allowed.title', 'Allowed Countries')
              : t('settings.geofencing.blocked.title', 'Blocked Countries')}
          </Typography>

          <Flex gap={2} wrap="wrap" style={{ marginBottom: '12px', minHeight: '36px' }}>
            {activeList.length === 0 ? (
              <Typography variant="pi" textColor="neutral500">
                {t('settings.geofencing.empty', 'No countries configured.')}
              </Typography>
            ) : (
              activeList.map((code) => (
                <Badge
                  key={code}
                  onClick={settings.enableGeofencing ? () => removeCode(code) : undefined}
                  style={{
                    cursor: settings.enableGeofencing ? 'pointer' : 'not-allowed',
                    padding: '6px 10px',
                    background: mode === 'allowlist' ? '#DCFCE7' : '#FEE2E2',
                    color: mode === 'allowlist' ? '#15803D' : '#B91C1C',
                  }}
                >
                  {formatCountry(code)}
                  {settings.enableGeofencing ? '  ✕' : ''}
                </Badge>
              ))
            )}
          </Flex>

          <Flex gap={2} wrap="wrap" style={{ minWidth: 0 }}>
            <Box style={{ flex: '1 1 12rem', minWidth: 0 }}>
              <FormField
                id="country-picker"
                name="countryPicker"
                label={t('settings.geofencing.pick.label', 'Select a country')}
                description={t('settings.geofencing.pick.hint', 'Choose a country to add it to the active list.')}
              >
              <SingleSelect
                disabled={!settings.enableGeofencing}
                value={pendingCode || ''}
                onChange={(value) => {
                  setPendingCode(value);
                  if (value) addCode(value);
                }}
                placeholder={t('settings.geofencing.pick', 'Pick a country to add…')}
              >
                {COUNTRIES
                  .filter((c) => !activeList.includes(c.code))
                  .map((c) => (
                    <SingleSelectOption key={c.code} value={c.code}>
                      {c.flag} {c.name} ({c.code})
                    </SingleSelectOption>
                  ))}
              </SingleSelect>
              </FormField>
            </Box>

            <Box style={{ flex: '1 1 12rem', minWidth: 0 }}>
              <FormField
                id="country-code-manual"
                name="countryCodeManual"
                label={t('settings.geofencing.manual.label', 'Country code')}
                description={t('settings.geofencing.manual.hint', 'Enter a two-letter ISO country code.')}
              >
                <TextInput
                  disabled={!settings.enableGeofencing}
                  placeholder={t('settings.geofencing.manual', 'For example, JP')}
                  value={pendingCode.length <= 2 ? pendingCode : ''}
                  onChange={(e) => setPendingCode(e.target.value.toUpperCase().slice(0, 2))}
                />
              </FormField>
            </Box>
            <Button
              disabled={!settings.enableGeofencing || !normalizeCountryCode(pendingCode)}
              onClick={() => addCode(pendingCode)}
            >
              {t('settings.geofencing.add', 'Add')}
            </Button>
          </Flex>
        </Box>
      </Grid.Item>

      {!settings.enableGeofencing && (
        <Grid.Item col={12}>
          <Alert variant="default" closeLabel="" title="" onClose={() => {}}>
            {t(
              'settings.geofencing.disabled',
              'Geofencing is currently disabled. Enable it above to enforce the configured country list.'
            )}
          </Alert>
        </Grid.Item>
      )}

      {settings.enableGeofencing && !settings.enableGeolocation && (
        <Grid.Item col={12}>
          <Alert variant="warning" closeLabel="" title="" onClose={() => {}}>
            {t(
              'settings.geofencing.needsGeolocation',
              'Geofencing requires Geolocation to be enabled (Security tab).'
            )}
          </Alert>
        </Grid.Item>
      )}
    </Grid.Root>
  );
};

const SettingsPage = () => {
  const { formatMessage } = useIntl();
  const { get, post, put } = useFetchClient();
  const { toggleNotification } = useNotification();
  const t = (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const copyValue = async (value, successMessage, scope) => {
    try {
      await copyText(value);
      toggleNotification({ type: 'success', message: successMessage });
    } catch (error) {
      logSafeAdminError(scope, error);
      toggleNotification({
        type: 'danger',
        message: t('notifications.error.clipboard', 'Could not copy to clipboard.'),
      });
    }
  };
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [activeTemplateTab, setActiveTemplateTab] = useState('suspiciousLogin');
  const [encryptionKey, setEncryptionKey] = useState('');
  const [showEncryptionKey, setShowEncryptionKey] = useState(false);
  const [maxFailedLoginInputRevision, setMaxFailedLoginInputRevision] = useState(0);
  const [geoIpStatus, setGeoIpStatus] = useState(null);
  const [geoIpCredentials, setGeoIpCredentials] = useState({ accountId: '', licenseKey: '' });
  const [geoIpUpdating, setGeoIpUpdating] = useState(false);
  const [geoIpSavingCredentials, setGeoIpSavingCredentials] = useState(false);
  const [relaxedWarningDismissed, setRelaxedWarningDismissed] = useState(false);

  const [settings, setSettings] = useState({
    inactivityTimeout: 15,
    cleanupInterval: 30,
    lastSeenRateLimit: 30,
    retentionDays: 90,
    maxSessionAgeDays: 30,
    // Grace window (ms) during which a freshly-issued JWT is accepted
    // without a matching session row. Prevents strict-session enforcement
    // from blocking the very first request after login. 0 disables.
    sessionCreationGraceMs: 5000,
    // Opt-in fast path for the periodic idle-session cleanup: single
    // SQL UPDATE instead of batched Document-Service writes. Bypasses
    // lifecycle hooks; required for very large installations.
    cleanupUseDbDirect: false,
    strictSessionEnforcement: false,
    trustedProxies: false,
    enableGeolocation: true,
    enableSecurityScoring: true,
    blockSuspiciousSessions: false,
    maxFailedLogins: 5,
    enableEmailAlerts: false,
    alertOnSuspiciousLogin: true,
    alertOnNewLocation: true,
    alertOnVpnProxy: true,
    enableWebhooks: false,
    discordWebhookUrl: '',
    slackWebhookUrl: '',
    enableGeofencing: false,
    allowedCountries: [],
    blockedCountries: [],
    geoIpProvider: 'auto',
    geoIpDatabasePath: '',
    geoLookupFailureMode: 'auto',
    emailTemplates: {
      suspiciousLogin: { subject: '', html: '', text: '' },
      newLocation: { subject: '', html: '', text: '' },
      vpnProxy: { subject: '', html: '', text: '' },
    },
  });
  const [savedSettings, setSavedSettings] = useState(settings);
  const hasChanges = !areSettingsEqual(settings, savedSettings);

  useEffect(() => {
    fetchSettings();
  }, []);

  /**
   * Loads persisted settings, fills missing email templates and records the
   * returned values as the reset and dirty-state baseline.
   *
   * @returns {Promise<void>}
   */
  const fetchSettings = async () => {
    setLoading(true);
    try {
      // Load settings from backend API
      const response = await get(`/${pluginId}/settings`);

      if (response?.data?.settings) {
        const loadedSettings = response.data.settings;

        // Ensure email templates exist with defaults
        if (!loadedSettings.emailTemplates || Object.keys(loadedSettings.emailTemplates).length === 0) {
          loadedSettings.emailTemplates = getDefaultTemplates();
        } else {
          // Ensure each template has all required fields
          const defaultTemplates = getDefaultTemplates();
          Object.keys(defaultTemplates).forEach(key => {
            if (!loadedSettings.emailTemplates[key]) {
              loadedSettings.emailTemplates[key] = defaultTemplates[key];
            } else {
              loadedSettings.emailTemplates[key] = {
                subject: loadedSettings.emailTemplates[key].subject || defaultTemplates[key].subject,
                html: loadedSettings.emailTemplates[key].html || defaultTemplates[key].html,
                text: loadedSettings.emailTemplates[key].text || defaultTemplates[key].text,
              };
            }
          });
        }

        // Merge WITHOUT replacing the state wholesale so that newly-introduced
        // keys (e.g. sessionCreationGraceMs, cleanupUseDbDirect) on a stored
        // settings blob written by an older version still fall back to our
        // in-component defaults instead of undefined.
        const nextSettings = { ...settings, ...loadedSettings };
        setSettings(nextSettings);
        setSavedSettings(nextSettings);
        await fetchGeoIpStatus();
      } else {
        const nextSettings = { ...settings, emailTemplates: getDefaultTemplates() };
        setSettings(nextSettings);
        setSavedSettings(nextSettings);
        await fetchGeoIpStatus();
      }
    } catch (err) {
      logSafeAdminError('settings.load', err);
      toggleNotification({
        type: 'warning',
        message: t('notifications.warning.settingsLoad', 'Could not load settings from server. Using defaults.'),
      });
      // Fallback to default settings
      const nextSettings = { ...settings, emailTemplates: getDefaultTemplates() };
      setSettings(nextSettings);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Loads local GeoIP availability without exposing the stored license key.
   *
   * @returns {Promise<void>}
   */
  const fetchGeoIpStatus = async () => {
    try {
      const response = await get(`/${pluginId}/geoip/status`);
      if (response?.data?.status) {
        const status = response.data.status;
        setGeoIpStatus(status);
        setGeoIpCredentials(prev => ({
          accountId: prev.accountId || status.accountId || '',
          licenseKey: '',
        }));
      }
    } catch (err) {
      logSafeAdminError('settings.geoIpStatus', err);
    }
  };

  /**
   * Applies a field change to the local settings draft.
   *
   * @param {string} key Settings field name.
   * @param {unknown} value New draft value.
   * @returns {void}
   */
  const handleChange = (key, value) => {
    if (key === 'strictSessionEnforcement') {
      setRelaxedWarningDismissed(false);
    }
    setSettings((previousSettings) => ({ ...previousSettings, [key]: value }));
  };

  const updateSetting = (key, value) => {
    handleChange(key, value);
  };

  /**
   * Persists the current settings draft and advances the saved-state baseline
   * only after the server confirms success.
   *
   * @returns {Promise<void>}
   */
  const handleSave = async () => {
    setSaving(true);
    try {
      // Save to backend API using PUT
      const response = await put(`/${pluginId}/settings`, settings);

      if (response?.data?.success) {
        await fetchGeoIpStatus();
        toggleNotification({
          type: 'success',
          message: t('notifications.success.saved', 'Settings saved successfully to database!'),
        });

        setSavedSettings(settings);
      } else {
        throw new Error('Save failed');
      }
    } catch (err) {
      logSafeAdminError('settings.save', err);
      toggleNotification({
        type: 'danger',
        message: t('notifications.error.save', 'Failed to save settings to server'),
      });
    } finally {
      setSaving(false);
    }
  };

  /**
   * Stores MaxMind credentials through the protected GeoIP endpoint and then
   * clears the in-memory license key before refreshing status.
   *
   * @returns {Promise<void>}
   */
  const handleSaveGeoIpCredentials = async () => {
    setGeoIpSavingCredentials(true);
    try {
      const response = await put(`/${pluginId}/geoip/credentials`, geoIpCredentials);
      if (response?.data?.success) {
        toggleNotification({
          type: 'success',
          message: t('notifications.success.geoipCredentialsSaved', 'MaxMind credentials saved.'),
        });
        setGeoIpCredentials(prev => ({ ...prev, licenseKey: '' }));
        await fetchGeoIpStatus();
      }
    } catch (err) {
      logSafeAdminError('settings.saveGeoIpCredentials', err);
      toggleNotification({
        type: 'danger',
        message: t('notifications.error.geoipCredentials', 'Failed to save MaxMind credentials.'),
      });
    } finally {
      setGeoIpSavingCredentials(false);
    }
  };

  /**
   * Requests a local GeoIP database update. The server owns path validation
   * and the external download.
   *
   * @param {boolean} force Bypass freshness checks and request a refresh.
   * @returns {Promise<void>}
   */
  const handleUpdateGeoIpDatabase = async (force = false) => {
    setGeoIpUpdating(true);
    try {
      const response = await post(`/${pluginId}/geoip/update`, { force });
      if (response?.data?.success) {
        toggleNotification({
          type: 'success',
          message: response.data.result?.changed
            ? t('notifications.success.geoipUpdated', 'GeoIP database updated.')
            : t('notifications.success.geoipCurrent', 'GeoIP database is already current.'),
        });
        await fetchGeoIpStatus();
      }
    } catch (err) {
      logSafeAdminError('settings.updateGeoIpDatabase', err);
      toggleNotification({
        type: 'danger',
        message: t('notifications.error.geoipUpdate', 'Failed to update GeoIP database.'),
      });
    } finally {
      setGeoIpUpdating(false);
    }
  };

  /**
   * Discards the local draft by reloading the persisted settings and status.
   *
   * @returns {void}
   */
  const handleReset = () => {
    fetchSettings();
  };

  /**
   * Confirms cleanup before removing inactive session details. The server keeps
   * deny hashes for access tokens that have not yet expired.
   *
   * @returns {Promise<void>}
   */
  const handleCleanInactive = async () => {
    if (!confirm(t(
      'settings.general.danger.confirm',
      'Remove all inactive session details? Any unexpired access tokens remain revoked until they expire.'
    ))) {
      return;
    }

    setCleaning(true);
    try {
      const { data } = await post(`/${pluginId}/sessions/clean-inactive`);

      toggleNotification({
        type: 'success',
        message: t('notifications.success.cleaned', 'Removed {count} inactive session records. Unexpired access tokens remain revoked until expiry.', { count: data.deletedCount }),
      });
    } catch (err) {
      toggleNotification({
        type: 'danger',
        message: t('notifications.error.clean', 'Failed to delete inactive sessions'),
      });
    } finally {
      setCleaning(false);
    }
  };

  if (loading) {
    return (
      <PluginPageLayout
        headingId="magic-sessionmanager-settings-title"
        title={t('settings.title', 'Session Manager Settings')}
        subtitle={t('settings.subtitle', 'Configure session tracking, security, and notifications')}
      >
        <Flex justifyContent="center" padding={8}>
          <Loader>{t('common.loading', 'Loading...')}</Loader>
        </Flex>
      </PluginPageLayout>
    );
  }

  return (
    <PluginPageLayout
      headingId="magic-sessionmanager-settings-title"
      title={t('settings.title', 'Session Manager Settings')}
      subtitle={t('settings.subtitle', 'Configure session tracking, security, and notifications')}
      primaryAction={hasChanges ? (
        <Flex gap={2} wrap="wrap">
          <Button onClick={handleReset} variant="tertiary">
            {t('settings.reset', 'Reset')}
          </Button>
          <Button
            onClick={handleSave}
            loading={saving}
            startIcon={<Check />}
            disabled={saving}
            variant="default"
          >
            {saving ? t('settings.saving', 'Saving...') : t('settings.save', 'Save Changes')}
          </Button>
        </Flex>
      ) : null}
    >
      <Container>
      {/* Content */}
      <Box
        paddingTop={{ initial: 4, small: 6 }}
        paddingLeft={{ initial: 3, small: 6 }}
        paddingRight={{ initial: 3, small: 6 }}
        paddingBottom={{ initial: 8, small: 10 }}
      >

        {/* Accordion Layout */}
        <Accordion.Root defaultValue="general">

          {/* General Settings */}
          <Accordion.Item value="general">
            <Accordion.Header>
              <Accordion.Trigger
                icon={Cog}
                description={t('settings.general.description', 'Basic session tracking configuration')}
              >
                {t('settings.general.title', 'General Settings')}
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content>
              <Box padding={{ initial: 3, small: 6 }}>

                {/* Session Timeout */}
                <Typography variant="sigma" fontWeight="bold" textColor="neutral700" style={{ marginBottom: '16px', display: 'block' }}>
                  {t('settings.general.timeout.title', 'SESSION TIMEOUT')}
                </Typography>
                <Grid.Root className="settings-grid" gap={6} style={{ marginBottom: '32px' }}>
                  <Grid.Item col={6} s={12} xs={12}>
                    <FormField
                      id="inactivity-timeout"
                      name="inactivityTimeout"
                      label={t('settings.general.timeout.inactivity', 'Inactivity Timeout')}
                      description={t('settings.general.timeout.inactivityHint', 'Sessions inactive for more than {minutes} minutes will be marked as offline', { minutes: settings.inactivityTimeout })}
                    >
                      <SingleSelect
                        value={String(settings.inactivityTimeout)}
                        onChange={(value) => handleChange('inactivityTimeout', parseInt(value))}
                      >
                        <SingleSelectOption value="5">{t('settings.general.timeout.5min', '5 minutes (Very Strict)')}</SingleSelectOption>
                        <SingleSelectOption value="10">{t('settings.general.timeout.10min', '10 minutes (Strict)')}</SingleSelectOption>
                        <SingleSelectOption value="15">{t('settings.general.timeout.15min', '15 minutes (Recommended)')}</SingleSelectOption>
                        <SingleSelectOption value="30">{t('settings.general.timeout.30min', '30 minutes (Moderate)')}</SingleSelectOption>
                        <SingleSelectOption value="60">{t('settings.general.timeout.1hour', '1 hour (Relaxed)')}</SingleSelectOption>
                        <SingleSelectOption value="120">{t('settings.general.timeout.2hours', '2 hours (Very Relaxed)')}</SingleSelectOption>
                      </SingleSelect>
                    </FormField>
                  </Grid.Item>

                  <Grid.Item col={6} s={12} xs={12}>
                    <FormField
                      id="last-seen-rate-limit"
                      name="lastSeenRateLimit"
                      label={t('settings.general.rateLimit.title', 'Last Seen Rate Limit')}
                      description={t('settings.general.rateLimit.hint', 'Prevents excessive database writes. Updates throttled to once every {seconds} seconds', { seconds: settings.lastSeenRateLimit })}
                    >
                      <SingleSelect
                        value={String(settings.lastSeenRateLimit)}
                        onChange={(value) => handleChange('lastSeenRateLimit', parseInt(value))}
                      >
                        <SingleSelectOption value="10">{t('settings.general.rateLimit.10sec', '10 seconds')}</SingleSelectOption>
                        <SingleSelectOption value="30">{t('settings.general.rateLimit.30sec', '30 seconds (Recommended)')}</SingleSelectOption>
                        <SingleSelectOption value="60">{t('settings.general.rateLimit.1min', '1 minute')}</SingleSelectOption>
                        <SingleSelectOption value="120">{t('settings.general.rateLimit.2min', '2 minutes')}</SingleSelectOption>
                        <SingleSelectOption value="300">{t('settings.general.rateLimit.5min', '5 minutes')}</SingleSelectOption>
                      </SingleSelect>
                    </FormField>
                  </Grid.Item>
                </Grid.Root>

                {/* Cleanup & Retention */}
                <Divider style={{ marginBottom: '24px' }} />
                <Typography variant="sigma" fontWeight="bold" textColor="neutral700" style={{ marginBottom: '16px', display: 'block' }}>
                  {t('settings.general.cleanup.title', 'Auto-cleanup and retention')}
                </Typography>
                <Grid.Root className="settings-grid" gap={6}>
                  <Grid.Item col={6} s={12} xs={12}>
                    <FormField
                      id="cleanup-interval"
                      name="cleanupInterval"
                      label={t('settings.general.cleanup.interval', 'Cleanup Interval')}
                      description={t('settings.general.cleanup.intervalHint', 'Inactive sessions are automatically cleaned every {minutes} minutes', { minutes: settings.cleanupInterval })}
                    >
                      <SingleSelect
                        value={String(settings.cleanupInterval)}
                        onChange={(value) => handleChange('cleanupInterval', parseInt(value))}
                      >
                        <SingleSelectOption value="15">{t('settings.general.cleanup.15min', '15 minutes')}</SingleSelectOption>
                        <SingleSelectOption value="30">{t('settings.general.cleanup.30min', '30 minutes (Recommended)')}</SingleSelectOption>
                        <SingleSelectOption value="60">{t('settings.general.cleanup.1hour', '1 hour')}</SingleSelectOption>
                        <SingleSelectOption value="120">{t('settings.general.cleanup.2hours', '2 hours')}</SingleSelectOption>
                      </SingleSelect>
                    </FormField>
                  </Grid.Item>

                  <Grid.Item col={6} s={12} xs={12}>
                    <FormField
                      id="session-retention-period"
                      name="retentionDays"
                      label={t('settings.general.retention.title', 'Retention Period')}
                      description={settings.retentionDays === -1
                        ? t('settings.general.retention.hintNever', 'Old sessions deleted after never')
                        : t('settings.general.retention.hint', 'Old sessions deleted after {days}', { days: `${settings.retentionDays} days` })}
                    >
                      <SingleSelect
                        value={String(settings.retentionDays)}
                        onChange={(value) => handleChange('retentionDays', parseInt(value))}
                      >
                        <SingleSelectOption value="7">{t('settings.general.retention.7days', '7 days')}</SingleSelectOption>
                        <SingleSelectOption value="30">{t('settings.general.retention.30days', '30 days')}</SingleSelectOption>
                        <SingleSelectOption value="60">{t('settings.general.retention.60days', '60 days')}</SingleSelectOption>
                        <SingleSelectOption value="90">{t('settings.general.retention.90days', '90 days (Recommended)')}</SingleSelectOption>
                        <SingleSelectOption value="180">{t('settings.general.retention.180days', '180 days')}</SingleSelectOption>
                        <SingleSelectOption value="365">{t('settings.general.retention.1year', '1 year')}</SingleSelectOption>
                        <SingleSelectOption value="-1">{t('settings.general.retention.forever', 'Forever')}</SingleSelectOption>
                      </SingleSelect>
                    </FormField>
                  </Grid.Item>

                  <Grid.Item col={6} s={12} xs={12}>
                    <FormField
                      id="session-creation-grace-period"
                      name="sessionCreationGraceMs"
                      label={t('settings.general.grace.title', 'Post-Login Grace Period')}
                      description={t(
                        'settings.general.grace.hint',
                        'Accepts a freshly-issued JWT without a matching session row for this window, preventing strict-enforcement races right after login.'
                      )}
                    >
                      <SingleSelect
                        value={String(settings.sessionCreationGraceMs ?? 5000)}
                        onChange={(value) => handleChange('sessionCreationGraceMs', parseInt(value))}
                      >
                        <SingleSelectOption value="0">{t('settings.general.grace.off', 'Off (strict from first request)')}</SingleSelectOption>
                        <SingleSelectOption value="2000">{t('settings.general.grace.2s', '2 seconds')}</SingleSelectOption>
                        <SingleSelectOption value="5000">{t('settings.general.grace.5s', '5 seconds (Recommended)')}</SingleSelectOption>
                        <SingleSelectOption value="10000">{t('settings.general.grace.10s', '10 seconds')}</SingleSelectOption>
                        <SingleSelectOption value="30000">{t('settings.general.grace.30s', '30 seconds')}</SingleSelectOption>
                      </SingleSelect>
                    </FormField>
                  </Grid.Item>

                  <Grid.Item col={6} s={12} xs={12}>
                    <FormField
                      id="cleanup-strategy"
                      name="cleanupUseDbDirect"
                      label={t('settings.general.cleanupMode.title', 'Cleanup Strategy')}
                      description={t(
                        'settings.general.cleanupMode.hint',
                        'Document Service is the recommended safe strategy. Direct SQL can drain very large idle-session backlogs in one statement but bypasses lifecycle hooks; use it only above 50,000 active sessions.'
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
                  </Grid.Item>

                  <Grid.Item col={12}>
                    <Box padding={4} background="danger100" hasRadius style={{ border: '1px solid rgba(208, 43, 32, 0.24)' }}>
                      <Flex gap={3} alignItems="flex-start">
                        <DangerTrashIcon aria-hidden="true" style={{ width: '18px', height: '18px', marginTop: '2px' }} />
                        <Box style={{ flex: 1 }}>
                          <Typography variant="omega" fontWeight="bold" textColor="danger700" style={{ marginBottom: '8px', display: 'block' }}>
                            {t('settings.general.danger.title', 'Danger Zone')}
                          </Typography>
                          <ReadableText variant="pi" textColor="danger600" tag="p">
                            {t('settings.general.danger.description', 'Clean All Inactive removes session details while keeping unexpired access-token hashes revoked until expiry.')}
                          </ReadableText>
                        </Box>
                        <Button
                          variant="danger-light"
                          onClick={handleCleanInactive}
                          loading={cleaning}
                          startIcon={<Trash />}
                          size="S"
                          style={{ flexShrink: 0 }}
                        >
                          {t('settings.general.danger.cleanNow', 'Clean Now')}
                        </Button>
                      </Flex>
                    </Box>
                  </Grid.Item>
                </Grid.Root>

              </Box>
            </Accordion.Content>
          </Accordion.Item>

          {/* Security Settings */}
          <Accordion.Item value="security">
            <Accordion.Header>
              <Accordion.Trigger
                icon={Shield}
                description={t('settings.security.description', 'Security policies and threat protection')}
              >
                {t('settings.security.title', 'Security Settings')}
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content>
              <Box padding={{ initial: 3, small: 6 }}>

                <Typography variant="sigma" fontWeight="bold" textColor="neutral700" style={{ marginBottom: '16px', display: 'block' }}>
                  {t('settings.security.options', 'SECURITY OPTIONS')}
                </Typography>

                {/* Encryption Key Generator */}
                <SettingsSectionCard
                  background="neutral0"
                  padding={{ initial: 3, small: 6 }}
                >
                  <Flex direction="column" gap={4}>
                    <Flex alignItems="center" gap={3}>
                      <PrimaryShieldIcon aria-hidden="true" style={{ width: 24, height: 24 }} />
                      <Typography variant="delta" fontWeight="bold">
                        {t('settings.security.encryption.title', 'JWT Encryption Key Generator')}
                      </Typography>
                    </Flex>

                    <ReadableText variant="omega" textColor="neutral600" tag="p">
                      {t('settings.security.encryption.description', 'Generate a secure 32-character encryption key for JWT token storage. This key is used to encrypt tokens before saving them to the database.')}
                    </ReadableText>

                    <Alert
                      variant="default"
                      closeLabel={t('settings.common.close', 'Close')}
                      title={t('settings.security.encryption.important', 'Important')}
                      style={{ marginTop: 8 }}
                    >
                      <ReadableText variant="pi" textColor="neutral700" tag="span">
                        {t('settings.security.encryption.envHint', 'Add this key to your .env file as SESSION_ENCRYPTION_KEY for production.')}
                      </ReadableText>
                    </Alert>

                    <EncryptionKeyControls gap={3}>
                      <Box style={{ flex: '1 1 0', minWidth: 0 }}>
                        <FormField
                          id="session-encryption-key"
                          name="sessionEncryptionKey"
                          label={t('settings.security.encryption.label', 'Generated Encryption Key')}
                          description={t('settings.security.encryption.fieldHint', 'The key stays masked until you choose to show it.')}
                        >
                          <TextInput
                            value={encryptionKey}
                            onChange={(e) => setEncryptionKey(e.target.value)}
                            placeholder={t('settings.security.encryption.placeholder', "Click 'Generate Key' to create a secure key")}
                            type={showEncryptionKey ? 'text' : 'password'}
                          />
                        </FormField>
                      </Box>
                        <Button
                        variant="tertiary"
                        onClick={() => setShowEncryptionKey(!showEncryptionKey)}
                        size="L"
                          style={{ flexShrink: 0 }}
                      >
                        {showEncryptionKey ? t('settings.security.encryption.hide', 'Hide') : t('settings.security.encryption.show', 'Show')}
                      </Button>
                    </EncryptionKeyControls>

                    <Flex gap={3} wrap="wrap" style={{ width: '100%', minWidth: 0 }}>
                      <Button
                        variant="default"
                        startIcon={<Code />}
                        onClick={() => {
                          const key = generateSecureKey();
                          setEncryptionKey(key);
                          setShowEncryptionKey(true);
                          toggleNotification({
                            type: 'success',
                            message: t('notifications.success.keyGenerated', '32-character encryption key generated!')
                          });
                        }}
                        size="L"
                      >
                        {t('settings.security.encryption.generate', 'Generate Key')}
                      </Button>

                      <Button
                        variant="secondary"
                        startIcon={<Duplicate />}
                        onClick={() => copyValue(
                          encryptionKey,
                          t('notifications.success.keyCopied', 'Encryption key copied to clipboard.'),
                          'settings.copyEncryptionKey'
                        )}
                        disabled={!encryptionKey}
                        size="L"
                      >
                        {t('settings.security.encryption.copy', 'Copy to Clipboard')}
                      </Button>

                      <Button
                        variant="secondary"
                        startIcon={<Duplicate />}
                        onClick={() => copyValue(
                          `SESSION_ENCRYPTION_KEY=${encryptionKey}`,
                          t('notifications.success.envCopied', 'Copied in .env format.'),
                          'settings.copyEncryptionKeyEnv'
                        )}
                        disabled={!encryptionKey}
                        size="L"
                      >
                        {t('settings.security.encryption.copyEnv', 'Copy for .env')}
                      </Button>
                    </Flex>

                    {encryptionKey && (
                      <Box
                        padding={4}
                        background="neutral100"
                        style={{
                          borderRadius: '4px',
                          border: '1px solid ' + 'rgba(128, 128, 128, 0.2)',
                          fontFamily: 'monospace',
                          fontSize: '12px',
                          wordBreak: 'break-all'
                        }}
                      >
                        <Typography variant="omega" fontWeight="bold" style={{ marginBottom: 8, display: 'block' }}>
                          {t('settings.security.encryption.envLabel', 'Add to .env file:')}
                        </Typography>
                        <EncryptionKeyValue>
                          SESSION_ENCRYPTION_KEY={showEncryptionKey ? encryptionKey : maskSensitiveValue(encryptionKey)}
                        </EncryptionKeyValue>
                      </Box>
                    )}
                  </Flex>
                </SettingsSectionCard>

                {/* Session Enforcement Policy */}
                <SettingsSectionCard
                  background="neutral0"
                  padding={{ initial: 3, small: 6 }}
                >
                  <Flex direction="column" gap={4}>
                    <Flex alignItems="center" gap={3} wrap="wrap">
                      <PrimaryShieldIcon aria-hidden="true" style={{ width: 24, height: 24 }} />
                      <Typography variant="delta" fontWeight="bold" tag="h2" style={{ minWidth: 0 }}>
                        {t('settings.security.enforcement.title', 'Session Enforcement Policy')}
                      </Typography>
                      <Badge backgroundColor={settings.strictSessionEnforcement ? 'danger100' : 'neutral100'} textColor={settings.strictSessionEnforcement ? 'danger700' : 'neutral700'}>
                        {settings.strictSessionEnforcement
                          ? t('settings.security.enforcement.badgeStrict', 'STRICT')
                          : t('settings.security.enforcement.badgeRelaxed', 'RELAXED')}
                      </Badge>
                    </Flex>

                    <ReadableParagraphs
                      variant="omega"
                      textColor="neutral600"
                      tag="p"
                      text={t(
                        'settings.security.enforcement.description',
                        'Controls how aggressively JWT tokens are tied to an active session record.\n\nStrict mode rejects any token without a matching session. This is more secure, but tokens issued before this plugin was installed will also be rejected.'
                      )}
                    />

                    <Grid.Root className="settings-grid" gap={6}>
                      <Grid.Item col={12} s={12}>
                        <SettingsToggleRow
                          id="strict-session-enforcement"
                          title={t('settings.security.enforcement.strict.title', 'Strict Session Enforcement')}
                          description={t('settings.security.enforcement.strict.description', 'Reject every authenticated request that does not have a matching session record. Recommended for production.')}
                          checked={settings.strictSessionEnforcement}
                          onChange={(checked) => handleChange('strictSessionEnforcement', checked)}
                        />
                      </Grid.Item>

                      <Grid.Item col={6} s={12} xs={12}>
                        <FormField
                          id="max-session-age"
                          name="maxSessionAgeDays"
                          label={<><Clock aria-hidden="true" style={{ width: 14, height: 14, verticalAlign: 'middle', marginRight: 6 }} />{t('settings.security.enforcement.maxAge.title', 'Max Session Age')}</>}
                          description={t('settings.security.enforcement.maxAge.hint', 'Sessions older than {days} days are automatically terminated, even if still active.', { days: settings.maxSessionAgeDays })}
                        >
                          <SingleSelect
                            value={String(settings.maxSessionAgeDays)}
                            onChange={(value) => handleChange('maxSessionAgeDays', parseInt(value))}
                          >
                            <SingleSelectOption value="1">{t('settings.security.enforcement.maxAge.1day', '1 day (Very Strict)')}</SingleSelectOption>
                            <SingleSelectOption value="7">{t('settings.security.enforcement.maxAge.7days', '7 days')}</SingleSelectOption>
                            <SingleSelectOption value="14">{t('settings.security.enforcement.maxAge.14days', '14 days')}</SingleSelectOption>
                            <SingleSelectOption value="30">{t('settings.security.enforcement.maxAge.30days', '30 days (Recommended)')}</SingleSelectOption>
                            <SingleSelectOption value="60">{t('settings.security.enforcement.maxAge.60days', '60 days')}</SingleSelectOption>
                            <SingleSelectOption value="90">{t('settings.security.enforcement.maxAge.90days', '90 days')}</SingleSelectOption>
                            <SingleSelectOption value="180">{t('settings.security.enforcement.maxAge.180days', '180 days')}</SingleSelectOption>
                            <SingleSelectOption value="365">{t('settings.security.enforcement.maxAge.365days', '1 year')}</SingleSelectOption>
                          </SingleSelect>
                        </FormField>
                      </Grid.Item>

                      <Grid.Item col={6} s={12} xs={12}>
                        <SettingsToggleRow
                          id="trusted-proxies"
                          title={t('settings.security.enforcement.trustedProxies.title', 'Trust Upstream Proxy')}
                          description={t('settings.security.enforcement.trustedProxies.description', 'Only enable when Strapi sits behind a trusted reverse proxy (nginx, Cloudflare). Otherwise clients can spoof X-Forwarded-For.')}
                          checked={settings.trustedProxies}
                          onChange={(checked) => handleChange('trustedProxies', checked)}
                        />
                      </Grid.Item>
                    </Grid.Root>

                    {!settings.strictSessionEnforcement && !relaxedWarningDismissed && (
                    <RelaxedModeAlert
                        variant="warning"
                        closeLabel={t('settings.common.close', 'Close')}
                        onClose={() => setRelaxedWarningDismissed(true)}
                        title={t('settings.security.enforcement.warning.title', 'Running in Relaxed Mode')}
                      >
                        <ReadableParagraphs
                          variant="pi"
                          textColor="neutral700"
                          tag="span"
                          text={t(
                            'settings.security.enforcement.warning.body',
                            'Tokens without a matching session record are allowed through.\n\nManual session termination is still enforced via the token hash. We strongly recommend enabling strict mode in production.'
                          )}
                        />
                    </RelaxedModeAlert>
                    )}
                  </Flex>
                </SettingsSectionCard>

                {/* Feature Toggles */}
                <Grid.Root className="settings-grid" gap={4} style={{ marginBottom: '32px' }}>
                  <Grid.Item col={12}>
                    <SettingsToggleRow
                      id="block-suspicious-sessions"
                      title={t('settings.security.blockSuspicious.title', 'Block Suspicious Sessions')}
                      description={t('settings.security.blockSuspicious.description', 'Automatically block sessions from VPNs, proxies, or threat IPs')}
                      checked={settings.blockSuspiciousSessions}
                      onChange={(checked) => handleChange('blockSuspiciousSessions', checked)}
                    />
                  </Grid.Item>

                  <Grid.Item col={12}>
                    <SettingsToggleRow
                      id="enable-ip-geolocation"
                      title={t('settings.security.geolocation.title', 'IP Geolocation')}
                      description={t('settings.security.geolocation.description', 'Fetch location data for each session')}
                      checked={settings.enableGeolocation}
                      onChange={(checked) => handleChange('enableGeolocation', checked)}
                    />
                  </Grid.Item>

                  <Grid.Item col={12}>
                    <SettingsToggleRow
                      id="enable-security-scoring"
                      title={t('settings.security.scoring.title', 'Security Scoring')}
                      description={t('settings.security.scoring.description', 'Calculate security scores and detect threats')}
                      checked={settings.enableSecurityScoring}
                      onChange={(checked) => handleChange('enableSecurityScoring', checked)}
                    />
                  </Grid.Item>
                </Grid.Root>

                {/* Max Failed Logins */}
                <Grid.Root className="settings-grid" gap={6}>
                  <Grid.Item col={12}>
                    <FormField
                      id="max-failed-logins"
                      name="maxFailedLogins"
                      label={t('settings.security.maxFailed.title', 'Max Failed Login Attempts')}
                      description={t('settings.security.maxFailed.hint', 'Set how many consecutive login failures are allowed before the protective action applies.')}
                    >
                      <NumberInput
                        key={maxFailedLoginInputRevision}
                        value={settings.maxFailedLogins}
                        onValueChange={(value) => {
                          const normalizedValue = value === undefined
                            ? undefined
                            : Math.max(0, Math.min(value, 100));
                          handleChange('maxFailedLogins', normalizedValue);
                          if (value !== normalizedValue) {
                            setMaxFailedLoginInputRevision((revision) => revision + 1);
                          }
                        }}
                        min={0}
                        max={100}
                      />
                      <Box padding={2} background="warning50" hasRadius style={{ marginTop: '8px' }}>
                        <Typography variant="pi" textColor="warning700" style={{ fontSize: '11px' }}>
                          {Number(settings.maxFailedLogins) === 0
                            ? t('settings.security.maxFailed.disabled', 'Login lockout is disabled')
                            : t('settings.security.maxFailed.hint', 'User will be blocked after {count} failed attempts', { count: settings.maxFailedLogins })}
                        </Typography>
                      </Box>
                    </FormField>
                  </Grid.Item>
                </Grid.Root>

              </Box>
            </Accordion.Content>
          </Accordion.Item>

          {/* Geofencing */}
          <Accordion.Item value="geofencing">
            <Accordion.Header>
              <Accordion.Trigger
                icon={Shield}
                description={t('settings.geofencing.description', 'Allow or block sign-ins by country')}
              >
                {t('settings.geofencing.title', 'Geofencing')}
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content>
              <Box padding={{ initial: 3, small: 6 }}>
                <GeofencingPanel
                  settings={settings}
                  handleChange={handleChange}
                  t={t}
                  geoIpStatus={geoIpStatus}
                  geoIpCredentials={geoIpCredentials}
                  setGeoIpCredentials={setGeoIpCredentials}
                  onSaveGeoIpCredentials={handleSaveGeoIpCredentials}
                  onUpdateGeoIp={handleUpdateGeoIpDatabase}
                  geoIpUpdating={geoIpUpdating}
                  geoIpSavingCredentials={geoIpSavingCredentials}
                  hasChanges={hasChanges}
                />
              </Box>
            </Accordion.Content>
          </Accordion.Item>

          {/* Email Notifications */}
          <Accordion.Item value="email">
              <Accordion.Header>
                <Accordion.Trigger
                  icon={Mail}
                  description={t('settings.email.description', 'Email alerts for security events')}
                >
                  {t('settings.email.title', 'Email Notifications')}
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content>
                <Box padding={{ initial: 3, small: 6 }}>

                  {/* Email Alerts Toggle */}
                  <Box background="neutral100" padding={5} hasRadius style={{ marginBottom: '32px' }}>
                    <Typography variant="sigma" fontWeight="bold" textColor="neutral700" style={{ marginBottom: '8px', display: 'block', textAlign: 'center' }}>
                      {t('settings.email.alerts.title', 'Email alerts')}
                    </Typography>
                    <Typography variant="pi" textColor="neutral600" style={{ marginBottom: '20px', display: 'block', textAlign: 'center', fontSize: '12px' }}>
                      {t('settings.email.alerts.subtitle', 'Send security alerts to users via email')}
                    </Typography>
                    <Grid.Root className="settings-grid" gap={4}>
                      <Grid.Item col={12}>
                        <SettingsToggleRow
                          id="enable-email-alerts"
                          title={t('settings.email.enable.title', 'Enable Email Alerts')}
                          description={t('settings.email.enable.description', 'Send security alerts for suspicious logins, new locations, and VPN/Proxy usage')}
                          checked={settings.enableEmailAlerts}
                          onChange={(checked) => handleChange('enableEmailAlerts', checked)}
                        />
                      </Grid.Item>
                    </Grid.Root>
                  </Box>

                  {/* Alert Type Checkboxes */}
                  {settings.enableEmailAlerts && (
                    <>
                      <Typography variant="sigma" fontWeight="bold" textColor="neutral700" style={{ marginBottom: '16px', display: 'block' }}>
                        {t('settings.email.types.title', 'Alert types')}
                      </Typography>
                      <ReadableText variant="pi" textColor="neutral600" tag="p">
                        {t('settings.email.types.description', 'Choose which security events should send an email alert.')}
                      </ReadableText>
                      <Grid.Root className="settings-grid" gap={4} style={{ marginBottom: '32px' }}>
                        <Grid.Item col={4} s={12} xs={12}>
                          <AlertTypeCard padding={4} $selected={settings.alertOnSuspiciousLogin}>
                            <Checkbox
                              checked={settings.alertOnSuspiciousLogin}
                              onCheckedChange={(checked) => handleChange('alertOnSuspiciousLogin', checked === true)}
                            >
                              <Typography variant="omega" fontWeight="semiBold" style={{ fontSize: '14px' }}>
                                {t('settings.email.types.suspicious', 'Suspicious Login')}
                              </Typography>
                            </Checkbox>
                          </AlertTypeCard>
                        </Grid.Item>
                        <Grid.Item col={4} s={12} xs={12}>
                          <AlertTypeCard padding={4} $selected={settings.alertOnNewLocation}>
                            <Checkbox
                              checked={settings.alertOnNewLocation}
                              onCheckedChange={(checked) => handleChange('alertOnNewLocation', checked === true)}
                            >
                              <Typography variant="omega" fontWeight="semiBold" style={{ fontSize: '14px' }}>
                                {t('settings.email.types.newLocation', 'New Location')}
                              </Typography>
                            </Checkbox>
                          </AlertTypeCard>
                        </Grid.Item>
                        <Grid.Item col={4} s={12} xs={12}>
                          <AlertTypeCard padding={4} $selected={settings.alertOnVpnProxy}>
                            <Checkbox
                              checked={settings.alertOnVpnProxy}
                              onCheckedChange={(checked) => handleChange('alertOnVpnProxy', checked === true)}
                            >
                              <Typography variant="omega" fontWeight="semiBold" style={{ fontSize: '14px' }}>
                                {t('settings.email.types.vpnProxy', 'VPN/Proxy')}
                              </Typography>
                            </Checkbox>
                          </AlertTypeCard>
                        </Grid.Item>
                      </Grid.Root>

                      {/* Email Templates */}
                      <Divider style={{ marginBottom: '24px' }} />
                      <Typography variant="sigma" fontWeight="bold" textColor="neutral700" style={{ marginBottom: '8px', display: 'block' }}>
                        {t('settings.email.templates.title', 'EMAIL TEMPLATES')}
                      </Typography>
                      <ReadableText variant="pi" textColor="neutral600" tag="p">
                        {t('settings.email.templates.subtitle', 'Customize email notification templates with dynamic variables')}
                      </ReadableText>

                      {/* Template Tabs */}
                      <Tabs.Root value={activeTemplateTab} onValueChange={setActiveTemplateTab}>
                        <Tabs.List
                          aria-label="Email Templates"
                          style={{ width: '100%', minWidth: 0, flexWrap: 'wrap' }}
                        >
                          <Tabs.Trigger value="suspiciousLogin">{t('settings.email.templates.tab.suspicious', 'Suspicious Login')}</Tabs.Trigger>
                          <Tabs.Trigger value="newLocation">{t('settings.email.templates.tab.newLocation', 'New Location')}</Tabs.Trigger>
                          <Tabs.Trigger value="vpnProxy">{t('settings.email.templates.tab.vpnProxy', 'VPN/Proxy')}</Tabs.Trigger>
                        </Tabs.List>

                        {Object.keys(settings.emailTemplates).map((templateKey) => (
                          <Tabs.Content key={templateKey} value={templateKey}>
                            <Box paddingTop={4}>
                              {/* Subject */}
                              <Box style={{ marginBottom: '24px' }}>
                                <FormField
                                  id={`email-template-subject-${templateKey}`}
                                  name={`emailTemplateSubject-${templateKey}`}
                                  label={t('settings.email.templates.subject', 'Email Subject')}
                                  description={t('settings.email.templates.subjectHint', 'This subject line is used for the selected alert type.')}
                                >
                                  <TextInput
                                    value={settings.emailTemplates[templateKey].subject}
                                    onChange={(e) => {
                                      const newTemplates = { ...settings.emailTemplates };
                                      newTemplates[templateKey].subject = e.target.value;
                                      handleChange('emailTemplates', newTemplates);
                                    }}
                                    placeholder={t('settings.email.templates.subjectPlaceholder', 'Enter email subject...')}
                                  />
                                </FormField>
                              </Box>

                              {/* Available Variables */}
                              <Box
                                padding={3}
                                background="primary100"
                                style={{ borderRadius: '4px', marginBottom: '20px', border: '1px solid rgba(73, 69, 255, 0.16)' }}
                              >
                                <Flex direction="column" gap={2}>
                                  <Flex alignItems="center" gap={2}>
                                    <PrimaryCodeIcon aria-hidden="true" style={{ width: '16px', height: '16px' }} />
                                    <Typography variant="omega" fontWeight="bold" textColor="primary600">
                                      {t('settings.email.templates.variables', 'Available Variables (click to copy)')}
                                    </Typography>
                                  </Flex>
                                  <Flex gap={2} wrap="wrap">
                                    {TEMPLATE_VARIABLES[templateKey].map(({ var: variable, desc }) => (
                                      <Button
                                        key={variable}
                                        size="S"
                                        variant="tertiary"
                                        onClick={() => copyValue(
                                          variable,
                                          t('notifications.success.variableCopied', '{variable} copied.', { variable }),
                                          'settings.copyTemplateVariable'
                                        )}
                                        style={{
                                          fontFamily: 'monospace',
                                          fontSize: '11px',
                                          padding: '4px 8px',
                                        }}
                                        title={desc}
                                      >
                                        {variable}
                                      </Button>
                                    ))}
                                  </Flex>
                                </Flex>
                              </Box>

                              {/* HTML Template - VS Code Style Editor */}
                              <Box
                                background="neutral0"
                                padding={{ initial: 2, small: 6 }}
                                style={{ borderRadius: '4px', border: '1px solid rgba(128, 128, 128, 0.2)', width: '100%', marginBottom: '24px' }}
                              >
                                <Flex justifyContent="space-between" alignItems="center" style={{ marginBottom: '16px' }}>
                                  <Flex alignItems="center" gap={2}>
                                    <Typography variant="delta" fontWeight="bold" style={{ fontSize: '18px' }}>
                                      🎨 {t('settings.email.templates.html.title', 'HTML Template')}
                                    </Typography>
                                    <Badge variant="success">{t('settings.email.templates.html.badge', 'Main Template')}</Badge>
                                  </Flex>
                                  <Button
                                    variant="tertiary"
                                    size="S"
                                    onClick={() => {
                                      const defaultTemplates = getDefaultTemplates();
                                      const newTemplates = { ...settings.emailTemplates };
                                      newTemplates[templateKey].html = defaultTemplates[templateKey].html;
                                      handleChange('emailTemplates', newTemplates);
                                      toggleNotification({ type: 'success', message: t('notifications.success.defaultLoaded', 'Default template loaded!') });
                                    }}
                                  >
                                    {t('settings.email.templates.html.loadDefault', 'Load Default')}
                                  </Button>
                                </Flex>
                                <FormField
                                  id={`email-template-html-${templateKey}`}
                                  name={`emailTemplateHtml-${templateKey}`}
                                  label={t('settings.email.templates.html.editorLabel', 'HTML template source')}
                                  description={t('settings.email.templates.html.description', 'HTML template for email notifications. Use variables like {{user.email}} for dynamic content.')}
                                >
                                  <Box
                                    style={{
                                      border: '1px solid rgba(128, 128, 128, 0.3)',
                                      borderRadius: '4px',
                                      overflow: 'hidden',
                                      background: '#1e1e1e',
                                      height: 'min(500px, 60vh)',
                                      display: 'flex',
                                      flexDirection: 'column'
                                    }}
                                  >
                                    <Box
                                      padding={2}
                                      background="neutral700"
                                      style={{ borderBottom: '1px solid #333', flexShrink: 0 }}
                                    >
                                      <Typography variant="omega" style={{ color: '#888', fontSize: '11px', fontFamily: 'monospace' }}>
                                        template.html
                                      </Typography>
                                    </Box>
                                    <textarea
                                      id={`email-template-html-${templateKey}`}
                                      name={`emailTemplateHtml-${templateKey}`}
                                      aria-describedby={`email-template-html-${templateKey}-hint`}
                                      value={settings.emailTemplates[templateKey].html}
                                      onChange={(e) => {
                                        const newTemplates = { ...settings.emailTemplates };
                                        newTemplates[templateKey].html = e.target.value;
                                        handleChange('emailTemplates', newTemplates);
                                      }}
                                      style={{
                                        fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                                        flex: 1,
                                        minHeight: 0,
                                        fontSize: '14px',
                                        lineHeight: '1.6',
                                        background: '#1e1e1e',
                                        color: '#d4d4d4',
                                        border: 'none',
                                        padding: '16px',
                                        resize: 'vertical',
                                        width: '100%',
                                        boxSizing: 'border-box',
                                        outline: 'none',
                                        margin: 0,
                                        display: 'block',
                                        overflow: 'auto'
                                      }}
                                      placeholder="Enter HTML template with variables like {{user.email}}..."
                                    />
                                  </Box>
                                </FormField>
                                <Flex gap={2} style={{ marginTop: '12px' }} wrap="wrap">
                                  <Button
                                    variant="secondary"
                                    size="S"
                                    onClick={() => copyValue(
                                      settings.emailTemplates[templateKey].html,
                                      t('notifications.success.htmlCopied', 'HTML template copied.'),
                                      'settings.copyHtmlTemplate'
                                    )}
                                  >
                                    {t('settings.email.templates.html.copy', 'Copy Template')}
                                  </Button>
                                  <Button
                                    variant="secondary"
                                    size="S"
                                    onClick={() => {
                                      const validation = validateTemplate(settings.emailTemplates[templateKey].html, templateKey);
                                      toggleNotification({
                                        type: validation.isValid ? 'success' : 'warning',
                                        message: validation.isValid
                                          ? t('notifications.success.validated', 'Template valid! Found {found}/{total} variables.', { found: validation.foundVars.length, total: validation.totalAvailable })
                                          : t('notifications.warning.noVariables', '[WARNING] No variables found. Add at least one variable.'),
                                      });
                                    }}
                                  >
                                    {t('settings.email.templates.html.validate', 'Validate')}
                                  </Button>
                                  <Button
                                    variant="tertiary"
                                    size="S"
                                    onClick={() => {
                                      const lines = settings.emailTemplates[templateKey].html.split('\n').length;
                                      const chars = settings.emailTemplates[templateKey].html.length;
                                      toggleNotification({
                                        type: 'info',
                                        message: t('notifications.info.templateStats', 'Template has {lines} lines and {chars} characters', { lines, chars })
                                      });
                                    }}
                                  >
                                    {t('settings.email.templates.html.info', 'Template Info')}
                                  </Button>
                                </Flex>
                              </Box>

                              {/* Text Template - VS Code Style Editor */}
                              <Box
                                background="neutral0"
                                padding={{ initial: 2, small: 6 }}
                                style={{ borderRadius: '4px', border: '1px solid rgba(128, 128, 128, 0.2)', width: '100%', marginBottom: '24px' }}
                              >
                                <Flex justifyContent="space-between" alignItems="center" style={{ marginBottom: '16px' }}>
                                  <Flex alignItems="center" gap={2}>
                                    <Typography variant="delta" fontWeight="bold" style={{ fontSize: '18px' }}>
                                      📄 {t('settings.email.templates.text.title', 'Text Template')}
                                    </Typography>
                                    <Badge variant="secondary">{t('settings.email.templates.text.badge', 'Fallback')}</Badge>
                                  </Flex>
                                  <Button
                                    variant="tertiary"
                                    size="S"
                                    onClick={() => {
                                      const defaultTemplates = getDefaultTemplates();
                                      const newTemplates = { ...settings.emailTemplates };
                                      newTemplates[templateKey].text = defaultTemplates[templateKey].text;
                                      handleChange('emailTemplates', newTemplates);
                                      toggleNotification({ type: 'success', message: t('notifications.success.defaultLoaded', 'Default template loaded!') });
                                    }}
                                  >
                                    {t('settings.email.templates.text.loadDefault', 'Load Default')}
                                  </Button>
                                </Flex>
                                <FormField
                                  id={`email-template-text-${templateKey}`}
                                  name={`emailTemplateText-${templateKey}`}
                                  label={t('settings.email.templates.text.editorLabel', 'Plain text template source')}
                                  description={t('settings.email.templates.text.description', 'Plain text version (no HTML) as fallback for older email clients')}
                                >
                                  <Box
                                    style={{
                                      border: '1px solid rgba(128, 128, 128, 0.3)',
                                      borderRadius: '4px',
                                      overflow: 'hidden',
                                      background: '#1e1e1e',
                                      height: 'min(320px, 45vh)',
                                      display: 'flex',
                                      flexDirection: 'column'
                                    }}
                                  >
                                    <Box
                                      padding={2}
                                      background="neutral700"
                                      style={{ borderBottom: '1px solid #333', flexShrink: 0 }}
                                    >
                                      <Typography variant="omega" style={{ color: '#888', fontSize: '11px', fontFamily: 'monospace' }}>
                                        template.txt
                                      </Typography>
                                    </Box>
                                    <textarea
                                      id={`email-template-text-${templateKey}`}
                                      name={`emailTemplateText-${templateKey}`}
                                      aria-describedby={`email-template-text-${templateKey}-hint`}
                                      value={settings.emailTemplates[templateKey].text}
                                      onChange={(e) => {
                                        const newTemplates = { ...settings.emailTemplates };
                                        newTemplates[templateKey].text = e.target.value;
                                        handleChange('emailTemplates', newTemplates);
                                      }}
                                      style={{
                                        fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                                        flex: 1,
                                        minHeight: 0,
                                        fontSize: '14px',
                                        lineHeight: '1.6',
                                        background: '#1e1e1e',
                                        color: '#d4d4d4',
                                        border: 'none',
                                        padding: '16px',
                                        resize: 'vertical',
                                        width: '100%',
                                        boxSizing: 'border-box',
                                        outline: 'none',
                                        margin: 0,
                                        display: 'block',
                                        overflow: 'auto'
                                      }}
                                      placeholder="Plain text version (no HTML)..."
                                    />
                                  </Box>
                                </FormField>
                                <Flex gap={2} style={{ marginTop: '12px' }} wrap="wrap">
                                  <Button
                                    variant="secondary"
                                    size="S"
                                    onClick={() => copyValue(
                                      settings.emailTemplates[templateKey].text,
                                      t('notifications.success.textCopied', 'Text template copied.'),
                                      'settings.copyTextTemplate'
                                    )}
                                  >
                                    {t('settings.email.templates.text.copy', 'Copy Template')}
                                  </Button>
                                </Flex>
                              </Box>
                            </Box>
                          </Tabs.Content>
                        ))}
                      </Tabs.Root>
                    </>
                  )}

                </Box>
              </Accordion.Content>
          </Accordion.Item>

          {/* Webhooks */}
          <Accordion.Item value="webhooks">
              <Accordion.Header>
                <Accordion.Trigger
                  icon={Code}
                  description={t('settings.webhooks.description', 'Discord & Slack integration')}
                >
                  {t('settings.webhooks.title', 'Webhook Integration')}
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content>
                <Box padding={{ initial: 3, small: 6 }}>

                  {/* Enable Webhooks Toggle */}
                  <Box background="neutral100" padding={5} hasRadius style={{ marginBottom: '32px' }}>
                    <Grid.Root className="settings-grid" gap={4}>
                      <Grid.Item col={12}>
                        <SettingsToggleRow
                          id="enable-webhooks"
                          title={t('settings.webhooks.enable.title', 'Enable Webhooks')}
                          description={t('settings.webhooks.enable.description', 'Send session events to Discord, Slack, or custom endpoints')}
                          checked={settings.enableWebhooks}
                          onChange={(checked) => handleChange('enableWebhooks', checked)}
                        />
                      </Grid.Item>
                    </Grid.Root>
                  </Box>

                  {/* Webhook URLs */}
                  {settings.enableWebhooks && (
                    <Grid.Root className="settings-grid" gap={6}>
                      <Grid.Item col={12}>
                        <Box>
                          <FormField
                            id="discord-webhook-url"
                            name="discordWebhookUrl"
                            label={t('settings.webhooks.discord.title', 'Discord Webhook URL')}
                            description={t('settings.webhooks.discord.hint', 'Optional: Post session alerts to your Discord channel')}
                          >
                            <WebhookInputFrame>
                              <textarea
                                id="discord-webhook-url"
                                name="discordWebhookUrl"
                                aria-describedby="discord-webhook-url-hint"
                                placeholder={t('settings.webhooks.discord.placeholder', 'https://discord.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz...')}
                                value={settings.discordWebhookUrl}
                                onChange={(e) => handleChange('discordWebhookUrl', e.target.value)}
                                rows={3}
                                style={{
                                  width: '100%',
                                  padding: '14px 18px',
                                  border: 'none',
                                  outline: 'none',
                                  fontFamily: 'Monaco, Consolas, monospace',
                                  fontSize: '14px',
                                  lineHeight: '1.6',
                                  background: 'transparent',
                                  resize: 'vertical',
                                  minHeight: '80px',
                                  boxSizing: 'border-box',
                                }}
                              />
                            </WebhookInputFrame>
                          </FormField>
                          {settings.discordWebhookUrl && (
                            <Typography variant="pi" textColor="primary600" style={{ fontSize: '11px', fontFamily: 'monospace', display: 'block', marginTop: '8px' }}>
                              {t('settings.webhooks.characters', '{count} characters', { count: settings.discordWebhookUrl.length })}
                            </Typography>
                          )}
                        </Box>
                      </Grid.Item>

                      <Grid.Item col={12}>
                        <Box>
                          <FormField
                            id="slack-webhook-url"
                            name="slackWebhookUrl"
                            label={t('settings.webhooks.slack.title', 'Slack Webhook URL')}
                            description={t('settings.webhooks.slack.hint', 'Optional: Post session alerts to your Slack workspace')}
                          >
                            <WebhookInputFrame>
                              <textarea
                                id="slack-webhook-url"
                                name="slackWebhookUrl"
                                aria-describedby="slack-webhook-url-hint"
                                placeholder={t('settings.webhooks.slack.placeholder', 'https://hooks.slack.com/services/XXXX/XXXX/XXXX')}
                                value={settings.slackWebhookUrl}
                                onChange={(e) => handleChange('slackWebhookUrl', e.target.value)}
                                rows={3}
                                style={{
                                  width: '100%',
                                  padding: '14px 18px',
                                  border: 'none',
                                  outline: 'none',
                                  fontFamily: 'Monaco, Consolas, monospace',
                                  fontSize: '14px',
                                  lineHeight: '1.6',
                                  background: 'transparent',
                                  resize: 'vertical',
                                  minHeight: '80px',
                                  boxSizing: 'border-box',
                                }}
                              />
                            </WebhookInputFrame>
                          </FormField>
                          {settings.slackWebhookUrl && (
                            <Typography variant="pi" textColor="primary600" style={{ fontSize: '11px', fontFamily: 'monospace', display: 'block', marginTop: '8px' }}>
                              {t('settings.webhooks.characters', '{count} characters', { count: settings.slackWebhookUrl.length })}
                            </Typography>
                          )}
                        </Box>
                      </Grid.Item>
                    </Grid.Root>
                  )}

                </Box>
              </Accordion.Content>
          </Accordion.Item>

        </Accordion.Root>

         {/* Footer Info */}
         <SettingsFooterCard padding={4} background="neutral100">
           <Flex gap={3} alignItems="flex-start">
             <PrimaryCheckIcon aria-hidden="true" style={{ width: '20px', height: '20px', marginTop: '2px' }} />
             <Box style={{ flex: 1 }}>
               <Typography variant="omega" fontWeight="bold" textColor="neutral800" style={{ marginBottom: '8px', display: 'block' }}>
                 {t('settings.footer.title', 'Database-Backed Settings')}
               </Typography>
               <ReadableParagraphs
                 variant="pi"
                 textColor="neutral700"
                 tag="p"
                 text={t(
                   'settings.footer.description',
                   'All settings are stored in your Strapi database and shared across all admin users.\n\nChanges take effect immediately, with no server restart required.\n\nEmail templates, webhooks, and security options are managed from this interface.'
                 )}
               />
             </Box>
           </Flex>
         </SettingsFooterCard>

      </Box>
      </Container>
    </PluginPageLayout>
  );
};

export default SettingsPage;
