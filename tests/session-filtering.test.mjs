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
