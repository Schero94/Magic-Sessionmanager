import { Box, Checkbox, Flex, Typography } from '@strapi/design-system';
import { EqualGrid, SectionCard } from '../../components/ui';
import FormField from '../../components/FormField';
import ReadableText from '../../components/ReadableText';
import SettingsToggleRow from '../../components/SettingsToggleRow';
import EmailTemplatesCard from './EmailTemplatesCard';
import SecretTextInput from './SecretTextInput';
import { useSettingsTranslate } from './hooks/useSettingsTranslate';

/**
 * Bordered cell around one alert-type checkbox; the DS Checkbox renders the
 * label, the cell only gives every option the same height.
 *
 * @param {{ checked: boolean, children: import('react').ReactNode }} props Selection state and checkbox.
 * @returns {import('react').ReactElement} Checkbox cell.
 */
const AlertTypeCell = ({ checked, children }) => (
  <Box
    padding={4}
    hasRadius
    borderColor={checked ? 'primary600' : 'neutral200'}
    background={checked ? 'primary100' : 'neutral0'}
    height="100%"
  >
    {children}
  </Box>
);

/**
 * Notifications tab: e-mail alerts, templates with preview, and webhooks.
 *
 * @param {{ form: ReturnType<typeof import('./hooks/useSettingsForm').useSettingsForm> }} props Settings form.
 * @returns {import('react').ReactElement} Tab content.
 */
const NotificationsTab = ({ form }) => {
  const { t, tError } = useSettingsTranslate();
  const { settings, handleChange, errors } = form;

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <SectionCard
        title={t('settings.email.alerts.title', 'Email alerts')}
        subtitle={t('settings.email.alerts.subtitle', 'Send security alerts to users via email')}
      >
        <SettingsToggleRow
          id="enable-email-alerts"
          title={t('settings.email.enable.title', 'Enable Email Alerts')}
          description={t('settings.email.enable.description', 'Send security alerts for suspicious logins, new locations, and VPN/Proxy usage')}
          checked={settings.enableEmailAlerts}
          onChange={(checked) => handleChange('enableEmailAlerts', checked)}
        />

        {settings.enableEmailAlerts && (
          <Flex direction="column" alignItems="stretch" gap={3}>
            <Typography variant="delta" tag="h3" textColor="neutral800">
              {t('settings.email.types.title', 'Alert types')}
            </Typography>
            <ReadableText variant="pi" textColor="neutral600" tag="p">
              {t('settings.email.types.description', 'Choose which security events should send an email alert.')}
            </ReadableText>
            <EqualGrid columns={3} stackBelow="medium" gap={4}>
              <AlertTypeCell checked={settings.alertOnSuspiciousLogin}>
                <Checkbox
                  checked={settings.alertOnSuspiciousLogin}
                  onCheckedChange={(checked) => handleChange('alertOnSuspiciousLogin', checked === true)}
                >
                  {t('settings.email.types.suspicious', 'Suspicious Login')}
                </Checkbox>
              </AlertTypeCell>
              <AlertTypeCell checked={settings.alertOnNewLocation}>
                <Checkbox
                  checked={settings.alertOnNewLocation}
                  onCheckedChange={(checked) => handleChange('alertOnNewLocation', checked === true)}
                >
                  {t('settings.email.types.newLocation', 'New Location')}
                </Checkbox>
              </AlertTypeCell>
              <AlertTypeCell checked={settings.alertOnVpnProxy}>
                <Checkbox
                  checked={settings.alertOnVpnProxy}
                  onCheckedChange={(checked) => handleChange('alertOnVpnProxy', checked === true)}
                >
                  {t('settings.email.types.vpnProxy', 'VPN/Proxy')}
                </Checkbox>
              </AlertTypeCell>
            </EqualGrid>
          </Flex>
        )}
      </SectionCard>

      {settings.enableEmailAlerts && <EmailTemplatesCard form={form} />}

      <SectionCard
        title={t('settings.webhooks.title', 'Webhook Integration')}
        subtitle={t('settings.webhooks.description', 'Discord & Slack integration')}
      >
        <SettingsToggleRow
          id="enable-webhooks"
          title={t('settings.webhooks.enable.title', 'Enable Webhooks')}
          description={t('settings.webhooks.enable.description', 'Send session events to Discord or Slack.')}
          checked={settings.enableWebhooks}
          onChange={(checked) => handleChange('enableWebhooks', checked)}
        />

        <EqualGrid columns={2} stackBelow="medium" gap={6}>
          <FormField
            id="discord-webhook-url"
            name="discordWebhookUrl"
            label={t('settings.webhooks.discord.title', 'Discord Webhook URL')}
            description={t('settings.webhooks.discord.hint', 'Optional: Post session alerts to your Discord channel')}
            error={tError(errors.discordWebhookUrl)}
          >
            <SecretTextInput
              name="discordWebhookUrl"
              revealedType="url"
              value={settings.discordWebhookUrl || ''}
              onChange={(value) => handleChange('discordWebhookUrl', value)}
              placeholder={t('settings.webhooks.discord.placeholder', 'https://discord.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz...')}
              showLabel={t('settings.webhooks.show', 'Show URL')}
              hideLabel={t('settings.webhooks.hide', 'Hide URL')}
            />
          </FormField>

          <FormField
            id="slack-webhook-url"
            name="slackWebhookUrl"
            label={t('settings.webhooks.slack.title', 'Slack Webhook URL')}
            description={t('settings.webhooks.slack.hint', 'Optional: Post session alerts to your Slack workspace')}
            error={tError(errors.slackWebhookUrl)}
          >
            <SecretTextInput
              name="slackWebhookUrl"
              revealedType="url"
              value={settings.slackWebhookUrl || ''}
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

export default NotificationsTab;
