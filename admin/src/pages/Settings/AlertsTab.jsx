import { useId } from 'react';
import { Box, Checkbox, Flex, Typography } from '@strapi/design-system';
import styled from 'styled-components';
import { EqualGrid, SectionCard } from '../../components/ui';
import FormField from '../../components/FormField';
import ReadableText from '../../components/ReadableText';
import SettingsToggleRow from '../../components/SettingsToggleRow';
import Alert from '../../components/PersistentAlert';
import { fieldHasError } from './settingsTabs.mjs';
import EmailTemplatesCard from './EmailTemplatesCard';
import SecretTextInput from './SecretTextInput';
import { SettingsTabLink } from './SettingsNavigation';
import { AdvancedSection, IntroText, RequiresNotice } from './SettingsBlocks';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

/** Webhook event names (protocol values, not translated). */
const WEBHOOK_EVENTS = Object.freeze({
  suspicious: 'login.suspicious',
  newLocation: 'login.new_location',
  success: 'login.success',
});

/**
 * Email types side by side when the card is wide enough for three readable
 * cells, else one per row. It follows the card width (container query), not
 * the viewport, so a 2 + 1 split with a lonely third cell never happens.
 */
const EmailTypeGrid = styled.div`
  container-type: inline-size;
  min-width: 0;

  & > div {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: ${({ theme }) => theme.spaces[4]};
  }

  @container (min-width: 640px) {
    & > div {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
`;

/**
 * Bordered cell around one email type checkbox with its helper text; the
 * cell gives every option the same height.
 *
 * @param {{ checked: boolean, disabled: boolean, children: import('react').ReactNode }} props State and content.
 * @returns {import('react').ReactElement} Checkbox cell.
 */
const AlertTypeCell = ({ checked, disabled, children }) => (
  <Box
    padding={4}
    hasRadius
    borderColor={checked && !disabled ? 'primary600' : 'neutral200'}
    background={checked && !disabled ? 'primary100' : 'neutral0'}
    height="100%"
  >
    <Flex direction="column" alignItems="stretch" gap={2}>
      {children}
    </Flex>
  </Box>
);

/**
 * Tab "Alerts" (IA F Tab 4): who is told about sign-ins. Alerts need
 * location data, so while IP location lookup is off the tab shows a warning
 * with a link to Location data and both cards are disabled.
 *
 * @param {{ form: ReturnType<typeof import('./hooks/useSettingsForm').useSettingsForm> }} props Settings form.
 * @returns {import('react').ReactElement} Tab content.
 */
const AlertsTab = ({ form }) => {
  const { t, tError } = useSettingsTranslate();
  const { settings, handleChange, errors } = form;
  const hintIds = { suspicious: useId(), newCountry: useId(), vpnProxy: useId() };
  const lookupOff = !settings.enableGeolocation;
  const emailTypesDisabled = lookupOff || !settings.enableEmailAlerts;
  const webhookFieldsDisabled = lookupOff || !settings.enableWebhooks;
  const templateErrors = fieldHasError(errors, 'emailTemplates');

  const emailTypes = [
    {
      field: 'alertOnSuspiciousLogin',
      hintId: hintIds.suspicious,
      label: t('settings.config.email.suspicious.label', 'Suspicious sign-in'),
      hint: t('settings.config.email.suspicious.hint', 'VPN, proxy or threat address, or a score below 70 with scoring on.'),
    },
    {
      field: 'alertOnNewLocation',
      hintId: hintIds.newCountry,
      label: t('settings.config.email.newCountry.label', 'Sign-in from a new country'),
      hint: t(
        'settings.config.email.newCountry.hint',
        "The country differs from all of the user's last 50 sessions. Needs at least one earlier country."
      ),
    },
    {
      field: 'alertOnVpnProxy',
      hintId: hintIds.vpnProxy,
      label: t('settings.config.email.vpnProxy.label', 'VPN or proxy'),
      hint: t('settings.config.email.vpnProxy.hint', 'Needs ipapi.co data; the local database does not detect VPNs or proxies.'),
    },
  ];

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <IntroText>
        {t('settings.config.alerts.intro', 'Alerts are sent only when location data is available for the sign-in.')}
      </IntroText>

      {lookupOff ? (
        <Alert variant="warning" closeLabel={t('common.close', 'Close')} title="">
          {t('settings.config.alerts.lookupOff', 'IP location lookup is off, so no alerts are sent.')}
          {' '}
          <SettingsTabLink tab="location-data">
            {t('settings.config.requires.geolocation', 'Requires IP location lookup')}
          </SettingsTabLink>
        </Alert>
      ) : null}

      <SectionCard
        title={t('settings.config.email.title', 'Security emails to users')}
        subtitle={t('settings.config.email.intro', "Sent to the end user's own email address, not to administrators.")}
      >
        <SettingsToggleRow
          id="enable-email-alerts"
          title={t('settings.config.email.enable.label', 'Send security emails')}
          checked={settings.enableEmailAlerts}
          disabled={lookupOff}
          onChange={(checked) => handleChange('enableEmailAlerts', checked)}
        />

        <Flex direction="column" alignItems="stretch" gap={3}>
          <Typography variant="pi" fontWeight="bold" tag="div" textColor="neutral800">
            {t('settings.config.email.types.label', 'Send an email for')}
          </Typography>
          {!lookupOff && !settings.enableEmailAlerts ? (
            <RequiresNotice>
              {t('settings.config.requires.emailAlerts', 'Requires Send security emails')}
            </RequiresNotice>
          ) : null}
          <EmailTypeGrid>
            <div>
              {emailTypes.map(({ field, hintId, label, hint }) => (
                <AlertTypeCell key={field} checked={settings[field]} disabled={emailTypesDisabled}>
                  <Checkbox
                    checked={settings[field]}
                    disabled={emailTypesDisabled}
                    aria-describedby={hintId}
                    onCheckedChange={(checked) => handleChange(field, checked === true)}
                  >
                    {label}
                  </Checkbox>
                  <ReadableText id={hintId} variant="pi" textColor="neutral600" tag="p">
                    {hint}
                  </ReadableText>
                </AlertTypeCell>
              ))}
            </div>
          </EmailTypeGrid>
        </Flex>

        <AdvancedSection
          label={t('settings.config.email.templates.label', 'Edit email templates')}
          hasError={templateErrors}
          disabled={emailTypesDisabled}
        >
          <Alert variant="warning" closeLabel={t('common.close', 'Close')} title="">
            {t(
              'settings.config.email.templates.warning',
              'As soon as any template has content, only your stored templates are used and empty ones are sent empty. Fill in all three, or none.'
            )}
          </Alert>
          <EmailTemplatesCard form={form} />
        </AdvancedSection>
      </SectionCard>

      <SectionCard
        title={t('settings.config.webhooks.title', 'Team notifications (webhooks)')}
        subtitle={t('settings.config.webhooks.intro', "Posts every sign-in to Discord or Slack as 'suspicious', 'new country' or 'success'.")}
      >
        <SettingsToggleRow
          id="enable-webhooks"
          title={t('settings.config.webhooks.enable.label', 'Send team notifications')}
          description={t(
            'settings.config.webhooks.enable.hint',
            'Event per sign-in: {suspicious}, otherwise {newLocation}, otherwise {success}.',
            WEBHOOK_EVENTS
          )}
          checked={settings.enableWebhooks}
          disabled={lookupOff}
          onChange={(checked) => handleChange('enableWebhooks', checked)}
        />
        {!lookupOff && !settings.enableWebhooks ? (
          <RequiresNotice>
            {t('settings.config.requires.webhooks', 'Requires Send team notifications')}
          </RequiresNotice>
        ) : null}

        <EqualGrid columns={2} stackBelow="medium" gap={6}>
          <FormField
            id="discord-webhook-url"
            name="discordWebhookUrl"
            label={t('settings.config.webhooks.discord.label', 'Discord webhook URL')}
            description={t(
              'settings.config.webhooks.discord.hint',
              'Must start with https://discord.com or https://discordapp.com. Anyone with this URL can post to your channel.'
            )}
            error={tError(errors.discordWebhookUrl)}
          >
            <SecretTextInput
              name="discordWebhookUrl"
              revealedType="url"
              value={settings.discordWebhookUrl || ''}
              disabled={webhookFieldsDisabled && !errors.discordWebhookUrl}
              onChange={(value) => handleChange('discordWebhookUrl', value)}
              placeholder={t('settings.webhooks.discord.placeholder', 'https://discord.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz...')}
              showLabel={t('settings.webhooks.show', 'Show URL')}
              hideLabel={t('settings.webhooks.hide', 'Hide URL')}
            />
          </FormField>

          <FormField
            id="slack-webhook-url"
            name="slackWebhookUrl"
            label={t('settings.config.webhooks.slack.label', 'Slack webhook URL')}
            description={t(
              'settings.config.webhooks.slack.hint',
              'Must start with https://hooks.slack.com. Anyone with this URL can post to your channel.'
            )}
            error={tError(errors.slackWebhookUrl)}
          >
            <SecretTextInput
              name="slackWebhookUrl"
              revealedType="url"
              value={settings.slackWebhookUrl || ''}
              disabled={webhookFieldsDisabled && !errors.slackWebhookUrl}
              onChange={(value) => handleChange('slackWebhookUrl', value)}
              placeholder={t('settings.webhooks.slack.placeholder', 'https://hooks.slack.com/services/XXXX/XXXX/XXXX')}
              showLabel={t('settings.webhooks.show', 'Show URL')}
              hideLabel={t('settings.webhooks.hide', 'Hide URL')}
            />
          </FormField>
        </EqualGrid>
      </SectionCard>
    </Flex>
  );
};

export default AlertsTab;
