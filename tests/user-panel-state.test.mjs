import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DASHBOARD_PATH,
  PANEL_SESSION_LIMIT,
  applyBlockedFormSync,
  buildUserSessionsHref,
  endOpenSessions,
  getPanelUserLabel,
  getUserSessionSummary,
  getVisiblePanelSessions,
  isNotFoundError,
  isUserModel,
  planBlockedFormSync,
} from '../admin/src/utils/userPanelState.mjs';

const at = (minutesAgo) => new Date(Date.UTC(2026, 10, 6, 12, 0) - minutesAgo * 60 * 1000).toISOString();

test('the panel only renders for the Users & Permissions user model', () => {
  assert.equal(isUserModel('plugin::users-permissions.user'), true);
  for (const model of ['api::article.article', 'admin::user', 'plugin::users-permissions.role', undefined, null]) {
    assert.equal(isUserModel(model), false, String(model));
  }
});

test('summary: online when any open session is active, open count covers active and idle (IA D3)', () => {
  assert.deepEqual(getUserSessionSummary([]), { isOnline: false, openCount: 0, activeCount: 0, lastActive: null });
  assert.deepEqual(getUserSessionSummary(null), { isOnline: false, openCount: 0, activeCount: 0, lastActive: null });

  const idleOnly = getUserSessionSummary([
    { isActive: true, isTrulyActive: false, lastActive: at(40) },
    { isActive: true, isTrulyActive: false, lastActive: at(50) },
  ]);
  assert.equal(idleOnly.isOnline, false, 'idle sessions alone are "Not online"');
  assert.equal(idleOnly.openCount, 2);

  const mixed = getUserSessionSummary([
    { isActive: true, isTrulyActive: true, lastActive: at(1) },
    { isActive: true, isTrulyActive: false, lastActive: at(40) },
    { isActive: false, isTrulyActive: true, lastActive: at(0) },
  ]);
  assert.equal(mixed.isOnline, true);
  assert.equal(mixed.openCount, 2, 'ended rows are not open');
  assert.equal(mixed.activeCount, 1);
});

test('"Last active" is the latest activity over every row the panel receives, ended ones included', () => {
  const summary = getUserSessionSummary([
    { isActive: true, isTrulyActive: false, lastActive: at(40) },
    { isActive: false, lastActive: at(5), terminationReason: 'logout' },
    { isActive: false, loginTime: at(90) },
    { isActive: false, lastActive: 'not-a-date' },
  ]);
  assert.equal(summary.lastActive?.toISOString(), at(5));
  assert.equal(summary.openCount, 1);
  assert.equal(getUserSessionSummary([{ isActive: false }]).lastActive, null, 'no valid time: "No sessions recorded"');
});

test('at most five open-session cards, newest activity first; the rest is counted for "+n more"', () => {
  assert.equal(PANEL_SESSION_LIMIT, 5);
  const rows = [3, 1, 7, 2, 6, 4, 5].map((minutes) => ({ id: `s${minutes}`, isActive: true, lastActive: at(minutes) }));
  const { visible, hiddenCount } = getVisiblePanelSessions(rows);
  assert.deepEqual(visible.map((row) => row.id), ['s1', 's2', 's3', 's4', 's5']);
  assert.equal(hiddenCount, 2);
  assert.equal(rows[0].id, 's3', 'the input order is not mutated');
  assert.deepEqual(getVisiblePanelSessions(undefined), { visible: [], hiddenCount: 0 });
  const undated = getVisiblePanelSessions([{ id: 'none' }, { id: 'dated', loginTime: at(9) }]);
  assert.deepEqual(undated.visible.map((row) => row.id), ['dated', 'none'], 'rows without a time go last');
});

test('ending all sessions locally keeps history and the last activity (no refetch, no unmount)', () => {
  const rows = [
    { id: 'open', isActive: true, isTrulyActive: true, lastActive: at(1) },
    { id: 'ended', isActive: false, terminationReason: 'logout', lastActive: at(30) },
  ];
  const ended = endOpenSessions(rows, 'blocked');
  assert.deepEqual(ended[0], { id: 'open', isActive: false, isTrulyActive: false, terminationReason: 'blocked', lastActive: at(1) });
  assert.equal(ended[1], rows[1], 'already ended rows are kept as they are');
  assert.equal(rows[0].isActive, true, 'the input is not mutated');
  assert.equal(getUserSessionSummary(ended).lastActive?.toISOString(), at(1));
  assert.deepEqual(endOpenSessions(null, 'manual'), []);
});

test('the user is named by user name, then e-mail', () => {
  assert.equal(getPanelUserLabel({ username: 'anna', email: 'anna@example.invalid' }), 'anna');
  assert.equal(getPanelUserLabel({ username: '  ', email: 'anna@example.invalid' }), 'anna@example.invalid');
  assert.equal(getPanelUserLabel({}), '');
  assert.equal(getPanelUserLabel(null), '');
});

test('a 404 from the admin fetch client is recognised for the "User not found." message', () => {
  assert.equal(isNotFoundError({ status: 404 }), true);
  assert.equal(isNotFoundError({ response: { status: 404 } }), true);
  assert.equal(isNotFoundError({ response: { status: 500 } }), false);
  assert.equal(isNotFoundError(new Error('x')), false);
  assert.equal(isNotFoundError(null), false);
});

test('"Show all sessions" links to the dashboard search with the e-mail (IA D3, C)', () => {
  assert.equal(DASHBOARD_PATH, '/plugins/magic-sessionmanager');
  assert.equal(
    buildUserSessionsHref({ email: 'anna+test@example.invalid', username: 'anna' }),
    '/plugins/magic-sessionmanager?search=anna%2Btest%40example.invalid'
  );
  assert.equal(buildUserSessionsHref({ email: '  ', username: 'carla' }), '/plugins/magic-sessionmanager?search=carla');
  assert.equal(buildUserSessionsHref({}), '/plugins/magic-sessionmanager');
  assert.equal(buildUserSessionsHref(null), '/plugins/magic-sessionmanager');
});

test('a clean edit form gets new initial values so it stays clean and saves the new blocked value', () => {
  const initialValues = { username: 'carla', confirmed: false, blocked: false };
  const plan = planBlockedFormSync({ initialValues, modified: false, blocked: true });
  assert.deepEqual(plan, { mode: 'reset', initialValues: { username: 'carla', confirmed: false, blocked: true } });
  assert.equal(initialValues.blocked, false, 'the current initial values are not mutated');

  const calls = [];
  assert.equal(applyBlockedFormSync(plan, { resetForm: (values) => calls.push(['reset', values]) }), true);
  assert.deepEqual(calls, [['reset', plan.initialValues]]);
});

test('a dirty edit form keeps its unsaved edits and only the blocked field changes', () => {
  const plan = planBlockedFormSync({ initialValues: { blocked: false, confirmed: false }, modified: true, blocked: true });
  assert.deepEqual(plan, { mode: 'change', field: 'blocked', value: true });

  const calls = [];
  assert.equal(applyBlockedFormSync(plan, { onChange: (...args) => calls.push(args) }), true);
  assert.deepEqual(calls, [['blocked', true]]);
});

test('without an edit form that has a blocked field the panel falls back to a reload notice', () => {
  for (const initialValues of [undefined, null, {}, { username: 'x' }, 'blocked']) {
    assert.deepEqual(planBlockedFormSync({ initialValues, modified: false, blocked: true }), { mode: 'notice' });
  }
  assert.deepEqual(planBlockedFormSync({ initialValues: { blocked: false }, modified: false, blocked: 'true' }), { mode: 'notice' });
  assert.equal(applyBlockedFormSync({ mode: 'notice' }, {}), false);
});

test('a throwing form API (Strapi default context) never breaks the panel', () => {
  const throwing = () => { throw new Error('useForm must be used within Form'); };
  assert.equal(applyBlockedFormSync({ mode: 'reset', initialValues: { blocked: true } }, { resetForm: throwing }), false);
  assert.equal(applyBlockedFormSync({ mode: 'change', field: 'blocked', value: true }, { onChange: throwing }), false);
  assert.equal(applyBlockedFormSync({ mode: 'change', field: 'blocked', value: true }, undefined), false);
});
