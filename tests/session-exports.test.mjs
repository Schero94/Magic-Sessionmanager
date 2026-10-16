import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSessionCsv, buildSessionJson } from '../admin/src/utils/sessionExports.mjs';

const getSessionStatus = (session) => session.status;
const getDeviceInfo = (session, unavailableValue) => ({
  device: session.device || unavailableValue,
  browser: session.browser || unavailableValue,
  browserVersion: session.browserVersion || '',
  os: session.os || unavailableValue,
});

test('CSV export quotes values, escapes embedded quotes, and includes every supplied session', () => {
  const sessions = [
    {
      id: 'session-1',
      status: 'idle',
      user: { email: 'user,one@example.invalid', username: 'He said "yes"' },
      device: 'Mobile',
      browser: 'Test Browser',
      os: 'Test OS',
      ipAddress: '127.0.0.1',
      loginTime: '2026-10-15T10:00:00.000Z',
      lastActive: '2026-10-15T10:05:00.000Z',
      minutesSinceActive: 5,
    },
    {
      id: 'session-2',
      status: 'loggedout',
      user: { email: 'two@example.invalid', username: 'second' },
      device: 'Desktop',
      browser: 'Other',
      os: 'Linux',
      ipAddress: '127.0.0.2',
      loginTime: '2026-10-15T10:10:00.000Z',
      lastActive: '2026-10-15T10:15:00.000Z',
      minutesSinceActive: 5,
    },
  ];

  const csv = buildSessionCsv(sessions, {
    unavailableValue: 'Unavailable',
    getDeviceInfo,
    getSessionStatus,
  });

  assert.match(csv, /"user,one@example\.invalid"/);
  assert.match(csv, /"He said ""yes"""/);
  assert.match(csv, /"session-2"/);
  assert.equal(csv.split('\n').length, 3);
});

test('JSON export preserves the full filtered set and marks missing details unavailable', () => {
  const sessions = [
    {
      id: 'native-session-1',
      status: 'idle',
      user: { id: 'user-1', email: 'one@example.invalid', username: 'one' },
      loginTime: '2026-10-15T10:00:00.000Z',
      isActive: true,
      isTrulyActive: false,
    },
    {
      id: 'native-session-2',
      status: 'idle',
      user: { id: 'user-2', email: 'two@example.invalid', username: 'two' },
      loginTime: '2026-10-15T10:10:00.000Z',
      isActive: true,
      isTrulyActive: false,
    },
  ];

  const json = buildSessionJson(sessions, {
    filterStatus: 'idle',
    totalSessions: 22,
    exportedAt: '2026-10-15T12:00:00.000Z',
    unavailableValue: 'Unavailable',
    getDeviceInfo,
    getSessionStatus,
  });
  const result = JSON.parse(json);

  assert.equal(result.exportedSessions, 2);
  assert.equal(result.totalSessions, 22);
  assert.deepEqual(result.sessions.map((session) => session.id), ['native-session-1', 'native-session-2']);
  assert.equal(result.sessions[0].ipAddress, 'Unavailable');
  assert.equal(result.sessions[0].device.type, 'Unavailable');
  assert.equal('accessToken' in result.sessions[0], false);
});
