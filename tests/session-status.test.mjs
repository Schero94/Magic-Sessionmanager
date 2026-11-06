import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SESSION_STATUSES,
  SESSION_STATUS_PRESENTATION,
  getSessionEndReason,
  getSessionEndReasonPresentation,
  getSessionStatus,
  getSessionStatusPresentation,
  isEndedSessionStatus,
} from '../admin/src/utils/sessionStatus.mjs';

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
  // DUX-12: a session ended by the inactivity timeout is no longer usable, so it
  // must not share the "idle" label with sessions that can still be refreshed.
  assert.equal(getSessionStatus({
    isActive: false,
    terminationReason: 'idle',
    logoutTime: new Date().toISOString(),
  }), 'terminated');
  assert.equal(getSessionEndReason({ isActive: false, terminationReason: 'idle' }), 'idle');
});

test('legacy inactive rows remain classified without crashing', () => {
  assert.equal(getSessionStatus({ isActive: false, logoutTime: '2026-01-01' }), 'loggedout');
  assert.equal(getSessionStatus({ isActive: false }), 'terminated');
});

test('legacy null rows do not crash', () => {
  assert.equal(getSessionStatus(null), 'terminated');
  assert.equal(getSessionEndReason(null), 'other');
});

test('one status vocabulary maps every status to a semantic tone and message', () => {
  assert.deepEqual([...SESSION_STATUSES], ['active', 'idle', 'loggedout', 'terminated']);
  assert.deepEqual(
    Object.fromEntries(SESSION_STATUSES.map((status) => [status, SESSION_STATUS_PRESENTATION[status].tone])),
    { active: 'success', idle: 'warning', loggedout: 'neutral', terminated: 'danger' }
  );
  for (const status of SESSION_STATUSES) {
    assert.match(SESSION_STATUS_PRESENTATION[status].messageId, /^common\.status\./);
  }
  assert.equal(getSessionStatusPresentation({ isActive: true, isTrulyActive: true }).tone, 'success');
  assert.equal(getSessionStatusPresentation('loggedout').defaultMessage, 'Logged out');
  assert.equal(getSessionStatusPresentation('bogus').status, 'terminated', 'unknown values never render an empty badge');
  assert.equal(isEndedSessionStatus('loggedout'), true);
  assert.equal(isEndedSessionStatus('idle'), false);
});

test('end reasons explain ended sessions and are absent for valid ones', () => {
  assert.equal(getSessionEndReason({ isActive: true }), null);
  assert.equal(getSessionEndReasonPresentation({ isActive: true, isTrulyActive: false }), null);
  assert.equal(getSessionEndReason({ isActive: false, terminationReason: 'Manual' }), 'manual');
  assert.equal(getSessionEndReason({ isActive: false, terminationReason: 'expired' }), 'expired');
  assert.equal(getSessionEndReason({ isActive: false, terminationReason: 'something-new' }), 'other');
  assert.equal(getSessionEndReason({ isActive: false, logoutTime: '2026-01-01' }), 'logout');
  assert.equal(
    getSessionEndReasonPresentation({ isActive: false, terminationReason: 'idle' }).messageId,
    'common.endReason.idle'
  );
});
