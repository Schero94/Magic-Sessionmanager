import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_SESSION_FILTER,
  filterSessionsByStatus,
  getManageableSessions,
} from '../admin/src/utils/sessionFilters.mjs';

const activeSession = { id: 'active', isActive: true, isTrulyActive: true };
const idleSession = { id: 'idle', isActive: true, isTrulyActive: false };
const loggedOutSession = { id: 'logged-out', isActive: false, terminationReason: 'logout' };

test('dashboard defaults to all sessions so valid idle sessions stay visible', () => {
  const sessions = [activeSession, idleSession, loggedOutSession];

  assert.equal(DEFAULT_SESSION_FILTER, 'all');
  assert.deepEqual(filterSessionsByStatus(sessions, DEFAULT_SESSION_FILTER), sessions);
});

test('status filters distinguish online, idle, logged-out and terminated sessions', () => {
  const sessions = [
    activeSession,
    idleSession,
    loggedOutSession,
    { id: 'terminated', isActive: false, terminationReason: 'manual' },
  ];

  assert.deepEqual(filterSessionsByStatus(sessions, 'active'), [activeSession]);
  assert.deepEqual(filterSessionsByStatus(sessions, 'idle'), [idleSession]);
  assert.deepEqual(filterSessionsByStatus(sessions, 'loggedout'), [loggedOutSession]);
  assert.deepEqual(filterSessionsByStatus(sessions, 'terminated'), [sessions[3]]);
});

test('user panel keeps every current session, including idle native sessions', () => {
  const sessions = [
    activeSession,
    idleSession,
    loggedOutSession,
    { id: 'terminated', isActive: false, terminationReason: 'manual' },
  ];

  assert.deepEqual(getManageableSessions(sessions), [activeSession, idleSession]);
});

test('status filter values from the URL are validated', async () => {
  const { isSessionFilter, SESSION_FILTER_OPTIONS } = await import('../admin/src/utils/sessionFilters.mjs');
  assert.deepEqual([...SESSION_FILTER_OPTIONS], ['all', 'active', 'idle', 'loggedout', 'terminated']);
  assert.equal(isSessionFilter('idle'), true);
  assert.equal(isSessionFilter('online'), false);
  assert.equal(isSessionFilter(undefined), false);
});

test('search matches user, IP, browser, OS, device type and translated extra text', async () => {
  const { filterSessionsBySearch } = await import('../admin/src/utils/sessionFilters.mjs');
  const mac = {
    id: 'mac',
    user: { username: 'anna', email: 'anna@example.test' },
    ipAddress: '192.0.2.10',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  };
  const phone = { id: 'phone', user: { email: 'ben@example.test' }, deviceType: 'mobile', osName: 'unknown' };
  const sessions = [mac, phone];

  assert.deepEqual(filterSessionsBySearch(sessions, ''), sessions);
  assert.deepEqual(filterSessionsBySearch(sessions, 'ANNA'), [mac]);
  assert.deepEqual(filterSessionsBySearch(sessions, '192.0.2'), [mac]);
  assert.deepEqual(filterSessionsBySearch(sessions, 'safari'), [mac]);
  assert.deepEqual(filterSessionsBySearch(sessions, 'macos'), [mac]);
  assert.deepEqual(filterSessionsBySearch(sessions, 'mobile'), [phone]);
  // The literal placeholder "unknown" is not searchable data.
  assert.deepEqual(filterSessionsBySearch(sessions, 'unknown'), []);
  assert.deepEqual(
    filterSessionsBySearch(sessions, 'mobilgerät', (session) => (session.id === 'phone' ? 'Mobilgerät' : 'Desktop')),
    [phone]
  );
  assert.deepEqual(filterSessionsBySearch(null, 'x'), []);
});
