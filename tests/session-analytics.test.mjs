import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANALYTICS_UNKNOWN_KEY,
  computeSessionAnalytics,
  getAnalyticsBarRows,
  getBrowserBucket,
  getDeviceBucket,
  getSessionDurationMinutes,
} from '../admin/src/utils/sessionAnalytics.mjs';

const NOW = Date.parse('2026-07-10T11:00:00.000Z');

test('the unknown bucket is a translation key, not an English label', () => {
  assert.equal(ANALYTICS_UNKNOWN_KEY, 'unknown');
});

test('KPIs count all sessions, active sessions and sign-ins in rolling windows (IA D6, I.1-24)', () => {
  const analytics = computeSessionAnalytics(
    [
      {
        isActive: true,
        isTrulyActive: true,
        loginTime: '2026-07-10T10:00:00.000Z',
        lastActive: '2026-07-10T10:30:00.000Z',
        user: { documentId: 'a' },
      },
      {
        isActive: true,
        isTrulyActive: false,
        loginTime: '2026-07-09T12:00:00.000Z',
        lastActive: '2026-07-09T12:30:00.000Z',
        user: { documentId: 'a' },
      },
      {
        isActive: false,
        terminationReason: 'idle',
        loginTime: '2026-07-05T08:00:00.000Z',
        logoutTime: '2026-07-05T09:00:00.000Z',
        user: { documentId: 'b' },
      },
      {
        isActive: false,
        loginTime: '2026-06-01T08:00:00.000Z',
        logoutTime: '2026-06-01T08:30:00.000Z',
        user: { documentId: 'c' },
      },
    ],
    { now: NOW }
  );

  assert.equal(analytics.totalSessions, 4);
  assert.equal(
    analytics.activeSessions,
    1,
    'Active sessions counts sessions that are open and truly active'
  );
  assert.equal(analytics.idleSessions, 1);
  assert.equal(analytics.endedSessions, 2);
  assert.equal(
    analytics.signInsLast24Hours,
    2,
    'the last 24 hours are a rolling window, not "today"'
  );
  assert.equal(analytics.signInsLast7Days, 3);
  assert.equal(analytics.uniqueUsers, 3);
});

test('a session that ended as timed out is ended, never active or idle', () => {
  const analytics = computeSessionAnalytics(
    [
      {
        isActive: false,
        isTrulyActive: true,
        terminationReason: 'idle',
        loginTime: '2026-07-10T10:00:00.000Z',
      },
    ],
    { now: NOW }
  );
  assert.equal(analytics.activeSessions, 0);
  assert.equal(analytics.idleSessions, 0);
  assert.equal(analytics.endedSessions, 1);
});

test('device buckets come from the stored deviceType with an Unknown bucket (decision I.2-3)', () => {
  const analytics = computeSessionAnalytics(
    [
      {
        deviceType: 'desktop',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
      },
      { deviceType: 'Desktop' },
      {
        deviceType: 'mobile',
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1',
      },
      { deviceType: 'tablet' },
      { deviceType: 'unknown', userAgent: null },
      { deviceType: null, userAgent: null },
      // A Strapi session without a user agent has no stored device type.
      { id: 'native_1', deviceType: null, browserName: null, osName: null },
      // The raw user agent is not re-parsed: only the stored device type counts.
      {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1',
      },
    ],
    { now: NOW }
  );

  assert.deepEqual(analytics.devices, {
    desktop: 2,
    mobile: 1,
    tablet: 1,
    [ANALYTICS_UNKNOWN_KEY]: 4,
  });
  for (const key of Object.keys(analytics.devices)) {
    assert.equal(key, key.toLowerCase(), `${key} is a translation key, not a display label`);
  }
  assert.equal(
    analytics.devices.Desktop,
    undefined,
    'unknown devices are never counted as Desktop (DUX-05)'
  );
});

test('device bucket helper normalises legacy labels and maps everything else to Unknown', () => {
  assert.equal(getDeviceBucket({ deviceType: 'API Client' }), 'api');
  assert.equal(getDeviceBucket({ deviceType: 'bot' }), 'bot');
  assert.equal(getDeviceBucket({ deviceType: 'smart fridge' }), ANALYTICS_UNKNOWN_KEY);
  assert.equal(getDeviceBucket({}), ANALYTICS_UNKNOWN_KEY);
  assert.equal(getDeviceBucket(null), ANALYTICS_UNKNOWN_KEY);
});

test('browser buckets use the browser name without its version (no "Safari 17.4 17")', () => {
  assert.equal(getBrowserBucket({ browserName: 'Safari 17.4' }), 'Safari');
  assert.equal(getBrowserBucket({ browserName: 'Chrome 124.0.0.0' }), 'Chrome');
  assert.equal(getBrowserBucket({ browserName: 'Internet Explorer 11.0' }), 'Internet Explorer');
  assert.equal(getBrowserBucket({ browserName: 'Firefox' }), 'Firefox');
  assert.equal(getBrowserBucket({ browserName: 'unknown' }), ANALYTICS_UNKNOWN_KEY);
  assert.equal(getBrowserBucket({ browserName: '  ' }), ANALYTICS_UNKNOWN_KEY);
  assert.equal(getBrowserBucket({}), ANALYTICS_UNKNOWN_KEY);

  const analytics = computeSessionAnalytics(
    [
      { browserName: 'Chrome 124.0.0.0' },
      { browserName: 'Chrome 125.0.1' },
      { browserName: 'Edge 124.0' },
      { browserName: 'unknown' },
      { browserName: null },
    ],
    { now: NOW }
  );
  assert.deepEqual(analytics.browsers, { Chrome: 2, Edge: 1, [ANALYTICS_UNKNOWN_KEY]: 2 });
  assert.equal(analytics.browsers.Unknown, undefined, 'no English "Unknown" literal');
});

test('average session length runs from sign-in to the end, or to the last activity while open (IA D6, I.1-25)', () => {
  const timedOut = {
    isActive: false,
    terminationReason: 'idle',
    loginTime: '2026-07-10T10:00:00.000Z',
    lastActive: '2026-07-10T10:00:00.000Z',
    logoutTime: '2026-07-10T10:28:00.000Z',
  };

  assert.equal(
    getSessionDurationMinutes(timedOut, NOW),
    28,
    'timed-out sessions include the unused time before they were closed'
  );
  assert.equal(getSessionDurationMinutes({ ...timedOut, terminationReason: 'manual' }, NOW), 28);
  assert.equal(
    getSessionDurationMinutes({ ...timedOut, logoutTime: null }, NOW),
    0,
    'without an end time the last activity is used'
  );
  assert.equal(
    getSessionDurationMinutes({ isActive: false, loginTime: '2026-07-10T10:00:00.000Z' }, NOW),
    null,
    'an ended session without any end marker cannot inflate the average'
  );
  assert.equal(computeSessionAnalytics([timedOut], { now: NOW }).avgSessionDuration, 28);
});

test('open sessions end at their last activity, or now without one; invalid dates are skipped', () => {
  assert.equal(
    getSessionDurationMinutes(
      {
        isActive: true,
        loginTime: '2026-07-10T10:00:00.000Z',
        lastActive: '2026-07-10T10:45:00.000Z',
      },
      NOW
    ),
    45
  );
  assert.equal(
    getSessionDurationMinutes({ isActive: true, loginTime: '2026-07-10T10:00:00.000Z' }, NOW),
    60
  );
  assert.equal(getSessionDurationMinutes({ loginTime: 'not a date' }, NOW), null);
  assert.equal(
    getSessionDurationMinutes(
      {
        isActive: true,
        loginTime: '2026-07-10T10:00:00.000Z',
        lastActive: '2026-07-10T09:00:00.000Z',
      },
      NOW
    ),
    0,
    'never negative'
  );
});

test('empty and malformed input produce zero analytics', () => {
  for (const input of [[], null, undefined, 'x']) {
    const analytics = computeSessionAnalytics(input, { now: NOW });
    assert.equal(analytics.totalSessions, 0);
    assert.equal(analytics.avgSessionDuration, 0);
    assert.deepEqual(analytics.devices, {});
  }
});

test('bar rows are sorted by count, scaled to the largest bucket and bounded', () => {
  assert.deepEqual(
    getAnalyticsBarRows({ mobile: 5, desktop: 10, tablet: 5, bad: -1, nan: Number.NaN }),
    [
      { key: 'desktop', count: 10, percent: 100 },
      { key: 'mobile', count: 5, percent: 50 },
      { key: 'tablet', count: 5, percent: 50 },
    ]
  );
  assert.deepEqual(getAnalyticsBarRows({}), []);
  assert.deepEqual(getAnalyticsBarRows(null), []);
  assert.deepEqual(getAnalyticsBarRows({ desktop: 0 }), []);
});

test('the unknown bucket is always listed last so known buckets lead', () => {
  assert.deepEqual(
    getAnalyticsBarRows({ [ANALYTICS_UNKNOWN_KEY]: 9, desktop: 3 }).map((row) => row.key),
    ['desktop', ANALYTICS_UNKNOWN_KEY]
  );
});
