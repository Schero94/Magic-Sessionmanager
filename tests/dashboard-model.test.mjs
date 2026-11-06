import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DASHBOARD_TABLE_COLUMNS,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  getExportDeviceInfo,
  getSessionStats,
  getSessionUserLabels,
  hasActiveFilters,
  parseDashboardQuery,
  pickFocusSessionId,
  shouldIsolateActionKey,
} from '../admin/src/pages/Dashboard/dashboardModel.mjs';

const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

test('URL query maps to dashboard state with safe defaults', () => {
  assert.deepEqual(parseDashboardQuery({}), { page: 1, pageSize: DEFAULT_PAGE_SIZE, status: 'all', search: '' });
  assert.deepEqual(parseDashboardQuery({ page: '3', pageSize: '50', status: 'idle', _q: '  anna ' }), {
    page: 3,
    pageSize: '50',
    status: 'idle',
    search: 'anna',
  });
  // Invalid values never broaden or empty the list silently.
  assert.deepEqual(parseDashboardQuery({ page: '-2', pageSize: '7', status: 'online', _q: ['x'] }), {
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    status: 'all',
    search: '',
  });
  assert.deepEqual(parseDashboardQuery(null).page, 1);
  assert.ok(PAGE_SIZE_OPTIONS.includes(DEFAULT_PAGE_SIZE));
});

test('active filters are detected for the "Clear filters" state', () => {
  assert.equal(hasActiveFilters({ status: 'all', search: '' }), false);
  assert.equal(hasActiveFilters({ status: 'idle', search: '' }), true);
  assert.equal(hasActiveFilters({ status: 'all', search: 'x' }), true);
});

test('KPI counts: Ended combines logged-out and terminated sessions', () => {
  const stats = getSessionStats([
    { isActive: true, isTrulyActive: true },
    { isActive: true, isTrulyActive: false },
    { isActive: false, terminationReason: 'logout' },
    { isActive: false, terminationReason: 'manual' },
    { isActive: false, terminationReason: 'idle' },
  ]);
  assert.deepEqual(stats, { active: 1, idle: 1, loggedOut: 1, terminated: 2, ended: 3, total: 5 });
  assert.deepEqual(getSessionStats(null), { active: 0, idle: 0, loggedOut: 0, terminated: 0, ended: 0, total: 0 });
});

test('one user identifier is used for display and per-row accessible names', () => {
  assert.deepEqual(getSessionUserLabels({ id: 's1', user: { username: 'anna', email: 'anna@example.test' } }), {
    primary: 'anna',
    secondary: 'anna@example.test',
    accessible: 'anna',
  });
  assert.deepEqual(getSessionUserLabels({ id: 's2', user: { email: 'ben@example.test' } }), {
    primary: 'ben@example.test',
    secondary: '',
    accessible: 'ben@example.test',
  });
  // Without a user the session id keeps every action label distinct.
  assert.deepEqual(getSessionUserLabels({ id: 's3', user: { username: '  ' } }), {
    primary: '',
    secondary: '',
    accessible: 's3',
  });
});

test('exports use neutral device keys and never infer Desktop for unknown agents', () => {
  assert.deepEqual(getExportDeviceInfo({ userAgent: MAC_SAFARI }, ''), {
    device: 'desktop',
    browser: 'Safari',
    browserVersion: '17.4',
    os: 'macOS',
  });
  assert.deepEqual(getExportDeviceInfo({ userAgent: 'SyntheticAgent/1.0' }, ''), {
    device: '',
    browser: '',
    browserVersion: '',
    os: '',
  });
  assert.equal(getExportDeviceInfo({ deviceType: 'mobile', browserName: 'unknown' }, 'n/a').browser, 'n/a');
});

test('table action groups keep Enter/Space for their own buttons and isolate dialog keys', () => {
  assert.equal(shouldIsolateActionKey('Enter', true), true);
  assert.equal(shouldIsolateActionKey(' ', true), true);
  // Arrow keys move between the row's buttons through the DS grid cell.
  assert.equal(shouldIsolateActionKey('ArrowRight', true), false);
  assert.equal(shouldIsolateActionKey('Tab', true), false);
  // Keys from the confirmation dialog (a portal) never reach the grid.
  assert.equal(shouldIsolateActionKey('Tab', false), true);
  assert.equal(shouldIsolateActionKey('ArrowDown', false), true);
});

test('focus after a mutation stays on the row, then the next, then the previous row', () => {
  const before = ['a', 'b', 'c'];
  assert.equal(pickFocusSessionId(before, ['a', 'b', 'c'], 'b'), 'b');
  assert.equal(pickFocusSessionId(before, ['a', 'c'], 'b'), 'c');
  assert.equal(pickFocusSessionId(before, ['a', 'b'], 'c'), 'b');
  assert.equal(pickFocusSessionId(before, [], 'b'), null);
  assert.equal(pickFocusSessionId([], ['x'], 'b'), 'x');
});

test('the desktop table declares its column count for DS grid navigation', () => {
  assert.equal(DASHBOARD_TABLE_COLUMNS, 6);
});
