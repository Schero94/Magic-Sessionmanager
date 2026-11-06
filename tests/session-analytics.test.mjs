import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANALYTICS_OTHER_KEY,
  computeSessionAnalytics,
  getAnalyticsBarRows,
  getSessionDurationMinutes,
} from '../admin/src/utils/sessionAnalytics.mjs';

const NOW = Date.parse('2026-07-10T11:00:00.000Z');

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
  ], { now: NOW });

  assert.equal(analytics.totalSessions, 3);
  assert.equal(analytics.activeSessions, 1);
  assert.equal(analytics.operatingSystems.Android, 1);
  assert.equal(analytics.operatingSystems.Linux, undefined);
  assert.equal(analytics.uniqueUsers, 2);
  assert.equal(analytics.loggedOut, 1);
  assert.equal(analytics.terminated, 1);
  assert.equal(analytics.avgSessionDuration, 20);
});

test('device buckets use the shared normalised device types, never English labels (UX-09, I18N-11)', () => {
  const analytics = computeSessionAnalytics([
    { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15' },
    { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1' },
    { userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari/604.1' },
    { userAgent: 'curl/8.0' },
    { userAgent: null },
    { userAgent: 'SomethingNobodyKnows/1.0' },
    { deviceType: 'Desktop', userAgent: '' },
  ], { now: NOW });

  assert.deepEqual(analytics.devices, { desktop: 2, mobile: 1, tablet: 1, api: 1, [ANALYTICS_OTHER_KEY]: 2 });
  for (const key of Object.keys(analytics.devices)) {
    assert.equal(key, key.toLowerCase(), `${key} is a translation key, not a display label`);
  }
  assert.equal(analytics.devices.Desktop, undefined, 'unknown user agents are not counted as Desktop (DUX-05)');
  assert.equal(analytics.mobileRatio, Math.round((2 / 7) * 100));
});

test('browser buckets keep proper names and group unknown browsers under one translatable key', () => {
  const analytics = computeSessionAnalytics([
    { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/150.0 Safari/537.36' },
    { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/150.0 Safari/537.36 Edg/150.0' },
    { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/150.0 Safari/537.36 OPR/110.0' },
    { userAgent: null },
    { userAgent: 'SomethingNobodyKnows/1.0' },
  ], { now: NOW });

  assert.deepEqual(analytics.browsers, { Chrome: 1, Edge: 1, Opera: 1, [ANALYTICS_OTHER_KEY]: 2 });
  assert.equal(analytics.browsers.Other, undefined, 'no English "Other" literal');
  assert.equal(analytics.browsers.Unknown, undefined, 'no English "Unknown" literal');
});

test('average duration excludes the time an idle session waited for cleanup (F5)', () => {
  const idleEnded = {
    isActive: false,
    terminationReason: 'idle',
    loginTime: '2026-07-10T10:00:00.000Z',
    lastActive: '2026-07-10T10:00:00.000Z',
    logoutTime: '2026-07-10T10:28:00.000Z',
  };

  assert.equal(getSessionDurationMinutes(idleEnded, NOW), 0);
  assert.equal(computeSessionAnalytics([idleEnded], { now: NOW }).avgSessionDuration, 0);

  assert.equal(
    getSessionDurationMinutes({ ...idleEnded, terminationReason: 'expired' }, NOW),
    0,
    'expiry cleanup does not count as activity either'
  );
  assert.equal(
    getSessionDurationMinutes({ ...idleEnded, lastActive: null }, NOW),
    28,
    'without a last-activity timestamp the logout time is the only end marker'
  );
});

test('a user logout ends the session at the logout time', () => {
  assert.equal(getSessionDurationMinutes({
    isActive: false,
    terminationReason: 'logout',
    loginTime: '2026-07-10T09:00:00.000Z',
    lastActive: '2026-07-10T09:05:00.000Z',
    logoutTime: '2026-07-10T09:20:00.000Z',
  }, NOW), 20);
});

test('active sessions end at their last activity; invalid dates are skipped', () => {
  assert.equal(getSessionDurationMinutes({
    isActive: true,
    loginTime: '2026-07-10T10:00:00.000Z',
    lastActive: '2026-07-10T10:45:00.000Z',
  }, NOW), 45);
  assert.equal(getSessionDurationMinutes({ isActive: true, loginTime: '2026-07-10T10:00:00.000Z' }, NOW), 60);
  assert.equal(getSessionDurationMinutes({ loginTime: 'not a date' }, NOW), null);
  assert.equal(getSessionDurationMinutes({
    loginTime: '2026-07-10T10:00:00.000Z',
    lastActive: '2026-07-10T09:00:00.000Z',
  }, NOW), 0, 'never negative');
});

test('login timeline has no peak hour when no login time is known', () => {
  const empty = computeSessionAnalytics([{ loginTime: null }], { now: NOW });
  assert.equal(empty.peakHour, null);
  assert.equal(empty.loginHours.length, 24);

  const one = computeSessionAnalytics([{ loginTime: '2026-07-10T10:00:00.000Z' }], { now: NOW });
  assert.equal(one.peakHour, new Date('2026-07-10T10:00:00.000Z').getHours());
});

test('bar rows are sorted by count, scaled to the largest bucket and bounded', () => {
  assert.deepEqual(getAnalyticsBarRows({ mobile: 5, desktop: 10, tablet: 5, bad: -1, nan: Number.NaN }), [
    { key: 'desktop', count: 10, percent: 100 },
    { key: 'mobile', count: 5, percent: 50 },
    { key: 'tablet', count: 5, percent: 50 },
  ]);
  assert.deepEqual(getAnalyticsBarRows({}), []);
  assert.deepEqual(getAnalyticsBarRows(null), []);
  assert.deepEqual(getAnalyticsBarRows({ desktop: 0 }), []);
});
