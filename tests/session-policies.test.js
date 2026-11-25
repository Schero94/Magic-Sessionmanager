'use strict';

// Sign-in and session policies (4.17): settings validation, lockout engine,
// upgrade defaults, session limit and the lockout email. Real modules, fake
// Strapi pieces; no network.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  POLICY_DEFAULTS,
  accountThresholdFor,
  inactivityTimeoutFor,
  isTrustedAddress,
  normalizePolicySettings,
  parseTrustedAddress,
  resolveLockoutPolicy,
  sessionLimitFor,
  validatePolicySettings,
} = require('../server/src/utils/policy-settings');
const { createCoordinator, __resetMemoryForTests } = require('../server/src/utils/coordination');
const {
  createLoginLockout,
  normalizeIdentifier,
  LOCK_ID_PATTERN,
} = require('../server/src/utils/login-lockout');
const { applyUpgradeDefaults } = require('../server/src/utils/upgrade-defaults');
const {
  createRefusalDedup,
  createSessionWithinLimit,
  isOpenSession,
  refusalReasonOfGeoDecision,
} = require('../server/src/utils/sign-in-policies');
const { validateSettingsUpdate, DEFAULT_SETTINGS } = require('../server/src/controllers/settings');
const createNotifications = require('../server/src/services/notifications');

const silentLog = { info() {}, warn() {}, debug() {}, error() {} };

test('defaults keep the earlier lockout and add nothing that changes sign-ins', () => {
  const policy = resolveLockoutPolicy({ maxFailedLogins: 5 });
  assert.equal(policy.ipMax, 5);
  assert.equal(policy.accountMax, 0);
  assert.equal(policy.windowMs, 15 * 60 * 1000);
  assert.equal(policy.durationMs, 15 * 60 * 1000);
  assert.deepEqual(policy.trusted, []);
  assert.equal(policy.notifyUser, false);
  assert.equal(policy.record, true);
  assert.deepEqual(sessionLimitFor({}, null), { limit: 0, policy: 'end-oldest' });
  assert.equal(POLICY_DEFAULTS.maxSessionsPerUser, 0);
  assert.equal(DEFAULT_SETTINGS.maxFailedLoginsPerAccount, 0);
  assert.equal(DEFAULT_SETTINGS.endOtherSessionsOnPasswordChange, true);
});

test('trusted addresses: IPv4, IPv6, CIDR and IPv4-mapped forms; invalid entries rejected', () => {
  assert.deepEqual(parseTrustedAddress(' 192.0.2.0/24 ')?.text, '192.0.2.0/24');
  assert.equal(parseTrustedAddress('2001:DB8::/32')?.text, '2001:db8::/32');
  assert.equal(parseTrustedAddress('::ffff:198.51.100.7')?.text, '198.51.100.7');
  for (const bad of ['192.0.2.0/33', '2001:db8::/129', 'example.com', '10.0.0.1/8/1', '', 42]) {
    assert.equal(parseTrustedAddress(bad), null, String(bad));
  }
  const entries = ['192.0.2.0/24', '2001:db8::1'];
  assert.equal(isTrustedAddress(entries, '192.0.2.77'), true);
  assert.equal(isTrustedAddress(entries, '::ffff:192.0.2.77'), true);
  assert.equal(isTrustedAddress(entries, '2001:db8::1'), true);
  assert.equal(isTrustedAddress(entries, '198.51.100.1'), false);
  assert.equal(isTrustedAddress(entries, 'unknown'), false);
});

test('validation reports invalid values per field and never clamps', () => {
  const { errors } = validatePolicySettings({
    maxFailedLoginsPerAccount: 101,
    lockoutWindowMinutes: 0,
    lockoutDurationMinutes: 'x',
    maxSessionsPerUser: -1,
    sessionLimitPolicy: 'kick',
    lockoutNotifyUser: 'yes',
    lockoutTrustedAddresses: ['192.0.2.1', 'nope'],
    roleRules: [{ role: 'abc' }, { role: 'abc', maxSessionsPerUser: 2 }, { role: '$bad' }],
  });
  const paths = errors.map((error) => error.path.join('.'));
  for (const expected of [
    'maxFailedLoginsPerAccount',
    'lockoutWindowMinutes',
    'lockoutDurationMinutes',
    'maxSessionsPerUser',
    'sessionLimitPolicy',
    'lockoutNotifyUser',
    'lockoutTrustedAddresses.1',
    'roleRules.0',
    'roleRules.1.role',
    'roleRules.2.role',
  ]) {
    assert.ok(paths.includes(expected), `missing error for ${expected}: ${paths.join(', ')}`);
  }
  for (const error of errors) {
    assert.doesNotMatch(error.message, /nope|\$bad/, 'messages never echo input');
  }
});

test('validation accepts and normalises a complete policy payload', () => {
  const { values, errors } = validatePolicySettings({
    maxFailedLoginsPerAccount: '10',
    lockoutWindowMinutes: 30,
    lockoutDurationMinutes: 60,
    maxSessionsPerUser: 3,
    sessionLimitPolicy: 'refuse',
    lockoutNotifyUser: true,
    recordUserSignInEvents: false,
    endOtherSessionsOnPasswordChange: false,
    lockoutTrustedAddresses: ['192.0.2.0/24', '192.0.2.0/24 ', '2001:db8::1'],
    roleRules: [
      { role: 'roleA', maxSessionsPerUser: 1, inactivityTimeout: '', maxFailedLoginsPerAccount: 0 },
    ],
  });
  assert.deepEqual(errors, []);
  assert.equal(values.maxFailedLoginsPerAccount, 10);
  assert.deepEqual(values.lockoutTrustedAddresses, ['192.0.2.0/24', '2001:db8::1']);
  assert.deepEqual(values.roleRules, [
    { role: 'roleA', maxSessionsPerUser: 1, inactivityTimeout: null, maxFailedLoginsPerAccount: 0 },
  ]);
});

test('the settings PUT validator merges policy keys and keeps omitted ones', () => {
  const current = { ...DEFAULT_SETTINGS, maxSessionsPerUser: 4 };
  const { settings, errors } = validateSettingsUpdate({ lockoutDurationMinutes: 45 }, current);
  assert.deepEqual(errors, []);
  assert.equal(settings.lockoutDurationMinutes, 45);
  assert.equal(settings.maxSessionsPerUser, 4);
  const invalid = validateSettingsUpdate({ maxSessionsPerUser: 500 }, current);
  assert.equal(invalid.settings, undefined);
  assert.deepEqual(invalid.errors[0].path, ['maxSessionsPerUser']);
});

test('role rules override the limit, idle timeout and account threshold of their role only', () => {
  const settings = {
    inactivityTimeout: 15 * 60 * 1000,
    maxSessionsPerUser: 5,
    sessionLimitPolicy: 'refuse',
    maxFailedLoginsPerAccount: 10,
    roleRules: [
      { role: 'staff', maxSessionsPerUser: 1, inactivityTimeout: 5, maxFailedLoginsPerAccount: 3 },
      { role: 'kiosk', maxSessionsPerUser: null, inactivityTimeout: 600 },
    ],
  };
  assert.deepEqual(sessionLimitFor(settings, 'staff'), { limit: 1, policy: 'refuse' });
  assert.deepEqual(sessionLimitFor(settings, 'kiosk'), { limit: 5, policy: 'refuse' });
  assert.equal(inactivityTimeoutFor(settings, 'staff'), 5 * 60 * 1000);
  assert.equal(inactivityTimeoutFor(settings, 'kiosk'), 600 * 60 * 1000);
  assert.equal(inactivityTimeoutFor(settings, 'other'), 15 * 60 * 1000);
  assert.equal(accountThresholdFor(settings, 'staff'), 3);
  assert.equal(accountThresholdFor(settings, 'kiosk'), 10);
  assert.equal(resolveLockoutPolicy(settings).accountMaxByRole, true);
  // A damaged stored value never breaks sign-ins.
  assert.deepEqual(normalizePolicySettings({ roleRules: 'x', maxSessionsPerUser: 'y' }), {
    roleRules: [],
    maxSessionsPerUser: 0,
  });
});

/** In-memory coordinator plus a controllable clock. */
function engine(start = Date.now()) {
  __resetMemoryForTests();
  let now = start;
  const coordinator = createCoordinator();
  const lockout = createLoginLockout(coordinator, { now: () => now });
  return {
    lockout,
    coordinator,
    advance(ms) {
      now += ms;
    },
  };
}

const policy = (overrides = {}) => ({
  ipMax: 3,
  windowMs: 10 * 60 * 1000,
  durationMs: 30 * 60 * 1000,
  trusted: [],
  ...overrides,
});

test('IP lockout: configurable threshold and duration, Retry-After from the lock', async () => {
  const { lockout } = engine();
  const p = policy();
  for (let i = 0; i < 3; i++) {
    const decision = await lockout.reserve({
      ip: '192.0.2.10',
      identifier: null,
      policy: p,
      accountMax: 0,
    });
    assert.equal(decision.outcome, 'allow');
    const locks = await lockout.settle(decision.reservation, 'failure', {
      policy: p,
      accountMax: 0,
      display: { ip: '192.0.2.10' },
    });
    assert.equal(locks.length, i === 2 ? 1 : 0);
  }
  const locked = await lockout.reserve({
    ip: '192.0.2.10',
    identifier: null,
    policy: p,
    accountMax: 0,
  });
  assert.equal(locked.outcome, 'locked');
  assert.equal(locked.lockedKind, 'ip');
  assert.equal(locked.retryAfter, 30 * 60);
  const other = await lockout.reserve({
    ip: '192.0.2.11',
    identifier: null,
    policy: p,
    accountMax: 0,
  });
  assert.equal(other.outcome, 'allow', 'another address is not affected');
});

test('after a lock ends, the failures that caused it do not count again', async () => {
  __resetMemoryForTests();
  const lockout = createLoginLockout(createCoordinator());
  const p = policy({ ipMax: 2, windowMs: 40, durationMs: 80 });
  for (let i = 0; i < 2; i++) {
    const decision = await lockout.reserve({
      ip: '192.0.2.12',
      identifier: null,
      policy: p,
      accountMax: 0,
    });
    await lockout.settle(decision.reservation, 'failure', { policy: p, accountMax: 0 });
  }
  const during = await lockout.reserve({
    ip: '192.0.2.12',
    identifier: null,
    policy: p,
    accountMax: 0,
  });
  assert.equal(during.outcome, 'locked');
  await new Promise((resolve) => setTimeout(resolve, 100));
  const after = await lockout.reserve({
    ip: '192.0.2.12',
    identifier: null,
    policy: p,
    accountMax: 0,
  });
  assert.equal(after.outcome, 'allow', 'a new window starts when the lock ends');
  assert.equal(after.reservation.ipHits, 1);
});

test('trusted addresses are never counted or locked by IP; accounts still are', async () => {
  const { lockout } = engine();
  const p = policy({ trusted: ['192.0.2.0/24'] });
  for (let i = 0; i < 10; i++) {
    const decision = await lockout.reserve({
      ip: '192.0.2.5',
      identifier: 'user@example.com',
      policy: p,
      accountMax: 4,
    });
    if (i < 4) {
      assert.equal(decision.outcome, 'allow');
      assert.equal(decision.reservation.ipKey, null);
      await lockout.settle(decision.reservation, 'failure', { policy: p, accountMax: 4 });
    } else {
      assert.equal(decision.outcome, 'locked');
      assert.equal(decision.lockedKind, 'account');
    }
  }
});

test('account lockout follows the account across addresses; success clears the counters', async () => {
  const { lockout } = engine();
  const p = policy({ ipMax: 0 });
  const id = normalizeIdentifier('  User@Example.COM ');
  assert.equal(id, 'user@example.com');
  const first = await lockout.reserve({
    ip: '192.0.2.1',
    identifier: id,
    policy: p,
    accountMax: 2,
  });
  await lockout.settle(first.reservation, 'failure', { policy: p, accountMax: 2 });
  const ok = await lockout.reserve({
    ip: '198.51.100.1',
    identifier: id,
    policy: p,
    accountMax: 2,
  });
  await lockout.settle(ok.reservation, 'success', { policy: p, accountMax: 2 });
  for (const ip of ['198.51.100.2', '203.0.113.3']) {
    const decision = await lockout.reserve({ ip, identifier: id, policy: p, accountMax: 2 });
    assert.equal(decision.outcome, 'allow', 'success reset the count');
    await lockout.settle(decision.reservation, 'failure', {
      policy: p,
      accountMax: 2,
      display: { userDocumentId: 'userdoc1' },
    });
  }
  const locked = await lockout.reserve({
    ip: '203.0.113.9',
    identifier: id,
    policy: p,
    accountMax: 2,
  });
  assert.equal(locked.outcome, 'locked');
  assert.equal(locked.lockedKind, 'account');
});

test('a burst over the threshold is turned away briefly without locking; neutral results give hits back', async () => {
  const { lockout } = engine();
  const p = policy({ ipMax: 2 });
  const a = await lockout.reserve({ ip: '192.0.2.1', identifier: null, policy: p, accountMax: 0 });
  const b = await lockout.reserve({ ip: '192.0.2.1', identifier: null, policy: p, accountMax: 0 });
  const c = await lockout.reserve({ ip: '192.0.2.1', identifier: null, policy: p, accountMax: 0 });
  assert.equal(a.outcome, 'allow');
  assert.equal(b.outcome, 'allow');
  assert.equal(c.outcome, 'busy');
  assert.equal(c.retryAfter, 1);
  await lockout.settle(a.reservation, 'neutral', { policy: p, accountMax: 0 });
  await lockout.settle(b.reservation, 'neutral', { policy: p, accountMax: 0 });
  const d = await lockout.reserve({ ip: '192.0.2.1', identifier: null, policy: p, accountMax: 0 });
  assert.equal(d.outcome, 'allow');
});

test('the lock list shows active locks without the typed identifier, and Unlock lifts one', async () => {
  const { lockout, advance } = engine();
  const p = policy({ ipMax: 1 });
  const decision = await lockout.reserve({
    ip: '192.0.2.44',
    identifier: 'secret-name@example.com',
    policy: p,
    accountMax: 1,
  });
  await lockout.settle(decision.reservation, 'failure', {
    policy: p,
    accountMax: 1,
    display: { ip: '192.0.2.0', userDocumentId: null },
  });
  const locks = await lockout.listLocks();
  assert.equal(locks.length, 2);
  assert.ok(locks.every((lock) => LOCK_ID_PATTERN.test(lock.id)));
  assert.doesNotMatch(JSON.stringify(locks), /secret-name/);
  const ipLock = locks.find((lock) => lock.kind === 'ip');
  assert.equal(ipLock.ip, '192.0.2.0');
  assert.equal(ipLock.failures, 1);

  assert.equal(await lockout.unlock('not-a-lock'), null);
  const lifted = await lockout.unlock(ipLock.id);
  assert.deepEqual(lifted, { kind: 'ip', ip: '192.0.2.0', user: null });
  assert.equal((await lockout.listLocks()).length, 1);
  assert.equal(await lockout.unlock(ipLock.id), null, 'a second unlock finds nothing');

  advance(31 * 60 * 1000);
  assert.equal((await lockout.listLocks()).length, 0, 'expired locks leave the list');
});

/** Fake plugin store with an in-memory map. */
function storeStrapi(initial = {}) {
  const values = new Map(Object.entries(initial));
  const coordinator = createCoordinator();
  const strapi = {
    store: () => ({
      get: async ({ key }) => (values.has(key) ? values.get(key) : null),
      set: async ({ key, value }) => values.set(key, value),
    }),
    db: { query: () => ({ findMany: async () => [], deleteMany: async () => ({ count: 0 }) }) },
    config: { get: () => ({}) },
    log: silentLog,
  };
  return { strapi, values, coordinator };
}

test('upgrade defaults: existing installs keep the old password-change behaviour, new ones get the new default', async () => {
  const existing = storeStrapi({
    contentApiPermissionsVersion: 3,
    settings: { maxFailedLogins: 5 },
  });
  const outcome = await applyUpgradeDefaults(existing.strapi, silentLog);
  assert.deepEqual(outcome, { existing: true, applied: ['endOtherSessionsOnPasswordChange'] });
  assert.equal(existing.values.get('settings').endOtherSessionsOnPasswordChange, false);
  assert.equal(existing.values.get('settings').maxFailedLogins, 5);
  assert.equal(existing.values.get('defaultsProfile'), 1);
  // Runs once.
  assert.deepEqual(await applyUpgradeDefaults(existing.strapi, silentLog), {
    existing: true,
    applied: [],
  });

  const chosen = storeStrapi({ settings: { endOtherSessionsOnPasswordChange: true } });
  await applyUpgradeDefaults(chosen.strapi, silentLog);
  assert.equal(chosen.values.get('settings').endOtherSessionsOnPasswordChange, true);

  const fresh = storeStrapi();
  assert.deepEqual(await applyUpgradeDefaults(fresh.strapi, silentLog), {
    existing: false,
    applied: [],
  });
  assert.equal(fresh.values.has('settings'), false, 'a new install keeps the new defaults');
  assert.equal(fresh.values.get('defaultsProfile'), 1);
});

/** Session rows plus a fake session service for the limit. */
function limitHarness(rows, role = null) {
  const terminated = [];
  const strapi = {
    db: {
      query: () => ({
        findOne: async () => ({ id: 1, role: role ? { documentId: role } : null }),
      }),
    },
    documents: () => ({
      findMany: async () => rows.filter((row) => row.isActive),
    }),
    log: silentLog,
  };
  const sessionService = {
    terminateSession: async ({ sessionId }) => {
      terminated.push(sessionId);
      const row = rows.find((candidate) => candidate.documentId === sessionId);
      if (row) row.isActive = false;
      return { terminatedCount: 1 };
    },
  };
  return { strapi, sessionService, terminated };
}

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60 * 1000).toISOString();

test('session limit off: no lookup, no termination', async () => {
  const harness = limitHarness([]);
  harness.strapi.db.query = () => {
    throw new Error('no lookup expected');
  };
  const result = await createSessionWithinLimit({
    strapi: harness.strapi,
    settings: {},
    userDocumentId: 'u1',
    create: async () => ({ documentId: 'new' }),
    sessionService: harness.sessionService,
  });
  assert.deepEqual(result, { session: { documentId: 'new' }, refused: false, ended: 0, limit: 0 });
});

test('session limit "end oldest" ends the oldest open sessions; stale rows do not count', async () => {
  const rows = [
    {
      documentId: 'stale',
      isActive: true,
      loginTime: minutesAgo(600),
      lastActive: minutesAgo(500),
    },
    { documentId: 'old', isActive: true, loginTime: minutesAgo(60), lastActive: minutesAgo(1) },
    { documentId: 'mid', isActive: true, loginTime: minutesAgo(30), lastActive: minutesAgo(1) },
  ];
  const harness = limitHarness(rows);
  const result = await createSessionWithinLimit({
    strapi: harness.strapi,
    settings: { maxSessionsPerUser: 2, inactivityTimeout: 15 * 60 * 1000, maxSessionAgeDays: 30 },
    userDocumentId: 'u1',
    create: async () => {
      const row = {
        documentId: 'new',
        isActive: true,
        loginTime: minutesAgo(0),
        lastActive: minutesAgo(0),
      };
      rows.push(row);
      return row;
    },
    sessionService: harness.sessionService,
  });
  assert.equal(result.refused, false);
  assert.equal(result.ended, 1);
  assert.deepEqual(harness.terminated, ['old']);
});

test('session limit "refuse" ends the new session and reports it; a role rule decides the limit', async () => {
  const rows = [
    { documentId: 'one', isActive: true, loginTime: minutesAgo(5), lastActive: minutesAgo(1) },
  ];
  const harness = limitHarness(rows, 'staff');
  const result = await createSessionWithinLimit({
    strapi: harness.strapi,
    settings: {
      maxSessionsPerUser: 0,
      sessionLimitPolicy: 'refuse',
      inactivityTimeout: 15 * 60 * 1000,
      roleRules: [{ role: 'staff', maxSessionsPerUser: 1 }],
    },
    userDocumentId: 'u1',
    create: async () => {
      const row = {
        documentId: 'new',
        isActive: true,
        loginTime: minutesAgo(0),
        lastActive: minutesAgo(0),
      };
      rows.push(row);
      return row;
    },
    sessionService: harness.sessionService,
  });
  assert.equal(result.refused, true);
  assert.equal(result.limit, 1);
  assert.deepEqual(harness.terminated, ['new']);
});

test('open-session rule and refusal helpers', () => {
  const now = Date.now();
  assert.equal(isOpenSession({ isActive: true, lastActive: new Date(now) }, 60_000, 30, now), true);
  assert.equal(isOpenSession({ isActive: false }, 60_000, 30, now), false);
  assert.equal(
    isOpenSession(
      { isActive: true, loginTime: new Date(now - 31 * 864e5), lastActive: new Date(now) },
      60_000,
      30,
      now
    ),
    false
  );
  assert.equal(refusalReasonOfGeoDecision('country_blocked:XX'), 'country');
  assert.equal(refusalReasonOfGeoDecision('geo_lookup_unavailable:error'), 'location-unavailable');
  assert.equal(refusalReasonOfGeoDecision('vpn_detected'), 'risk');
  const dedup = createRefusalDedup({ windowMs: 1000 });
  assert.equal(dedup('k', 0), true);
  assert.equal(dedup('k', 500), false);
  assert.equal(dedup('k', 1500), true);
});

test('the lockout email escapes values and goes through the email plugin', async () => {
  const sent = [];
  const strapi = {
    store: () => ({ get: async () => null }),
    plugin: (name) => {
      assert.equal(name, 'email');
      return { service: () => ({ send: async (mail) => sent.push(mail) }) };
    },
    log: silentLog,
  };
  const notifications = createNotifications({ strapi });
  const ok = await notifications.sendAccountLockedEmail({
    user: { email: 'user@example.com', username: '<b>x</b>' },
    minutes: 15,
    until: Date.UTC(2026, 0, 1),
  });
  assert.equal(ok, true);
  assert.equal(sent[0].to, 'user@example.com');
  assert.match(sent[0].html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(sent[0].text, /15 minutes/);
  assert.equal(
    await notifications.sendAccountLockedEmail({ user: {}, minutes: 1, until: 0 }),
    false
  );
});
