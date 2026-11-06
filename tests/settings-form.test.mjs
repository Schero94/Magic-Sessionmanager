import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  ENCRYPTION_KEY_ENV_NAME,
  formatEnvLine,
  generateEncryptionKey,
} from '../admin/src/utils/encryptionKey.mjs';
import * as settingsForm from '../admin/src/utils/settingsForm.mjs';
import {
  getAdjustedFields,
  normalizeSettings,
  validateCountryCode,
  validateSettings,
} from '../admin/src/utils/settingsForm.mjs';

// Single-field checks run through validateSettings, the only entry point the page uses.
const fieldError = (field, value) => validateSettings({ maxFailedLogins: 5, [field]: value })[field] ?? null;
const GEOIP_DATABASE_FILENAMES = ['GeoLite2-City.mmdb', 'GeoLite2-Country.mmdb', 'GeoIP2-City.mmdb', 'GeoIP2-Country.mmdb'];
import {
  fillMissingTemplates,
  findTemplateVariables,
  getDefaultTemplates,
  renderTemplatePreview,
  TEMPLATE_KEYS,
  TEMPLATE_LIMITS,
  TEMPLATE_VARIABLE_DEFINITIONS,
  TEMPLATE_VARIABLES,
} from '../admin/src/utils/emailTemplateDraft.mjs';
import { getModeChangeImpact } from '../admin/src/utils/geofencingMode.mjs';
import { tabHasFieldErrors } from '../admin/src/pages/Settings/settingsTabs.mjs';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv');

test('generated encryption keys are 256-bit hex and survive dotenv unchanged (SET-01)', () => {
  for (let index = 0; index < 500; index += 1) {
    const key = generateEncryptionKey();
    assert.match(key, /^[0-9a-f]{64}$/);
    const parsed = dotenv.parse(formatEnvLine(ENCRYPTION_KEY_ENV_NAME, key));
    assert.equal(parsed[ENCRYPTION_KEY_ENV_NAME], key);
  }
});

test('key generation maps bytes to hex without modulo bias and refuses a missing random source', () => {
  const source = { getRandomValues: (array) => { array.fill(0xab); return array; } };
  assert.equal(generateEncryptionKey(source), 'ab'.repeat(32));
  assert.throws(() => generateEncryptionKey(null), /secure_random_unavailable/);
});

test('.env lines are quoted so dotenv keeps "#" and other special characters', () => {
  for (const value of ['abc#def', 'a b c', 'x"y', "x'y\"z", '$HOME#1', 'p@ss=word']) {
    const line = formatEnvLine(ENCRYPTION_KEY_ENV_NAME, value);
    assert.equal(dotenv.parse(line)[ENCRYPTION_KEY_ENV_NAME], value, line);
  }
  assert.equal(formatEnvLine('KEY', 'abc'), 'KEY="abc"');
  assert.throws(() => formatEnvLine('KEY', 'a\nb'), /single_line/);
  assert.throws(() => formatEnvLine('KEY', '"\'`'), /quote_styles/);
});

test('settingsForm exports only what the admin uses (no stale helpers)', () => {
  assert.deepEqual(Object.keys(settingsForm).sort(), [
    'MAX_FAILED_LOGINS_RANGE',
    'SETTINGS_DEFAULTS',
    'getAdjustedFields',
    'normalizeSettings',
    'validateCountryCode',
    'validateSettings',
  ]);
});

test('max failed logins is validated, never clamped (SET-03)', () => {
  assert.equal(fieldError('maxFailedLogins', 5), null);
  assert.equal(fieldError('maxFailedLogins', 0), null);
  assert.equal(fieldError('maxFailedLogins', 100), null);
  assert.equal(fieldError('maxFailedLogins', undefined)?.messageId, 'settings.validation.required');
  for (const value of [-3, 101, 500, 2.5, Number.NaN]) {
    const error = fieldError('maxFailedLogins', value);
    assert.equal(error?.messageId, 'settings.validation.range', String(value));
    assert.deepEqual(error.values, { min: 0, max: 100 });
  }
});

test('webhook URLs follow the server allowlist and report errors inline', () => {
  const discordOk = (url) => fieldError('discordWebhookUrl', url) === null;
  assert.equal(discordOk(''), true);
  assert.equal(discordOk('https://discord.com/api/webhooks/1/abc'), true);
  assert.equal(discordOk('https://discordapp.com/api/webhooks/1/abc'), true);
  assert.equal(discordOk('https://ptb.discord.com/api/webhooks/1/abc'), true);
  assert.equal(discordOk('http://discord.com/api/webhooks/1/abc'), false);
  assert.equal(discordOk('https://evil-discord.com/x'), false);
  assert.equal(discordOk('not-a-url'), false);
  assert.equal(fieldError('slackWebhookUrl', 'https://hooks.slack.com/services/A/B/C'), null);
  assert.equal(fieldError('slackWebhookUrl', 'https://discord.com/api/webhooks/1/abc')?.messageId, 'settings.validation.webhookSlack');

  const errors = validateSettings({
    maxFailedLogins: 5,
    discordWebhookUrl: 'not-a-url',
    slackWebhookUrl: 'https://example.com/hook',
  });
  assert.equal(errors.discordWebhookUrl.messageId, 'settings.validation.webhookDiscord');
  assert.equal(errors.slackWebhookUrl.messageId, 'settings.validation.webhookSlack');
  assert.equal(tabHasFieldErrors(errors, 'alerts'), true);
  assert.equal(tabHasFieldErrors(errors, 'sessions'), false);
});

test('GeoIP filename and template lengths are validated instead of silently changed by the server', () => {
  assert.equal(validateSettings({ maxFailedLogins: 1, geoIpDatabasePath: '' }).geoIpDatabasePath, undefined);
  for (const name of GEOIP_DATABASE_FILENAMES) {
    assert.equal(validateSettings({ maxFailedLogins: 1, geoIpDatabasePath: name }).geoIpDatabasePath, undefined);
  }
  const pathError = validateSettings({ maxFailedLogins: 1, geoIpDatabasePath: '../etc/passwd' }).geoIpDatabasePath;
  assert.equal(pathError.messageId, 'settings.validation.geoIpFilename');

  const templates = fillMissingTemplates({});
  templates.vpnProxy = { ...templates.vpnProxy, subject: 'x'.repeat(TEMPLATE_LIMITS.subject + 1) };
  const errors = validateSettings({ maxFailedLogins: 1, emailTemplates: templates });
  assert.equal(errors['emailTemplates.vpnProxy.subject'].messageId, 'settings.validation.maxLength');
  assert.equal(errors['emailTemplates.vpnProxy.subject'].values.count, TEMPLATE_LIMITS.subject + 1);
  assert.equal(tabHasFieldErrors(errors, 'alerts'), true);
});

test('country codes are validated and duplicates are reported', () => {
  assert.equal(validateCountryCode('', []), null);
  assert.equal(validateCountryCode('jp', []), null);
  assert.equal(validateCountryCode('J1', [])?.messageId, 'settings.validation.countryCode');
  assert.equal(validateCountryCode('JP', ['JP'])?.messageId, 'settings.validation.countryDuplicate');
});

test('the saved baseline is what the server stored, not the submitted draft (SET-01 browser)', () => {
  const previous = normalizeSettings({ discordWebhookUrl: '', enableWebhooks: false, emailTemplates: {} });
  const submitted = { ...previous, enableWebhooks: true, discordWebhookUrl: 'not-a-url' };
  const stored = normalizeSettings({ ...submitted, discordWebhookUrl: '' });

  assert.equal(stored.discordWebhookUrl, '');
  assert.deepEqual(getAdjustedFields(submitted, stored, previous), ['discordWebhookUrl']);
  // Server-side sanitising of a value the admin did not edit is not reported.
  const sanitized = { ...stored, discordWebhookUrl: submitted.discordWebhookUrl, emailTemplates: { ...stored.emailTemplates, vpnProxy: { ...stored.emailTemplates.vpnProxy, html: '<p>clean</p>' } } };
  assert.deepEqual(getAdjustedFields(submitted, sanitized, previous), []);
});

test('normalizeSettings keeps unknown server fields, fills defaults and rejects malformed payloads', () => {
  const settings = normalizeSettings({ rateLimitWriteMax: 10, emailTemplates: { vpnProxy: { subject: 'S', html: '', text: '' } } });
  assert.equal(settings.rateLimitWriteMax, 10);
  assert.equal(settings.maxFailedLogins, 5);
  assert.equal(settings.emailTemplates.vpnProxy.subject, 'S');
  assert.equal(settings.emailTemplates.vpnProxy.html, getDefaultTemplates().vpnProxy.html);
  for (const value of [null, [], 'x']) assert.throws(() => normalizeSettings(value), /Invalid settings response/);
});

test('switching geofencing mode asks before clearing a non-empty list (SET-05)', () => {
  assert.deepEqual(getModeChangeImpact({ allowedCountries: ['DE', 'AT'], blockedCountries: [] }, 'allowlist', 'blocklist'), {
    confirm: true,
    clearField: 'allowedCountries',
    count: 2,
  });
  assert.equal(getModeChangeImpact({ allowedCountries: [], blockedCountries: [] }, 'allowlist', 'blocklist').confirm, false);
  assert.equal(getModeChangeImpact({ allowedCountries: ['DE'] }, 'allowlist', 'allowlist').confirm, false);
});

test('template variables have translated descriptions and previews escape inserted values', () => {
  for (const key of TEMPLATE_KEYS) {
    for (const variable of TEMPLATE_VARIABLES[key]) {
      assert.ok(TEMPLATE_VARIABLE_DEFINITIONS[variable]?.messageId.startsWith('settings.email.templates.variable.'), variable);
    }
  }
  assert.deepEqual(findTemplateVariables('Hi {{user.email}} {{geo.city}}', 'newLocation'), {
    found: ['{{user.email}}', '{{geo.city}}'],
    total: TEMPLATE_VARIABLES.newLocation.length,
  });
  assert.equal(renderTemplatePreview('Hi {{user.email}} {{unknown.x}}'), 'Hi jane.doe@example.com {{unknown.x}}');
  assert.doesNotMatch(renderTemplatePreview('<b>{{session.userAgent}}</b>', { html: true }), /<script/);
});

test('the HTML preview drops scripts and inline handlers, so the sandboxed frame logs no blocked-script errors', () => {
  const preview = renderTemplatePreview('<p onclick="x()" onmouseover=\'y()\'>Hi {{user.email}}</p><script>alert(1)</script><SCRIPT src="a.js"></SCRIPT>', { html: true });
  assert.doesNotMatch(preview, /<script/i);
  assert.doesNotMatch(preview, /\son\w+=/i);
  assert.match(preview, /<p>Hi jane\.doe@example\.com<\/p>/);
  assert.match(renderTemplatePreview('<p>Someone onboarding = yes</p>', { html: true }), /Someone onboarding = yes/, 'text outside tags stays');
  // Plain text and subjects are never touched.
  assert.equal(renderTemplatePreview('<script>x</script>'), '<script>x</script>');
});

test('the HTML preview follows the browser tokenizer, so half-typed tags never become handlers or scripts', () => {
  const clean = (source) => renderTemplatePreview(source, { html: true });
  // An attribute without a value is still a handler for the browser.
  assert.equal(clean('<p onclick\n<html><body>x</body></html>'), '<p\n<html><body>x</body></html>');
  // A quoted value runs past ">" until its closing quote, as in the browser.
  assert.equal(clean('<p title="a>b" onclick="x()">t</p>'), '<p title="a>b">t</p>');
  assert.equal(clean('<p onclick="alert(1)\n<html>\n<body style="a">x'), '<p a">x');
  // "<!-->" is a complete comment for the browser; the tag after it is real.
  assert.equal(clean('<!--><p onclick="x()">t</p>-->'), '<!--><p>t</p>-->');
  // A tag cut off by the end of the source is dropped, as the browser drops it.
  assert.equal(clean('Hi <p oncl'), 'Hi ');
  assert.equal(clean('Hi <p class="a'), 'Hi ');
  // Scripts: closed, unclosed, upper case, with attributes.
  assert.equal(clean('a<script>alert(1)</script>b'), 'ab');
  assert.equal(clean('a<SCRIPT src="x.js"></SCRIPT >b'), 'ab');
  assert.equal(clean('a<script>alert(1)</scr'), 'a');
  assert.equal(clean('a<script'), 'a');
  // Unquoted and single-quoted handlers, slashes as separators, SVG, nested srcdoc.
  assert.equal(clean("<img src=x onerror=alert(3)><svg/onload='x()'>"), '<img src=x><svg>');
  assert.equal(clean('<iframe srcdoc="<script>x</script>"></iframe>'), '<iframe></iframe>');
  // Text, comments and end tags stay; "on" words in text are untouched.
  assert.equal(clean('<!-- <p onclick="x"> --><p>Someone onboarding = yes</p>'), '<!-- <p onclick="x"> --><p>Someone onboarding = yes</p>');
  assert.equal(clean('<b>{{user.email}}</b> 3 < 4'), '<b>jane.doe@example.com</b> 3 < 4');
});
