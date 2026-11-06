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
      status: 'ended',
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
  assert.deepEqual(
    result.sessions.map((session) => session.id),
    ['native-session-1', 'native-session-2']
  );
  assert.equal(result.sessions[0].ipAddress, 'Unavailable');
  assert.equal(result.sessions[0].device.type, 'Unavailable');
  assert.equal('accessToken' in result.sessions[0], false);
});

test('CSV export survives rows with missing or invalid timestamps', async () => {
  const { toIsoTimestamp } = await import('../admin/src/utils/sessionExports.mjs');
  assert.equal(toIsoTimestamp(undefined), '');
  assert.equal(toIsoTimestamp('not a date'), '');
  assert.equal(toIsoTimestamp('2026-10-15T10:00:00.000Z'), '2026-10-15T10:00:00.000Z');

  const csv = buildSessionCsv(
    [{ id: 'legacy', status: 'ended', user: {}, minutesSinceActive: undefined }],
    {
      unavailableValue: '',
      getDeviceInfo,
      getSessionStatus,
    }
  );
  const [, row] = csv.split('\n');
  assert.equal(row.split(',').length, 13);
  assert.doesNotMatch(row, /undefined|Invalid/);
});

test('CSV column names are stable machine identifiers, independent of the admin language (I18N-11)', async () => {
  const { CSV_HEADERS } = await import('../admin/src/utils/sessionExports.mjs');
  assert.ok(Object.isFrozen(CSV_HEADERS));
  assert.deepEqual(
    [...CSV_HEADERS],
    [
      'ID',
      'Status',
      'User Email',
      'Username',
      'Device',
      'Browser',
      'OS',
      'IP Address',
      'Login Time',
      'Last Active',
      'Logout Time',
      'Minutes Idle',
      'End Reason',
    ]
  );
  const csv = buildSessionCsv([], { unavailableValue: '', getDeviceInfo, getSessionStatus });
  assert.equal(csv, CSV_HEADERS.map((header) => `"${header}"`).join(','));
});

test('End Reason is an additive last column and a JSON field (decision I.2-4)', () => {
  const rows = [
    { id: 'open', status: 'active', isActive: true, user: {} },
    { id: 'timed-out', status: 'ended', isActive: false, terminationReason: 'idle', user: {} },
    {
      id: 'legacy',
      status: 'ended',
      isActive: false,
      logoutTime: '2026-01-01T00:00:00.000Z',
      user: {},
    },
  ];
  const csv = buildSessionCsv(rows, { unavailableValue: '', getDeviceInfo, getSessionStatus });
  const lines = csv.split('\n').map((line) => line.split(','));
  assert.equal(lines[0].at(-1), '"End Reason"');
  assert.deepEqual(
    lines.slice(1).map((cells) => cells.at(-1)),
    ['""', '"idle"', '"unrecorded"']
  );

  const json = JSON.parse(
    buildSessionJson(rows, {
      filterStatus: 'all',
      totalSessions: 3,
      exportedAt: '2026-11-06T12:00:00.000Z',
      unavailableValue: '',
      getDeviceInfo,
      getSessionStatus,
      truncated: true,
    })
  );
  assert.deepEqual(
    json.sessions.map((session) => session.endReason),
    [null, 'idle', 'unrecorded']
  );
  assert.equal(json.truncated, true, 'a truncated list says so in the file');
});

test('exports never contain token material', () => {
  const row = {
    id: 's',
    status: 'active',
    isActive: true,
    user: {},
    token: 'secret-token',
    tokenHash: 'h',
    refreshToken: 'r',
  };
  const json = buildSessionJson([row], {
    filterStatus: 'all',
    totalSessions: 1,
    exportedAt: 'x',
    unavailableValue: '',
    getDeviceInfo,
    getSessionStatus,
  });
  const csv = buildSessionCsv([row], { unavailableValue: '', getDeviceInfo, getSessionStatus });
  for (const output of [json, csv])
    assert.doesNotMatch(output, /secret-token|tokenHash|refreshToken/);
});
