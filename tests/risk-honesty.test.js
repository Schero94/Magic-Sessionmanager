'use strict';

/**
 * Without a risk data source the plugin must not claim risk results: no
 * fake score, no VPN/proxy flags from a provider that has none, and no
 * risk-based email, webhook event or rejection.
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const createGeolocationService = require('../server/src/services/geolocation');
const { invalidateSettingsCache } = require('../server/src/utils/settings-loader');
const { evaluateLoginRisk, hasRiskData, noRiskData } = require('../server/src/utils/risk-data');
const { dispatchLoginAlerts } = require('../server/src/utils/login-alerts');

function createStrapi(config) {
  return {
    config: {
      get(key) {
        return key === 'plugin::magic-sessionmanager' ? config : {};
      },
    },
    store: () => ({ get: async () => null, set: async () => {} }),
    db: { query: () => ({ findOne: async () => null }) },
    log: { debug() {}, error() {}, info() {}, warn() {} },
  };
}

/**
 * Notification service double that records what would be sent.
 *
 * @returns {object} Fake service with a `sent` log.
 */
function createNotificationRecorder() {
  const sent = [];
  return {
    sent,
    async sendVpnProxyAlert() {
      sent.push('email:vpnProxy');
      return true;
    },
    async sendSuspiciousLoginAlert() {
      sent.push('email:suspiciousLogin');
      return true;
    },
    async sendNewLocationAlert() {
      sent.push('email:newLocation');
      return true;
    },
    formatDiscordWebhook: ({ event }) => ({ event }),
    formatSlackWebhook: ({ event }) => ({ event }),
    async sendWebhook({ event, webhookUrl }) {
      sent.push(`webhook:${event}:${new URL(webhookUrl).hostname}`);
      return true;
    },
  };
}

const ALL_ALERTS_ON = Object.freeze({
  enableEmailAlerts: true,
  alertOnVpnProxy: true,
  alertOnSuspiciousLogin: true,
  alertOnNewLocation: true,
  enableWebhooks: true,
  enableSecurityScoring: true,
  discordWebhookUrl: 'https://discord.com/api/webhooks/1/synthetic',
});

test('ipapi.co answers carry no risk data, even if a threat object appears', async () => {
  invalidateSettingsCache();
  const fetchBefore = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      ip: '198.51.100.7',
      country_name: 'Germany',
      country_code: 'DE',
      city: 'Berlin',
      region: 'Berlin',
      timezone: 'Europe/Berlin',
      // Not a documented ipapi.co field (https://ipapi.co/api/): ignored.
      threat: { is_vpn: true, is_proxy: true, is_tor: true, is_threat: true },
    }),
  });
  try {
    const service = createGeolocationService({
      strapi: createStrapi({ geoIpProvider: 'ipapi', enableGeolocation: true }),
    });
    // Documentation addresses count as private in getIpInfo, so the provider
    // is called directly (fetch is stubbed; nothing leaves the process).
    const result = await service.getIpapiIpInfo('198.51.100.7');
    assert.equal(result._status, 'ok');
    assert.equal(result.country_code, 'DE');
    assert.equal(result.isVpn, false);
    assert.equal(result.isProxy, false);
    assert.equal(result.isTor, false);
    assert.equal(result.isThreat, false);
    assert.equal(result.securityScore, null);
    assert.equal(result.riskSource, null);
    assert.equal(hasRiskData(result), false);
  } finally {
    global.fetch = fetchBefore;
  }
});

test('lookup fallbacks and private addresses never report a score', async () => {
  invalidateSettingsCache();
  const service = createGeolocationService({ strapi: createStrapi({}) });
  assert.equal(service.getFallbackData('198.51.100.8', 'error').securityScore, null);
  const local = await service.getIpInfo('127.0.0.1');
  assert.equal(local._status, 'private');
  assert.equal(local.securityScore, null);
  assert.equal(local.riskSource, null);
});

test('without a risk source nothing is suspicious, whatever the flags say', () => {
  const settings = { enableSecurityScoring: true };
  assert.deepEqual(evaluateLoginRisk(settings, { ...noRiskData(), country: 'Germany' }), {
    hasRiskData: false,
    isSuspicious: false,
    isVpnOrProxy: false,
  });
  assert.equal(evaluateLoginRisk(settings, { isVpn: true, securityScore: 10 }).isSuspicious, false);
  assert.equal(evaluateLoginRisk(settings, null).hasRiskData, false);
});

test('no source: no risk emails, and the webhook reports login.success', async () => {
  const notificationService = createNotificationRecorder();
  const attempted = await dispatchLoginAlerts({
    settings: ALL_ALERTS_ON,
    notificationService,
    user: { email: 'ada@example.com', username: 'ada' },
    session: { ipAddress: '198.51.100.7', loginTime: '2026-11-24T10:00:00.000Z' },
    geoData: { _status: 'ok', country: 'Germany', country_code: 'DE', ...noRiskData() },
  });
  assert.deepEqual(notificationService.sent, ['webhook:login.success:discord.com']);
  assert.deepEqual(attempted, { webhookEvent: 'login.success', emails: [] });
});

test('no source: the new-country alert still works, it needs location only', async () => {
  const notificationService = createNotificationRecorder();
  await dispatchLoginAlerts({
    settings: ALL_ALERTS_ON,
    notificationService,
    user: { email: 'ada@example.com' },
    session: {},
    geoData: { _status: 'ok', country_code: 'FR', ...noRiskData() },
    isNewLocation: true,
  });
  assert.deepEqual(notificationService.sent, [
    'email:newLocation',
    'webhook:login.new_location:discord.com',
  ]);
});

test('webhook messages name no risk without a source', () => {
  const createNotifications = require('../server/src/services/notifications');
  const notifications = createNotifications({ strapi: createStrapi({}) });
  const session = { ipAddress: '198.51.100.7', loginTime: '2026-11-24T10:00:00.000Z' };
  const user = { email: 'ada@example.com', username: 'ada' };
  const geoData = { country: 'Germany', city: 'Berlin', isVpn: true, securityScore: 100 };
  const discord = notifications.formatDiscordWebhook({
    event: 'login.success',
    session,
    user,
    geoData,
  });
  assert.doesNotMatch(JSON.stringify(discord), /VPN|Score/);
  const slack = notifications.formatSlackWebhook({
    event: 'login.success',
    session,
    user,
    geoData,
  });
  assert.doesNotMatch(JSON.stringify(slack), /VPN|score/);
});
