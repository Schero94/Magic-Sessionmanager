import assert from 'node:assert/strict';
import test from 'node:test';

import { WIDGET_STAT_KEYS, computeWidgetStats, startOfLocalDay } from '../admin/src/utils/widgetStats.mjs';

const now = new Date(2026, 5, 21, 10, 0, 0).getTime();
const minutesAgo = (minutes) => new Date(now - minutes * 60 * 1000).toISOString();

test('the widget shows exactly four tiles in a 2 x 2 order', () => {
  assert.deepEqual([...WIDGET_STAT_KEYS], ['onlineNow', 'last15min', 'lastHour', 'today']);
});

test('online now counts unique users with a valid, currently active session', () => {
  const stats = computeWidgetStats([
    { isActive: true, isTrulyActive: true, lastActive: minutesAgo(1), user: { documentId: 'a' } },
    { isActive: true, isTrulyActive: true, lastActive: minutesAgo(2), user: { documentId: 'a' } },
    { isActive: true, isTrulyActive: false, lastActive: minutesAgo(40), user: { documentId: 'b' } },
    { isActive: false, isTrulyActive: true, lastActive: minutesAgo(1), user: { documentId: 'c' } },
  ], { now });

  assert.equal(stats.onlineNow, 1);
});

test('activity windows count unique users, including sessions that ended since', () => {
  const stats = computeWidgetStats([
    { isActive: true, lastActive: minutesAgo(5), user: { documentId: 'five' } },
    { isActive: false, logoutTime: minutesAgo(1), lastActive: minutesAgo(10), user: { documentId: 'ended-ten' } },
    { isActive: true, lastActive: minutesAgo(20), user: { documentId: 'twenty' } },
    { isActive: true, lastActive: minutesAgo(59), user: { documentId: 'fifty-nine' } },
    { isActive: true, lastActive: minutesAgo(61), user: { documentId: 'sixty-one' } },
    { isActive: true, lastActive: minutesAgo(61), user: { documentId: 'five' } },
  ], { now });

  assert.equal(stats.last15min, 2);
  assert.equal(stats.lastHour, 4);
  assert.equal(stats.today, 5);
  assert.equal(stats.sessionCount, 6);
});

test('today starts at local midnight and ignores yesterday', () => {
  const midnight = startOfLocalDay(now);
  assert.equal(new Date(midnight).getHours(), 0);
  const stats = computeWidgetStats([
    { lastActive: new Date(midnight + 1000).toISOString(), user: { documentId: 'today' } },
    { lastActive: new Date(midnight - 1000).toISOString(), user: { documentId: 'yesterday' } },
  ], { now });
  assert.equal(stats.today, 1);
});

test('login time is the fallback and invalid rows are ignored instead of counted', () => {
  const stats = computeWidgetStats([
    { loginTime: minutesAgo(3), user: { email: 'x@example.invalid' } },
    { lastActive: 'not-a-date', user: { documentId: 'bad-date' } },
    { lastActive: minutesAgo(1) },
    null,
  ], { now });
  assert.equal(stats.last15min, 1);
  assert.equal(stats.today, 1);
});

test('slightly future timestamps (clock skew) count as now', () => {
  const stats = computeWidgetStats([
    { lastActive: new Date(now + 30 * 1000).toISOString(), user: { documentId: 'skew' } },
  ], { now });
  assert.equal(stats.last15min, 1);
});

test('no sessions yields real zeroes and an empty session count', () => {
  assert.deepEqual(computeWidgetStats([], { now }), { onlineNow: 0, last15min: 0, lastHour: 0, today: 0, sessionCount: 0 });
  assert.deepEqual(computeWidgetStats(undefined, { now }), { onlineNow: 0, last15min: 0, lastHour: 0, today: 0, sessionCount: 0 });
});
