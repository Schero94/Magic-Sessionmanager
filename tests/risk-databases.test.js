'use strict';

/**
 * Risk data from local MaxMind databases, read by the real
 * `@maxmind/geoip2-node` reader from synthetic MMDB fixtures written by
 * tests/helpers/mmdb-writer.js (no MaxMind data is shipped or downloaded).
 * Covers VPN, Tor, hosting, residential proxy and a clean address, the ASN
 * heuristic, and that the reject rule, the emails and the webhook fire.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildMmdb } = require('./helpers/mmdb-writer');
const {
  getRiskDataStatus,
  lookupRiskData,
  resetRiskReaders,
} = require('../server/src/utils/risk-databases');
const createGeolocationService = require('../server/src/services/geolocation');
const createNotifications = require('../server/src/services/notifications');
const createGeoIpController = require('../server/src/controllers/geoip');
const { evaluateGeoFirewall } = require('../server/src/utils/geo-firewall');
const { dispatchLoginAlerts } = require('../server/src/utils/login-alerts');
const { invalidateSettingsCache } = require('../server/src/utils/settings-loader');
const {
  DEFAULT_GEOIP_DIRECTORY,
  resolveConfig,
  resolveDatabaseTarget,
} = require('../scripts/geoip-updater.cjs');

// Synthetic networks. Documentation ranges (RFC 5737) for direct lookups;
// 25.0.0.0/16 for the sign-in path, because getIpInfo answers documentation
// ranges as private without any lookup. The records are invented.
const NET = Object.freeze({
  vpn: { network: '198.51.100.0/25', ip: '198.51.100.10' },
  publicProxy: { network: '198.51.100.128/25', ip: '198.51.100.200' },
  tor: { network: '192.0.2.0/25', ip: '192.0.2.10' },
  hosting: { network: '192.0.2.128/25', ip: '192.0.2.200' },
  residentialProxy: { network: '203.0.113.0/24', ip: '203.0.113.10' },
  clean: { ip: '100.64.0.10' },
  signInVpn: { network: '25.0.1.0/24', ip: '25.0.1.10' },
  signInCloud: { network: '25.0.2.0/24', ip: '25.0.2.10' },
  signInClean: { network: '25.0.3.0/24', ip: '25.0.3.10' },
});

const ANONYMOUS_IP_RECORDS = [
  { network: NET.vpn.network, data: { is_anonymous: true, is_anonymous_vpn: true } },
  { network: NET.publicProxy.network, data: { is_anonymous: true, is_public_proxy: true } },
  { network: NET.tor.network, data: { is_anonymous: true, is_tor_exit_node: true } },
  { network: NET.hosting.network, data: { is_anonymous: true, is_hosting_provider: true } },
  {
    network: NET.residentialProxy.network,
    data: { is_anonymous: true, is_residential_proxy: true },
  },
  { network: NET.signInVpn.network, data: { is_anonymous: true, is_anonymous_vpn: true } },
];

const ASN_RECORDS = [
  // 16509 is on the hosting list (Amazon); 64500 is a documentation ASN (RFC 5398).
  {
    network: NET.hosting.network,
    data: { autonomous_system_number: 16509, autonomous_system_organization: 'Example Cloud' },
  },
  {
    network: NET.residentialProxy.network,
    data: { autonomous_system_number: 64500, autonomous_system_organization: 'Example ISP' },
  },
  {
    network: NET.signInCloud.network,
    data: { autonomous_system_number: 16509, autonomous_system_organization: 'Example Cloud' },
  },
  {
    network: NET.signInClean.network,
    data: { autonomous_system_number: 64500, autonomous_system_organization: 'Example ISP' },
  },
];

const COUNTRY_RECORDS = ['25.0.1.0/24', '25.0.2.0/24', '25.0.3.0/24'].map((network) => ({
  network,
  data: { country: { iso_code: 'DE', names: { en: 'Germany' } } },
}));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-sessionmanager-risk-'));
const files = {
  anonymousIp: path.join(tmpDir, 'GeoIP2-Anonymous-IP.mmdb'),
  asn: path.join(tmpDir, 'GeoLite2-ASN.mmdb'),
  country: path.join(tmpDir, 'GeoLite2-Country.mmdb'),
  missing: path.join(tmpDir, 'missing.mmdb'),
};
fs.writeFileSync(
  files.anonymousIp,
  buildMmdb({ databaseType: 'GeoIP2-Anonymous-IP', records: ANONYMOUS_IP_RECORDS })
);
fs.writeFileSync(files.asn, buildMmdb({ databaseType: 'GeoLite2-ASN', records: ASN_RECORDS }));
fs.writeFileSync(
  files.country,
  buildMmdb({ databaseType: 'GeoLite2-Country', records: COUNTRY_RECORDS })
);

const ENV_KEYS = [
  'MAGIC_SESSIONMANAGER_ANONYMOUS_IP_DATABASE',
  'MAGIC_SESSIONMANAGER_ASN_DATABASE',
];

/**
 * Points the risk database variables at fixture files for one test.
 *
 * @param {import('node:test').TestContext} t Test context.
 * @param {{anonymousIp?: string, asn?: string}} paths Fixture paths (missing file when omitted).
 * @returns {NodeJS.ProcessEnv} The environment used.
 */
function useRiskDatabases(t, { anonymousIp = files.missing, asn = files.missing }) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.MAGIC_SESSIONMANAGER_ANONYMOUS_IP_DATABASE = anonymousIp;
  process.env.MAGIC_SESSIONMANAGER_ASN_DATABASE = asn;
  resetRiskReaders();
  t.after(() => {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    resetRiskReaders();
  });
  return process.env;
}

test.after(() => {
  resetRiskReaders();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Anonymous IP database: VPN, Tor, hosting, proxies and a clean address', async (t) => {
  const env = useRiskDatabases(t, { anonymousIp: files.anonymousIp });

  const vpn = await lookupRiskData(NET.vpn.ip, env);
  assert.equal(vpn.riskSource, 'anonymous-ip');
  assert.equal(vpn.isVpn, true);
  assert.equal(vpn.isAnonymous, true);
  assert.equal(vpn.isProxy, false);
  assert.equal(vpn.securityScore, 70);
  assert.equal(vpn.riskLevel, 'Medium');

  const tor = await lookupRiskData(NET.tor.ip, env);
  assert.equal(tor.isTor, true);
  assert.equal(tor.securityScore, 40);
  assert.equal(tor.riskLevel, 'High');

  const hosting = await lookupRiskData(NET.hosting.ip, env);
  assert.equal(hosting.isHosting, true);
  assert.equal(hosting.isVpn, false);
  assert.equal(hosting.securityScore, 70);

  const residential = await lookupRiskData(NET.residentialProxy.ip, env);
  assert.equal(residential.isResidentialProxy, true);
  assert.equal(residential.isPublicProxy, false);
  assert.equal(residential.isProxy, true);
  assert.equal(residential.securityScore, 75);

  const publicProxy = await lookupRiskData(NET.publicProxy.ip, env);
  assert.equal(publicProxy.isPublicProxy, true);
  assert.equal(publicProxy.isProxy, true);

  // Not in the database: no known anonymiser. That is a real "clean" answer.
  const clean = await lookupRiskData(NET.clean.ip, env);
  assert.equal(clean.riskSource, 'anonymous-ip');
  assert.deepEqual(
    [clean.isVpn, clean.isProxy, clean.isTor, clean.isHosting, clean.isAnonymous, clean.isThreat],
    [false, false, false, false, false, false]
  );
  assert.equal(clean.securityScore, 100);
  assert.equal(clean.riskLevel, 'Low');
});

test('GeoLite2 ASN alone: hosting heuristic only, never VPN, proxy or Tor', async (t) => {
  const env = useRiskDatabases(t, { asn: files.asn });

  const cloud = await lookupRiskData(NET.hosting.ip, env);
  assert.equal(cloud.riskSource, 'asn-heuristic');
  assert.equal(cloud.isHosting, true);
  assert.equal(cloud.asn, 'AS16509');
  assert.equal(cloud.org, 'Example Cloud');
  assert.equal(cloud.isVpn, false);
  assert.equal(cloud.isAnonymous, false);
  assert.equal(cloud.securityScore, 80, 'above both thresholds: alerts, never a rejection');

  const isp = await lookupRiskData(NET.residentialProxy.ip, env);
  assert.equal(isp.riskSource, 'asn-heuristic');
  assert.equal(isp.isHosting, false);
  assert.equal(isp.isProxy, false, 'the ASN database cannot see proxies');
  assert.equal(isp.securityScore, 100);
});

test('both databases: Anonymous IP decides, ASN adds the network name', async (t) => {
  const env = useRiskDatabases(t, { anonymousIp: files.anonymousIp, asn: files.asn });
  const result = await lookupRiskData(NET.residentialProxy.ip, env);
  assert.equal(result.riskSource, 'anonymous-ip');
  assert.equal(result.isProxy, true);
  assert.equal(result.asn, 'AS64500');
});

test('no database, or the wrong one, gives no risk data', async (t) => {
  const env = useRiskDatabases(t, {});
  const none = await lookupRiskData(NET.vpn.ip, env);
  assert.equal(none.riskSource, null);
  assert.equal(none.securityScore, null);
  assert.equal(none._riskStatus, 'missing');

  // An ASN file configured as the Anonymous IP database (BadMethodCallError).
  process.env.MAGIC_SESSIONMANAGER_ANONYMOUS_IP_DATABASE = files.asn;
  resetRiskReaders();
  const wrong = await lookupRiskData(NET.vpn.ip, process.env);
  assert.equal(wrong.riskSource, null);
  assert.equal(wrong._riskStatus, 'error');
  const status = await getRiskDataStatus(process.env);
  assert.equal(status.anonymousIp.exists, true);
  assert.equal(status.anonymousIp.usable, false);
  assert.equal(status.available, false);
});

test('status reports the source without paths from the environment', async (t) => {
  const env = useRiskDatabases(t, { anonymousIp: files.anonymousIp, asn: files.asn });
  const status = await getRiskDataStatus(env);
  assert.equal(status.available, true);
  assert.equal(status.source, 'anonymous-ip');
  assert.equal(status.anonymousIp.usable, true);
  assert.equal(status.anonymousIp.fromEnvironment, true);
  assert.equal(status.anonymousIp.file, null, 'no absolute path reaches the browser');
  assert.equal(status.asn.editionId, 'GeoLite2-ASN');
  assert.doesNotMatch(
    JSON.stringify(status),
    new RegExp(tmpDir.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'))
  );

  useRiskDatabases(t, { asn: files.asn });
  assert.equal((await getRiskDataStatus(process.env)).source, 'asn-heuristic');
});

// ---------------------------------------------------------------------------
// The sign-in path: lookup -> reject rule -> emails and webhook.
// ---------------------------------------------------------------------------

function createStrapi(config, { emails = [] } = {}) {
  return {
    config: {
      get(key) {
        return key === 'plugin::magic-sessionmanager' ? config : {};
      },
    },
    store: () => ({ get: async () => null, set: async () => {} }),
    plugins: {
      email: {
        services: {
          email: {
            async send(message) {
              emails.push(message);
            },
          },
        },
      },
    },
    log: { debug() {}, error() {}, info() {}, warn() {} },
  };
}

const SIGN_IN_SETTINGS = Object.freeze({
  enableGeolocation: true,
  geoIpProvider: 'local-mmdb',
  geoIpDatabasePath: files.country,
  enableSecurityScoring: true,
  blockSuspiciousSessions: true,
  enableEmailAlerts: true,
  alertOnVpnProxy: true,
  alertOnSuspiciousLogin: true,
  alertOnNewLocation: true,
  enableWebhooks: true,
  discordWebhookUrl: 'https://discord.com/api/webhooks/1/synthetic',
  // The selection of an installation upgraded from 4.16: every sign-in.
  webhookEvents: ['login.success', 'login.suspicious', 'login.new_location'],
});

/**
 * Runs one synthetic sign-in through the real lookup, firewall, alert
 * dispatcher, notification service and webhook sender (fetch stubbed).
 *
 * @param {import('node:test').TestContext} t Test context.
 * @param {string} ip Sign-in address.
 * @returns {Promise<object>} Decision, emails and webhook posts.
 */
async function signIn(t, ip) {
  invalidateSettingsCache();
  const emails = [];
  const posts = [];
  const fetchBefore = global.fetch;
  global.fetch = async (url, init) => {
    const target = new URL(url);
    assert.equal(target.hostname, 'discord.com', 'only the configured webhook is called');
    posts.push(JSON.parse(init.body));
    return { ok: true, status: 204 };
  };
  t.after(() => {
    global.fetch = fetchBefore;
  });
  const strapi = createStrapi(SIGN_IN_SETTINGS, { emails });
  const geoData = await createGeolocationService({ strapi }).getIpInfo(ip);
  const decision = evaluateGeoFirewall(SIGN_IN_SETTINGS, geoData);
  // Alerts run only for sign-ins that were not refused, as in bootstrap.
  if (!decision.blocked) {
    await dispatchLoginAlerts({
      settings: SIGN_IN_SETTINGS,
      notificationService: createNotifications({ strapi }),
      user: { email: 'ada@example.com', username: 'ada' },
      session: { ipAddress: ip, loginTime: '2026-11-24T10:00:00.000Z' },
      geoData,
    });
  }
  return { geoData, decision, emails, posts };
}

test('VPN sign-in: "Reject suspicious sign-ins" refuses it', async (t) => {
  useRiskDatabases(t, { anonymousIp: files.anonymousIp });
  const { geoData, decision } = await signIn(t, NET.signInVpn.ip);
  assert.equal(geoData._status, 'ok');
  assert.equal(geoData.country_code, 'DE');
  assert.equal(geoData.riskSource, 'anonymous-ip');
  assert.deepEqual(decision, { blocked: true, reason: 'vpn_detected', status: 'ok' });
});

test('VPN sign-in with rejection off: VPN email, suspicious email and login.suspicious fire', async (t) => {
  useRiskDatabases(t, { anonymousIp: files.anonymousIp });
  invalidateSettingsCache();
  const emails = [];
  const posts = [];
  const fetchBefore = global.fetch;
  global.fetch = async (_url, init) => {
    posts.push(JSON.parse(init.body));
    return { ok: true, status: 204 };
  };
  t.after(() => {
    global.fetch = fetchBefore;
  });
  const settings = { ...SIGN_IN_SETTINGS, blockSuspiciousSessions: false };
  const strapi = createStrapi(settings, { emails });
  const geoData = await createGeolocationService({ strapi }).getIpInfo(NET.signInVpn.ip);
  assert.equal(evaluateGeoFirewall(settings, geoData).blocked, false);
  const attempted = await dispatchLoginAlerts({
    settings,
    notificationService: createNotifications({ strapi }),
    user: { email: 'ada@example.com', username: 'ada' },
    session: { ipAddress: NET.signInVpn.ip, loginTime: '2026-11-24T10:00:00.000Z' },
    geoData,
  });

  assert.deepEqual(attempted, {
    webhookEvent: 'login.suspicious',
    emails: ['vpnProxy', 'suspiciousLogin'],
  });
  assert.equal(emails.length, 2);
  assert.ok(emails.every((email) => email.to === 'ada@example.com'));
  assert.match(emails[0].text, /VPN: Yes/);
  assert.match(emails[1].text, /Score=70\/100/);
  assert.equal(posts.length, 1);
  const embed = posts[0].embeds[0];
  assert.match(embed.title, /Suspicious Login/);
  assert.ok(embed.fields.some((field) => /VPN detected/.test(field.value)));
});

test('cloud sign-in with the ASN heuristic: alert and login.suspicious, but no rejection', async (t) => {
  useRiskDatabases(t, { asn: files.asn });
  const { geoData, decision, emails, posts } = await signIn(t, NET.signInCloud.ip);
  assert.equal(geoData.riskSource, 'asn-heuristic');
  assert.equal(geoData.isHosting, true);
  assert.equal(decision.blocked, false);
  assert.equal(emails.length, 1, 'suspicious-sign-in email only, no VPN email');
  assert.match(emails[0].subject, /Suspicious/);
  assert.equal(posts.length, 1);
  assert.ok(
    posts[0].embeds[0].fields.some((field) => /Hosting \(ASN heuristic\)/.test(field.value))
  );
});

test('clean sign-in with a risk source: no rejection, no risk email, login.success', async (t) => {
  useRiskDatabases(t, { anonymousIp: files.anonymousIp, asn: files.asn });
  const { geoData, decision, emails, posts } = await signIn(t, NET.signInClean.ip);
  assert.equal(geoData.riskSource, 'anonymous-ip');
  assert.equal(geoData.securityScore, 100);
  assert.equal(decision.blocked, false);
  assert.equal(emails.length, 0);
  assert.equal(posts.length, 1);
  assert.match(posts[0].embeds[0].title, /Session Event/);
});

test('risk lookups never run when IP location lookup is off', async (t) => {
  useRiskDatabases(t, { anonymousIp: files.anonymousIp });
  invalidateSettingsCache();
  const strapi = createStrapi({ ...SIGN_IN_SETTINGS, enableGeolocation: false });
  const result = await createGeolocationService({ strapi }).getIpInfo(NET.signInVpn.ip);
  assert.equal(result._status, 'disabled');
  assert.equal(result.riskSource, null);
});

// ---------------------------------------------------------------------------
// Download flow: same credentials, fixed edition files, no paths from input.
// ---------------------------------------------------------------------------

function createControllerStrapi(credentials = {}) {
  const stored = { settings: {}, geoipCredentials: credentials };
  return {
    config: { get: () => ({}) },
    store: () => ({
      get: async ({ key }) => stored[key] || null,
      set: async ({ key, value }) => {
        stored[key] = value;
      },
    }),
    log: { debug() {}, error() {}, info() {}, warn() {} },
  };
}

function createCtx(body = {}) {
  return {
    request: { body },
    sent: null,
    error: null,
    send(payload) {
      this.sent = payload;
    },
    badRequest(message) {
      this.error = message;
      return message;
    },
  };
}

test('risk downloads use the stored credentials and a fixed edition file', async (t) => {
  invalidateSettingsCache();
  const previous = [process.env.MAXMIND_ACCOUNT_ID, process.env.MAXMIND_LICENSE_KEY];
  delete process.env.MAXMIND_ACCOUNT_ID;
  delete process.env.MAXMIND_LICENSE_KEY;
  t.after(() => {
    if (previous[0] === undefined) delete process.env.MAXMIND_ACCOUNT_ID;
    else process.env.MAXMIND_ACCOUNT_ID = previous[0];
    if (previous[1] === undefined) delete process.env.MAXMIND_LICENSE_KEY;
    else process.env.MAXMIND_LICENSE_KEY = previous[1];
  });

  const configs = [];
  const controller = createGeoIpController({
    strapi: createControllerStrapi({ accountId: 'synthetic', licenseKey: 'synthetic-key' }),
    updateGeoIpDatabase: async (config) => {
      configs.push(config);
      return { changed: true };
    },
  });

  for (const [database, editionId] of [
    ['anonymous-ip', 'GeoIP2-Anonymous-IP'],
    ['asn', 'GeoLite2-ASN'],
  ]) {
    const ctx = createCtx({ database, force: true });
    await controller.updateDatabase(ctx);
    assert.deepEqual(ctx.sent, { success: true, result: { changed: true } });
    const config = configs.at(-1);
    assert.equal(config.editionId, editionId);
    assert.equal(config.outputPath, path.join(DEFAULT_GEOIP_DIRECTORY, `${editionId}.mmdb`));
    assert.equal(config.licenseKey, 'synthetic-key');
    assert.equal(config.force, true);
  }

  const unknown = createCtx({ database: '../../etc/passwd' });
  await controller.updateDatabase(unknown);
  assert.equal(unknown.error, 'Unknown GeoIP database');
  assert.equal(configs.length, 2, 'the updater is not called for an unknown database');
});

test('a refused MaxMind download returns a fixed message, never provider text', async () => {
  invalidateSettingsCache();
  const controller = createGeoIpController({
    strapi: createControllerStrapi({ accountId: 'synthetic', licenseKey: 'synthetic-key' }),
    updateGeoIpDatabase: async () => {
      const error = new Error('MaxMind HEAD failed with HTTP 401 secret-detail');
      error.httpStatus = 401;
      throw error;
    },
  });
  const ctx = createCtx({ database: 'anonymous-ip' });
  await controller.updateDatabase(ctx);
  assert.equal(ctx.status, 502);
  assert.equal(
    ctx.body.error.message,
    'MaxMind refused the download. Check the credentials and that your account includes this database.'
  );
  assert.doesNotMatch(JSON.stringify(ctx.body), /secret-detail/);
});

test('the location settings cannot select a risk database file', () => {
  assert.throws(() => resolveDatabaseTarget('GeoLite2-ASN.mmdb'), /supported MMDB filename/);
  assert.throws(() => resolveDatabaseTarget('GeoIP2-Anonymous-IP.mmdb'), /supported MMDB filename/);
  const cli = resolveConfig({ MAXMIND_EDITION_ID: 'GeoLite2-ASN' }, []);
  assert.equal(cli.editionId, 'GeoLite2-ASN');
  assert.equal(path.basename(cli.outputPath), 'GeoLite2-ASN.mmdb');
  // A configured location path does not redirect a risk download.
  const withLocationPath = resolveConfig(
    {
      MAXMIND_EDITION_ID: 'GeoIP2-Anonymous-IP',
      MAGIC_SESSIONMANAGER_GEOIP_DATABASE: 'GeoLite2-City.mmdb',
    },
    []
  );
  assert.equal(path.basename(withLocationPath.outputPath), 'GeoIP2-Anonymous-IP.mmdb');
});
