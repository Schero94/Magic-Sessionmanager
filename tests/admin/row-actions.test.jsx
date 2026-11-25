/**
 * Row action spacing: the icon buttons at the end of a table row are separate actions, so they
 * sit apart like in Strapi's own list views (Flex with gap 1 = 4 px, Settings > Webhooks) instead
 * of being joined into one segmented IconButtonGroup.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { renderStrict } from './harness/index.jsx';
import { AdminTable } from '../../admin/src/pages/AdminPanel/AdminList';
import SessionActions from '../../admin/src/pages/Dashboard/SessionActions';

const ADMIN = {
  id: 3,
  name: 'Anna Beispiel',
  email: 'anna.beispiel@example.test',
  roles: [{ name: 'Editor', superAdmin: false }],
  account: 'active',
  self: false,
  sessionCount: 1,
  lastActiveAt: new Date().toISOString(),
  canSignOut: true,
  protectedReason: null,
};

/**
 * Asserts that the buttons of a row action container are spaced, not joined.
 * @param {Element} container - The `[data-row-actions]` element.
 * @param {number} buttons - Expected number of buttons.
 */
const assertSpaced = (container, buttons) => {
  assert.ok(container, 'row actions container exists');
  const style = window.getComputedStyle(container);
  assert.equal(style.display, 'flex');
  assert.equal(style.gap, '4px', 'actions are 4 px apart like native Strapi tables');
  assert.equal(container.querySelectorAll(':scope > button, :scope > a').length >= buttons, true);
};

test('admin panel table: view and end-sessions actions are spaced, not grouped', async () => {
  const handle = await renderStrict(
    <AdminTable
      admins={[ADMIN]}
      labelledBy="caption"
      canRevoke
      onView={() => {}}
      onSignOutEverywhere={() => {}}
    />
  );
  try {
    const container = document.querySelector('[data-admin-row="3"] [data-row-actions]');
    assertSpaced(container, 2);
    const names = [...container.querySelectorAll('button')].map((node) => node.textContent.trim());
    assert.deepEqual(names, [
      'View sessions of Anna Beispiel',
      'End all sessions of Anna Beispiel',
    ]);
  } finally {
    await handle.unmount();
  }
});

test('session dashboard table: view, end and more actions are spaced, not grouped', async () => {
  const session = {
    id: 'session-1',
    documentId: 'session-1',
    isActive: true,
    isTrulyActive: true,
    loginTime: new Date().toISOString(),
    user: { id: 7, documentId: 'user-7', username: 'ben.muster', email: 'ben@example.test' },
  };
  const handle = await renderStrict(
    <SessionActions
      session={session}
      layout="table"
      onView={() => {}}
      onEnd={async () => {}}
      onDelete={async () => {}}
      mutationPending={false}
      focusFallback={{ current: null }}
    />
  );
  try {
    assertSpaced(document.querySelector('[data-row-actions]'), 3);
  } finally {
    await handle.unmount();
  }
});

test('admin panel table: Enter and Space stay on the row button (the grid table would swallow them)', async () => {
  const seen = [];
  const handle = await renderStrict(
    <div onKeyDown={(event) => seen.push(event.key)}>
      <AdminTable
        admins={[ADMIN]}
        labelledBy="caption"
        canRevoke
        onView={() => {}}
        onSignOutEverywhere={() => {}}
      />
    </div>
  );
  try {
    const view = document.querySelector('[data-admin-row="3"] [data-row-actions] button');
    for (const key of ['Enter', ' ', 'ArrowDown']) {
      await act(async () => {
        view.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
      });
    }
    assert.deepEqual(seen, ['ArrowDown'], 'only navigation keys reach the table');
  } finally {
    await handle.unmount();
  }
});

test('event tables: the details button keeps Enter and Space, opens the details and returns focus', async () => {
  const { SignInEventTable } = await import('../../admin/src/pages/AdminPanel/EventTables');
  const seen = [];
  const row = {
    id: 41,
    event: 'admin.session.revoked',
    scope: 'everywhere',
    sessionsEnded: 2,
    at: new Date(Date.now() - 60_000).toISOString(),
    ipAddress: '203.0.113.5',
    ipAnonymized: false,
    location: null,
    browser: 'Firefox 133',
    os: 'Windows 10/11',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) SyntheticFox/133.0',
    admin: { id: 3, name: 'Anna Beispiel' },
    actor: { id: 1, name: 'Ben Muster' },
    session: null,
  };
  const handle = await renderStrict(
    <div onKeyDown={(event) => seen.push(event.key)}>
      <SignInEventTable rows={[row]} label="Synthetic activity" showAdmin />
    </div>
  );
  try {
    const grid = document.querySelector('table[role="grid"]');
    assert.ok(grid, 'a DS table');
    assert.equal(grid.getAttribute('aria-colcount'), '7', 'with Admin and Done by columns');
    const details = document.querySelector('[data-event-id="41"] [data-event-details]');
    for (const key of ['Enter', ' ', 'ArrowDown']) {
      await act(async () => {
        details.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
      });
    }
    assert.deepEqual(seen, ['ArrowDown'], 'only navigation keys reach the table');
    await act(async () => {
      details.focus();
      details.click();
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    const dialog = document.querySelector('[role="dialog"]');
    assert.ok(dialog, 'details dialog is open');
    assert.match(dialog.textContent, /Session ended by an admin: Anna Beispiel/);
    assert.match(dialog.textContent, /Done byBen Muster/);
    assert.match(dialog.textContent, /Every browser \(2 sessions ended\)/);
    assert.match(dialog.textContent, /SyntheticFox\/133\.0/);
    await act(async () => {
      dialog.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(document.activeElement, details, 'focus returns to the details button');
  } finally {
    await handle.unmount();
  }
});
