import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const adminRoot = path.resolve(import.meta.dirname, '../admin/src');
const sensitiveValues = [
  'session-secret-token',
  'private@example.invalid',
  '198.51.100.23',
  'session-row-private-id',
  'license-key-private-value',
];

function listSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? listSourceFiles(absolutePath)
      : /\.(?:js|jsx|mjs|ts|tsx)$/.test(entry.name)
        ? [absolutePath]
        : [];
  });
}

test('safe admin error logging records only a bounded scope and HTTP status', async () => {
  const { logSafeAdminError } = await import('../admin/src/utils/safeAdminLog.mjs');
  const originalWarn = console.warn;
  const originalError = console.error;
  const calls = [];
  const errors = [];
  console.warn = (...args) => calls.push(args);
  console.error = (...args) => errors.push(args);

  try {
    logSafeAdminError('SessionInfoPanel.logoutAll', {
      message: sensitiveValues.join(' '),
      response: {
        status: 403,
        data: {
          email: sensitiveValues[1],
          ipAddress: sensitiveValues[2],
          token: sensitiveValues[0],
        },
      },
      config: { headers: { Authorization: `Bearer ${sensitiveValues[0]}` } },
    });
    logSafeAdminError('unsafe scope ' + sensitiveValues[1], { message: sensitiveValues.join(' ') });
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }

  const output = JSON.stringify(calls);
  for (const value of sensitiveValues) {
    assert.equal(output.includes(value), false, `console output must not contain ${value}`);
  }
  assert.deepEqual(calls, [
    ['[SessionInfoPanel.logoutAll] Request failed (HTTP 403)'],
    ['[admin] Request failed'],
  ]);
  assert.deepEqual(errors, [], 'handled request failures are warnings, never console errors');
});

test('safe admin logging reads the Strapi FetchError status and skips cancelled requests', async () => {
  const { isCancelledRequest, logSafeAdminError } =
    await import('../admin/src/utils/safeAdminLog.mjs');
  const originalWarn = console.warn;
  const originalError = console.error;
  const calls = [];
  console.warn = (...args) => calls.push(['warn', ...args]);
  console.error = (...args) => calls.push(['error', ...args]);

  // Strapi 5 FetchError: status on the error, response holds only { data }.
  const fetchError = Object.assign(new Error(sensitiveValues[0]), {
    name: 'FetchError',
    status: 500,
    response: { data: { error: { status: 500, message: sensitiveValues[1] } } },
  });
  const aborted = new DOMException('The operation was aborted.', 'AbortError');
  const timedOut = new DOMException('The operation timed out.', 'TimeoutError');
  const hostile = new Proxy(
    {},
    {
      get() {
        throw new Error('getter must not escape');
      },
    }
  );

  try {
    logSafeAdminError('dashboard.loadSessions', fetchError);
    logSafeAdminError('dashboard.loadSessions', aborted);
    logSafeAdminError('onlineUsers.loadSessions', timedOut);
    logSafeAdminError('onlineUsers.loadSessions', { name: 'CanceledError' });
    logSafeAdminError('dashboard.loadSessions', hostile);
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }

  assert.equal(isCancelledRequest(aborted), true);
  assert.equal(isCancelledRequest(timedOut), true);
  assert.equal(isCancelledRequest(fetchError), false);
  assert.equal(isCancelledRequest(null), false);
  assert.equal(isCancelledRequest(hostile), false);
  assert.deepEqual(calls, [
    ['warn', '[dashboard.loadSessions] Request failed (HTTP 500)'],
    ['warn', '[dashboard.loadSessions] Request failed'],
  ]);
});

test('dashboard and widget loads ignore requests aborted on unmount', () => {
  for (const file of ['pages/HomePage.jsx', 'components/OnlineUsersWidget.jsx']) {
    const source = readFileSync(path.join(adminRoot, file), 'utf8');
    assert.match(source, /import \{ isCancelledRequest, logSafeAdminError \}/, file);
    const catchBlock = source.slice(
      source.indexOf('loadSessions') - 400,
      source.indexOf('loadSessions')
    );
    assert.match(catchBlock, /isCancelledRequest\((err|error)\)\) return;/, file);
  }
});

test('admin UI sources send errors through the safe logger instead of raw console objects', () => {
  const unsafeFiles = listSourceFiles(adminRoot).filter((filePath) =>
    /console\.error\(/.test(readFileSync(filePath, 'utf8'))
  );

  assert.deepEqual(
    unsafeFiles.map((filePath) => path.relative(adminRoot, filePath)),
    [],
    'admin source must not print raw errors, request data, or unreviewed context'
  );
});
