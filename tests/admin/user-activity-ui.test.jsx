/**
 * App-user security activity in the admin panel (4.22), in StrictMode with the real Strapi
 * providers: the "Security activity" section on the App users tab and the full page appear only
 * with "View app-user security activity" (no request without it), the shared event table shows
 * plain labels and what happened, users are "User #id" when the server hides the email, the
 * details dialog opens the user only when they are visible, filters live in the URL, and the
 * user's Sessions panel shows the latest events with "Show all" filtered by that user.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { act } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Form } from '@strapi/strapi/admin';
import { checkStrictEntry, network, permission } from './harness/index.jsx';
import App from '../../admin/src/pages/App';
import SessionInfoPanel from '../../admin/src/components/SessionInfoPanel';

const adminDist = path.join(
  path.dirname(createRequire(import.meta.url).resolve('@strapi/admin/package.json')),
  'dist/admin/admin/src'
);
const { DescriptionComponentRenderer } = await import(
  pathToFileURL(path.join(adminDist, 'components/DescriptionComponentRenderer.mjs')).href
);

const PLUGIN = 'plugin::magic-sessionmanager';
const ACCESS = permission(`${PLUGIN}.access`);
const USER_ACTIVITY = permission(`${PLUGIN}.user-activity.read`);
const USER_MODEL = 'plugin::users-permissions.user';
const API = '/magic-sessionmanager/user-activity';

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

const EVENTS = {
  data: [
    {
      id: 41,
      event: 'user.lockout',
      at: minutesAgo(2),
      target: 'user',
      user: { id: 7, documentId: 'usrann', email: 'ann@example.test', username: 'ann' },
      actor: null,
      details: { kind: 'account', failures: 5, minutes: 15 },
      ipAddress: '203.0.113.42',
      ipAnonymized: false,
      location: null,
      browser: 'Firefox 133',
      os: 'Windows 10',
      deviceType: 'desktop',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) SyntheticAgent/1.0',
    },
    {
      id: 40,
      event: 'user.sign-in.refused',
      at: minutesAgo(4),
      target: 'user',
      user: { id: 8, documentId: 'usrben', email: '', username: '' },
      actor: null,
      details: { reason: 'session-limit', limit: 3, lock: null, unknownAccount: false },
      ipAddress: '198.51.100.0',
      ipAnonymized: true,
      location: null,
      browser: null,
      os: null,
      deviceType: null,
      userAgent: null,
    },
    {
      id: 39,
      event: 'impersonation.started',
      at: minutesAgo(6),
      target: 'user',
      user: { id: 7, documentId: 'usrann', email: 'ann@example.test', username: 'ann' },
      actor: { type: 'admin', id: 1, name: '' },
      details: {
        durationMinutes: 30,
        handoff: 'token',
        endReason: null,
        refusal: null,
        reason: null,
      },
      ipAddress: null,
      ipAnonymized: false,
      location: null,
      browser: null,
      os: null,
      deviceType: null,
      userAgent: null,
    },
  ],
  meta: {
    pagination: { page: 1, pageSize: 20, pageCount: 1, total: 3 },
    recording: { ipAddresses: true, anonymizeIp: false, retentionDays: 90, userSignIns: true },
    identity: { users: true, names: false, impersonationReasons: false },
  },
};

const dashboardRoutes = () => {
  network.on('GET', '/magic-sessionmanager/sessions', {
    data: [],
    meta: { pagination: { page: 1, pageSize: 25, pageCount: 1, total: 0 } },
  });
  network.on('GET', '/magic-sessionmanager/sessions/stats', {
    data: {
      total: 0,
      open: 0,
      active: 0,
      idle: 0,
      ended: 0,
      loggedOut: 0,
      timedOut: 0,
      otherReasons: 0,
      usersOnline: 0,
      nativeOnly: 0,
      nativeOnlyAfterTracking: 0,
    },
  });
};

const PluginPage = () => (
  <Routes>
    <Route path="/plugins/magic-sessionmanager/*" element={<App />} />
  </Routes>
);

const click = async (element) => {
  assert.ok(element, 'element to click exists');
  await act(async () => {
    element.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    element.click();
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
};

const button = (label) =>
  [...document.querySelectorAll('button')].find((node) => {
    const name = node.getAttribute('aria-label') || node.textContent.trim();
    return label instanceof RegExp ? label.test(name) : name === label;
  });

const live = (calls, pathname) =>
  calls.filter((call) => call.method === 'GET' && call.pathname === pathname && !call.aborted);

const queryOf = (call) => new URL(call.path, 'http://localhost').searchParams;

test('App users tab: no Security activity and no request without the permission', async () => {
  dashboardRoutes();
  const result = await checkStrictEntry(<PluginPage />, {
    path: '/plugins/magic-sessionmanager',
    permissions: [ACCESS],
    async whileMounted(handle) {
      assert.equal(handle.container.querySelector('[data-recent-user-activity]'), null);
    },
  });
  assert.equal(result.calls.filter((call) => call.pathname.startsWith(API)).length, 0);
});

test('App users tab: latest events in the shared table, plain labels, details with Open user', async () => {
  dashboardRoutes();
  network.on('GET', API, EVENTS);
  const result = await checkStrictEntry(<PluginPage />, {
    path: '/plugins/magic-sessionmanager',
    permissions: [ACCESS, USER_ACTIVITY],
    async whileMounted(handle) {
      const section = handle.container.querySelector('[data-recent-user-activity]');
      assert.ok(section, 'the section is shown');
      assert.equal(section.querySelector('h2')?.textContent, 'Security activity');
      assert.ok(section.querySelector('table[role="grid"]'), 'a DS table');
      assert.ok(
        section.querySelector('a[href="/plugins/magic-sessionmanager/app-users/activity"]'),
        'Show all opens the full page'
      );
      const text = section.textContent;
      assert.match(text, /Locked out/);
      assert.match(text, /Account locked for 15 minutes after 5 failed sign-ins/);
      assert.match(text, /Sign-in refused/);
      assert.match(text, /Session limit of 3 reached/);
      assert.match(text, /Impersonation started/);
      assert.match(text, /ann@example\.test/);
      assert.match(text, /User #8/, 'a hidden email reads User #id');
      assert.match(text, /Admin #1/, 'a hidden admin name reads Admin #id');
      assert.match(text, /198\.51\.100\.0 \(anonymised\)/);
      assert.equal(
        section
          .querySelector('[data-event-id="41"] [data-event-tone]')
          ?.getAttribute('data-event-tone'),
        'danger'
      );

      await click(button(/^Details of Locked out/));
      const dialog = document.querySelector('[role="dialog"]');
      assert.match(dialog.textContent, /Locked out: ann@example\.test/);
      assert.match(dialog.textContent, /What happened/);
      assert.match(dialog.textContent, /SyntheticAgent\/1\.0/);
      assert.ok(
        dialog.querySelector(`a[href="/content-manager/collection-types/${USER_MODEL}/usrann"]`),
        'Open user leads to the Content Manager'
      );
      await click(button('Close'));

      await click(button(/^Details of Sign-in refused/));
      const masked = document.querySelector('[role="dialog"]');
      assert.match(masked.textContent, /User #8/);
      assert.equal(masked.querySelector('[data-open-user]'), null, 'no link to a hidden user');
      await click(button('Close'));
    },
  });
  const calls = live(result.calls, API);
  assert.equal(calls.length, 1, 'the list loads once');
  assert.equal(queryOf(calls[0]).get('pageSize'), '8');
  assert.equal(result.calls.filter((call) => call.method !== 'GET').length, 0, 'no mutation');
});

test('full page: filters and the user come from the URL; the caption counts the server total', async () => {
  network.on('GET', API, {
    data: [EVENTS.data[0]],
    meta: { ...EVENTS.meta, pagination: { page: 1, pageSize: 20, pageCount: 1, total: 1 } },
  });
  const result = await checkStrictEntry(<PluginPage />, {
    path: '/plugins/magic-sessionmanager/app-users/activity?event=lockouts&period=7&userId=usrann',
    permissions: [ACCESS, USER_ACTIVITY],
    async whileMounted(handle) {
      assert.equal(
        handle.container.querySelector('h1')?.textContent,
        'Security activity of app users'
      );
      assert.ok(handle.container.querySelector('table[role="grid"]'));
      assert.match(handle.container.textContent, /User: ann@example\.test/);
      assert.ok(handle.container.querySelector('[data-user-filter="usrann"]'));
      assert.match(handle.container.textContent, /1 event/);
    },
  });
  const calls = live(result.calls, API);
  assert.equal(calls.length, 1);
  const query = queryOf(calls[0]);
  assert.equal(query.get('event'), 'lockouts');
  assert.equal(query.get('userId'), 'usrann');
  assert.ok(query.get('from'), 'the period is sent');
});

test('full page without the permission: no request', async () => {
  const result = await checkStrictEntry(<PluginPage />, {
    path: '/plugins/magic-sessionmanager/app-users/activity',
    permissions: [ACCESS],
  });
  assert.equal(result.calls.filter((call) => call.pathname.startsWith(API)).length, 0);
});

const SidePanelHost = (props) => (
  <DescriptionComponentRenderer props={props} descriptions={[SessionInfoPanel]}>
    {(panels) =>
      panels.map(({ id, title, content }) => (
        <section key={id} aria-label={title}>
          <h2>{title}</h2>
          {content}
        </section>
      ))
    }
  </DescriptionComponentRenderer>
);

const wait = (ms) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));

const renderPanel = (permissions) =>
  checkStrictEntry(
    <Form method="PUT" initialValues={{ blocked: false }}>
      <SidePanelHost
        model={USER_MODEL}
        documentId="usrann"
        document={{ documentId: 'usrann', username: 'ann', email: 'ann@example.test' }}
        collectionType="collection-types"
        activeTab="draft"
      />
    </Form>,
    {
      path: `/content-manager/collection-types/${USER_MODEL}/usrann`,
      permissions,
      whileMounted: () => wait(200),
    }
  );

test('Sessions panel: the latest events of this user and Show all filtered by the user', async () => {
  network.on('GET', '/magic-sessionmanager/user/usrann/sessions', { data: [] });
  network.on('GET', API, { ...EVENTS, data: [EVENTS.data[0], EVENTS.data[2]] });
  const result = await renderPanel([ACCESS, USER_ACTIVITY]);
  assert.match(result.html, /data-panel-user-activity/);
  assert.match(result.html, /Account locked for 15 minutes/);
  assert.match(
    result.html,
    /href="\/plugins\/magic-sessionmanager\/app-users\/activity\?userId=usrann"/
  );
  const calls = live(result.calls, API);
  assert.equal(calls.length, 1);
  assert.equal(queryOf(calls[0]).get('userId'), 'usrann');
  assert.equal(queryOf(calls[0]).get('pageSize'), '3');
});

test('Sessions panel without the permission: no Security activity, no request', async () => {
  network.on('GET', '/magic-sessionmanager/user/usrann/sessions', { data: [] });
  const result = await renderPanel([ACCESS]);
  assert.doesNotMatch(result.html, /data-panel-user-activity/);
  assert.equal(result.calls.filter((call) => call.pathname.startsWith(API)).length, 0);
});
