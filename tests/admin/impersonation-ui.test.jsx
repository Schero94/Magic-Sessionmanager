/**
 * Impersonation in the admin panel (4.20): the side-panel entry point is shown only
 * with the permission and the switch on, the dialog validates the reason before any request,
 * the credential is handed over once (token or one-time code by POST to the frontend), End works
 * from the dialog and from the Settings list, and the list's row action works by keyboard. View as
 * admin is offered only where allowed, asks for a reason, and shows a read-only preview with a
 * banner, a countdown and End.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { network, permission, renderStrict, settle } from './harness/index.jsx';
import ImpersonationPanelSection from '../../admin/src/components/impersonation/ImpersonationPanelSection';
import ActiveImpersonationsCard from '../../admin/src/components/impersonation/ActiveImpersonationsCard';
import PreviewAdminModal from '../../admin/src/components/impersonation/PreviewAdminModal';
import SignInAsAdminModal from '../../admin/src/components/impersonation/SignInAsAdminModal';
import { AdminTable } from '../../admin/src/pages/AdminPanel/AdminList';

const IMPERSONATE = permission('plugin::magic-sessionmanager.impersonate.users');
const ACCESS = permission('plugin::magic-sessionmanager.access');
const USER_ID = 'usersynthetic0000000001';
const ROW = {
  id: 'impersonation00000000001',
  targetType: 'user',
  targetId: 'usersynthetic0000000002',
  targetLabel: 'ben.muster',
  actorId: '1',
  actorLabel: 'Anna Beispiel',
  startedByYou: false,
  reason: 'Ticket 4711: checkout fails',
  durationMinutes: 15,
  handoff: 'token',
  credentialIssued: true,
  startedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  state: 'active',
};

const status = (overrides = {}) => ({
  data: {
    enabled: true,
    handoff: 'token',
    frontendOrigin: null,
    durations: [15, 30, 60],
    mode: 'legacy',
    ...overrides,
  },
});

const buttonByText = (root, text) =>
  [...root.querySelectorAll('button')].find((node) => node.textContent.trim() === text);

const click = async (node) => {
  await act(async () => {
    node.click();
  });
  await settle(4, 5);
};

const type = async (element, value) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set;
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await settle(2, 5);
};

const renderPanel = async (permissions, statusBody = status()) => {
  network.on('GET', '/magic-sessionmanager/impersonation/status', statusBody);
  network.on('GET', '/magic-sessionmanager/impersonation/active', { data: [] });
  const handle = await renderStrict(
    <ImpersonationPanelSection documentId={USER_ID} userLabel="anna.beispiel" />,
    { permissions }
  );
  await settle(8, 10);
  return handle;
};

test('the side panel offers Impersonate only with the permission and the switch on', async () => {
  const without = await renderPanel([ACCESS]);
  try {
    assert.equal(buttonByText(without.container, 'Impersonate…'), undefined);
    assert.equal(
      network.calls.some((call) => call.path.includes('/impersonation/')),
      false,
      'no request without the permission'
    );
  } finally {
    await without.unmount();
  }
  const off = await renderPanel([ACCESS, IMPERSONATE], status({ enabled: false }));
  try {
    assert.equal(buttonByText(off.container, 'Impersonate…'), undefined);
  } finally {
    await off.unmount();
  }
  const on = await renderPanel([ACCESS, IMPERSONATE]);
  try {
    assert.ok(buttonByText(on.container, 'Impersonate…'));
  } finally {
    await on.unmount();
  }
});

test('the dialog needs a reason before it starts, then shows the token once and can end it', async () => {
  const handle = await renderPanel([ACCESS, IMPERSONATE]);
  network.on('POST', `/magic-sessionmanager/impersonation/users/${USER_ID}`, (call) => ({
    status: 201,
    body: {
      data: {
        impersonation: { ...ROW, id: 'impersonation00000000009', reason: call.json().reason },
        handoff: {
          type: 'token',
          jwt: 'synthetic.jwt.value',
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        },
      },
    },
  }));
  network.on('POST', '/magic-sessionmanager/impersonation/impersonation00000000009/end', {
    data: { ended: true },
  });
  try {
    await click(buttonByText(handle.container, 'Impersonate…'));
    const dialog = document.querySelector('[role="dialog"]');
    assert.ok(dialog, 'dialog opened');
    assert.match(dialog.textContent, /Impersonate anna\.beispiel/);

    network.clearCalls();
    await click(buttonByText(dialog, 'Start impersonation'));
    assert.match(dialog.textContent, /Enter a reason of at least 3 characters/);
    assert.equal(
      network.calls.filter((call) => call.method === 'POST').length,
      0,
      'no request with an invalid reason'
    );

    await type(dialog.querySelector('textarea'), 'Ticket 4711');
    await click(buttonByText(dialog, 'Start impersonation'));
    const start = network.calls.find((call) => call.method === 'POST');
    assert.deepEqual(JSON.parse(start.body), {
      reason: 'Ticket 4711',
      durationMinutes: 15,
      notifyUser: false,
    });
    const result = document.querySelector('[role="dialog"]');
    assert.match(result.textContent, /Impersonating anna\.beispiel/);
    assert.match(result.textContent, /Shown only once/);
    const token = result.querySelector('input[name="jwt"]');
    assert.ok(token, 'the access token field is shown');
    assert.equal(token.value, 'synthetic.jwt.value');
    assert.ok(token.readOnly);
    assert.match(result.textContent, /Ends in 1[45]:\d\d\./);

    network.clearCalls();
    await click(buttonByText(result, 'End impersonation'));
    assert.ok(
      network.calls.some(
        (call) =>
          call.method === 'POST' &&
          call.path === '/magic-sessionmanager/impersonation/impersonation00000000009/end'
      ),
      'End sends one request'
    );
    assert.equal(document.querySelector('[role="dialog"]'), null, 'the dialog closes after End');
  } finally {
    await handle.unmount();
  }
});

test('frontend hand-off posts the one-time code in a form, never in a URL', async () => {
  const handle = await renderPanel(
    [ACCESS, IMPERSONATE],
    status({ handoff: 'frontend', frontendOrigin: 'https://app.example.test' })
  );
  network.on('POST', `/magic-sessionmanager/impersonation/users/${USER_ID}`, {
    status: 201,
    body: {
      data: {
        impersonation: { ...ROW, handoff: 'frontend' },
        handoff: {
          type: 'frontend',
          url: 'https://app.example.test/impersonate',
          field: 'code',
          code: 'c'.repeat(43),
          codeExpiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      },
    },
  });
  const submitted = [];
  const originalSubmit = window.HTMLFormElement.prototype.submit;
  window.HTMLFormElement.prototype.submit = function submit() {
    submitted.push({
      method: this.method,
      action: this.action,
      target: this.target,
      fields: [...this.querySelectorAll('input')].map((input) => [input.name, input.value]),
    });
  };
  try {
    await click(buttonByText(handle.container, 'Impersonate…'));
    const dialog = document.querySelector('[role="dialog"]');
    await type(dialog.querySelector('textarea'), 'Ticket 4712');
    await click(buttonByText(dialog, 'Start impersonation'));
    const result = document.querySelector('[role="dialog"]');
    assert.match(result.textContent, /https:\/\/app\.example\.test/);
    assert.equal(result.querySelector('input[name="jwt"]'), null, 'no token in this mode');
    await click(buttonByText(result, 'Open frontend'));
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0].method, 'post');
    assert.equal(submitted[0].action, 'https://app.example.test/impersonate');
    assert.equal(submitted[0].target, '_blank');
    assert.deepEqual(submitted[0].fields, [['code', 'c'.repeat(43)]]);
    assert.equal(document.querySelector('form[action*="app.example.test"]'), null, 'form removed');
  } finally {
    window.HTMLFormElement.prototype.submit = originalSubmit;
    await handle.unmount();
  }
});

test('the active list ends an impersonation by keyboard (Enter on the row action)', async () => {
  network.on('GET', '/magic-sessionmanager/impersonation/active', { data: [ROW] });
  const seen = [];
  const handle = await renderStrict(
    <div onKeyDown={(event) => seen.push(event.key)}>
      <ActiveImpersonationsCard />
    </div>,
    { permissions: [ACCESS, IMPERSONATE] }
  );
  await settle(8, 10);
  try {
    assert.match(handle.container.textContent, /ben\.muster/);
    assert.match(handle.container.textContent, /Ticket 4711: checkout fails/);
    assert.match(handle.container.textContent, /Anna Beispiel/);
    const action = [...handle.container.querySelectorAll('button')].find(
      (node) => node.textContent.trim() === 'End impersonation of ben.muster'
    );
    assert.ok(action, 'row action with a contextual name');
    assert.ok(action.closest('[data-row-actions]'), 'inside the spaced row actions');
    // The DS grid cell swallows Enter and Space for cells with several buttons; the row actions
    // keep both keys on the button and let navigation keys through.
    for (const key of ['Enter', ' ', 'ArrowDown']) {
      await act(async () => {
        action.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
      });
    }
    assert.deepEqual(seen, ['ArrowDown'], 'only navigation keys reach the table');
    await act(async () => {
      action.click();
    });
    await settle(4, 5);
    const dialog = document.querySelector('[role="alertdialog"], [role="dialog"]');
    assert.ok(dialog, 'confirmation opened');
    assert.match(dialog.textContent, /End the impersonation of ben\.muster\?/);
  } finally {
    await handle.unmount();
  }
});

const ADMIN_ROW = {
  id: 7,
  name: 'Ben Muster',
  email: 'ben.muster@example.test',
  roles: [{ name: 'Editor', superAdmin: false }],
  account: 'active',
  self: false,
  sessionCount: 0,
  lastActiveAt: null,
  canSignOut: false,
  protectedReason: null,
};

test('View as: offered only with the permission, never for oneself or a Super Admin', async () => {
  const seen = [];
  const opened = [];
  const rows = [
    ADMIN_ROW,
    { ...ADMIN_ROW, id: 8, name: 'Self Admin', self: true },
    {
      ...ADMIN_ROW,
      id: 9,
      name: 'Super Admin',
      roles: [{ name: 'Super Admin', superAdmin: true }],
    },
  ];
  const handle = await renderStrict(
    <div onKeyDown={(event) => seen.push(event.key)}>
      <AdminTable
        admins={rows}
        labelledBy="caption"
        canRevoke={false}
        canPreview
        onView={() => {}}
        onSignOutEverywhere={() => {}}
        onPreview={(admin) => opened.push(admin.id)}
      />
    </div>
  );
  try {
    const names = [...document.querySelectorAll('[data-row-actions] button')].map((node) =>
      node.textContent.trim()
    );
    assert.ok(names.includes('View permissions of Ben Muster'));
    assert.equal(names.includes('View permissions of Self Admin'), false);
    assert.equal(names.includes('View permissions of Super Admin'), false);
    const action = [
      ...document.querySelectorAll('[data-admin-row="7"] [data-row-actions] button'),
    ].find((node) => node.textContent.trim() === 'View permissions of Ben Muster');
    for (const key of ['Enter', ' ', 'ArrowDown']) {
      await act(async () => {
        action.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
      });
    }
    assert.deepEqual(seen, ['ArrowDown'], 'only navigation keys reach the table');
    await act(async () => action.click());
    assert.deepEqual(opened, [7]);
  } finally {
    await handle.unmount();
  }
  const without = await renderStrict(
    <AdminTable
      admins={[ADMIN_ROW]}
      labelledBy="caption"
      canRevoke={false}
      onView={() => {}}
      onSignOutEverywhere={() => {}}
    />
  );
  try {
    assert.equal(
      [...document.querySelectorAll('[data-row-actions] button')].some((node) =>
        node.textContent.includes('View permissions')
      ),
      false
    );
  } finally {
    await without.unmount();
  }
});

test('View as: reason first, then a read-only preview with banner, countdown and End', async () => {
  network.on('POST', '/magic-sessionmanager/impersonation/admins/7/preview', {
    status: 201,
    body: {
      data: {
        impersonation: {
          ...ROW,
          id: 'impersonation00000000077',
          targetType: 'admin',
          targetId: '7',
          handoff: 'preview',
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        },
        preview: {
          admin: { id: 7, name: 'Ben Muster', active: true, roles: [{ name: 'Editor' }] },
          contentTypes: [
            {
              uid: 'api::article.article',
              name: 'Article',
              kind: 'collection',
              actions: [
                { action: 'read', fields: null, locales: null, conditions: [] },
                { action: 'update', fields: 2, locales: null, conditions: ['admin::is-creator'] },
              ],
            },
          ],
          otherPermissions: [
            {
              action: 'plugin::upload.read',
              name: 'Access the Media Library',
              section: 'plugins',
              scope: 'upload',
            },
          ],
        },
      },
    },
  });
  network.on('POST', '/magic-sessionmanager/impersonation/impersonation00000000077/end', {
    data: { ended: true },
  });
  let closed = 0;
  const handle = await renderStrict(
    <PreviewAdminModal admin={{ id: 7, name: 'Ben Muster' }} onClose={() => (closed += 1)} />,
    { permissions: [ACCESS] }
  );
  try {
    const dialog = document.querySelector('[role="dialog"]');
    assert.match(dialog.textContent, /Permissions of Ben Muster/);
    network.clearCalls();
    await click(buttonByText(dialog, 'View permissions'));
    assert.equal(network.calls.filter((call) => call.method === 'POST').length, 0);
    await type(dialog.querySelector('textarea'), 'Check what the editor sees');
    await click(buttonByText(dialog, 'View permissions'));
    const body = JSON.parse(network.calls.find((call) => call.method === 'POST').body);
    assert.deepEqual(body, { reason: 'Check what the editor sees', durationMinutes: 15 });
    const banner = document.querySelector('[data-preview-banner]');
    assert.match(
      banner.textContent,
      /You are viewing as Ben Muster · read-only · ends in 1[45]:\d\d/
    );
    const preview = document.querySelector('[data-preview-body]');
    assert.match(preview.textContent, /Article/);
    assert.match(preview.textContent, /Update \(restricted\)/);
    assert.match(preview.textContent, /Update: 2 fields/);
    assert.match(preview.textContent, /only entries they created/);
    assert.match(preview.textContent, /Access the Media Library/);
    network.clearCalls();
    await click(buttonByText(banner, 'End'));
    assert.ok(
      network.calls.some(
        (call) => call.path === '/magic-sessionmanager/impersonation/impersonation00000000077/end'
      )
    );
    assert.equal(closed, 1);
  } finally {
    await handle.unmount();
  }
});

test('View as: a refused preview explains why and keeps the dialog open', async () => {
  network.on('POST', '/magic-sessionmanager/impersonation/admins/7/preview', {
    status: 403,
    body: {
      data: null,
      error: {
        status: 403,
        name: 'ForbiddenError',
        message: 'x',
        details: { reason: 'not-subset' },
      },
    },
  });
  const handle = await renderStrict(
    <PreviewAdminModal admin={{ id: 7, name: 'Ben Muster' }} onClose={() => {}} />,
    { permissions: [ACCESS] }
  );
  try {
    const dialog = document.querySelector('[role="dialog"]');
    await type(dialog.querySelector('textarea'), 'Ticket 99');
    await click(buttonByText(dialog, 'View permissions'));
    assert.match(
      document.querySelector('[role="dialog"]').textContent,
      /This admin has permissions that you do not have/
    );
    assert.equal(document.querySelector('[data-preview-banner]'), null);
  } finally {
    await handle.unmount();
  }
});

const SUPPORTED = { supported: true, version: '5.64.0', reason: null, durations: [15, 30] };

test('Sign in as: offered next to View permissions, disabled with the reason on an untested Strapi', async () => {
  const opened = [];
  const rows = [
    ADMIN_ROW,
    { ...ADMIN_ROW, id: 8, name: 'Self Admin', self: true },
    { ...ADMIN_ROW, id: 10, name: 'Gone Admin', account: 'deactivated' },
  ];
  const handle = await renderStrict(
    <AdminTable
      admins={rows}
      labelledBy="caption"
      canRevoke={false}
      canSignIn
      onView={() => {}}
      onSignOutEverywhere={() => {}}
      onSignIn={(admin) => opened.push(admin.id)}
    />
  );
  try {
    const buttons = [...document.querySelectorAll('[data-row-actions] button')];
    const names = buttons.map((node) => node.textContent.trim());
    assert.ok(names.includes('Sign in as Ben Muster'));
    assert.equal(names.includes('Sign in as Self Admin'), false);
    assert.equal(names.includes('Sign in as Gone Admin'), false);
    await click(buttons.find((node) => node.textContent.trim() === 'Sign in as Ben Muster'));
    assert.deepEqual(opened, [7]);
  } finally {
    await handle.unmount();
  }
  const reason = 'Not available on Strapi 5.65.0: tested with 5.50 to 5.64.';
  const off = await renderStrict(
    <AdminTable
      admins={[ADMIN_ROW]}
      labelledBy="caption"
      canRevoke={false}
      canSignIn
      signInUnavailable={reason}
      onView={() => {}}
      onSignOutEverywhere={() => {}}
      onSignIn={() => opened.push('x')}
    />
  );
  try {
    const button = [...document.querySelectorAll('[data-row-actions] button')].find(
      (node) => node.textContent.trim() === reason
    );
    assert.ok(button, 'the disabled button says why');
    assert.ok(button.disabled || button.getAttribute('aria-disabled') === 'true');
  } finally {
    await off.unmount();
  }
});

test('Sign in as: unsupported Strapi explains why and cannot start', async () => {
  const handle = await renderStrict(
    <SignInAsAdminModal
      admin={{ id: 7, name: 'Ben Muster' }}
      support={{
        supported: false,
        version: '5.65.0',
        reason: 'untested-version',
        durations: [15, 30],
      }}
      onClose={() => {}}
    />,
    { permissions: [ACCESS] }
  );
  try {
    const dialog = document.querySelector('[role="dialog"]');
    assert.match(dialog.textContent, /Not available on Strapi 5\.65\.0/);
    const start = buttonByText(dialog, 'Start sign-in');
    assert.ok(start.disabled || start.getAttribute('aria-disabled') === 'true');
  } finally {
    await handle.unmount();
  }
});

test('Sign in as: reason, duration and Allow changes (with warning), then a one-time link', async () => {
  network.on('POST', '/magic-sessionmanager/impersonation/admins/7/sign-in', {
    status: 201,
    body: {
      data: {
        impersonation: { ...ROW, targetType: 'admin', targetId: '7', handoff: 'admin-session' },
        handoff: {
          type: 'admin-tab',
          path: '/plugins/magic-sessionmanager/impersonate/land',
          cookieName: 'jwtToken',
          code: 'C'.repeat(43),
          codeExpiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      },
    },
  });
  const handle = await renderStrict(
    <SignInAsAdminModal
      admin={{ id: 7, name: 'Ben Muster' }}
      support={SUPPORTED}
      onClose={() => {}}
    />,
    { permissions: [ACCESS] }
  );
  try {
    const dialog = document.querySelector('[role="dialog"]');
    assert.match(dialog.textContent, /Sign in as Ben Muster/);
    assert.doesNotMatch(dialog.textContent, /appear in Strapi as made by/);
    network.clearCalls();
    await click(buttonByText(dialog, 'Start sign-in'));
    assert.equal(network.calls.filter((call) => call.method === 'POST').length, 0, 'reason first');
    await type(dialog.querySelector('textarea'), 'Ticket 4711');
    await click(dialog.querySelector('button[role="checkbox"]'));
    assert.match(dialog.textContent, /appear in Strapi as made by Ben Muster/);
    await click(buttonByText(dialog, 'Start sign-in'));
    const body = JSON.parse(network.calls.find((call) => call.method === 'POST').body);
    assert.deepEqual(body, { reason: 'Ticket 4711', durationMinutes: 15, allowChanges: true });
    const link = dialog.querySelector('a[href*="impersonate/land"]');
    assert.ok(link);
    const href = link.getAttribute('href');
    assert.ok(
      href.endsWith(
        `/plugins/magic-sessionmanager/impersonate/land#code=${'C'.repeat(43)}&c=jwtToken`
      ),
      href
    );
    assert.equal(href.includes('?'), false, 'never in the query');
    assert.equal(link.getAttribute('target'), '_blank');
    assert.match(link.getAttribute('rel'), /noopener/);
  } finally {
    await handle.unmount();
  }
});
