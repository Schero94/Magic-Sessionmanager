import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SESSION_END_REASONS,
  SESSION_END_REASON_PRESENTATION,
  SESSION_STATUSES,
  SESSION_STATUS_PRESENTATION,
  getEndReasonPresentation,
  getSessionEndReason,
  getSessionEndReasonPresentation,
  getSessionState,
  getSessionStatus,
  getSessionStatusPresentation,
  isEndedSessionStatus,
  isNativeOnlySession,
} from '../admin/src/utils/sessionStatus.mjs';

const now = new Date().toISOString();

test('IA B.1: open rows are active or idle, every closed row is ended', () => {
  assert.equal(getSessionStatus({ isActive: true, isTrulyActive: true }), 'active');
  assert.equal(getSessionStatus({ isActive: true, isTrulyActive: false }), 'idle');
  for (const terminationReason of ['logout', 'manual', 'idle', 'expired', 'blocked', undefined]) {
    assert.equal(getSessionStatus({ isActive: false, terminationReason, logoutTime: now }), 'ended', String(terminationReason));
  }
  assert.equal(getSessionState({ isActive: false }), 'ended');
});

test('a session ended by inactivity is Ended · Timed out, never Idle and never red (I.1 item 1)', () => {
  const timedOut = { isActive: false, terminationReason: 'idle', logoutTime: now };
  assert.equal(getSessionStatus(timedOut), 'ended');
  assert.equal(getSessionEndReason(timedOut), 'idle');
  assert.equal(getSessionStatusPresentation(timedOut).tone, 'neutral');
  assert.equal(getSessionEndReasonPresentation(timedOut).defaultMessage, 'Timed out');
});

test('rows without a reason are "Reason not recorded", even with an end time (decision I.2-1)', () => {
  assert.equal(getSessionEndReason({ isActive: false, logoutTime: '2026-01-01' }), 'unrecorded');
  assert.equal(getSessionEndReason({ isActive: false }), 'unrecorded');
  assert.equal(getSessionEndReason({ isActive: false, terminationReason: 'something-new' }), 'unrecorded');
  assert.equal(getSessionEndReason({ isActive: false, terminationReason: 'Manual' }), 'manual');
});

test('legacy null rows do not crash', () => {
  assert.equal(getSessionStatus(null), 'ended');
  assert.equal(getSessionEndReason(null), 'unrecorded');
});

test('three states map to success, warning and neutral; danger is never a state colour', () => {
  assert.deepEqual([...SESSION_STATUSES], ['active', 'idle', 'ended']);
  assert.deepEqual(
    Object.fromEntries(SESSION_STATUSES.map((status) => [status, SESSION_STATUS_PRESENTATION[status].tone])),
    { active: 'success', idle: 'warning', ended: 'neutral' }
  );
  for (const status of SESSION_STATUSES) {
    const presentation = SESSION_STATUS_PRESENTATION[status];
    assert.match(presentation.messageId, /^common\.status\./);
    assert.match(presentation.definition.messageId, /^common\.status\.\w+\.definition$/);
  }
  assert.deepEqual(
    SESSION_STATUSES.map((status) => SESSION_STATUS_PRESENTATION[status].defaultMessage),
    ['Active', 'Idle', 'Ended']
  );
  assert.equal(getSessionStatusPresentation('bogus').status, 'ended', 'unknown values never render an empty badge');
  assert.equal(getSessionStatusPresentation('bogus').tone, 'neutral');
  assert.equal(isEndedSessionStatus('ended'), true);
  assert.equal(isEndedSessionStatus('idle'), false);
  assert.equal(
    SESSION_STATUS_PRESENTATION.idle.help.defaultMessage,
    'Still open. It ends on its next request or at the next idle check. A token refresh makes it active again.'
  );
});

test('EndReason vocabulary follows IA A.4 with a definition per reason (I.1 item 2)', () => {
  assert.deepEqual([...SESSION_END_REASONS], ['logout', 'idle', 'expired', 'manual', 'blocked', 'unrecorded']);
  assert.deepEqual(
    SESSION_END_REASONS.map((reason) => SESSION_END_REASON_PRESENTATION[reason].defaultMessage),
    ['Logged out', 'Timed out', 'Expired', 'Ended manually', 'User blocked', 'Reason not recorded']
  );
  for (const reason of SESSION_END_REASONS) {
    const presentation = getEndReasonPresentation(reason);
    assert.equal(presentation.messageId, `common.endReason.${reason}`);
    assert.equal(presentation.description.messageId, `common.endReason.${reason}.description`);
  }
  assert.equal(getEndReasonPresentation('bogus').reason, 'unrecorded');
});

test('end reasons are absent for open sessions', () => {
  assert.equal(getSessionEndReason({ isActive: true }), null);
  assert.equal(getSessionEndReasonPresentation({ isActive: true, isTrulyActive: false }), null);
});

test('native-only rows are recognised by their native_ id', () => {
  assert.equal(isNativeOnlySession({ id: 'native_abc' }), true);
  assert.equal(isNativeOnlySession({ id: 'doc123' }), false);
  assert.equal(isNativeOnlySession(null), false);
});
