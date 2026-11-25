'use strict';

const { evaluateLoginRisk } = require('./risk-data');
const { resolveDetectionSettings } = require('./detection-settings');

/**
 * Sends the email alerts and team notifications for one successful sign-in.
 *
 * Risk-based alerts (VPN or proxy email, suspicious-sign-in email and the
 * `login.suspicious` webhook event) fire only when the sign-in's lookup
 * result carries risk data from a real source (`riskSource`). The
 * new-country alert needs location data only.
 *
 * Each channel is isolated: a failing email or webhook does not stop the
 * others. Nothing here throws for delivery failures; the notification
 * service reports them as `false`.
 *
 * @param {object} params
 * @param {object} params.settings Effective plugin settings.
 * @param {object} params.notificationService The plugin's `notifications` service.
 * @param {object} params.user Signed-in user (email, username).
 * @param {object} params.session New session record.
 * @param {object} params.geoData Lookup result of the sign-in.
 * @param {boolean} [params.isNewLocation] Country not seen in the user's recent sessions.
 * @param {object|null} [params.webhooks] The plugin's `webhooks` service (signed webhook).
 * @returns {Promise<{webhookEvent: string|null, emails: string[]}>} What was attempted.
 * @sideeffect Sends emails through the Email plugin and posts to Discord or Slack.
 */
async function dispatchLoginAlerts({
  settings,
  notificationService,
  user,
  session,
  geoData,
  isNewLocation = false,
  webhooks = null,
}) {
  const attempted = { webhookEvent: null, emails: [] };
  if (!geoData) return attempted;

  const risk = evaluateLoginRisk(settings, geoData);

  if (settings.enableEmailAlerts) {
    if (settings.alertOnVpnProxy && risk.isVpnOrProxy) {
      attempted.emails.push('vpnProxy');
      await notificationService.sendVpnProxyAlert({
        user,
        session,
        reason: { isVpn: geoData.isVpn, isProxy: geoData.isProxy },
        geoData,
      });
    }

    if (settings.alertOnSuspiciousLogin && risk.isSuspicious) {
      attempted.emails.push('suspiciousLogin');
      await notificationService.sendSuspiciousLoginAlert({
        user,
        session,
        reason: {
          isVpn: geoData.isVpn,
          isProxy: geoData.isProxy,
          isThreat: geoData.isThreat,
          securityScore: geoData.securityScore,
        },
        geoData,
      });
    }

    if (settings.alertOnNewLocation && isNewLocation) {
      attempted.emails.push('newLocation');
      await notificationService.sendNewLocationAlert({ user, session, geoData });
    }
  }

  const webhookEvent = risk.isSuspicious
    ? 'login.suspicious'
    : isNewLocation
      ? 'login.new_location'
      : 'login.success';
  // 4.17: Discord, Slack and the signed webhook get only the selected
  // events. Installations upgraded from 4.16 keep "every sign-in" selected
  // (utils/upgrade-defaults.js); new ones leave out login.success.
  const selected = resolveDetectionSettings(settings).webhookEvents.includes(webhookEvent);
  if (selected && webhooks) {
    webhooks.emit(
      webhookEvent,
      {
        userId: user?.documentId || null,
        ip: session?.ipAddress || null,
        userAgent: session?.userAgent || null,
        geo: geoData,
        details: null,
      },
      { chat: false }
    );
  }

  if (settings.enableWebhooks && selected) {
    attempted.webhookEvent = webhookEvent;

    const targets = [];
    if (settings.discordWebhookUrl) {
      targets.push({
        url: settings.discordWebhookUrl,
        payload: notificationService.formatDiscordWebhook({
          event: webhookEvent,
          session,
          user,
          geoData,
        }),
      });
    }
    if (settings.slackWebhookUrl) {
      targets.push({
        url: settings.slackWebhookUrl,
        payload: notificationService.formatSlackWebhook({
          event: webhookEvent,
          session,
          user,
          geoData,
        }),
      });
    }

    await Promise.allSettled(
      targets.map((target) =>
        notificationService.sendWebhook({
          event: webhookEvent,
          data: target.payload,
          webhookUrl: target.url,
        })
      )
    );
  }

  return attempted;
}

module.exports = { dispatchLoginAlerts };
