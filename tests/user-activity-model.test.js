'use strict';

// App-user security activity (4.22): which events belong to the view, the
// filter groups, retention at read time, the event facts a response may carry
// and the address rules. Pure functions; the real database path is covered by
// tests/isolated-user-activity-http.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  USER_ACTIVITY_EVENTS,
  USER_ACTIVITY_FILTERS,
  userActivityWhere,
  userEventAddress,
  userEventFacts,
} = require('../server/src/utils/user-activity-model');
const { SECURITY_EVENTS } = require('../server/src/utils/security-log-model');
const { anonymizeIp, normalizeIp } = require('../server/src/utils/admin-request-info');

const NOW = new Date('2026-11-25T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

test('the view lists every app-user and impersonation event, and no admin event', () => {
  for (const event of Object.values(SECURITY_EVENTS)) {
    // `impersonation.write` (4.23) is only recorded while signed in as an admin.
    const isUser =
      event.startsWith('user.') ||
      (event.startsWith('impersonation.') && event !== 'impersonation.write');
    assert.equal(USER_ACTIVITY_EVENTS.includes(event), isUser, event);
  }
  // Every event belongs to exactly one filter group besides "all".
  const grouped = Object.entries(USER_ACTIVITY_FILTERS)
    .filter(([key]) => key !== 'all')
    .flatMap(([, events]) => events);
  assert.deepEqual([...grouped].sort(), [...USER_ACTIVITY_EVENTS].sort());
  assert.equal(new Set(grouped).size, grouped.length);
});

test('where: impersonations only of app users, the user filter, and the retention cutoff', () => {
  const where = userActivityWhere({ event: 'all' }, { retentionDays: 90, now: NOW });
  const [kinds, created] = where.$and;
  assert.deepEqual(kinds.$or[1].targetType, 'user', 'admin previews are not app-user events');
  assert.ok(kinds.$or[0].event.$in.includes('user.sign-in.failed'));
  assert.ok(!kinds.$or[0].event.$in.includes('impersonation.started'));
  assert.deepEqual(created, { createdAt: { $gte: new Date(NOW.getTime() - 90 * DAY) } });

  const one = userActivityWhere(
    { event: 'failed', userId: 'abc123', from: new Date(NOW.getTime() - DAY), to: NOW },
    { retentionDays: 90, now: NOW }
  );
  assert.deepEqual(one.$and, [
    { event: { $in: ['user.sign-in.failed', 'user.sign-in.refused'] } },
    { targetType: 'user', targetId: 'abc123' },
    { createdAt: { $gte: new Date(NOW.getTime() - DAY) } },
    { createdAt: { $lte: NOW } },
  ]);

  // A `from` before the retention cutoff is raised to it: expired rows stay hidden.
  const early = userActivityWhere(
    { event: 'impersonation', from: new Date(NOW.getTime() - 400 * DAY) },
    { retentionDays: 30, now: NOW }
  );
  assert.deepEqual(early.$and[0], {
    event: { $in: [...USER_ACTIVITY_FILTERS.impersonation] },
    targetType: 'user',
  });
  assert.deepEqual(early.$and[1], { createdAt: { $gte: new Date(NOW.getTime() - 30 * DAY) } });
});

test('facts: numbers and codes only, each checked against its shape', () => {
  assert.deepEqual(
    userEventFacts('user.sign-in.refused', {
      reason: 'session-limit',
      limit: 3,
      unknownAccount: false,
      identifier: 'ann@example.test',
    }),
    { reason: 'session-limit', limit: 3, lock: null, unknownAccount: false }
  );
  assert.deepEqual(userEventFacts('user.sign-in.refused', { reason: '<script>' }).reason, null);
  assert.deepEqual(
    userEventFacts('user.lockout', { kind: 'account', failures: 5, minutes: 15, ip: 'x' }),
    { kind: 'account', failures: 5, minutes: 15 }
  );
  assert.deepEqual(
    userEventFacts('user.sign-in.impossible-travel', {
      distanceKm: 9100,
      speedKmh: 4550,
      from: 'DE',
      to: 'us',
      action: 'reauthenticate',
    }),
    { distanceKm: 9100, speedKmh: 4550, from: 'DE', to: null, action: 'reauthenticate' }
  );
  assert.deepEqual(userEventFacts('user.not-me', JSON.stringify({ scope: 'all', ended: 2 })), {
    scope: 'all',
    ended: 2,
  });
  assert.deepEqual(userEventFacts('user.data.exported', { sessions: 4, events: 12 }), {
    sessions: 4,
    events: 12,
  });
  assert.deepEqual(userEventFacts('user.sign-in.failed', { status: 400, unknownAccount: true }), {
    status: 400,
    unknownAccount: true,
  });
  assert.deepEqual(userEventFacts('admin.sign-in', { provider: 'local' }), {});
});

test('facts: the impersonation reason only for readers who may impersonate', () => {
  const meta = { reason: 'Ticket 4711: checkout fails', durationMinutes: 30, handoff: 'token' };
  assert.equal(userEventFacts('impersonation.started', meta).reason, null);
  assert.equal(
    userEventFacts('impersonation.started', meta, { canSeeImpersonationReason: true }).reason,
    'Ticket 4711: checkout fails'
  );
  assert.deepEqual(
    userEventFacts('impersonation.refused', { refusal: 'call-credentials', impersonation: 'x' }),
    {
      durationMinutes: null,
      handoff: null,
      endReason: null,
      refusal: 'call-credentials',
      reason: null,
    }
  );
});

test('address: the current switches apply to stored rows', () => {
  const anonymize = (ip) => anonymizeIp(normalizeIp(ip));
  const row = { ip: '203.0.113.42', geo: { country: 'X' }, meta: {} };
  assert.deepEqual(userEventAddress(row, { storeIp: true, anonymizeIp: false }, anonymize), {
    ipAddress: '203.0.113.42',
    ipAnonymized: false,
    keepLocation: true,
  });
  assert.deepEqual(userEventAddress(row, { storeIp: true, anonymizeIp: true }, anonymize), {
    ipAddress: '203.0.113.0',
    ipAnonymized: true,
    keepLocation: true,
  });
  assert.deepEqual(userEventAddress(row, { storeIp: false, anonymizeIp: false }, anonymize), {
    ipAddress: null,
    ipAnonymized: false,
    keepLocation: false,
  });
  const v6 = { ip: '2001:db8:1:2::42', meta: {} };
  assert.equal(
    userEventAddress(v6, { storeIp: true, anonymizeIp: true }, anonymize).ipAddress,
    '2001:db8:1::'
  );
  const stored = { ip: '203.0.113.0', meta: { ipAnonymized: true } };
  assert.deepEqual(userEventAddress(stored, { storeIp: true, anonymizeIp: false }, anonymize), {
    ipAddress: '203.0.113.0',
    ipAnonymized: true,
    keepLocation: true,
  });
});
