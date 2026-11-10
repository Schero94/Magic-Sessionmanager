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
