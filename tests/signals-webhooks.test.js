'use strict';

// Sign-in signals, "This wasn't me" tokens, signed webhook delivery and the
// detection settings (4.17, part 2). Real modules; the network is replaced
// by injected resolvers and transports, nothing leaves the process.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.SESSION_ENCRYPTION_KEY =
  process.env.SESSION_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

const {
  buildSignedRequest,
  deliverOnce,
  deliverWithRetries,
  isBlockedAddress,
  signPayload,
  verifySignature,
  SIGNATURE_HEADER,
} = require('../server/src/utils/webhook-delivery');
const {
  consumeNotMeToken,
  issueNotMeToken,
  readNotMeToken,
  LIFETIME_MS,
} = require('../server/src/utils/not-me-link');
const {
  deviceKeyOf,
  distanceKm,
  evaluateTravel,
  isNewDevice,
  pointOf,
} = require('../server/src/utils/sign-in-signals');
const {
  DEFAULT_WEBHOOK_EVENTS,
  normalizeWebhookUrl,
  resolveDetectionSettings,
  validateDetectionSettings,
} = require('../server/src/utils/detection-settings');
const { createCoordinator, __resetMemoryForTests } = require('../server/src/utils/coordination');
const {
  toPublicSettings,
  validateSettingsUpdate,
  DEFAULT_SETTINGS,
} = require('../server/src/controllers/settings');
const createNotifications = require('../server/src/services/notifications');

test('SSRF guard: loopback, private, link-local, metadata, CGNAT, mapped and unique-local addresses are blocked', () => {
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    '::ffff:10.0.0.1',
    '::ffff:127.0.0.1',
    '::ffff:a00:5',
    '::ffff:7f00:1',
    'fd00::1',
    'fe80::1',
    '2001:db8::1',
    'not-an-ip',
  ]) {
    assert.equal(isBlockedAddress(address), true, address);
  }
  // Public IPv4 must pass (a /96 rule for mapped addresses once matched every IPv4).
  for (const address of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111', '::ffff:5db8:d822']) {
    assert.equal(isBlockedAddress(address), false, address);
  }
});

test('webhook URL form: https only, no credentials, no local names', () => {
  assert.equal(
    normalizeWebhookUrl('https://hooks.example.com/a?b=1'),
    'https://hooks.example.com/a?b=1'
  );
  for (const bad of [
    'http://hooks.example.com/a',
    'https://user:pass@hooks.example.com/',
    'https://localhost/x',
    'https://printer.local/x',
    'javascript:alert(1)',
    `https://example.com/${'a'.repeat(2100)}`,
  ]) {
    assert.equal(normalizeWebhookUrl(bad), null, bad);
  }
});

test('signature: HMAC-SHA256 over "t.body", verified in constant time with a replay window', () => {
  const secret = 'a'.repeat(40);
  const body = JSON.stringify({ event: 'lockout' });
  const header = signPayload(secret, body, 1_800_000_000);
  assert.match(header, /^t=1800000000,v1=[a-f0-9]{64}$/);
  const expected = crypto.createHmac('sha256', secret).update(`1800000000.${body}`).digest('hex');
  assert.equal(header.split('v1=')[1], expected);
  assert.equal(verifySignature(secret, body, header, { now: 1_800_000_000 * 1000 }), true);
  assert.equal(verifySignature(secret, `${body} `, header, { now: 1_800_000_000 * 1000 }), false);
  assert.equal(verifySignature('b'.repeat(40), body, header, { now: 1_800_000_000 * 1000 }), false);
  assert.equal(verifySignature(secret, body, header, { now: (1_800_000_000 + 600) * 1000 }), false);
  const request = buildSignedRequest({ event: 'test', data: { a: 1 }, secret, id: 'x' });
  assert.equal(JSON.parse(request.body).event, 'test');
  assert.equal(verifySignature(secret, request.body, request.headers[SIGNATURE_HEADER]), true);
});

test('delivery checks every resolved address and pins the connection to the checked one', async () => {
  const posts = [];
  const post = async (input) => {
    posts.push(input.address.address);
    return 204;
  };
  await assert.rejects(
    deliverOnce({
      url: 'https://hooks.example.com/x',
      body: '{}',
      headers: {},
      resolve: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.5', family: 4 },
      ],
      post,
    }),
    (err) => err.code === 'address_not_allowed' && err.retryable === false
  );
  assert.deepEqual(posts, [], 'nothing is sent when any address is private');
  const ok = await deliverOnce({
    url: 'https://hooks.example.com/x',
    body: '{}',
    headers: {},
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    post,
  });
  assert.deepEqual(ok, { status: 204 });
  assert.deepEqual(posts, ['93.184.216.34']);
  await assert.rejects(
    deliverOnce({ url: 'https://[::1]/x', body: '{}', headers: {}, post }),
    (err) => err.code === 'address_not_allowed'
  );
  await assert.rejects(
    deliverOnce({ url: 'http://hooks.example.com/x', body: '{}', headers: {}, post }),
    (err) => err.code === 'invalid_url'
  );
  await assert.rejects(
    deliverOnce({
      url: 'https://hooks.example.com/x',
      body: '{}',
      headers: {},
      resolve: async () => [{ address: '93.184.216.34', family: 4 }],
      post: async () => 302,
    }),
    (err) => err.code === 'redirect_not_followed'
  );
});

test('retries: 5xx and 429 are retried with backoff, 4xx and blocked addresses are not', async () => {
  const resolve = async () => [{ address: '93.184.216.34', family: 4 }];
  const sleeps = [];
  const sleep = async (ms) => sleeps.push(ms);
  let calls = 0;
  const flaky = await deliverWithRetries({
    url: 'https://hooks.example.com/x',
    body: '{}',
    headers: {},
    resolve,
    sleep,
    post: async () => (++calls < 3 ? 503 : 200),
  });
  assert.deepEqual(flaky, { ok: true, status: 200, code: null, attempts: 3 });
  assert.deepEqual(sleeps, [2000, 10000]);
  calls = 0;
  const final = await deliverWithRetries({
    url: 'https://hooks.example.com/x',
    body: '{}',
    headers: {},
    resolve,
    sleep,
    post: async () => {
      calls += 1;
      return 400;
    },
  });
  assert.equal(final.ok, false);
  assert.equal(final.code, 'http_400');
  assert.equal(calls, 1);
});

test('"This wasn\'t me" token: signed, expiring, single use, tamper-proof', async () => {
  __resetMemoryForTests();
  const coordinator = createCoordinator();
  const token = await issueNotMeToken(coordinator, { sessionId: 'sess1', userId: 'user1' });
  assert.ok(readNotMeToken(token));
  assert.equal(readNotMeToken(`${token}x`), null);
  const [payload, signature] = token.split('.');
  const forged = Buffer.from(
    JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), u: 'user2' })
  ).toString('base64url');
  assert.equal(
    readNotMeToken(`${forged}.${signature}`),
    null,
    'changing the user breaks the signature'
  );
  assert.equal(readNotMeToken(token, { now: Date.now() + LIFETIME_MS + 1 }), null, 'expired');
  const [first, second] = await Promise.all([
    consumeNotMeToken(coordinator, token),
    consumeNotMeToken(coordinator, token),
  ]);
  assert.deepEqual([first, second].filter(Boolean), [{ sessionId: 'sess1', userId: 'user1' }]);
  assert.equal(await consumeNotMeToken(coordinator, token), null);
  assert.equal(await issueNotMeToken(coordinator, { sessionId: '../x', userId: 'u' }), null);
});

test('device key: HMAC of browser and system family (and the app deviceId), stable across versions', () => {
  const chrome130 =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const chrome131 = chrome130.replace('Chrome/130', 'Chrome/131');
  const key = deviceKeyOf(chrome130);
  assert.match(key, /^[a-f0-9]{32}$/);
  assert.equal(deviceKeyOf(chrome131), key, 'a browser update is not a new device');
  assert.notEqual(deviceKeyOf(chrome130, 'device-a'), key);
  assert.ok(!key.includes('Chrome'));
});

test('new device: first sign-in is not new; key match or (for old rows) family match is known', () => {
  const ua =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';
  const key = deviceKeyOf(ua);
  assert.equal(isNewDevice([], { deviceKey: key, userAgent: ua }), false);
  assert.equal(isNewDevice([{ deviceKey: key }], { deviceKey: key, userAgent: ua }), false);
  assert.equal(
    isNewDevice([{ deviceKey: 'f'.repeat(32) }], { deviceKey: key, userAgent: ua }),
    true
  );
  assert.equal(
    isNewDevice([{ deviceKey: null, browserName: 'Safari 16.6', osName: 'macOS 13' }], {
      deviceKey: key,
      userAgent: ua,
    }),
    false,
    'sessions from before 4.17 are compared by family'
  );
});

test('impossible travel: distance, speed, minimum distance and missing locations', () => {
  const berlin = pointOf({ latitude: 52.52, longitude: 13.405 });
  const sydney = pointOf({ latitude: -33.87, longitude: 151.21 });
  const potsdam = pointOf({ latitude: 52.39, longitude: 13.06 });
  assert.deepEqual(berlin, { lat: 52.5, lon: 13.4 });
  assert.ok(Math.abs(distanceKm(berlin, sydney) - 16000) < 200);
  const now = Date.now();
  const limits = { speedKmh: 1000, minDistanceKm: 500 };
  const fast = evaluateTravel(
    { point: berlin, at: now - 2 * 3600e3 },
    { point: sydney, at: now },
    limits
  );
  assert.equal(fast.flagged, true);
  const slow = evaluateTravel(
    { point: berlin, at: now - 30 * 3600e3 },
    { point: sydney, at: now },
    limits
  );
  assert.equal(slow.flagged, false, '16,000 km in 30 h is about 530 km/h');
  const near = evaluateTravel(
    { point: berlin, at: now - 60e3 },
    { point: potsdam, at: now },
    limits
  );
  assert.equal(near.flagged, false, 'below the minimum distance');
  assert.equal(evaluateTravel({ point: null, at: now }, { point: sydney, at: now }, limits), null);
  assert.equal(pointOf({ latitude: null, longitude: null }), null);
  assert.equal(pointOf({ latitude: 95, longitude: 0 }), null);
});

test('detection settings: off by default, default selection without every sign-in, validation', () => {
  const resolved = resolveDetectionSettings({});
  assert.equal(resolved.alertOnNewDevice, false);
  assert.equal(resolved.impossibleTravelEnabled, false);
  assert.equal(resolved.genericWebhookEnabled, false);
  assert.ok(!resolved.webhookEvents.includes('login.success'));
  assert.deepEqual(resolved.webhookEvents, [...DEFAULT_WEBHOOK_EVENTS]);
  const { errors } = validateDetectionSettings({
    impossibleTravelSpeedKmh: 50,
    impossibleTravelMinDistanceKm: 'far',
    impossibleTravelAction: 'block',
    webhookEvents: ['lockout', 'everything'],
    genericWebhookUrl: 'http://example.com',
    alertOnNewDevice: 'yes',
  });
  assert.deepEqual(errors.map((error) => error.path[0]).sort(), [
    'alertOnNewDevice',
    'genericWebhookUrl',
    'impossibleTravelAction',
    'impossibleTravelMinDistanceKm',
    'impossibleTravelSpeedKmh',
    'webhookEvents',
  ]);
});

test('settings API: the webhook URL and secret are write-only and the secret is stored encrypted', () => {
  const secret = `S${'x'.repeat(39)}`;
  const { settings, errors } = validateSettingsUpdate(
    { genericWebhookUrl: 'https://hooks.example.com/x', genericWebhookSecret: secret },
    { ...DEFAULT_SETTINGS }
  );
  assert.deepEqual(errors, []);
  assert.notEqual(settings.genericWebhookSecret, secret);
  const shown = toPublicSettings(settings);
  assert.equal(shown.hasGenericWebhook, true);
  assert.equal(shown.hasGenericWebhookSecret, true);
  // Only scheme and host are shown, never the path (which may carry a token).
  assert.equal(shown.genericWebhookHint, 'https://hooks.example.com/…');
  assert.ok(!JSON.stringify(shown).includes('hooks.example.com/x'));
  assert.ok(!('genericWebhookUrl' in shown));
  assert.ok(!('genericWebhookSecret' in shown));
  const kept = validateSettingsUpdate({ alertOnNewDevice: true }, settings).settings;
  assert.equal(
    kept.genericWebhookSecret,
    settings.genericWebhookSecret,
    'omitted keeps the stored value'
  );
  assert.equal(
    validateSettingsUpdate({ genericWebhookSecret: '' }, settings).settings.genericWebhookSecret,
    ''
  );
  assert.ok(
    validateSettingsUpdate({ genericWebhookSecret: 'has space'.padEnd(40, 'x') }, settings).errors
      .length
  );
});

test('sign-in signal emails escape values and only insert a server-built http(s) link', async () => {
  const sent = [];
  const strapi = {
    store: () => ({ get: async () => null }),
    plugin: () => ({ service: () => ({ send: async (mail) => sent.push(mail) }) }),
    log: { info() {}, warn() {}, error() {}, debug() {} },
  };
  const notifications = createNotifications({ strapi });
  await notifications.sendSignInSignalEmail('newDevice', {
    user: { email: 'jane@example.test', username: '<b>jane</b>' },
    session: { loginTime: new Date().toISOString(), ipAddress: '203.0.113.9' },
    geoData: { city: 'Berlin', country: 'Germany' },
    device: { browser: 'Chrome', os: 'Windows' },
    link: 'https://app.example.test/api/magic-sessionmanager/not-me?token=a.b&x="y"',
  });
  assert.match(sent[0].html, /&lt;b&gt;jane&lt;\/b&gt;/);
  assert.match(
    sent[0].html,
    /href="https:\/\/app\.example\.test\/api\/magic-sessionmanager\/not-me\?token=a\.b&amp;x=&quot;y&quot;"/
  );
  await notifications.sendSignInSignalEmail('newDevice', {
    user: { email: 'jane@example.test' },
    session: {},
    device: {},
    link: 'javascript:alert(1)',
  });
  assert.doesNotMatch(sent[1].html, /javascript:/);
});
