import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const panel = readFileSync(new URL('../admin/src/components/SessionInfoPanel.jsx', import.meta.url), 'utf8');

const between = (start, end) => {
  const from = panel.indexOf(start);
  assert.notEqual(from, -1, `expected ${start}`);
  const to = panel.indexOf(end, from);
  assert.notEqual(to, -1, `expected ${end}`);
  return panel.slice(from, to);
};

test('panel renders nothing for other models and checks the plugin permission', () => {
  const guard = panel.indexOf('if (!isUserPanel) {');
  assert.ok(guard > 0);
  assert.match(panel.slice(guard, guard + 60), /return null;/);
  assert.match(panel, /useRBAC\(pluginPermissions\.access\)/);
});

test('both actions use ConfirmAction, never window.confirm (UX-05)', () => {
  assert.doesNotMatch(panel, /\bconfirm\(/);
  assert.equal((panel.match(/<ConfirmAction\b/g) || []).length, 2);
  assert.match(panel, /onConfirm=\{handleLogoutAll\}/);
  assert.match(panel, /onConfirm=\{handleToggleBlock\}/);
  assert.match(panel, /fallbackFocusRef=\{panelRef\}/, 'focus has a target when the trigger disappears');
});

test('each action shows its own spinner and both are blocked while one runs (UX-13)', () => {
  assert.match(panel, /loading=\{pendingAction === 'logoutAll'\}/);
  assert.match(panel, /loading=\{pendingAction === 'toggleBlock'\}/);
  assert.doesNotMatch(panel, /actionLoading/);
  assert.equal((panel.match(/<Button\s+fullWidth\s+size="M"/g) || []).length, 2, 'equal-height full-width buttons');
});

test('failed actions notify and keep the dialog open for a retry', () => {
  for (const handler of ['handleLogoutAll', 'handleToggleBlock']) {
    const source = between(`const ${handler} = async () => {`, '\n  };');
    assert.match(source, /toggleNotification\(\{\s*type: 'danger'/);
    assert.match(source, /logSafeAdminError\(/);
    assert.match(source, /throw error;/);
    assert.match(source, /setPendingAction\(null\)/);
  }
});

test('block/unblock writes the new value into the open edit form (F1, UX-04)', () => {
  assert.match(panel, /import \{[^}]*\buseForm\b[^}]*\} from '@strapi\/strapi\/admin'/);
  for (const selector of ['initialValues', 'modified', 'onChange', 'resetForm']) {
    assert.match(panel, new RegExp(`useForm\\(FORM_CONSUMER, \\(state\\) => state\\.${selector}, false\\)`), selector);
  }
  const handler = between('const handleToggleBlock = async () => {', '\n  };');
  assert.ok(handler.indexOf('requireSuccessfulMutation') < handler.indexOf('planBlockedFormSync'), 'only a confirmed change is synced');
  assert.match(handler, /applyBlockedFormSync\(plan, \{ resetForm: formResetForm, onChange: formOnChange \}\)/);
  assert.match(handler, /setFormOutOfSync\(!synced\)/);
  assert.match(panel, /\{formOutOfSync \? \(\s*<Alert\s+variant="warning"/, 'missing form context shows a reload notice');
});

test('session cards translate the device, use a decorative icon and no contradicting status (UX-03, F2, F3)', () => {
  assert.match(panel, /getDevicePresentation\(session\)/);
  assert.match(panel, /translate\(device\.deviceTypeMessage\)/);
  assert.match(panel, /<DeviceIcon icon=\{device\.icon\} \/>/);
  assert.match(panel, /<StatusBadge session=\{session\} size="S" \/>/);
  assert.doesNotMatch(panel, /textColor="success600"/);
  assert.doesNotMatch(panel, /panel\.sessions\.(active|idle|activeAgo|activeNow)'/);
  assert.match(panel, /panel\.sessions\.lastActive/);
  assert.doesNotMatch(panel, /deviceType === 'Mobile'|getDeviceIcon/);
  assert.doesNotMatch(panel, /Unavailable on|unavailableValue/);
});

test('at most five sessions are shown with a "Show all" link to the filtered dashboard', () => {
  assert.match(panel, /getVisiblePanelSessions\(sessions\)/);
  assert.match(panel, /<Link tag=\{NavLink\} to=\{buildUserSessionsHref\(document\)\}>/);
  assert.match(panel, /panel\.sessions\.showAll/);
});

test('panel summary uses the shared StatusBadge and a translated count', () => {
  const summary = between('{/* Summary */}', '{isBlocked ?');
  assert.match(summary, /<StatusBadge status=\{summary\.status\} \/>/);
  assert.match(summary, /panel\.sessions\.currentCount/);
  assert.match(summary, /panel\.status\.offline/);
});

test('panel uses DS tokens and shared blocks instead of hand-made styled boxes (UX-11, F11)', () => {
  assert.doesNotMatch(panel, /from 'styled-components'/);
  assert.doesNotMatch(panel, /\d+px/);
  assert.doesNotMatch(panel, /textColor="neutral500"/);
  assert.match(panel, /<Loader small>/);
  assert.match(panel, /from '\.\/ui'/);
});

test('error state keys are used (UX-01, I18N-2)', () => {
  assert.match(panel, /panel\.error\.title/);
  assert.match(panel, /panel\.error\.description/);
});

test('the unregistered SessionInfoCard is removed (UX-15, I18N-13)', () => {
  assert.equal(existsSync(new URL('../admin/src/components/SessionInfoCard.jsx', import.meta.url)), false);
  const barrel = readFileSync(new URL('../admin/src/components/index.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(barrel, /SessionInfoCard/);
});
