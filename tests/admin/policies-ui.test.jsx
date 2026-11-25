/**
 * Rendered checks of the 4.17 policy UI: the "Locked now" card (states, RBAC, keyboard,
 * unlock round trip) and the per-role rules editor (add through the dialog, edit, remove).
 * Synthetic data only; the network is the harness fake.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { network, permission, renderStrict, settle } from './harness/index.jsx';
import LockedNowCard from '../../admin/src/pages/Settings/LockedNowCard';
import RoleRulesSection from '../../admin/src/pages/Settings/RoleRulesSection';

const PLUGIN = 'plugin::magic-sessionmanager';
const ACCESS = permission(`${PLUGIN}.access`);
const UNLOCK = permission(`${PLUGIN}.lockouts.unlock`);

const LOCKS = {
  data: [
    {
      id: `la:${'a'.repeat(48)}`,
      kind: 'account',
      ip: null,
      user: { documentId: 'u1', username: 'jane.doe', email: 'jane.doe@example.test' },
      failures: 5,
      lockedAt: new Date().toISOString(),
      until: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    },
    {
      id: `lf:${'b'.repeat(48)}`,
      kind: 'ip',
      ip: '192.0.2.0',
      user: null,
      failures: 3,
      lockedAt: new Date().toISOString(),
      until: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    },
  ],
  meta: { total: 2 },
};

test('Locked now: lists locks, Unlock is spaced, keyboard keys stay on the button', async () => {
  network.on('GET', '/magic-sessionmanager/lockouts', LOCKS);
  const seen = [];
  const handle = await renderStrict(
    <div onKeyDown={(event) => seen.push(event.key)}>
      <LockedNowCard />
    </div>,
    { permissions: [ACCESS, UNLOCK] }
  );
  try {
    await settle(10, 10);
    const text = handle.container.textContent;
    assert.match(text, /jane\.doe/);
    assert.match(text, /192\.0\.2\.0/);
    const rows = document.querySelectorAll('[data-lock-row]');
    assert.equal(rows.length, 2);
    const button = document.querySelector('[data-lock-row="account"] [data-row-actions] button');
    assert.ok(button, 'unlock button rendered');
    assert.equal(button.textContent.trim(), 'Unlock jane.doe');
    for (const key of ['Enter', ' ', 'ArrowDown']) {
      await act(async () => {
        button.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
      });
    }
    assert.deepEqual(seen, ['ArrowDown'], 'only navigation keys reach the table');
  } finally {
    await handle.unmount();
  }
});

test('Locked now: without "Unlock locked sign-ins" there is no Unlock button and a hint says why', async () => {
  network.on('GET', '/magic-sessionmanager/lockouts', LOCKS);
  const handle = await renderStrict(<LockedNowCard />, { permissions: [ACCESS] });
  try {
    await settle(10, 10);
    assert.equal(document.querySelectorAll('[data-row-actions] button').length, 0);
    assert.match(handle.container.textContent, /Unlocking needs the "Unlock locked sign-ins"/);
  } finally {
    await handle.unmount();
  }
});

test('Locked now: empty and error states', async () => {
  network.on('GET', '/magic-sessionmanager/lockouts', { data: [], meta: { total: 0 } });
  let handle = await renderStrict(<LockedNowCard />, { permissions: [ACCESS] });
  try {
    await settle(10, 10);
    assert.match(handle.container.textContent, /Nothing is locked/);
  } finally {
    await handle.unmount();
  }
  network.on('GET', '/magic-sessionmanager/lockouts', { status: 500, body: { error: {} } });
  handle = await renderStrict(<LockedNowCard />, { permissions: [ACCESS] });
  try {
    await settle(10, 10);
    assert.match(handle.container.textContent, /Locks could not be loaded/);
    assert.match(handle.container.textContent, /Try again/);
  } finally {
    await handle.unmount();
  }
});

test('Locked now: Unlock asks first, sends the lock id and reloads the list', async () => {
  network.on('GET', '/magic-sessionmanager/lockouts', LOCKS);
  network.on('POST', '/magic-sessionmanager/lockouts/unlock', {
    data: { unlocked: true, kind: 'account' },
  });
  const handle = await renderStrict(<LockedNowCard />, { permissions: [ACCESS, UNLOCK] });
  try {
    await settle(10, 10);
    const button = document.querySelector('[data-lock-row="account"] [data-row-actions] button');
    await act(async () => button.click());
    await settle(5, 5);
    const dialog = document.querySelector('[role="alertdialog"]');
    assert.ok(dialog, 'confirmation dialog opened');
    assert.match(dialog.textContent, /Unlock jane\.doe\?/);
    const confirm = [...dialog.querySelectorAll('button')].find(
      (node) => node.textContent.trim() === 'Unlock'
    );
    network.on('GET', '/magic-sessionmanager/lockouts', {
      data: [LOCKS.data[1]],
      meta: { total: 1 },
    });
    await act(async () => confirm.click());
    await settle(10, 10);
    const posted = network.calls.filter(
      (call) => call.method === 'POST' && call.pathname.endsWith('/lockouts/unlock')
    );
    assert.equal(posted.length, 1);
    assert.deepEqual(JSON.parse(posted[0].body), { id: LOCKS.data[0].id });
    assert.equal(document.querySelectorAll('[data-lock-row]').length, 1);
  } finally {
    await handle.unmount();
  }
});

/**
 * A minimal settings form for the role rules editor.
 *
 * @param {object[]} initial Initial rules.
 * @returns {{form: object, changes: Array<[string, unknown]>}} Form and recorded changes.
 */
const fakeForm = (initial) => {
  const changes = [];
  const form = {
    settings: { roleRules: initial },
    errors: {},
    handleChange(key, value) {
      changes.push([key, value]);
      form.settings = { ...form.settings, [key]: value };
    },
  };
  return { form, changes };
};

test('role rules: "Add rule" opens a dialog that validates and adds a rule to the draft', async () => {
  network.on('GET', '/magic-sessionmanager/roles', {
    data: [
      { documentId: 'role-auth', name: 'Authenticated', type: 'authenticated' },
      { documentId: 'role-staff', name: 'Staff', type: 'staff' },
    ],
  });
  const { form, changes } = fakeForm([]);
  const handle = await renderStrict(<RoleRulesSection form={form} />, { permissions: [ACCESS] });
  try {
    await settle(10, 10);
    const trigger = document.querySelector('[data-advanced-section] button');
    await act(async () => trigger.click());
    await settle(5, 5);
    assert.match(handle.container.textContent, /No role has its own rules/);
    const add = [...document.querySelectorAll('button')].find(
      (node) => node.textContent.trim() === 'Add rule'
    );
    await act(async () => add.click());
    await settle(5, 5);
    const dialog = document.querySelector('[role="dialog"]');
    assert.ok(dialog, 'dialog opened');
    const submit = [...dialog.querySelectorAll('button')].find(
      (node) => node.textContent.trim() === 'Add rule'
    );
    await act(async () => submit.click());
    await settle(5, 5);
    assert.match(document.body.textContent, /Choose a role\./, 'an empty rule is not added');
    assert.equal(changes.length, 0);
  } finally {
    await handle.unmount();
  }
});

test('role rules: existing rules show general values, edit and remove are labelled per role', async () => {
  network.on('GET', '/magic-sessionmanager/roles', {
    data: [{ documentId: 'role-staff', name: 'Staff', type: 'staff' }],
  });
  const { form, changes } = fakeForm([
    {
      role: 'role-staff',
      maxSessionsPerUser: 1,
      inactivityTimeout: null,
      maxFailedLoginsPerAccount: 0,
    },
  ]);
  const handle = await renderStrict(<RoleRulesSection form={form} />, { permissions: [ACCESS] });
  try {
    await settle(10, 10);
    const trigger = document.querySelector('[data-advanced-section] button');
    await act(async () => trigger.click());
    await settle(5, 5);
    const row = document.querySelector('[data-role-rule="role-staff"]');
    assert.ok(row);
    assert.match(row.textContent, /Staff/);
    assert.match(row.textContent, /1 session/);
    assert.match(row.textContent, /General setting/);
    const labels = [...row.querySelectorAll('[data-row-actions] button')].map((node) =>
      node.textContent.trim()
    );
    assert.deepEqual(labels, ['Edit the rule for Staff', 'Remove the rule for Staff']);
    const remove = row.querySelectorAll('[data-row-actions] button')[1];
    await act(async () => remove.click());
    assert.deepEqual(changes, [['roleRules', []]]);
  } finally {
    await handle.unmount();
  }
});

test('role rules: read-only without "Change protected settings"', async () => {
  network.on('GET', '/magic-sessionmanager/roles', {
    data: [{ documentId: 'role-staff', name: 'Staff', type: 'staff' }],
  });
  const { form, changes } = fakeForm([
    {
      role: 'role-staff',
      maxSessionsPerUser: 1,
      inactivityTimeout: null,
      maxFailedLoginsPerAccount: null,
    },
  ]);
  form.canChangeProtected = false;
  const handle = await renderStrict(<RoleRulesSection form={form} />, { permissions: [ACCESS] });
  try {
    await settle(10, 10);
    const trigger = document.querySelector('[data-advanced-section] button');
    await act(async () => trigger.click());
    await settle(5, 5);
    assert.match(handle.container.textContent, /Change protected settings/);
    const buttons = [...document.querySelectorAll('[data-role-rule] [data-row-actions] button')];
    const isDisabled = (button) =>
      button.disabled || button.getAttribute('aria-disabled') === 'true';
    assert.equal(buttons.length, 2);
    assert.ok(buttons.every(isDisabled), 'edit and remove are disabled');
    const add = [...document.querySelectorAll('button')].find(
      (node) => node.textContent.trim() === 'Add rule'
    );
    assert.ok(isDisabled(add), 'add is disabled');
    assert.equal(changes.length, 0);
  } finally {
    await handle.unmount();
  }
});
