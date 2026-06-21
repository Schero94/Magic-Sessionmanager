import assert from 'node:assert/strict';
import test from 'node:test';

import { computeOnlineUserStats } from '../admin/src/utils/onlineStats.mjs';

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
