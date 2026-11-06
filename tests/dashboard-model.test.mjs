import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DASHBOARD_COMPACT_TABLE_COLUMNS,
  DASHBOARD_TABLE_COLUMNS,
  DEFAULT_PAGE_SIZE,
  HOW_IT_WORKS_STORAGE_KEY,
  PAGE_SIZE_OPTIONS,
  encodeSearchQuery,
  getErrorStatus,
  getExportDeviceInfo,
  getSessionStats,
  getSessionUserLabels,
  getUserEditPath,
  hasActiveFilters,
  parseDashboardQuery,
  pickFocusSessionId,
  readDisclosureOpen,
  shouldIsolateActionKey,
  shouldRedispatchEscape,
  shouldUseCompactTable,
  FULL_TABLE_MIN_WIDTH,
  writeDisclosureOpen,
} from '../admin/src/pages/Dashboard/dashboardModel.mjs';

const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

test('URL query maps to dashboard state with safe defaults', () => {
  assert.deepEqual(parseDashboardQuery({}), { page: 1, pageSize: DEFAULT_PAGE_SIZE, status: 'all', reason: 'all', search: '' });
  assert.deepEqual(parseDashboardQuery({ page: '3', pageSize: '50', status: 'idle', search: '  anna ' }), {
    page: 3,
    pageSize: '50',
    status: 'idle',
    reason: 'all',
    search: 'anna',
  });
  // Invalid values never broaden or empty the list silently.
  assert.deepEqual(parseDashboardQuery({ page: '-2', pageSize: '7', status: 'online', search: ['x'] }), {
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    status: 'all',
    reason: 'all',
    search: '',
  });
  assert.deepEqual(parseDashboardQuery(null).page, 1);
  assert.ok(PAGE_SIZE_OPTIONS.includes(DEFAULT_PAGE_SIZE));
  assert.equal(DEFAULT_PAGE_SIZE, '25');
});

test('the end reason applies only to the Ended status', () => {
  assert.equal(parseDashboardQuery({ status: 'ended', reason: 'idle' }).reason, 'idle');
  assert.equal(parseDashboardQuery({ status: 'open', reason: 'idle' }).reason, 'all');
  assert.equal(parseDashboardQuery({ status: 'ended', reason: 'terminated' }).reason, 'all');
});

test('?search=<email> from the user panel prefills the search; _q still works (IA C)', () => {
  assert.equal(parseDashboardQuery({ search: 'anna%2Btest%40example.test' }).search, 'anna+test@example.test');
  assert.equal(parseDashboardQuery({ search: 'anna@example.test' }).search, 'anna@example.test');
  assert.equal(parseDashboardQuery({ _q: 'legacy' }).search, 'legacy');
  assert.equal(parseDashboardQuery({ search: '%E0%A4%A' }).search, '%E0%A4%A', 'broken encodings do not throw');
  assert.equal(encodeSearchQuery(' anna+test@example.test '), 'anna%2Btest%40example.test');
  assert.equal(encodeSearchQuery('  '), undefined);
});

test('active filters are detected for the "Clear filters" state', () => {
  assert.equal(hasActiveFilters({ status: 'all', reason: 'all', search: '' }), false);
  assert.equal(hasActiveFilters({ status: 'idle', reason: 'all', search: '' }), true);
  assert.equal(hasActiveFilters({ status: 'all', reason: 'all', search: 'x' }), true);
  assert.equal(hasActiveFilters({ status: 'ended', reason: 'idle', search: '' }), true);
});

test('KPI counts: Active with users online, Idle (open only), Ended by reason, All (IA D1.4)', () => {
  const stats = getSessionStats([
    { isActive: true, isTrulyActive: true, user: { documentId: 'u1' } },
    { isActive: true, isTrulyActive: true, user: { documentId: 'u1' } },
    { isActive: true, isTrulyActive: true, user: { documentId: 'u2' } },
    { isActive: true, isTrulyActive: false, user: { documentId: 'u3' } },
    { isActive: false, terminationReason: 'logout' },
    { isActive: false, terminationReason: 'idle' },
    { isActive: false, terminationReason: 'manual' },
    { isActive: false, logoutTime: '2026-01-01T00:00:00.000Z' },
  ]);
  assert.deepEqual(stats, {
    active: 3,
    idle: 1,
    ended: 4,
    total: 8,
    usersOnline: 2,
    loggedOut: 1,
    timedOut: 1,
    otherReasons: 2,
  });
  assert.equal(getSessionStats(null).total, 0);
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

test('"Open user" links only when the row carries the user documentId (decision I.2-6)', () => {
  assert.equal(
    getUserEditPath({ user: { documentId: 'abc123' } }),
    '/content-manager/collection-types/plugin::users-permissions.user/abc123'
  );
  assert.equal(getUserEditPath({ user: { id: 7 } }), null);
  assert.equal(getUserEditPath({}), null);
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

test('"How sessions work" remembers its state and survives broken storage', () => {
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  assert.equal(readDisclosureOpen(storage), false, 'collapsed by default');
  writeDisclosureOpen(storage, true);
  assert.equal(store.get(HOW_IT_WORKS_STORAGE_KEY), 'open');
  assert.equal(readDisclosureOpen(storage), true);
  writeDisclosureOpen(storage, false);
  assert.equal(readDisclosureOpen(storage), false);

  const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(readDisclosureOpen(throwing), false);
  assert.doesNotThrow(() => writeDisclosureOpen(throwing, true));
  assert.equal(readDisclosureOpen(null), false);
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

test('Escape from a dialog or menu portal is handed back to the document so Radix can close it', () => {
  // Stopping the portal keydown hides it from Radix's document listener, and
  // letting it bubble lets the DS grid cell call preventDefault, which Radix
  // reads as "do not dismiss". The group re-dispatches it on the document.
  assert.equal(shouldRedispatchEscape('Escape', false), true);
  assert.equal(shouldRedispatchEscape('Escape', true), false);
  assert.equal(shouldRedispatchEscape('Tab', false), false);
});

test('focus after a mutation stays on the row, then the next, then the previous row', () => {
  const before = ['a', 'b', 'c'];
  assert.equal(pickFocusSessionId(before, ['a', 'b', 'c'], 'b'), 'b');
  assert.equal(pickFocusSessionId(before, ['a', 'c'], 'b'), 'c');
  assert.equal(pickFocusSessionId(before, ['a', 'b'], 'c'), 'b');
  assert.equal(pickFocusSessionId(before, [], 'b'), null);
  assert.equal(pickFocusSessionId([], ['x'], 'b'), 'x');
});

test('the table declares its column count per responsive tier (IA D1.7, I.1 item 10)', () => {
  assert.equal(DASHBOARD_TABLE_COLUMNS, 7);
  assert.equal(DASHBOARD_COMPACT_TABLE_COLUMNS, 5);
});

test('fetch errors expose their HTTP status for the 404 message', () => {
  assert.equal(getErrorStatus({ status: 404 }), 404);
  assert.equal(getErrorStatus({ response: { status: 500 } }), 500);
  assert.equal(getErrorStatus(new Error('x')), null);
});

test('the table hides IP address and Signed in when its own width is too narrow (1080-1280 with the main menu)', () => {
  // Below the DS large breakpoint the compact table is always used (IA D1).
  assert.equal(shouldUseCompactTable(1400, true), true);
  // With the Strapi main menu open, 1080 and 1280 px viewports leave 912 and
  // 1112 px for the list: the full table would squeeze User and Device to "…".
  assert.equal(FULL_TABLE_MIN_WIDTH, 1200);
  assert.equal(shouldUseCompactTable(912, false), true);
  assert.equal(shouldUseCompactTable(1112, false), true);
  assert.equal(shouldUseCompactTable(1272, false), false);
  // Unknown width (first render, no ResizeObserver): trust the breakpoint.
  assert.equal(shouldUseCompactTable(0, false), false);
  assert.equal(shouldUseCompactTable(undefined, false), false);
});
