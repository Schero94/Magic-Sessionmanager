'use strict';

/**
 * Notifications Service.
 *
 * Sends email alerts and webhook notifications for session events. Supports
 * admin-provided templates (loaded from the plugin store) with a hardcoded
 * fallback. All dynamic values are HTML-escaped before interpolation to
 * prevent XSS via user-controlled inputs (user-agent, geo data, etc.).
 */

const { hasRiskData } = require('../utils/risk-data');

/**
 * Risk labels for a webhook message. Empty without risk data from a real
 * source, so a message never claims a check that did not happen.
 *
 * @param {object} geoData Lookup result of the sign-in.
 * @returns {string[]} Labels such as 'VPN' or 'Hosting (ASN heuristic)'.
 */
function getRiskWarnings(geoData) {
  if (!hasRiskData(geoData)) return [];
  const warnings = [];
  if (geoData.isVpn) warnings.push('VPN');
  if (geoData.isProxy) warnings.push('Proxy');
  if (geoData.isTor) warnings.push('Tor');
  if (geoData.isHosting) {
    warnings.push(
      geoData.riskSource === 'asn-heuristic' ? 'Hosting (ASN heuristic)' : 'Hosting provider'
    );
  }
  if (geoData.isThreat) warnings.push('Threat');
  return warnings;
}

/**
 * Default templates of the alerts added in 4.17. A stored template of the
 * same key with no html and no text falls back to these, so an upgrade with
 * customised older templates still sends a complete mail.
 */
const POLICY_TEMPLATES = Object.freeze({
  accountLocked: Object.freeze({
    subject: 'Your account was locked after failed sign-ins',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2>Your account was temporarily locked</h2>
    <p>Hello {{user.username}},</p>
    <p>There were several failed sign-in attempts for your account. To protect it, sign-in is locked for {{lock.minutes}} minutes, until {{lock.until}}.</p>
    <p>If these attempts were not yours, change your password after the lock ends.</p>
    <p style="color: #666; font-size: 12px;">This is an automated security notification.</p>
  </div>
</body>
</html>`,
    text: `Your account was temporarily locked\n\nHello {{user.username}},\n\nThere were several failed sign-in attempts for your account. To protect it, sign-in is locked for {{lock.minutes}} minutes, until {{lock.until}}.\n\nIf these attempts were not yours, change your password after the lock ends.`,
  }),
  newDevice: Object.freeze({
    subject: 'New sign-in to your account',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2>New sign-in to your account</h2>
    <p>Hello {{user.username}},</p>
    <p>Your account was just used on a device we have not seen before.</p>
    <ul>
      <li>Time: {{session.loginTime}}</li>
      <li>Device: {{device.browser}} on {{device.os}}</li>
      <li>Location: {{geo.city}}, {{geo.country}}</li>
      <li>IP address: {{session.ipAddress}}</li>
    </ul>
    <p>If this was you, you can ignore this email.</p>
    <p>If this was not you, <a href="{{link.notMe}}">sign this device out</a> and change your password.</p>
    <p style="color: #666; font-size: 12px;">The link works once and expires after 72 hours.</p>
  </div>
</body>
</html>`,
    text: `New sign-in to your account\n\nHello {{user.username}},\n\nYour account was just used on a device we have not seen before.\n\nTime: {{session.loginTime}}\nDevice: {{device.browser}} on {{device.os}}\nLocation: {{geo.city}}, {{geo.country}}\nIP address: {{session.ipAddress}}\n\nIf this was not you, sign this device out and change your password:\n{{link.notMe}}\n\nThe link works once and expires after 72 hours.`,
  }),
  impossibleTravel: Object.freeze({
    subject: 'Unusual sign-in to your account',
    html: `<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2>Unusual sign-in to your account</h2>
    <p>Hello {{user.username}},</p>
    <p>Your account was used about {{travel.distanceKm}} km away from your previous sign-in, sooner than anyone could travel that far.</p>
    <ul>
      <li>Time: {{session.loginTime}}</li>
      <li>Location: {{geo.city}}, {{geo.country}}</li>
      <li>Device: {{device.browser}} on {{device.os}}</li>
    </ul>
    <p>A VPN or a mobile network can cause this. If this was not you, <a href="{{link.notMe}}">sign this device out</a> and change your password.</p>
    <p style="color: #666; font-size: 12px;">The link works once and expires after 72 hours.</p>
  </div>
</body>
</html>`,
    text: `Unusual sign-in to your account\n\nHello {{user.username}},\n\nYour account was used about {{travel.distanceKm}} km away from your previous sign-in, sooner than anyone could travel that far.\n\nTime: {{session.loginTime}}\nLocation: {{geo.city}}, {{geo.country}}\nDevice: {{device.browser}} on {{device.os}}\n\nA VPN or a mobile network can cause this. If this was not you, sign this device out and change your password:\n{{link.notMe}}\n\nThe link works once and expires after 72 hours.`,
  }),
});

const ALLOWED_WEBHOOK_HOSTS = ['discord.com', 'discordapp.com', 'hooks.slack.com'];

const WEBHOOK_TIMEOUT_MS = 5000;

module.exports = ({ strapi }) => ({
  /**
   * Loads email templates from the plugin store, falling back to hardcoded
   * defaults if none are configured.
   * @returns {Promise<object>}
   */
  async getEmailTemplates() {
    try {
      const pluginStore = strapi.store({
        type: 'plugin',
        name: 'magic-sessionmanager',
      });

      const settings = await pluginStore.get({ key: 'settings' });

      if (settings?.emailTemplates && Object.keys(settings.emailTemplates).length > 0) {
        const hasContent = Object.values(settings.emailTemplates).some(
          (template) => template.html || template.text
        );

        if (hasContent) {
          strapi.log.debug('[magic-sessionmanager/notifications] Using templates from database');
          return settings.emailTemplates;
        }
      }
    } catch {
      strapi.log.warn(
        '[magic-sessionmanager/notifications] Could not load templates from DB; using defaults'
      );
    }

    strapi.log.debug('[magic-sessionmanager/notifications] Using default fallback templates');
    return {
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
        text: `[ALERT] Suspicious Login Detected\n\nA potentially suspicious login was detected for your account.\n\nAccount: {{user.email}}\nUsername: {{user.username}}\n\nLogin Details:\n- Time: {{session.loginTime}}\n- IP: {{session.ipAddress}}\n- Location: {{geo.city}}, {{geo.country}}\n\nSecurity: VPN={{reason.isVpn}}, Proxy={{reason.isProxy}}, Threat={{reason.isThreat}}, Score={{reason.securityScore}}/100`,
      },
      newLocation: {
        subject: '[LOCATION] New Location Login Detected',
        html: `<h2>[LOCATION] New Location Login</h2><p>Account: {{user.email}}</p><p>Time: {{session.loginTime}}</p><p>Location: {{geo.city}}, {{geo.country}}</p><p>IP: {{session.ipAddress}}</p>`,
        text: `[LOCATION] New Location Login\n\nAccount: {{user.email}}\nTime: {{session.loginTime}}\nLocation: {{geo.city}}, {{geo.country}}\nIP: {{session.ipAddress}}`,
      },
      vpnProxy: {
        subject: '[WARNING] VPN/Proxy Login Detected',
        html: `<h2>[WARNING] VPN/Proxy Detected</h2><p>Account: {{user.email}}</p><p>Time: {{session.loginTime}}</p><p>IP: {{session.ipAddress}}</p><p>VPN: {{reason.isVpn}}, Proxy: {{reason.isProxy}}</p>`,
        text: `[WARNING] VPN/Proxy Detected\n\nAccount: {{user.email}}\nTime: {{session.loginTime}}\nIP: {{session.ipAddress}}\nVPN: {{reason.isVpn}}, Proxy: {{reason.isProxy}}`,
      },
      ...POLICY_TEMPLATES,
    };
  },

  /**
   * One template by key. A stored template without html and text falls back
   * to the default of that key.
   *
   * @param {string} key Template key.
   * @returns {Promise<{subject: string, html: string, text: string}>} Template.
   */
  async getTemplate(key) {
    const templates = await this.getEmailTemplates();
    const template = templates?.[key];
    if (template && (template.html || template.text)) {
      return {
        subject: template.subject || POLICY_TEMPLATES[key]?.subject || '',
        html: template.html || '',
        text: template.text || '',
      };
    }
    return { ...POLICY_TEMPLATES[key] };
  },

  /**
   * Emails a user about a sign-in from a new device or an impossible
   * travel, with the "This wasn't me" link.
   *
   * @param {'newDevice'|'impossibleTravel'} key Template.
   * @param {{user: object, session: object, geoData?: object|null, device: object,
   *   travel?: object|null, link: string|null}} data Values.
   * @returns {Promise<boolean>} Whether the mail was handed to the email plugin.
   * @sideeffect Sends one email.
   */
  async sendSignInSignalEmail(key, data) {
    try {
      if (!data?.user?.email) return false;
      const template = await this.getTemplate(key);
      const values = { ...data, geoData: data.geoData || {}, link: { notMe: data.link } };
      await strapi
        .plugin('email')
        .service('email')
        .send({
          to: data.user.email,
          subject: this.replaceVariables(template.subject, values),
          html: this.replaceVariables(template.html, values),
          text: this.replaceVariables(template.text, values),
        });
      strapi.log.info(`[magic-sessionmanager/notifications] ${key} email sent`);
      return true;
    } catch (err) {
      strapi.log.error(
        `[magic-sessionmanager/notifications] ${key} email failed:`,
        err?.name || 'Error'
      );
      return false;
    }
  },

  /**
   * Emails a user that their account was locked after failed sign-ins.
   * Sent through Strapi's email plugin, so a provider plugin such as Magic
   * Mail delivers it when installed.
   *
   * @param {{user: {email?: string, username?: string}, minutes: number, until: number}} params
   *   Account, lock duration in minutes and lock end (epoch ms).
   * @returns {Promise<boolean>} Whether the mail was handed to the email plugin.
   * @sideeffect Sends one email.
   */
  async sendAccountLockedEmail({ user, minutes, until }) {
    try {
      if (!user?.email) return false;
      const template = await this.getTemplate('accountLocked');
      const data = { user, lock: { minutes, until } };
      await strapi
        .plugin('email')
        .service('email')
        .send({
          to: user.email,
          subject: this.replaceVariables(template.subject, data),
          html: this.replaceVariables(template.html, data),
          text: this.replaceVariables(template.text, data),
        });
      strapi.log.info('[magic-sessionmanager/notifications] Account lock email sent');
      return true;
    } catch (err) {
      strapi.log.error(
        '[magic-sessionmanager/notifications] Account lock email failed:',
        err?.name || 'Error'
      );
      return false;
    }
  },

  /**
   * HTML-escapes a string to prevent XSS when it is interpolated into an
   * HTML email template. Non-string inputs are coerced to strings first.
   *
   * @param {unknown} str
   * @returns {string}
   */
  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const s = typeof str === 'string' ? str : String(str);
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  /**
   * Replaces `{{var}}` placeholders in a template with HTML-escaped actual
   * values.
   *
   * @param {string} template
   * @param {object} data
   * @returns {string}
   */
  replaceVariables(template, data) {
    let result = template;
    const esc = this.escapeHtml.bind(this);

    result = result.replace(/\{\{user\.email\}\}/g, esc(data.user?.email || 'N/A'));
    result = result.replace(/\{\{user\.username\}\}/g, esc(data.user?.username || 'N/A'));

    result = result.replace(
      /\{\{session\.loginTime\}\}/g,
      esc(data.session?.loginTime ? new Date(data.session.loginTime).toLocaleString() : 'N/A')
    );
    result = result.replace(/\{\{session\.ipAddress\}\}/g, esc(data.session?.ipAddress || 'N/A'));
    result = result.replace(/\{\{session\.userAgent\}\}/g, esc(data.session?.userAgent || 'N/A'));

    result = result.replace(/\{\{geo\.city\}\}/g, esc(data.geoData?.city || 'Unknown'));
    result = result.replace(/\{\{geo\.country\}\}/g, esc(data.geoData?.country || 'Unknown'));
    result = result.replace(/\{\{geo\.timezone\}\}/g, esc(data.geoData?.timezone || 'Unknown'));

    result = result.replace(/\{\{reason\.isVpn\}\}/g, data.reason?.isVpn ? 'Yes' : 'No');
    result = result.replace(/\{\{reason\.isProxy\}\}/g, data.reason?.isProxy ? 'Yes' : 'No');
    result = result.replace(/\{\{reason\.isThreat\}\}/g, data.reason?.isThreat ? 'Yes' : 'No');
    result = result.replace(
      /\{\{lock\.minutes\}\}/g,
      esc(Number.isFinite(data.lock?.minutes) ? String(data.lock.minutes) : 'N/A')
    );
    result = result.replace(
      /\{\{lock\.until\}\}/g,
      esc(Number.isFinite(data.lock?.until) ? new Date(data.lock.until).toUTCString() : 'N/A')
    );
    result = result.replace(/\{\{device\.browser\}\}/g, esc(data.device?.browser || 'Unknown'));
    result = result.replace(/\{\{device\.os\}\}/g, esc(data.device?.os || 'Unknown'));
    result = result.replace(
      /\{\{travel\.distanceKm\}\}/g,
      esc(Number.isFinite(data.travel?.distanceKm) ? String(data.travel.distanceKm) : 'N/A')
    );
    result = result.replace(
      /\{\{travel\.speedKmh\}\}/g,
      esc(Number.isFinite(data.travel?.speedKmh) ? String(data.travel.speedKmh) : 'N/A')
    );
    // Only an https/http link built by the server is inserted.
    const link =
      typeof data.link?.notMe === 'string' && /^https?:\/\//.test(data.link.notMe)
        ? data.link.notMe
        : '';
    result = result.replace(/\{\{link\.notMe\}\}/g, esc(link));
    const score = data.reason?.securityScore;
    result = result.replace(
      /\{\{reason\.securityScore\}\}/g,
      esc(typeof score === 'number' && Number.isFinite(score) ? String(score) : 'N/A')
    );

    return result;
  },

  /**
   * Sends a suspicious-login email alert using the `suspiciousLogin` template.
   * @param {{user: object, session: object, reason: object, geoData: object}} params
   * @returns {Promise<boolean>}
   */
  async sendSuspiciousLoginAlert({ user, session, reason, geoData }) {
    try {
      const templates = await this.getEmailTemplates();
      const template = templates.suspiciousLogin;

      const data = { user, session, reason, geoData };
      const htmlContent = this.replaceVariables(template.html, data);
      const textContent = this.replaceVariables(template.text, data);

      await strapi.plugins['email'].services.email.send({
        to: user.email,
        subject: template.subject,
        html: htmlContent,
        text: textContent,
      });

      strapi.log.info('[magic-sessionmanager/notifications] Suspicious login alert sent');
      return true;
    } catch (err) {
      strapi.log.error(
        '[magic-sessionmanager/notifications] Email alert failed:',
        err?.name || 'Error'
      );
      return false;
    }
  },

  /**
   * Sends a new-location email alert using the `newLocation` template.
   * @param {{user: object, session: object, geoData: object}} params
   * @returns {Promise<boolean>}
   */
  async sendNewLocationAlert({ user, session, geoData }) {
    try {
      const templates = await this.getEmailTemplates();
      const template = templates.newLocation;

      const data = { user, session, geoData, reason: {} };
      const htmlContent = this.replaceVariables(template.html, data);
      const textContent = this.replaceVariables(template.text, data);

      await strapi.plugins['email'].services.email.send({
        to: user.email,
        subject: template.subject,
        html: htmlContent,
        text: textContent,
      });

      strapi.log.info('[magic-sessionmanager/notifications] New location alert sent');
      return true;
    } catch (err) {
      strapi.log.error(
        '[magic-sessionmanager/notifications] New-location email failed:',
        err?.name || 'Error'
      );
      return false;
    }
  },

  /**
   * Sends a VPN/Proxy email alert using the `vpnProxy` template.
   * @param {{user: object, session: object, reason: object, geoData: object}} params
   * @returns {Promise<boolean>}
   */
  async sendVpnProxyAlert({ user, session, reason, geoData }) {
    try {
      const templates = await this.getEmailTemplates();
      const template = templates.vpnProxy;

      const data = { user, session, reason, geoData };
      const htmlContent = this.replaceVariables(template.html, data);
      const textContent = this.replaceVariables(template.text, data);

      await strapi.plugins['email'].services.email.send({
        to: user.email,
        subject: template.subject,
        html: htmlContent,
        text: textContent,
      });

      strapi.log.info('[magic-sessionmanager/notifications] VPN/Proxy alert sent');
      return true;
    } catch (err) {
      strapi.log.error(
        '[magic-sessionmanager/notifications] VPN/Proxy email failed:',
        err?.name || 'Error'
      );
      return false;
    }
  },

  ALLOWED_WEBHOOK_HOSTS,

  /**
   * Posts a JSON payload to a webhook URL. Only allowlisted hosts are
   * permitted (SSRF protection) and the request times out after
   * WEBHOOK_TIMEOUT_MS.
   *
   * For Discord/Slack webhooks the `data` object is the provider-specific
   * payload (e.g. `{ embeds: [...] }` for Discord, Block Kit for Slack) and
   * is sent verbatim — any wrapping would break message rendering. Both
   * providers reject unknown top-level fields, so we deliberately do NOT
   * add `event`, `timestamp` or `source` keys.
   *
   * @param {{event: string, data: object, webhookUrl: string}} params
   *   `event` is retained for log output only.
   * @returns {Promise<boolean>}
   */
  async sendWebhook({ event, data, webhookUrl }) {
    try {
      try {
        const parsed = new URL(webhookUrl);
        const isAllowed =
          parsed.protocol === 'https:' &&
          ALLOWED_WEBHOOK_HOSTS.some(
            (h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`)
          );
        if (!isAllowed) {
          strapi.log.warn('[magic-sessionmanager/notifications] Blocked webhook to untrusted host');
          return false;
        }
      } catch {
        strapi.log.warn('[magic-sessionmanager/notifications] Invalid webhook URL');
        return false;
      }

      // Discord & Slack both want the provider-specific payload as the raw
      // request body. We used to wrap it in { event, timestamp, data, source }
      // which produced messages that neither platform could render.
      const payload = data;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Strapi-Magic-SessionManager-Webhook/1.0',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (response.ok) {
          strapi.log.info(`[magic-sessionmanager/notifications] Webhook sent: ${event}`);
          return true;
        }
        strapi.log.warn(`[magic-sessionmanager/notifications] Webhook failed: ${response.status}`);
        return false;
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      strapi.log.error(
        '[magic-sessionmanager/notifications] Webhook request failed:',
        err?.name || 'Error'
      );
      return false;
    }
  },

  /**
   * Formats a session event as a Slack Incoming Webhook payload.
   *
   * Uses Slack's Block Kit so the message renders as a rich card with
   * status color and structured fields, matching the Discord embed shape.
   *
   * @param {{event: string, session: object, user: object, geoData: object}} params
   * @returns {object}
   */
  formatSlackWebhook({ event, session, user, geoData }) {
    const title = this.getEventTitle(event);
    const color = this.getSlackEventColor(event);

    const fields = [
      { type: 'mrkdwn', text: `*User*\n${user.email || 'N/A'}` },
      { type: 'mrkdwn', text: `*Username*\n${user.username || 'N/A'}` },
      { type: 'mrkdwn', text: `*IP*\n\`${session.ipAddress || 'unknown'}\`` },
      {
        type: 'mrkdwn',
        text: `*Time*\n${session.loginTime ? new Date(session.loginTime).toLocaleString() : '-'}`,
      },
    ];

    if (geoData) {
      const locationFlag = geoData.country_flag ? `${geoData.country_flag} ` : '';
      fields.push({
        type: 'mrkdwn',
        text: `*Location*\n${locationFlag}${geoData.city || '?'}, ${geoData.country || '?'}`,
      });

      const warnings = getRiskWarnings(geoData);
      if (warnings.length > 0) {
        fields.push({
          type: 'mrkdwn',
          text: `*Security*\n${warnings.join(', ')} — score ${geoData.securityScore ?? '-'}/100`,
        });
      }
    }

    return {
      text: title, // Fallback for clients without Block Kit support
      attachments: [
        {
          color,
          blocks: [
            { type: 'header', text: { type: 'plain_text', text: title } },
            { type: 'section', fields },
            {
              type: 'context',
              elements: [
                { type: 'mrkdwn', text: 'Magic Session Manager' },
                { type: 'mrkdwn', text: new Date().toISOString() },
              ],
            },
          ],
        },
      ],
    };
  },

  /**
   * Returns a Slack-compatible color (hex string) for an event kind.
   * Slack attachments accept hex colors unlike Discord embeds which take ints.
   * @param {string} event
   * @returns {string}
   */
  getSlackEventColor(event) {
    const colors = {
      'login.suspicious': '#dc2626',
      'login.new_location': '#f59e0b',
      'login.vpn': '#ef4444',
      'login.threat': '#7f1d1d',
      'session.terminated': '#6b7280',
    };
    return colors[event] || '#2563eb';
  },

  /**
   * Formats a session event as a Discord embed.
   * @param {{event: string, session: object, user: object, geoData: object}} params
   * @returns {object}
   */
  formatDiscordWebhook({ event, session, user, geoData }) {
    const embed = {
      title: this.getEventTitle(event),
      color: this.getEventColor(event),
      fields: [
        { name: 'User', value: `${user.email}\n${user.username || 'N/A'}`, inline: true },
        { name: 'IP', value: session.ipAddress, inline: true },
        { name: 'Time', value: new Date(session.loginTime).toLocaleString(), inline: false },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'Magic Session Manager' },
    };

    if (geoData) {
      embed.fields.push({
        name: '[LOCATION] Location',
        value: `${geoData.country_flag || ''} ${geoData.city}, ${geoData.country}`,
        inline: true,
      });

      const warnings = getRiskWarnings(geoData);
      if (warnings.length > 0) {
        embed.fields.push({
          name: '[WARNING] Security',
          value: `${warnings.join(', ')} detected\nScore: ${geoData.securityScore}/100`,
          inline: true,
        });
      }
    }

    return { embeds: [embed] };
  },

  /**
   * Human-readable title for a webhook event.
   * @param {string} event
   * @returns {string}
   */
  getEventTitle(event) {
    const titles = {
      'login.suspicious': '[ALERT] Suspicious Login',
      'login.new_location': '[LOCATION] New Location Login',
      'login.vpn': '[WARNING] VPN Login Detected',
      'login.threat': '[THREAT] Threat IP Login',
      'session.terminated': '[INFO] Session Terminated',
    };
    return titles[event] || '[STATS] Session Event';
  },

  /**
   * Discord embed color for a webhook event.
   * @param {string} event
   * @returns {number}
   */
  getEventColor(event) {
    const colors = {
      'login.suspicious': 0xff0000,
      'login.new_location': 0xffa500,
      'login.vpn': 0xff6b6b,
      'login.threat': 0x8b0000,
      'session.terminated': 0x808080,
    };
    return colors[event] || 0x5865f2;
  },
});
