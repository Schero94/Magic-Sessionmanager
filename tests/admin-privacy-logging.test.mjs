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
  const originalError = console.error;
  const calls = [];
  console.error = (...args) => calls.push(args);

  try {
    logSafeAdminError('SessionInfoPanel.logoutAll', {
      message: sensitiveValues.join(' '),
      response: {
        status: 403,
        data: { email: sensitiveValues[1], ipAddress: sensitiveValues[2], token: sensitiveValues[0] },
      },
      config: { headers: { Authorization: `Bearer ${sensitiveValues[0]}` } },
    });
    logSafeAdminError('unsafe scope ' + sensitiveValues[1], { message: sensitiveValues.join(' ') });
  } finally {
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
});

test('admin UI sources send errors through the safe logger instead of raw console objects', () => {
  const unsafeFiles = listSourceFiles(adminRoot)
    .filter((filePath) => path.basename(filePath) !== 'safeAdminLog.mjs')
    .filter((filePath) => /console\.error\(/.test(readFileSync(filePath, 'utf8')));

  assert.deepEqual(
    unsafeFiles.map((filePath) => path.relative(adminRoot, filePath)),
    [],
    'admin source must not print raw errors, request data, or unreviewed context'
  );
});
