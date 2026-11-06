import assert from 'node:assert/strict';
import test from 'node:test';

import * as onlineStats from '../admin/src/utils/onlineStats.mjs';

const { getSessionUserKey, normalizeUserCounts } = onlineStats;

test('one user key de-duplicates concurrent sessions without exposing secrets', () => {
  assert.equal(getSessionUserKey({ user: { documentId: 'doc', id: 1, email: 'a@example.invalid' } }), 'doc');
  assert.equal(getSessionUserKey({ user: { id: 7 } }), 7);
  assert.equal(getSessionUserKey({ user: { email: 'a@example.invalid' } }), 'a@example.invalid');
  assert.equal(getSessionUserKey({ user: { username: 'anna' } }), 'anna');
  assert.equal(getSessionUserKey({}), null);
  assert.equal(getSessionUserKey(null), null);
});

test('the retired 15/30-minute online buckets are gone (IA I.2-2)', () => {
  assert.equal('computeOnlineUserStats' in onlineStats, false);
});

test('count-only API response preserves real zero counts and rejects malformed totals', () => {
  assert.deepEqual(
    normalizeUserCounts({ success: true, data: { totalUsers: 0, blockedUsers: 0 } }),
    { totalUsers: 0, blockedUsers: 0 }
  );
  assert.deepEqual(
    normalizeUserCounts({ success: true, data: { totalUsers: 12, blockedUsers: 2 } }),
    { totalUsers: 12, blockedUsers: 2 }
  );
  assert.equal(normalizeUserCounts({ success: true, data: { totalUsers: 3, blockedUsers: 4 } }), null);
  assert.equal(normalizeUserCounts({ success: false, data: { totalUsers: 0, blockedUsers: 0 } }), null);
  assert.equal(normalizeUserCounts({ success: true, data: { totalUsers: -1, blockedUsers: 0 } }), null);
  assert.equal(normalizeUserCounts({ success: true, data: { totalUsers: '3', blockedUsers: 0 } }), null);
  assert.equal(normalizeUserCounts(undefined), null);
});
