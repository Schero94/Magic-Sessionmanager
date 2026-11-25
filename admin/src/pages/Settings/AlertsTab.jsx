import { useId } from 'react';
import { Box, Checkbox, Flex, Typography } from '@strapi/design-system';
import styled from 'styled-components';
import { EqualGrid, SectionCard } from '../../components/ui';
import ReadableText from '../../components/ReadableText';
import SettingsToggleRow from '../../components/SettingsToggleRow';
import Alert from '../../components/PersistentAlert';
import { fieldHasError } from './settingsTabs.mjs';
import EmailTemplatesCard from './EmailTemplatesCard';
import WebhookUrlField from './WebhookUrlField';
import SignedWebhookCard from './SignedWebhookCard';
import WebhookEventsCard from './WebhookEventsCard';
import { SettingsTabLink } from './SettingsNavigation';
import {
  AdvancedSection,
  IntroText,
  ProtectedNotice,
  RequiresNotice,
  RiskSourceNotice,
} from './SettingsBlocks';
import { getRiskAvailability, riskDependentControl } from '../../utils/riskData.mjs';
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
  const hintIds = {
    suspicious: useId(),
    newCountry: useId(),
    vpnProxy: useId(),
    newDevice: useId(),
    travel: useId(),
  };
  const lookupOff = !settings.enableGeolocation;
  const emailTypesDisabled = lookupOff || !settings.enableEmailAlerts;
  const webhookFieldsDisabled = lookupOff || !settings.enableWebhooks;
  // Webhooks are protected settings (4.17): changing them needs settings.update.
  const locked = form.canChangeProtected === false;
  const templateErrors = fieldHasError(errors, 'emailTemplates');
  const risk = getRiskAvailability(form.geoIp.status);

  const emailTypes = [
    {
      field: 'alertOnSuspiciousLogin',
      needsRiskData: true,
      hintId: hintIds.suspicious,
      label: t('settings.config.email.suspicious.label', 'Suspicious sign-in'),
      hint: t(
        'settings.config.email.suspicious.hint',
        'VPN, proxy, Tor or hosting address, or a score below 70 with scoring on.'
      ),
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
      needsRiskData: true,
      hintId: hintIds.vpnProxy,
      label: t('settings.config.email.vpnProxy.label', 'VPN or proxy'),
      hint: t(
        'settings.config.email.vpnProxy.hint',
        'Sign-in from a VPN, or from a public or residential proxy.'
      ),
    },
    {
      field: 'alertOnNewDevice',
      hintId: hintIds.newDevice,
      label: t('settings.config.email.newDevice.label', 'Sign-in from a new device'),
      hint: t(
        'settings.config.email.newDevice.hint',
        'Browser and system not seen in the user\'s last 50 sessions. With a "This wasn\'t me" link that signs that device out.'
      ),
    },
    {
      field: 'alertOnImpossibleTravel',
      hintId: hintIds.travel,
      needsTravel: true,
      label: t('settings.config.email.travel.label', 'Impossible travel'),
      hint: t(
        'settings.config.email.travel.hint',
        'Farther from the previous sign-in than anyone could travel. With a "This wasn\'t me" link.'
      ),
    },
  ];

  return (
    <Flex direction="column" alignItems="stretch" gap={6}>
      <IntroText>
        {t(
          'settings.config.alerts.intro',
          'Alerts are sent only when location data is available for the sign-in.'
        )}
      </IntroText>

      {lookupOff ? (
        <Alert variant="warning" closeLabel={t('common.close', 'Close')} title="">
          {t(
            'settings.config.alerts.lookupOff',
            'IP location lookup is off, so no alerts are sent.'
          )}{' '}
          <SettingsTabLink tab="location-data">
            {t('settings.config.requires.geolocation', 'Requires IP location lookup')}
          </SettingsTabLink>
        </Alert>
      ) : null}

      <SectionCard
        title={t('settings.config.email.title', 'Security emails to users')}
        subtitle={t(
          'settings.config.email.intro',
          "Sent to the end user's own email address, not to administrators."
        )}
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
              {emailTypes.map(({ field, needsRiskData, needsTravel, hintId, label, hint }) => {
                const control = needsRiskData
                  ? riskDependentControl(settings[field], risk.state)
                  : { checked: settings[field], disabled: false, savedOnButInactive: false };
                const travelOff = needsTravel && settings.impossibleTravelEnabled !== true;
                const disabled = emailTypesDisabled || control.disabled || travelOff;
                return (
                  <AlertTypeCell key={field} checked={control.checked} disabled={disabled}>
                    <Checkbox
                      checked={control.checked}
                      disabled={disabled}
                      aria-describedby={hintId}
                      onCheckedChange={(checked) => handleChange(field, checked === true)}
                    >
                      {label}
                    </Checkbox>
                    <ReadableText id={hintId} variant="pi" textColor="neutral600" tag="p">
                      {hint}
                    </ReadableText>
                    {!lookupOff && control.disabled ? (
                      <RiskSourceNotice savedOn={control.savedOnButInactive} />
                    ) : null}
                    {travelOff ? (
                      <RequiresNotice tab="login-protection">
                        {t('settings.config.requires.travel', 'Requires Detect impossible travel')}
                      </RequiresNotice>
                    ) : null}
                  </AlertTypeCell>
                );
              })}
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
        subtitle={t(
          'settings.config.webhooks.intro',
          'Posts the selected events to Discord or Slack.'
        )}
      >
        <SettingsToggleRow
          id="enable-webhooks"
          title={t('settings.config.webhooks.enable.label', 'Send team notifications')}
          description={t(
            'settings.config.webhooks.enable.hint',
            'A sign-in is sent as {suspicious}, otherwise {newLocation}, otherwise {success}, when that event is selected below.',
            WEBHOOK_EVENTS
          )}
          checked={settings.enableWebhooks}
          disabled={lookupOff || locked}
          onChange={(checked) => handleChange('enableWebhooks', checked)}
        />
        {!lookupOff && !settings.enableWebhooks ? (
          <RequiresNotice>
            {t('settings.config.requires.webhooks', 'Requires Send team notifications')}
          </RequiresNotice>
        ) : null}
        {!lookupOff && risk.state === 'missing' ? (
          <ReadableText variant="pi" textColor="neutral600" tag="p" data-risk-webhook-note="">
            {t(
              'settings.config.webhooks.noRiskData',
              'Without a risk data source, {suspicious} is never sent.',
              WEBHOOK_EVENTS
            )}
          </ReadableText>
        ) : null}

        {locked ? <ProtectedNotice /> : null}

        <EqualGrid columns={2} stackBelow="medium" gap={6}>
          <WebhookUrlField
            key={`discord-${form.draftVersion}`}
            form={form}
            id="discord-webhook-url"
            field="discordWebhookUrl"
            hasKey="hasDiscordWebhook"
            hintKey="discordWebhookHint"
            label={t('settings.config.webhooks.discord.label', 'Discord webhook URL')}
            description={t(
              'settings.config.webhooks.discord.hint',
              'Must start with https://discord.com or https://discordapp.com. Anyone with this URL can post to your channel.'
            )}
            error={tError(errors.discordWebhookUrl)}
            disabled={webhookFieldsDisabled || locked}
            placeholder={t(
              'settings.webhooks.discord.placeholder',
              'https://discord.com/api/webhooks/123456789/abcdefghijklmnopqrstuvwxyz...'
            )}
          />
          <WebhookUrlField
            key={`slack-${form.draftVersion}`}
            form={form}
            id="slack-webhook-url"
            field="slackWebhookUrl"
            hasKey="hasSlackWebhook"
            hintKey="slackWebhookHint"
            label={t('settings.config.webhooks.slack.label', 'Slack webhook URL')}
            description={t(
              'settings.config.webhooks.slack.hint',
              'Must start with https://hooks.slack.com. Anyone with this URL can post to your channel.'
            )}
            error={tError(errors.slackWebhookUrl)}
            disabled={webhookFieldsDisabled || locked}
            placeholder={t(
              'settings.webhooks.slack.placeholder',
              'https://hooks.slack.com/services/XXXX/XXXX/XXXX'
            )}
          />
        </EqualGrid>
      </SectionCard>

      <WebhookEventsCard form={form} />

      <SignedWebhookCard form={form} />
    </Flex>
  );
};

export default AlertsTab;
