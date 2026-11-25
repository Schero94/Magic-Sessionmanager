import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EMPTY_SESSION_STATS,
  MAX_EXPORT_ROWS,
  buildExportParams,
  buildListParams,
  readSessionPage,
  readSessionStats,
} from '../admin/src/utils/sessionListApi.mjs';
import { widgetStatsFromCounts } from '../admin/src/utils/widgetStats.mjs';
import { escapeCsvValue } from '../admin/src/utils/sessionExports.mjs';

test('list and export parameters send only non-default filters and a bounded search', () => {
  assert.deepEqual(
    buildListParams({ page: 3, pageSize: '50', status: 'all', reason: 'all', search: '' }),
    { page: '3', pageSize: '50' }
  );
  assert.deepEqual(
    buildListParams({ page: 1, pageSize: '25', status: 'ended', reason: 'idle', search: ' bob ' }),
    { page: '1', pageSize: '25', status: 'ended', reason: 'idle', search: 'bob' }
  );
  // The end reason only applies to ended sessions.
  assert.deepEqual(buildListParams({ page: 1, pageSize: '25', status: 'open', reason: 'idle' }), {
    page: '1',
    pageSize: '25',
    status: 'open',
  });
  assert.equal(
    buildListParams({ page: 1, pageSize: '25', search: 'x'.repeat(500) }).search.length,
    100
  );
  assert.deepEqual(buildExportParams({ status: 'active' }, 'abc'), {
    limit: '1000',
    status: 'active',
    cursor: 'abc',
  });
  assert.equal(MAX_EXPORT_ROWS, 50000);
});

test('page and stats responses are validated before they reach the UI', () => {
  assert.deepEqual(
    readSessionPage({ data: [{ id: 'a' }], meta: { pagination: { total: 1, pageCount: 1 } } }),
    { rows: [{ id: 'a' }], pagination: { total: 1, pageCount: 1 } }
  );
  assert.throws(() => readSessionPage({ data: [] }), /Invalid session page/);
  assert.throws(
    () => readSessionPage({ data: [], meta: { pagination: { total: -1, pageCount: 1 } } }),
    /Invalid session page/
  );

  const stats = { ...EMPTY_SESSION_STATS, total: 5, active: 2, idle: 1, usersOnline: 2 };
  assert.deepEqual(readSessionStats({ data: stats }), stats);
  assert.throws(() => readSessionStats({ data: { ...stats, active: '2' } }), /Invalid session/);
});

test('the widget reads count-only statistics, exact for any number of sessions', () => {
  assert.deepEqual(
    widgetStatsFromCounts({
      data: { total: 125_000, active: 4_200, idle: 310, usersOnline: 3_900 },
    }),
    { onlineUsers: 3_900, activeSessions: 4_200, idleSessions: 310, sessionCount: 125_000 }
  );
  assert.throws(() => widgetStatsFromCounts({ data: [{ id: 1 }] }), /Invalid session statistics/);
});

test('CSV cells that start like a formula are neutralised (CSV injection)', () => {
  assert.equal(escapeCsvValue('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  for (const start of ['+', '-', '@', '\t', '\r']) {
    assert.equal(escapeCsvValue(`${start}cmd`), `"'${start}cmd"`);
  }
  assert.equal(escapeCsvValue('Mozilla/5.0'), '"Mozilla/5.0"');
  assert.equal(escapeCsvValue(-5), '"-5"', 'numbers are data, not formulas');
  assert.equal(escapeCsvValue(null), '""');
});

test('item 4: CSV escaping covers zero-width prefixes and full-width formula signs', () => {
  for (const value of [
    '\u200b=1+1',
    '\ufeff@SUM(A1)',
    '\u200d\u200c+cmd',
    '\u2060-2',
    '\u00ad=x',
    '  =x',
    '\uff1dHYPERLINK("http://x")',
    '\uff0bcmd',
    '\uff0dcmd',
    '\uff20SUM(A1)',
    '\u200b\uff1d1',
    '\nline',
  ]) {
    assert.ok(escapeCsvValue(value).startsWith(`"'`), JSON.stringify(value));
  }
  assert.equal(escapeCsvValue('Plain title'), '"Plain title"');
  assert.equal(escapeCsvValue('a=b'), '"a=b"', 'only a leading sign counts');
  const started = performance.now();
  escapeCsvValue(`${'\u200b'.repeat(50_000)}x`);
  assert.ok(performance.now() - started < 200, 'linear on adversarial input');
});

test('analytics from the server merge raw device and browser groups into the display buckets', async () => {
  const { analyticsFromServer } = await import('../admin/src/utils/sessionAnalytics.mjs');
  const result = analyticsFromServer({
    data: {
      totalSessions: 60_000,
      activeSessions: 10,
      idleSessions: 5,
      endedSessions: 59_985,
      signInsLast24Hours: 3,
      signInsLast7Days: 9,
      uniqueUsers: 12_000,
      avgSessionDuration: 42,
      devices: [
        { value: 'desktop', count: 40_000 },
        { value: 'Mobile', count: 15_000 },
        { value: null, count: 5_000 },
      ],
      browsers: [
        { value: 'Chrome 120', count: 30_000 },
        { value: 'Chrome 121', count: 10_000 },
        { value: 'Safari 17', count: 15_000 },
        { value: null, count: 5_000 },
      ],
    },
  });
  assert.equal(result.totalSessions, 60_000);
  assert.equal(result.browsers.Chrome, 40_000, 'versions merge into one browser bucket');
  assert.equal(result.browsers.unknown, 5_000);
  assert.equal(result.devices.unknown, 5_000);
  assert.equal(
    Object.values(result.devices).reduce((sum, value) => sum + value, 0),
    60_000
  );
  assert.throws(
    () => analyticsFromServer({ data: { totalSessions: '1' } }),
    /Invalid session analytics/
  );
});

test('security review 2, hardening 8: U+061C and U+180E before a formula sign are escaped', () => {
  for (const value of ['؜=1+1', '᠎=HYPERLINK("x")', ' ؜᠎@SUM(A1)']) {
    assert.ok(escapeCsvValue(value).startsWith(`"'`), JSON.stringify(value));
  }
});
