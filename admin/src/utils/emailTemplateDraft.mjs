/** Alert types that have an editable e-mail template, in display order. */
export const TEMPLATE_KEYS = Object.freeze(['suspiciousLogin', 'newLocation', 'vpnProxy']);

/**
 * Server-side limits (server/src/controllers/settings.js sanitizeEmailTemplates).
 * The server truncates longer values, so the form validates them instead.
 */
export const TEMPLATE_LIMITS = Object.freeze({ subject: 200, html: 10000, text: 5000 });

/**
 * Template variables with the message id of their translated description.
 * Descriptions are rendered through formatMessage (I18N-5, SET-11).
 */
export const TEMPLATE_VARIABLE_DEFINITIONS = Object.freeze({
  '{{user.email}}': { messageId: 'settings.email.templates.variable.userEmail', defaultMessage: 'User email address' },
  '{{user.username}}': { messageId: 'settings.email.templates.variable.username', defaultMessage: 'Username' },
  '{{session.loginTime}}': { messageId: 'settings.email.templates.variable.loginTime', defaultMessage: 'Login time' },
  '{{session.ipAddress}}': { messageId: 'settings.email.templates.variable.ipAddress', defaultMessage: 'IP address' },
  '{{geo.city}}': { messageId: 'settings.email.templates.variable.city', defaultMessage: 'City (if available)' },
  '{{geo.country}}': { messageId: 'settings.email.templates.variable.country', defaultMessage: 'Country (if available)' },
  '{{geo.timezone}}': { messageId: 'settings.email.templates.variable.timezone', defaultMessage: 'Time zone (if available)' },
  '{{session.userAgent}}': { messageId: 'settings.email.templates.variable.userAgent', defaultMessage: 'Browser and device' },
  '{{reason.isVpn}}': { messageId: 'settings.email.templates.variable.isVpn', defaultMessage: 'VPN detected (true or false)' },
  '{{reason.isProxy}}': { messageId: 'settings.email.templates.variable.isProxy', defaultMessage: 'Proxy detected (true or false)' },
  '{{reason.isThreat}}': { messageId: 'settings.email.templates.variable.isThreat', defaultMessage: 'Threat detected (true or false)' },
  '{{reason.securityScore}}': { messageId: 'settings.email.templates.variable.securityScore', defaultMessage: 'Security score (0 to 100)' },
});

/** Variables available per alert type. */
export const TEMPLATE_VARIABLES = Object.freeze({
  suspiciousLogin: [
    '{{user.email}}', '{{user.username}}', '{{session.loginTime}}', '{{session.ipAddress}}',
    '{{geo.city}}', '{{geo.country}}', '{{geo.timezone}}', '{{session.userAgent}}',
    '{{reason.isVpn}}', '{{reason.isProxy}}', '{{reason.isThreat}}', '{{reason.securityScore}}',
  ],
  newLocation: [
    '{{user.email}}', '{{user.username}}', '{{session.loginTime}}', '{{session.ipAddress}}',
    '{{geo.city}}', '{{geo.country}}', '{{geo.timezone}}', '{{session.userAgent}}',
  ],
  vpnProxy: [
    '{{user.email}}', '{{user.username}}', '{{session.loginTime}}', '{{session.ipAddress}}',
    '{{geo.city}}', '{{geo.country}}', '{{session.userAgent}}', '{{reason.isVpn}}', '{{reason.isProxy}}',
  ],
});

/** Synthetic values for the template preview. Never real user data. */
export const TEMPLATE_PREVIEW_VALUES = Object.freeze({
  '{{user.email}}': 'jane.doe@example.com',
  '{{user.username}}': 'jane.doe',
  '{{session.loginTime}}': '2026-11-06 09:41 UTC',
  '{{session.ipAddress}}': '203.0.113.42',
  '{{geo.city}}': 'Berlin',
  '{{geo.country}}': 'Germany',
  '{{geo.timezone}}': 'Europe/Berlin',
  '{{session.userAgent}}': 'Firefox 132 on macOS',
  '{{reason.isVpn}}': 'true',
  '{{reason.isProxy}}': 'false',
  '{{reason.isThreat}}': 'false',
  '{{reason.securityScore}}': '35',
});

/** Return an updated template collection without changing the saved baseline. */
export function updateEmailTemplate(templates, templateKey, field, value) {
  return { ...templates, [templateKey]: { ...templates[templateKey], [field]: value } };
}

/**
 * Lists the known variables of an alert type that a template uses.
 *
 * @param {string} template Template source.
 * @param {string} templateKey Alert type.
 * @returns {{found: string[], total: number}} Used variables and the number available.
 */
export function findTemplateVariables(template, templateKey) {
  const available = TEMPLATE_VARIABLES[templateKey] || [];
  const source = typeof template === 'string' ? template : '';
  return { found: available.filter((variable) => source.includes(variable)), total: available.length };
}

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const HTML_SPACE = /[\t\n\f\r ]/;
const ASCII_LETTER = /[A-Za-z]/;
/** Attributes that run script or load a nested document in the preview frame. */
const isActiveAttribute = (name) => /^on/i.test(name) || name.toLowerCase() === 'srcdoc';

/**
 * Reads one start or end tag the way the HTML tokenizer does: attribute
 * values in quotes run until the closing quote (also across ">" and line
 * breaks), unquoted values until white space or ">". Inline event handlers
 * and srcdoc are left out.
 *
 * @param {string} raw HTML source.
 * @param {number} start Index of "<".
 * @returns {{ tag: string, name: string, end: number }|null} Cleaned tag,
 *   lower-case name and the index after it, or null when the source ends
 *   inside the tag (the browser then drops the tag).
 */
const readTag = (raw, start) => {
  const isEnd = raw[start + 1] === '/';
  let j = start + (isEnd ? 2 : 1);
  const nameStart = j;
  while (j < raw.length && !HTML_SPACE.test(raw[j]) && raw[j] !== '/' && raw[j] !== '>') j += 1;
  const name = raw.slice(nameStart, j);
  let tag = `<${isEnd ? '/' : ''}${name}`;

  for (;;) {
    let separator = '';
    while (j < raw.length && (HTML_SPACE.test(raw[j]) || raw[j] === '/')) separator += raw[j++];
    if (j >= raw.length) return null;
    if (raw[j] === '>') return { tag: `${tag}${separator}>`, name: name.toLowerCase(), end: j + 1 };

    const attributeStart = j;
    j += 1; // The first character may be "=".
    while (j < raw.length && !HTML_SPACE.test(raw[j]) && !['/', '>', '='].includes(raw[j])) j += 1;
    const attributeName = raw.slice(attributeStart, j);

    let k = j;
    while (k < raw.length && HTML_SPACE.test(raw[k])) k += 1;
    if (raw[k] === '=') {
      k += 1;
      while (k < raw.length && HTML_SPACE.test(raw[k])) k += 1;
      if (k >= raw.length) return null;
      if (raw[k] === '"' || raw[k] === "'") {
        const close = raw.indexOf(raw[k], k + 1);
        if (close === -1) return null;
        j = close + 1;
      } else if (raw[k] === '>') {
        j = k;
      } else {
        while (k < raw.length && !HTML_SPACE.test(raw[k]) && raw[k] !== '>') k += 1;
        if (k >= raw.length) return null;
        j = k;
      }
    }

    if (!isActiveAttribute(attributeName)) {
      tag += `${separator || ' '}${raw.slice(attributeStart, j)}`;
    }
  }
};

/**
 * Removes script elements, inline event handlers and srcdoc from HTML for the
 * sandboxed preview, so the frame never logs "Blocked script execution".
 * It tokenizes like the browser: while an admin types, half-finished markup
 * such as `<p onclick` before the next tag, or a quote that is not closed
 * yet, is a real handler for the browser, which a regular expression over
 * "<…>" does not see. A tag cut off by the end of the source is dropped, as
 * the browser drops it. Comments and text are kept unchanged.
 *
 * @param {string} raw HTML source.
 * @returns {string} HTML without active content.
 */
const stripActiveHtml = (raw) => {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const lt = raw.indexOf('<', i);
    if (lt === -1) return out + raw.slice(i);
    out += raw.slice(i, lt);
    i = lt;
    const next = raw[i + 1] || '';

    if (raw.startsWith('<!--', i)) {
      // "<!-->" and "<!--->" are complete (empty) comments for the browser.
      const shortEnd = raw.startsWith('<!-->', i) ? 5 : raw.startsWith('<!--->', i) ? 6 : 0;
      if (shortEnd) {
        out += raw.slice(i, i + shortEnd);
        i += shortEnd;
        continue;
      }
      const ends = [raw.indexOf('-->', i + 4), raw.indexOf('--!>', i + 4)].filter((index) => index !== -1);
      if (!ends.length) return out;
      const end = Math.min(...ends);
      const close = raw.indexOf('>', end) + 1;
      out += raw.slice(i, close);
      i = close;
      continue;
    }

    const isTag = ASCII_LETTER.test(next) || (next === '/' && ASCII_LETTER.test(raw[i + 2] || ''));
    if (!isTag) {
      if (next === '!' || next === '?' || next === '/') {
        // Doctype, bogus comment or invalid end tag: inert up to the next ">".
        const close = raw.indexOf('>', i);
        if (close === -1) return out;
        out += raw.slice(i, close + 1);
        i = close + 1;
      } else {
        out += '<';
        i += 1;
      }
      continue;
    }

    const parsed = readTag(raw, i);
    if (!parsed) return out;
    i = parsed.end;
    if (parsed.name === 'script' && !parsed.tag.startsWith('</')) {
      const closing = /<\/script[\t\n\f\r />]/i.exec(raw.slice(i));
      if (!closing) return out;
      const close = raw.indexOf('>', i + closing.index);
      if (close === -1) return out;
      i = close + 1;
      continue;
    }
    if (parsed.name === 'script') continue;
    out += parsed.tag;
  }
  return out;
};

/**
 * Replaces template variables with synthetic preview values. HTML previews
 * escape the inserted values; the result is meant for a sandboxed iframe.
 *
 * @param {string} template Template source.
 * @param {{html?: boolean}} [options] Escape inserted values for HTML.
 * @returns {string} Preview text.
 */
export function renderTemplatePreview(template, { html = false } = {}) {
  const raw = typeof template === 'string' ? template : '';
  // The preview frame is sandboxed without scripts. Scripts and inline event
  // handlers are dropped first, so the browser logs no blocked-script errors;
  // the server sanitises the stored HTML separately.
  const source = html ? stripActiveHtml(raw) : raw;
  return source.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, name) => {
    const value = TEMPLATE_PREVIEW_VALUES[`{{${name}}}`];
    if (value === undefined) return match;
    return html ? escapeHtml(value) : value;
  });
}

/**
 * Default e-mail templates. They are sent to end users, so they stay in
 * English like the server-side fallbacks; admins edit them per alert type.
 *
 * @returns {Record<string, {subject: string, html: string, text: string}>} Fresh copies.
 */
export const getDefaultTemplates = () => ({
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

/**
 * Fills missing or empty template fields with the defaults, without
 * mutating the input (the server stores empty strings for unset fields).
 *
 * @param {unknown} templates Stored templates.
 * @returns {Record<string, {subject: string, html: string, text: string}>} Complete templates.
 */
export function fillMissingTemplates(templates) {
  const defaults = getDefaultTemplates();
  const source = templates && typeof templates === 'object' ? templates : {};
  return Object.fromEntries(TEMPLATE_KEYS.map((key) => {
    const stored = source[key] && typeof source[key] === 'object' ? source[key] : {};
    return [key, {
      subject: stored.subject || defaults[key].subject,
      html: stored.html || defaults[key].html,
      text: stored.text || defaults[key].text,
    }];
  }));
}
