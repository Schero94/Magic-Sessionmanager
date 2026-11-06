import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_SESSION_FILTER,
  END_REASON_FILTER_OPTIONS,
  SESSION_FILTER_OPTIONS,
  filterSessionsBySearch,
  filterSessionsByStatus,
  getManageableSessions,
  isEndReasonFilter,
  isSessionFilter,
} from '../admin/src/utils/sessionFilters.mjs';

const activeSession = { id: 'active', isActive: true, isTrulyActive: true };
const idleSession = { id: 'idle', isActive: true, isTrulyActive: false };
const loggedOutSession = { id: 'logged-out', isActive: false, terminationReason: 'logout' };
const timedOutSession = { id: 'timed-out', isActive: false, terminationReason: 'idle' };
const manualSession = { id: 'manual', isActive: false, terminationReason: 'manual' };
const legacySession = { id: 'legacy', isActive: false, logoutTime: '2026-01-01T00:00:00.000Z' };
const sessions = [
  activeSession,
  idleSession,
  loggedOutSession,
  timedOutSession,
  manualSession,
  legacySession,
];

test('dashboard defaults to all sessions so idle and ended sessions stay visible', () => {
  assert.equal(DEFAULT_SESSION_FILTER, 'all');
  assert.deepEqual(filterSessionsByStatus(sessions, DEFAULT_SESSION_FILTER), sessions);
});

test('status filter: All sessions, Open, Active, Idle, Ended (IA D1.5)', () => {
  assert.deepEqual([...SESSION_FILTER_OPTIONS], ['all', 'open', 'active', 'idle', 'ended']);
  assert.deepEqual(filterSessionsByStatus(sessions, 'open'), [activeSession, idleSession]);
  assert.deepEqual(filterSessionsByStatus(sessions, 'active'), [activeSession]);
  // Idle means open sessions only; a session that timed out is Ended.
  assert.deepEqual(filterSessionsByStatus(sessions, 'idle'), [idleSession]);
  assert.deepEqual(filterSessionsByStatus(sessions, 'ended'), [
    loggedOutSession,
    timedOutSession,
    manualSession,
    legacySession,
  ]);
});

test('the End reason filter narrows ended sessions only', () => {
  assert.deepEqual(
    [...END_REASON_FILTER_OPTIONS],
    ['all', 'logout', 'idle', 'expired', 'manual', 'blocked', 'unrecorded']
  );
  assert.deepEqual(filterSessionsByStatus(sessions, 'ended', 'idle'), [timedOutSession]);
  assert.deepEqual(filterSessionsByStatus(sessions, 'ended', 'unrecorded'), [legacySession]);
  assert.deepEqual(
    filterSessionsByStatus(sessions, 'ended', 'all'),
    filterSessionsByStatus(sessions, 'ended')
  );
  // A reason without the Ended status is ignored rather than emptying the list.
  assert.deepEqual(filterSessionsByStatus(sessions, 'open', 'logout'), [
    activeSession,
    idleSession,
  ]);
  assert.deepEqual(
    filterSessionsByStatus(sessions, 'ended', 'bogus'),
    filterSessionsByStatus(sessions, 'ended')
  );
});

test('user panel keeps every current session, including idle native sessions', () => {
  assert.deepEqual(getManageableSessions(sessions), [activeSession, idleSession]);
});

test('status and reason filter values from the URL are validated', () => {
  assert.equal(isSessionFilter('idle'), true);
  assert.equal(isSessionFilter('open'), true);
  assert.equal(isSessionFilter('terminated'), false);
  assert.equal(isSessionFilter('online'), false);
  assert.equal(isSessionFilter(undefined), false);
  assert.equal(isEndReasonFilter('unrecorded'), true);
  assert.equal(isEndReasonFilter('other'), false);
  assert.deepEqual(
    filterSessionsByStatus(sessions, 'terminated'),
    [],
    'unknown status never broadens the list'
  );
});

test('search matches user, IP, browser, OS, device type and translated extra text', () => {
  const mac = {
    id: 'mac',
    user: { username: 'anna', email: 'anna@example.test' },
    ipAddress: '192.0.2.10',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  };
  const phone = {
    id: 'phone',
    user: { email: 'ben@example.test' },
    deviceType: 'mobile',
    osName: 'unknown',
  };
  const rows = [mac, phone];

  assert.deepEqual(filterSessionsBySearch(rows, ''), rows);
  assert.deepEqual(filterSessionsBySearch(rows, 'ANNA'), [mac]);
  assert.deepEqual(filterSessionsBySearch(rows, '192.0.2'), [mac]);
  assert.deepEqual(filterSessionsBySearch(rows, 'safari'), [mac]);
  assert.deepEqual(filterSessionsBySearch(rows, 'macos'), [mac]);
  assert.deepEqual(filterSessionsBySearch(rows, 'mobile'), [phone]);
  assert.deepEqual(
    filterSessionsBySearch(rows, 'ben@example.test'),
    [phone],
    'the panel link searches by e-mail'
  );
  // The literal placeholder "unknown" is not searchable data.
  assert.deepEqual(filterSessionsBySearch(rows, 'unknown'), []);
  assert.deepEqual(
    filterSessionsBySearch(rows, 'mobilgerät', (session) =>
      session.id === 'phone' ? 'Mobilgerät' : 'Desktop'
    ),
    [phone]
  );
  assert.deepEqual(filterSessionsBySearch(null, 'x'), []);
});
