import assert from 'node:assert/strict';
import test from 'node:test';

import { WIDGET_STAT_KEYS, computeWidgetStats } from '../admin/src/utils/widgetStats.mjs';

test('the widget shows exactly four tiles in a 2 x 2 order (IA D4, I.2-2)', () => {
  assert.deepEqual([...WIDGET_STAT_KEYS], ['onlineUsers', 'activeSessions', 'idleSessions', 'blockedUsers']);
});

test('online users are distinct users with at least one active session (isTrulyActive)', () => {
  const stats = computeWidgetStats([
    { isActive: true, isTrulyActive: true, user: { documentId: 'a' } },
    { isActive: true, isTrulyActive: true, user: { documentId: 'a' } },
    { isActive: true, isTrulyActive: false, user: { documentId: 'b' } },
    { isActive: false, isTrulyActive: true, user: { documentId: 'c' } },
    { isActive: true, isTrulyActive: true, user: { email: 'd@example.invalid' } },
  ]);

  assert.equal(stats.onlineUsers, 2, 'a and d; b is idle and c has ended');
});

test('active and idle tiles count open sessions only, using the same rule as the dashboard', () => {
  const stats = computeWidgetStats([
    { isActive: true, isTrulyActive: true, user: { documentId: 'a' } },
    { isActive: true, isTrulyActive: true, user: { documentId: 'a' } },
    { isActive: true, isTrulyActive: false, user: { documentId: 'b' } },
    { isActive: false, isTrulyActive: false, terminationReason: 'idle', user: { documentId: 'c' } },
    { isActive: false, user: { documentId: 'd' } },
  ]);

  assert.equal(stats.activeSessions, 2, 'sessions, not users');
  assert.equal(stats.idleSessions, 1, 'a session ended as "Timed out" is not idle');
  assert.equal(stats.sessionCount, 5);
});

test('no hard-coded activity windows: an old lastActive does not decide who is online', () => {
  const longAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const stats = computeWidgetStats([
    { isActive: true, isTrulyActive: true, lastActive: longAgo, user: { documentId: 'long-timeout' } },
  ]);
  assert.equal(stats.onlineUsers, 1, 'the configured inactivity timeout (isTrulyActive) decides');
});

test('rows without a user still count as sessions but never as online users', () => {
  const stats = computeWidgetStats([{ isActive: true, isTrulyActive: true }, null, 'x']);
  assert.equal(stats.onlineUsers, 0);
  assert.equal(stats.activeSessions, 1);
  assert.equal(stats.sessionCount, 3);
});

test('no sessions yields real zeroes and an empty session count', () => {
  const empty = { onlineUsers: 0, activeSessions: 0, idleSessions: 0, sessionCount: 0 };
  assert.deepEqual(computeWidgetStats([]), empty);
  assert.deepEqual(computeWidgetStats(undefined), empty);
});
