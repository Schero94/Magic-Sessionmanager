'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const createNotifications = require('../server/src/services/notifications');
const createGeolocation = require('../server/src/services/geolocation');
const rateLimit = require('../server/src/middlewares/rate-limit');
const createLogger = require('../server/src/utils/logger').createLogger;
const createLicenseController = require('../server/src/controllers/license');
const createGeoIpController = require('../server/src/controllers/geoip');
const settingsController = require('../server/src/controllers/settings');
const createLicenseGuard = require('../server/src/services/license-guard');

const SENSITIVE_EMAIL = 'private.user@example.invalid';
const SENSITIVE_IP = '203.0.113.42';
const SENSITIVE_LICENSE_KEY = 'license-secret-value-123';
const SENSITIVE_ERROR = `private error for ${SENSITIVE_EMAIL} ${SENSITIVE_IP} ${SENSITIVE_LICENSE_KEY}`;

function createNotificationHarness(send) {
  const logs = [];
  const templates = Object.fromEntries(['suspiciousLogin', 'newLocation', 'vpnProxy'].map((name) => [
    name,
    { subject: 'test', html: '{{user.email}} {{session.ipAddress}}', text: '{{user.email}} {{session.ipAddress}}' },
  ]));
  const strapi = {
    store: () => ({ get: async () => ({ emailTemplates: templates }) }),
    plugins: { email: { services: { email: { send } } } },
    log: {
      debug: (...args) => logs.push(args.map(String).join(' ')),
      info: (...args) => logs.push(args.map(String).join(' ')),
      warn: (...args) => logs.push(args.map((arg) => arg instanceof Error ? arg.message : String(arg)).join(' ')),
      error: (...args) => logs.push(args.map((arg) => arg instanceof Error ? arg.message : String(arg)).join(' ')),
    },
  };
  return { service: createNotifications({ strapi }), logs };
}

test('email notification logs omit recipient email and client IP on success and failure', async () => {
  const { service, logs } = createNotificationHarness(async () => undefined);
  const input = {
    user: { email: SENSITIVE_EMAIL, username: 'private-user' },
    session: { ipAddress: SENSITIVE_IP, loginTime: new Date().toISOString() },
    reason: {},
    geoData: {},
  };

  assert.equal(await service.sendSuspiciousLoginAlert(input), true);
  assert.equal(await service.sendNewLocationAlert(input), true);
  assert.equal(await service.sendVpnProxyAlert(input), true);
  assert.equal(logs.join('\n').includes(SENSITIVE_EMAIL), false);
  assert.equal(logs.join('\n').includes(SENSITIVE_IP), false);

  const failing = createNotificationHarness(async () => {
    throw new Error(`SMTP failure for ${SENSITIVE_EMAIL} at ${SENSITIVE_IP}`);
  });
  assert.equal(await failing.service.sendSuspiciousLoginAlert(input), false);
  assert.equal(failing.logs.join('\n').includes(SENSITIVE_EMAIL), false);
  assert.equal(failing.logs.join('\n').includes(SENSITIVE_IP), false);
});

test('webhook transport errors do not log the secret URL or its path token', async () => {
  const previousFetch = global.fetch;
  const webhookUrl = 'https://discord.com/api/webhooks/private-id/private-secret';
  const { service, logs } = createNotificationHarness(async () => undefined);
  global.fetch = async () => {
    throw new Error(`request failed for ${webhookUrl}`);
  };

  try {
    assert.equal(await service.sendWebhook({ event: 'session-alert', data: {}, webhookUrl }), false);
    assert.equal(logs.join('\n').includes(webhookUrl), false);
    assert.equal(logs.join('\n').includes('private-secret'), false);
  } finally {
    global.fetch = previousFetch;
  }
});

test('GeoIP provider success and failure logs omit the looked-up IP and location', async () => {
  const previousFetch = global.fetch;
  const logs = [];
  const strapi = {
    log: {
      debug: (message) => logs.push(String(message)),
      warn: (message) => logs.push(String(message)),
      error: (message) => logs.push(String(message)),
    },
  };
  const service = createGeolocation({ strapi });
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      ip: SENSITIVE_IP,
      city: 'Private City',
      country_name: 'Private Country',
      country_code: 'US',
      region: 'Private Region',
      timezone: 'Etc/UTC',
      threat: {},
    }),
  });

  try {
    await service.getIpapiIpInfo(SENSITIVE_IP);
    assert.equal(logs.join('\n').includes(SENSITIVE_IP), false);
    assert.equal(logs.join('\n').includes('Private City'), false);
    assert.equal(logs.join('\n').includes('Private Country'), false);
  } finally {
    global.fetch = previousFetch;
  }
});

test('rate-limit warnings do not include caller identifiers or IP addresses', async () => {
  const logs = [];
  const middleware = rateLimit(
    { max: 1, window: 60_000 },
    { strapi: { log: { warn: (message) => logs.push(String(message)) } } }
  );
  const createContext = () => ({
    path: '/api/magic-sessionmanager/logout',
    request: { ip: SENSITIVE_IP },
    state: { user: { id: 912345 } },
    set() {},
    status: 200,
    body: {},
  });

  await middleware(createContext(), async () => {});
  const limited = createContext();
  await middleware(limited, async () => {});

  assert.equal(limited.status, 429);
  assert.equal(logs.join('\n').includes(SENSITIVE_IP), false);
  assert.equal(logs.join('\n').includes('912345'), false);
});

test('auth and session log templates omit IP, email, and stable user/session identifiers', () => {
  const readServerFile = (relativePath) => fs.readFileSync(path.join(__dirname, '..', 'server', 'src', relativePath), 'utf8');
  const bootstrap = readServerFile('bootstrap.js');
  const policy = readServerFile(path.join('policies', 'session-required.js'));
  const sessionController = readServerFile(path.join('controllers', 'session.js'));

  assert.doesNotMatch(bootstrap, /from IP \$\{ip\}/);
  assert.doesNotMatch(bootstrap, /\$\{user\.email \|\| user\.username\}/);
  assert.doesNotMatch(bootstrap, /Session \$\{newSession\.documentId\}.*user \$\{userDocId\}/);
  assert.doesNotMatch(policy, /userDocId\.substring/);
  assert.doesNotMatch(sessionController, /Security: User \$\{requestingUserDocId\}/);
  assert.doesNotMatch(sessionController, /User \$\{userDocId\} logged out/);
});

test('plugin logger never serializes exception messages or arbitrary object fields', () => {
  const logs = [];
  const log = createLogger({
    config: { get: () => ({ debug: true }) },
    log: {
      debug: (message) => logs.push(String(message)),
      info: (message) => logs.push(String(message)),
      warn: (message) => logs.push(String(message)),
      error: (message) => logs.push(String(message)),
    },
  });

  log.error('provider failed', new Error(SENSITIVE_ERROR));
  log.warn('provider response', { email: SENSITIVE_EMAIL, licenseKey: SENSITIVE_LICENSE_KEY });

  assert.equal(logs.join('\n').includes(SENSITIVE_EMAIL), false);
  assert.equal(logs.join('\n').includes(SENSITIVE_IP), false);
  assert.equal(logs.join('\n').includes(SENSITIVE_LICENSE_KEY), false);
});

test('license, GeoIP and settings controller failures do not log raw exception details', async () => {
  const logs = [];
  const log = {
    debug() {},
    info() {},
    warn: (message) => logs.push(String(message)),
    error: (...args) => logs.push(args.map((arg) => arg instanceof Error ? arg.message : String(arg)).join(' ')),
  };
  const previousStrapi = global.strapi;

  try {
    const licenseController = createLicenseController({
      strapi: {
        plugin: () => ({ service: () => ({ getLicenseByKey: async () => { throw new Error(SENSITIVE_ERROR); } }) }),
        store: () => ({ get: async () => SENSITIVE_LICENSE_KEY }),
        log,
      },
    });
    await licenseController.getStatus({ badRequest: (message) => message });

    global.strapi = {
      store: () => ({
        get: async () => null,
        set: async () => { throw new Error(SENSITIVE_ERROR); },
      }),
      log,
    };
    const geoipController = createGeoIpController({ strapi: global.strapi });
    await geoipController.storeCredentials({
      request: { body: { accountId: '12345', licenseKey: SENSITIVE_LICENSE_KEY } },
      send: (body) => body,
      badRequest: (message) => message,
    });

    global.strapi = {
      store: () => ({ get: async () => { throw new Error(SENSITIVE_ERROR); } }),
      log,
    };
    await settingsController.getSettings({
      send: (body) => body,
      badRequest: (message) => message,
    });

    assert.equal(logs.join('\n').includes(SENSITIVE_EMAIL), false);
    assert.equal(logs.join('\n').includes(SENSITIVE_IP), false);
    assert.equal(logs.join('\n').includes(SENSITIVE_LICENSE_KEY), false);
  } finally {
    if (previousStrapi === undefined) delete global.strapi;
    else global.strapi = previousStrapi;
  }
});

test('optional license provider errors and response messages are redacted from logs', async () => {
  const previousFetch = global.fetch;
  const logs = [];
  const service = createLicenseGuard({
    strapi: {
      config: { get: () => '5.58.0' },
      store: () => ({ get: async () => null, set: async () => undefined }),
      log: {
        info: (message) => logs.push(String(message)),
        debug: (message) => logs.push(String(message)),
        warn: (message) => logs.push(String(message)),
        error: (message) => logs.push(String(message)),
      },
    },
  });

  try {
    global.fetch = async () => ({ json: async () => { throw new Error(SENSITIVE_ERROR); } });
    await service.createLicense({ email: SENSITIVE_EMAIL, firstName: 'Test', lastName: 'User' });
    await service.verifyLicense(SENSITIVE_LICENSE_KEY);
    await service.getLicenseByKey(SENSITIVE_LICENSE_KEY);

    global.fetch = async () => ({
      json: async () => ({ success: false, message: SENSITIVE_ERROR }),
    });
    await service.createLicense({ email: SENSITIVE_EMAIL, firstName: 'Test', lastName: 'User' });

    assert.equal(logs.join('\n').includes(SENSITIVE_EMAIL), false);
    assert.equal(logs.join('\n').includes(SENSITIVE_IP), false);
    assert.equal(logs.join('\n').includes(SENSITIVE_LICENSE_KEY), false);
  } finally {
    global.fetch = previousFetch;
  }
});

test('server log call sites do not interpolate or pass raw exceptions or provider messages', () => {
  const serverRoot = path.join(__dirname, '..', 'server', 'src');
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(fullPath);
    }
  };
  visit(serverRoot);

  const unsafeLogPatterns = [
    ['raw exception message', /\.log\.(?:debug|info|warn|error)\([^\r\n]*(?:err|error|cleanupErr|e)\.message/],
    ['raw exception object', /\.log\.(?:debug|info|warn|error)\([^\r\n]*,\s*(?:err|error)\s*\)/],
    ['provider response message', /\.log\.(?:debug|info|warn|error)\([^\r\n]*data\.message/],
    ['user identifier in log template', /\$\{userDocId\.substring\(/],
  ];

  const findings = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [description, pattern] of unsafeLogPatterns) {
      if (pattern.test(source)) findings.push(`${path.relative(serverRoot, file)}: ${description}`);
    }
  }
  assert.deepEqual(findings, [], `Unsafe log sinks found:\n${findings.join('\n')}`);
});
