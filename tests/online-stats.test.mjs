import assert from 'node:assert/strict';
import test from 'node:test';

import { computeOnlineUserStats, normalizeUserCounts } from '../admin/src/utils/onlineStats.mjs';

test('computeOnlineUserStats ignores inactive sessions for online buckets', () => {
  const now = new Date('2026-06-21T10:00:00.000Z').getTime();
  const sessions = [
    {
      isActive: false,
      isTrulyActive: false,
      lastActive: '2026-06-21T09:59:00.000Z',
      loginTime: '2026-06-21T09:00:00.000Z',
      user: { documentId: 'logged-out-user' },
    },
    {
      isActive: true,
      isTrulyActive: true,
      lastActive: '2026-06-21T09:59:00.000Z',
      loginTime: '2026-06-21T09:00:00.000Z',
      user: { documentId: 'active-user' },
    },
  ];

  const stats = computeOnlineUserStats(sessions, { now, totalUsers: 2, blockedUsers: 0 });

  assert.equal(stats.onlineNow, 1);
  assert.equal(stats.last15min, 1);
  assert.equal(stats.last30min, 1);
  assert.equal(stats.offline, 1);
});

test('a user active 20 minutes ago is only in the 30-minute bucket', () => {
  const now = Date.parse('2026-06-21T10:00:00.000Z');
  const stats = computeOnlineUserStats([
    {
      isActive: true,
      lastActive: '2026-06-21T09:40:00.000Z',
      user: { documentId: 'user-20-minutes' },
    },
  ], { now, totalUsers: 1 });

  assert.equal(stats.onlineNow, 0);
  assert.equal(stats.last15min, 0);
  assert.equal(stats.last30min, 1);
});

test('count-only API response preserves real zero counts and rejects malformed totals', () => {
  assert.deepEqual(
    normalizeUserCounts({ success: true, data: { totalUsers: 0, blockedUsers: 0 } }),
    { totalUsers: 0, blockedUsers: 0 }
  );
  assert.equal(normalizeUserCounts({ success: true, data: { totalUsers: 3, blockedUsers: 4 } }), null);
  assert.equal(normalizeUserCounts({ success: false, data: { totalUsers: 0, blockedUsers: 0 } }), null);
});

test('unknown user totals stay unavailable instead of becoming false zeroes', () => {
  assert.deepEqual(computeOnlineUserStats([], {}), {
    onlineNow: 0,
    last15min: 0,
    last30min: 0,
    offline: null,
    totalUsers: null,
    blocked: null,
  });
});
