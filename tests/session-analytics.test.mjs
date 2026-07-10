import assert from 'node:assert/strict';
import test from 'node:test';

import { computeSessionAnalytics } from '../admin/src/utils/sessionAnalytics.mjs';

test('analytics handles missing user agents and classifies Android before Linux', () => {
  const analytics = computeSessionAnalytics([
    {
      isActive: true,
      isTrulyActive: true,
      userAgent: null,
      user: { documentId: 'user-a' },
      ipAddress: '203.0.113.1',
      loginTime: '2026-07-10T10:00:00.000Z',
      lastActive: '2026-07-10T10:30:00.000Z',
    },
    {
      isActive: false,
      terminationReason: 'logout',
      userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/150.0 Mobile',
      user: { documentId: 'user-b', id: 7 },
      ipAddress: '203.0.113.2',
      loginTime: '2026-07-10T09:00:00.000Z',
      logoutTime: '2026-07-10T09:20:00.000Z',
    },
    {
      isActive: false,
      terminationReason: 'manual',
      userAgent: 'curl/8.0',
      user: { documentId: 'user-b', id: 8 },
      loginTime: '2026-07-10T08:00:00.000Z',
      logoutTime: '2026-07-10T08:10:00.000Z',
    },
  ], { now: Date.parse('2026-07-10T11:00:00.000Z') });

  assert.equal(analytics.totalSessions, 3);
  assert.equal(analytics.activeSessions, 1);
  assert.equal(analytics.operatingSystems.Android, 1);
  assert.equal(analytics.operatingSystems.Linux, undefined);
  assert.equal(analytics.uniqueUsers, 2);
  assert.equal(analytics.loggedOut, 1);
  assert.equal(analytics.terminated, 1);
  assert.equal(analytics.avgSessionDuration, 20);
});
