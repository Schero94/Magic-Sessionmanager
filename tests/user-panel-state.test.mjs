import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DASHBOARD_PATH,
  PANEL_SESSION_LIMIT,
  applyBlockedFormSync,
  buildUserSessionsHref,
  getUserSessionSummary,
  getVisiblePanelSessions,
  isUserModel,
  planBlockedFormSync,
} from '../admin/src/utils/userPanelState.mjs';

test('the panel only renders for the Users & Permissions user model', () => {
  assert.equal(isUserModel('plugin::users-permissions.user'), true);
  for (const model of ['api::article.article', 'admin::user', 'plugin::users-permissions.role', undefined, null]) {
    assert.equal(isUserModel(model), false, String(model));
  }
});

test('user summary is active, idle or none and counts current sessions', () => {
  assert.deepEqual(getUserSessionSummary([]), { status: 'none', currentCount: 0, activeCount: 0 });
  assert.deepEqual(getUserSessionSummary(null), { status: 'none', currentCount: 0, activeCount: 0 });
  assert.deepEqual(
    getUserSessionSummary([{ isActive: true, isTrulyActive: false }, { isActive: true, isTrulyActive: false }]),
    { status: 'idle', currentCount: 2, activeCount: 0 }
  );
  assert.deepEqual(
    getUserSessionSummary([{ isActive: true, isTrulyActive: true }, { isActive: true, isTrulyActive: false }]),
    { status: 'active', currentCount: 2, activeCount: 1 }
  );
});

test('at most five session cards are shown; the rest is counted for "Show all"', () => {
  assert.equal(PANEL_SESSION_LIMIT, 5);
  const rows = Array.from({ length: 7 }, (_, index) => ({ id: `s${index}` }));
  const { visible, hiddenCount } = getVisiblePanelSessions(rows);
  assert.equal(visible.length, 5);
  assert.equal(hiddenCount, 2);
  assert.deepEqual(getVisiblePanelSessions(rows.slice(0, 3)), { visible: rows.slice(0, 3), hiddenCount: 0 });
  assert.deepEqual(getVisiblePanelSessions(undefined), { visible: [], hiddenCount: 0 });
});

test('"Show all" links to the dashboard filtered by the user through the standard _q parameter', () => {
  assert.equal(DASHBOARD_PATH, '/plugins/magic-sessionmanager');
  assert.equal(
    buildUserSessionsHref({ email: 'anna+test@example.invalid', username: 'anna' }),
    '/plugins/magic-sessionmanager?_q=anna%2Btest%40example.invalid'
  );
  assert.equal(buildUserSessionsHref({ email: '  ', username: 'carla' }), '/plugins/magic-sessionmanager?_q=carla');
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
