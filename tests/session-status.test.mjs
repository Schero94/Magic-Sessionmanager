import assert from 'node:assert/strict';
import test from 'node:test';

import { getSessionStatus } from '../admin/src/utils/sessionStatus.mjs';

test('session status uses termination reason instead of logoutTime presence', () => {
  assert.equal(getSessionStatus({ isActive: true, isTrulyActive: true }), 'active');
  assert.equal(getSessionStatus({ isActive: true, isTrulyActive: false }), 'idle');
  assert.equal(getSessionStatus({
    isActive: false,
    terminationReason: 'logout',
    logoutTime: new Date().toISOString(),
  }), 'loggedout');
  assert.equal(getSessionStatus({
    isActive: false,
    terminationReason: 'manual',
    logoutTime: new Date().toISOString(),
  }), 'terminated');
  assert.equal(getSessionStatus({
    isActive: false,
    terminationReason: 'idle',
    logoutTime: new Date().toISOString(),
  }), 'idle');
});

test('legacy inactive rows remain classified without crashing', () => {
  assert.equal(getSessionStatus({ isActive: false, logoutTime: '2026-01-01' }), 'loggedout');
  assert.equal(getSessionStatus({ isActive: false }), 'terminated');
});
