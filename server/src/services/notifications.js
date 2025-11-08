/**
 * Notifications Service (ADVANCED Feature)
 * Send email alerts for session events
 */

module.exports = ({ strapi }) => ({
  /**
   * Get email templates from database settings
   * Falls back to default hardcoded templates if not found
   */
  async getEmailTemplates() {
    try {
      // Try to load templates from database
      const pluginStore = strapi.store({
        type: 'plugin',
        name: 'magic-sessionmanager',
      });
      
      const settings = await pluginStore.get({ key: 'settings' });
      
      if (settings?.emailTemplates && Object.keys(settings.emailTemplates).length > 0) {
        // Check if templates have content
        const hasContent = Object.values(settings.emailTemplates).some(
          template => template.html || template.text
        );
        
        if (hasContent) {
          strapi.log.debug('[magic-sessionmanager/notifications] Using templates from database');
          return settings.emailTemplates;
        }
      }
    } catch (err) {
      strapi.log.warn('[magic-sessionmanager/notifications] Could not load templates from DB, using defaults:', err.message);
    }
    
    // Default fallback templates
    strapi.log.debug('[magic-sessionmanager/notifications] Using default fallback templates');
    return {
      suspiciousLogin: {
        subject: '🚨 Suspicious Login Alert - Session Manager',
        html: `
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb; border-radius: 10px;">
    <h2 style="color: #dc2626;">🚨 Suspicious Login Detected</h2>
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
        text: `🚨 Suspicious Login Detected\n\nA potentially suspicious login was detected for your account.\n\nAccount: {{user.email}}\nUsername: {{user.username}}\n\nLogin Details:\n- Time: {{session.loginTime}}\n- IP: {{session.ipAddress}}\n- Location: {{geo.city}}, {{geo.country}}\n\nSecurity: VPN={{reason.isVpn}}, Proxy={{reason.isProxy}}, Threat={{reason.isThreat}}, Score={{reason.securityScore}}/100`,
      },
      newLocation: {
        subject: '📍 New Location Login Detected',
        html: `<h2>📍 New Location Login</h2><p>Account: {{user.email}}</p><p>Time: {{session.loginTime}}</p><p>Location: {{geo.city}}, {{geo.country}}</p><p>IP: {{session.ipAddress}}</p>`,
        text: `📍 New Location Login\n\nAccount: {{user.email}}\nTime: {{session.loginTime}}\nLocation: {{geo.city}}, {{geo.country}}\nIP: {{session.ipAddress}}`,
      },
      vpnProxy: {
        subject: '⚠️ VPN/Proxy Login Detected',
        html: `<h2>⚠️ VPN/Proxy Detected</h2><p>Account: {{user.email}}</p><p>Time: {{session.loginTime}}</p><p>IP: {{session.ipAddress}}</p><p>VPN: {{reason.isVpn}}, Proxy: {{reason.isProxy}}</p>`,
        text: `⚠️ VPN/Proxy Detected\n\nAccount: {{user.email}}\nTime: {{session.loginTime}}\nIP: {{session.ipAddress}}\nVPN: {{reason.isVpn}}, Proxy: {{reason.isProxy}}`,
      },
    };
  },
  
  /**
   * Replace template variables with actual values
   */
  replaceVariables(template, data) {
    let result = template;
    
    // User variables
    result = result.replace(/\{\{user\.email\}\}/g, data.user?.email || 'N/A');
    result = result.replace(/\{\{user\.username\}\}/g, data.user?.username || 'N/A');
    
    // Session variables
    result = result.replace(/\{\{session\.loginTime\}\}/g, 
      data.session?.loginTime ? new Date(data.session.loginTime).toLocaleString() : 'N/A');
    result = result.replace(/\{\{session\.ipAddress\}\}/g, data.session?.ipAddress || 'N/A');
    result = result.replace(/\{\{session\.userAgent\}\}/g, data.session?.userAgent || 'N/A');
    
    // Geo variables
    result = result.replace(/\{\{geo\.city\}\}/g, data.geoData?.city || 'Unknown');
    result = result.replace(/\{\{geo\.country\}\}/g, data.geoData?.country || 'Unknown');
    result = result.replace(/\{\{geo\.timezone\}\}/g, data.geoData?.timezone || 'Unknown');
    
    // Reason variables
    result = result.replace(/\{\{reason\.isVpn\}\}/g, data.reason?.isVpn ? 'Yes' : 'No');
    result = result.replace(/\{\{reason\.isProxy\}\}/g, data.reason?.isProxy ? 'Yes' : 'No');
    result = result.replace(/\{\{reason\.isThreat\}\}/g, data.reason?.isThreat ? 'Yes' : 'No');
    result = result.replace(/\{\{reason\.securityScore\}\}/g, data.reason?.securityScore || '0');
    
    return result;
  },

  /**
   * Send suspicious login alert
   * @param {Object} params - { user, session, reason, geoData }
   */
  async sendSuspiciousLoginAlert({ user, session, reason, geoData }) {
    try {
      // Get templates from database (or defaults)
      const templates = await this.getEmailTemplates();
      const template = templates.suspiciousLogin;
      
      // Prepare data for variable replacement
      const data = { user, session, reason, geoData };
      
      // Replace variables in template
      const htmlContent = this.replaceVariables(template.html, data);
      const textContent = this.replaceVariables(template.text, data);

      await strapi.plugins['email'].services.email.send({
        to: user.email,
        subject: template.subject,
        html: htmlContent,
        text: textContent,
      });

      strapi.log.info(`[magic-sessionmanager/notifications] Suspicious login alert sent to ${user.email}`);
      return true;
    } catch (err) {
      strapi.log.error('[magic-sessionmanager/notifications] Error sending email:', err);
      return false;
    }
  },

  /**
   * Send new location login alert
   * @param {Object} params - { user, session, geoData }
   */
  async sendNewLocationAlert({ user, session, geoData }) {
    try {
      // Get templates from database (or defaults)
      const templates = await this.getEmailTemplates();
      const template = templates.newLocation;
      
      // Prepare data for variable replacement
      const data = { user, session, geoData, reason: {} };
      
      // Replace variables in template
      const htmlContent = this.replaceVariables(template.html, data);
      const textContent = this.replaceVariables(template.text, data);

      await strapi.plugins['email'].services.email.send({
        to: user.email,
        subject: template.subject,
        html: htmlContent,
        text: textContent,
      });

      strapi.log.info(`[magic-sessionmanager/notifications] New location alert sent to ${user.email}`);
      return true;
    } catch (err) {
      strapi.log.error('[magic-sessionmanager/notifications] Error sending new location email:', err);
      return false;
    }
  },
  
  /**
   * Send VPN/Proxy login alert
   * @param {Object} params - { user, session, reason, geoData }
   */
  async sendVpnProxyAlert({ user, session, reason, geoData }) {
    try {
      // Get templates from database (or defaults)
      const templates = await this.getEmailTemplates();
      const template = templates.vpnProxy;
      
      // Prepare data for variable replacement
      const data = { user, session, reason, geoData };
      
      // Replace variables in template
      const htmlContent = this.replaceVariables(template.html, data);
      const textContent = this.replaceVariables(template.text, data);

      await strapi.plugins['email'].services.email.send({
        to: user.email,
        subject: template.subject,
        html: htmlContent,
        text: textContent,
      });

      strapi.log.info(`[magic-sessionmanager/notifications] VPN/Proxy alert sent to ${user.email}`);
      return true;
    } catch (err) {
      strapi.log.error('[magic-sessionmanager/notifications] Error sending VPN/Proxy email:', err);
      return false;
    }
  },

  /**
   * Send webhook notification
   * @param {Object} params - { event, data, webhookUrl }
   */
  async sendWebhook({ event, data, webhookUrl }) {
    try {
      const payload = {
        event,
        timestamp: new Date().toISOString(),
        data,
        source: 'magic-sessionmanager',
      };

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Strapi-Magic-SessionManager-Webhook/1.0',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        strapi.log.info(`[magic-sessionmanager/notifications] Webhook sent: ${event}`);
        return true;
      } else {
        strapi.log.warn(`[magic-sessionmanager/notifications] Webhook failed: ${response.status}`);
        return false;
      }
    } catch (err) {
      strapi.log.error('[magic-sessionmanager/notifications] Webhook error:', err);
      return false;
    }
  },

  /**
   * Format webhook for Discord
   * @param {Object} params - { event, session, user, geoData }
   */
  formatDiscordWebhook({ event, session, user, geoData }) {
    const embed = {
      title: this.getEventTitle(event),
      color: this.getEventColor(event),
      fields: [
        { name: '👤 User', value: `${user.email}\n${user.username || 'N/A'}`, inline: true },
        { name: '🌐 IP', value: session.ipAddress, inline: true },
        { name: '📅 Time', value: new Date(session.loginTime).toLocaleString(), inline: false },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'Magic Session Manager' },
    };

    if (geoData) {
      embed.fields.push({
        name: '📍 Location',
        value: `${geoData.country_flag} ${geoData.city}, ${geoData.country}`,
        inline: true,
      });
      
      if (geoData.isVpn || geoData.isProxy || geoData.isThreat) {
        const warnings = [];
        if (geoData.isVpn) warnings.push('VPN');
        if (geoData.isProxy) warnings.push('Proxy');
        if (geoData.isThreat) warnings.push('Threat');
        
        embed.fields.push({
          name: '⚠️ Security',
          value: `${warnings.join(', ')} detected\nScore: ${geoData.securityScore}/100`,
          inline: true,
        });
      }
    }

    return { embeds: [embed] };
  },

  getEventTitle(event) {
    const titles = {
      'login.suspicious': '🚨 Suspicious Login',
      'login.new_location': '📍 New Location Login',
      'login.vpn': '🔴 VPN Login Detected',
      'login.threat': '⛔ Threat IP Login',
      'session.terminated': '🔴 Session Terminated',
    };
    return titles[event] || '📊 Session Event';
  },

  getEventColor(event) {
    const colors = {
      'login.suspicious': 0xFF0000, // Red
      'login.new_location': 0xFFA500, // Orange
      'login.vpn': 0xFF6B6B, // Light Red
      'login.threat': 0x8B0000, // Dark Red
      'session.terminated': 0x808080, // Gray
    };
    return colors[event] || 0x5865F2; // Discord Blue
  },
});

