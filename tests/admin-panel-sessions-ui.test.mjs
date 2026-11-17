import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildAdminListParams,
  getAdminStatusPresentation,
  getSignOutErrorMessage,
  hasAdminFilters,
  parseAdminPanelQuery,
  splitDuration,
} from '../admin/src/pages/AdminPanel/adminPanelModel.mjs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('URL state falls back to safe defaults and decodes the search', () => {
  assert.deepEqual(parseAdminPanelQuery({}), {
    page: 1,
    pageSize: 25,
    filter: 'all',
    search: '',
  });
  assert.deepEqual(
    parseAdminPanelQuery({
      page: '3',
      pageSize: '50',
      filter: 'signed-in',
      search: 'ada%40example',
    }),
    { page: 3, pageSize: 50, filter: 'signed-in', search: 'ada@example' }
  );
  assert.deepEqual(
    parseAdminPanelQuery({ page: '-2', pageSize: '7', filter: 'x', search: '%E0' }),
    {
      page: 1,
      pageSize: 25,
      filter: 'all',
      search: '%E0',
    }
  );
  assert.equal(parseAdminPanelQuery({ search: 'x'.repeat(150) }).search.length, 100);
  assert.deepEqual(buildAdminListParams({ page: 1, pageSize: 25, filter: 'all', search: '' }), {
    page: 1,
    pageSize: 25,
    filter: 'all',
  });
  assert.equal(hasAdminFilters({ filter: 'all', search: '' }), false);
  assert.equal(hasAdminFilters({ filter: 'not-signed-in', search: '' }), true);
});

test('each admin state has its own label; danger is never used for a state', () => {
  const keys = [
    { account: 'active', sessionCount: 2 },
    { account: 'active', sessionCount: 0 },
    { account: 'deactivated', sessionCount: 0 },
    { account: 'invited', sessionCount: 0 },
  ].map((row) => getAdminStatusPresentation(row));
  assert.deepEqual(
    keys.map((entry) => entry.key),
    ['signed-in', 'not-signed-in', 'deactivated', 'invited']
  );
  assert.ok(keys.every((entry) => entry.tone !== 'danger'));
  assert.deepEqual(keys[0].detail.values, { count: 2 });
});

test('durations use the largest whole unit', () => {
  assert.deepEqual(splitDuration(7200), { unit: 'hours', count: 2 });
  assert.deepEqual(splitDuration(1209600), { unit: 'days', count: 14 });
  assert.deepEqual(splitDuration(1800), { unit: 'minutes', count: 30 });
  assert.equal(splitDuration(0), null);
  assert.equal(splitDuration('x'), null);
});

test('sign-out errors map to honest messages', () => {
  const fetchError = (status, reason) => ({
    response: { status, data: { error: { details: reason ? { reason } : {} } } },
  });
  assert.equal(
    getSignOutErrorMessage(fetchError(403, 'super-admin-protected')).messageId,
    'adminPanel.signOut.error.protected'
  );
  assert.equal(
    getSignOutErrorMessage(fetchError(403)).messageId,
    'adminPanel.signOut.error.forbidden'
  );
  assert.equal(getSignOutErrorMessage(fetchError(404)).messageId, 'adminPanel.signOut.error.gone');
  assert.equal(
    getSignOutErrorMessage(fetchError(429)).messageId,
    'adminPanel.signOut.error.rateLimited'
  );
  assert.equal(
    getSignOutErrorMessage(new Error('x')).messageId,
    'adminPanel.signOut.error.generic'
  );
});

test('the admin panel view is its own protected route; the dashboard is unchanged for other roles', () => {
  const app = read('admin/src/pages/App.jsx');
  assert.match(app, /<Route index element=\{<HomePage \/>\} \/>/);
  assert.match(
    app,
    /path="admin-panel"[\s\S]*?<Page\.Protect permissions=\{pluginPermissions\.adminSessionsRead\}>/
  );
  assert.match(app, /<Route path="\*" element=\{<HomePage \/>\} \/>/);
  const nav = read('admin/src/components/SessionViewNav.jsx');
  assert.match(nav, /useRBAC\(pluginPermissions\.adminSessionsRead\)/);
  assert.match(nav, /if \(isLoading \|\| \(!canRead && current !== 'admins'\)\) return null;/);
  assert.match(nav, /<ViewNav aria-label=/);
  const permissions = read('admin/src/permissions.js');
  assert.match(permissions, /admin-sessions\.read/);
  assert.match(permissions, /admin-sessions\.revoke/);
});

test('sign-out is confirmed, honest about timing, and warns before a self sign-out', () => {
  const page = read('admin/src/pages/AdminPanel/index.jsx');
  assert.match(page, /<ConfirmAction\b/);
  assert.doesNotMatch(page, /window\.confirm/);
  assert.match(page, /on their next click in the admin panel/);
  assert.match(page, /They can sign in again with their password/);
  assert.match(page, /'adminPanel\.confirm\.self\.warning'/);
  assert.match(page, /useRBAC\(pluginPermissions\.adminSessionsRevoke\)/);
  assert.match(page, /to=\{SETTINGS_USERS_PATH\}/);
  const list = read('admin/src/pages/AdminPanel/AdminList.jsx');
  assert.match(list, /canRevoke && admin\.canSignOut \?/);
  assert.match(list, /colCount=\{5\}\s+rowCount=\{admins\.length \+ 1\}/);
  const modal = read('admin/src/pages/AdminPanel/AdminSessionsModal.jsx');
  assert.match(modal, /<Modal\.Title>/);
  assert.match(modal, /`\/settings\/users\/\$\{admin\.id\}`/);
});
