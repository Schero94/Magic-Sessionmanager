/**
 * StrictMode checks of every Session Manager admin entry point: the plugin page (session dashboard
 * and admin panel sessions), the two settings pages (Configuration, Analytics), the homepage widget,
 * the Content Manager side panel for users, the initializer, and the dialogs they open. See
 * harness/index.jsx for what each assertion counts.
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
import Settings from '../../admin/src/pages/Settings';
import Analytics from '../../admin/src/pages/Analytics';
import OnlineUsersWidget from '../../admin/src/components/OnlineUsersWidget';
import SessionInfoPanel from '../../admin/src/components/SessionInfoPanel';
import Initializer from '../../admin/src/components/Initializer';
import plugin from '../../admin/src/index';

// Strapi's own renderer of Content Manager side panel descriptions (not in the package exports).
const adminDist = path.join(
  path.dirname(createRequire(import.meta.url).resolve('@strapi/admin/package.json')),
  'dist/admin/admin/src'
);
const { DescriptionComponentRenderer } = await import(
  pathToFileURL(path.join(adminDist, 'components/DescriptionComponentRenderer.mjs')).href
);

const PLUGIN = 'plugin::magic-sessionmanager';
const ACCESS = permission(`${PLUGIN}.access`);
const ADMIN_READ = permission(`${PLUGIN}.admin-sessions.read`);
const ADMIN_REVOKE = permission(`${PLUGIN}.admin-sessions.revoke`);
const ALL = [ACCESS, ADMIN_READ, ADMIN_REVOKE];
const USER_MODEL = 'plugin::users-permissions.user';

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

const STATS = {
  total: 2,
  open: 1,
  active: 1,
  idle: 0,
  ended: 1,
  loggedOut: 1,
  timedOut: 0,
  otherReasons: 0,
  usersOnline: 1,
  nativeOnly: 0,
  nativeOnlyAfterTracking: 0,
};

const session = (overrides = {}) => ({
  id: 11,
  documentId: 'session-11',
  isActive: true,
  isTrulyActive: true,
  loginTime: minutesAgo(30),
  lastActive: minutesAgo(1),
  ipAddress: '203.0.113.10',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  user: { id: 7, documentId: 'user-7', username: 'grace', email: 'grace@example.test' },
  ...overrides,
});

const SESSIONS = [
  session(),
  session({
    id: 12,
    documentId: 'session-12',
    isActive: false,
    isTrulyActive: false,
    terminationReason: 'logout',
    logoutTime: minutesAgo(5),
  }),
];

/** Routes of the session dashboard (list, counts, untracked summary). */
const dashboardRoutes = () => {
  network.on('GET', '/magic-sessionmanager/sessions', {
    data: SESSIONS,
    meta: { pagination: { page: 1, pageSize: 25, pageCount: 1, total: SESSIONS.length } },
  });
  network.on('GET', '/magic-sessionmanager/sessions/stats', { data: STATS });
  network.on('GET', '/magic-sessionmanager/users/stats', {
    success: true,
    data: { totalUsers: 5, blockedUsers: 1 },
  });
  network.on('GET', /^\/magic-sessionmanager\/geolocation\//, {
    data: { country: 'Example', city: 'Example City' },
  });
};

/**
 * Clicks an element inside `act` (Radix triggers also need pointerdown).
 * @param {Element | null | undefined} element - Element.
 */
const click = async (element) => {
  assert.ok(element, 'element to click exists');
  await act(async () => {
    element.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    element.click();
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
};

/**
 * Finds a button by accessible label or exact text anywhere in the document (dialogs render in
 * portals).
 * @param {string | RegExp} label - Label or text.
 * @returns {HTMLElement | undefined} Button.
 */
const button = (label) =>
  [...document.querySelectorAll('button, [role="tab"]')].find((node) => {
    const name = node.getAttribute('aria-label') || node.textContent.trim();
    return label instanceof RegExp ? label.test(name) : name === label;
  });

/** The plugin page as Strapi mounts it: at `plugins/magic-sessionmanager/*`. */
const PluginPage = () => (
  <Routes>
    <Route path="/plugins/magic-sessionmanager/*" element={<App />} />
  </Routes>
);

/**
 * Plugin intervals that run right now (the harness counts every setInterval with its origin).
 * @param {string} file - Source file below admin/src.
 * @returns {number} Count.
 */
const runningIntervals = (file) =>
  [...globalThis.__strictHarness.resources.intervals.values()].filter((entry) =>
    entry.origin.includes(`admin/src/${file}`)
  ).length;

const live = (calls, pathname, method = 'GET') =>
  calls.filter((call) => call.method === method && call.pathname === pathname && !call.aborted);

test('plugin registration: menu link, settings links, widget and side panel are registered', () => {
  const app = {
    menu: [],
    settings: [],
    addMenuLink: (link) => app.menu.push(link),
    addSettingsLink: (_section, links) => app.settings.push(...links),
    registerPlugin: () => {},
    widgets: { register: (widget) => app.widgetList.push(widget) },
    widgetList: [],
  };
  plugin.register(app);
  assert.equal(app.menu.length, 1);
  assert.deepEqual(
    app.settings.map((link) => link.id),
    ['general', 'analytics']
  );
  assert.equal(app.widgetList.length, 1);
  const panels = [];
  plugin.bootstrap({
    getPlugin: () => ({ apis: { addEditViewSidePanel: (list) => panels.push(...list) } }),
  });
  assert.deepEqual(panels, [SessionInfoPanel]);
});

test('initializer: StrictMode mount reports the plugin and leaves nothing behind', async () => {
  const ready = [];
  await checkStrictEntry(<Initializer setPlugin={(id) => ready.push(id)} />);
  assert.ok(ready.length >= 1);
  assert.ok(ready.every((id) => id === 'magic-sessionmanager'));
});

test('session dashboard: StrictMode mount, one live list request, clock and auto refresh stop on unmount', async () => {
  dashboardRoutes();
  const result = await checkStrictEntry(<PluginPage />, {
    path: '/plugins/magic-sessionmanager',
    permissions: ALL,
    whileMounted() {
      // The relative-time clock and the 10-minute auto refresh; StrictMode's first mount cleared its own.
      assert.equal(runningIntervals('pages/HomePage.jsx'), 2);
    },
  });
  assert.match(result.html, /grace/);
  assert.equal(live(result.mountCalls, '/magic-sessionmanager/sessions').length, 1);
  assert.equal(live(result.mountCalls, '/magic-sessionmanager/sessions/stats').length, 1);
  assert.equal(runningIntervals('pages/HomePage.jsx'), 0);
});

test('session dashboard: details dialog and end-session confirmation open and close cleanly', async () => {
  dashboardRoutes();
  const result = await checkStrictEntry(<PluginPage />, {
    path: '/plugins/magic-sessionmanager',
    permissions: ALL,
    async whileMounted() {
      await click(button('View details for grace'));
      assert.ok(document.querySelector('[role="dialog"]'), 'details dialog is open');
      await click(button('Close'));
      assert.equal(document.querySelector('[role="dialog"]'), null, 'details dialog closed');
      await click(button('End session of grace'));
      assert.match(document.body.textContent, /End this session\?/);
      await click(button('Cancel'));
    },
  });
  assert.equal(result.calls.filter((call) => call.method !== 'GET').length, 0, 'no mutation');
});

test('session dashboard: the search field debounces without leaking its timer', async () => {
  dashboardRoutes();
  await checkStrictEntry(<PluginPage />, {
    path: '/plugins/magic-sessionmanager',
    permissions: ALL,
    async whileMounted(handle) {
      const input = handle.container.querySelector('input[type="search"], input[name="search"]');
      assert.ok(input, 'search input exists');
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        ).set;
        setter.call(input, 'grace');
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
      });
    },
  });
});

test('admin panel sessions: StrictMode mount, one live list request, clean unmount', async () => {
  network.on('GET', '/magic-sessionmanager/admin-sessions/admins', {
    data: [
      {
        id: 1,
        name: 'Ada Example',
        email: 'ada@example.test',
        roles: [{ name: 'Super Admin' }],
        account: 'active',
        sessionCount: 1,
        lastActiveAt: minutesAgo(2),
        self: true,
        canSignOut: false,
      },
    ],
    meta: {
      pagination: { page: 1, pageSize: 25, pageCount: 1, total: 1 },
      stats: { signedInAdmins: 1, activeSessions: 1, activeAccounts: 1, totalAdmins: 1 },
      supported: true,
    },
  });
  network.on('GET', '/magic-sessionmanager/admin-sessions/admins/1/sessions', {
    data: [session({ id: 31, user: undefined })],
    meta: {},
  });
  const result = await checkStrictEntry(<PluginPage />, {
    path: '/plugins/magic-sessionmanager/admin-panel',
    permissions: ALL,
    async whileMounted() {
      await click(button('View sessions of Ada Example'));
      assert.ok(document.querySelector('[role="dialog"]'), 'sessions dialog is open');
    },
  });
  assert.match(result.html, /Ada Example/);
  assert.equal(live(result.mountCalls, '/magic-sessionmanager/admin-sessions/admins').length, 1);
  assert.equal(
    live(result.calls, '/magic-sessionmanager/admin-sessions/admins/1/sessions').length,
    1
  );
  assert.equal(result.calls.filter((call) => call.method !== 'GET').length, 0, 'no mutation');
});

test('settings page: StrictMode mount shows the loaded form, tabs switch cleanly', async () => {
  network.on('GET', '/magic-sessionmanager/settings', { settings: {}, revision: 1 });
  network.on('GET', '/magic-sessionmanager/geoip/status', {
    status: { exists: false, hasCredentials: false },
  });
  const result = await checkStrictEntry(<Settings />, {
    path: '/settings/magic-sessionmanager/general',
    permissions: ALL,
    async whileMounted(handle) {
      assert.doesNotMatch(handle.container.textContent, /could not be loaded/i);
      for (const tab of [...document.querySelectorAll('[role="tab"]')].slice(1)) await click(tab);
    },
  });
  assert.equal(live(result.mountCalls, '/magic-sessionmanager/settings').length, 1);
  assert.equal(result.calls.filter((call) => call.method !== 'GET').length, 0, 'no mutation');
});

test('analytics page: StrictMode mount shows the aggregates, not the error state', async () => {
  network.on('GET', '/magic-sessionmanager/sessions/analytics', {
    data: {
      totalSessions: 2,
      activeSessions: 1,
      idleSessions: 0,
      endedSessions: 1,
      signInsLast24Hours: 2,
      signInsLast7Days: 2,
      uniqueUsers: 1,
      avgSessionDuration: 1800,
      devices: [{ name: 'desktop', count: 2 }],
      browsers: [{ name: 'Chrome', count: 2 }],
    },
  });
  const result = await checkStrictEntry(<Analytics />, {
    path: '/settings/magic-sessionmanager/analytics',
    permissions: ALL,
  });
  assert.doesNotMatch(result.html, /could not be loaded/i);
  assert.equal(live(result.mountCalls, '/magic-sessionmanager/sessions/analytics').length, 1);
});

test('homepage widget: StrictMode mount shows the counts, polls once and stops on unmount', async () => {
  dashboardRoutes();
  const result = await checkStrictEntry(<OnlineUsersWidget />, {
    permissions: [ACCESS],
    whileMounted: () => assert.equal(runningIntervals('components/OnlineUsersWidget.jsx'), 1),
  });
  // Before the fix the remount waited for the aborted first load and showed the error state.
  assert.doesNotMatch(result.html, /could not be loaded/i);
  assert.equal(live(result.mountCalls, '/magic-sessionmanager/sessions/stats').length, 1);
  assert.equal(live(result.mountCalls, '/magic-sessionmanager/users/stats').length, 1);
  assert.equal(runningIntervals('components/OnlineUsersWidget.jsx'), 0);
});

/** Lets throttled updates (Strapi's side panel renderer: 60 ms) and async work run. */
const wait = (ms) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));

/**
 * Content Manager edit view side panels: Strapi's DescriptionComponentRenderer renders the panel
 * description as a component and pushes its `{ title, content }` out, inside the edit view Form.
 * @param {object} props - Side panel props.
 * @returns {import('react').ReactElement} Panels.
 */
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

test('Content Manager side panel: StrictMode mount, one live request, confirmation dialog', async () => {
  network.on('GET', '/magic-sessionmanager/user/user-7/sessions', { data: SESSIONS });
  const document_ = { documentId: 'user-7', username: 'grace', blocked: false };
  const result = await checkStrictEntry(
    <Form method="PUT" initialValues={{ blocked: false }}>
      <SidePanelHost
        model={USER_MODEL}
        documentId="user-7"
        document={document_}
        collectionType="collection-types"
        activeTab="draft"
      />
    </Form>,
    {
      path: `/content-manager/collection-types/${USER_MODEL}/user-7`,
      permissions: ALL,
      async whileMounted() {
        await wait(150);
        await click(button('Block user'));
        assert.ok(document.querySelector('[role="alertdialog"], [role="dialog"]'));
        await click(button('Cancel'));
      },
    }
  );
  assert.match(result.html, /1 open session/);
  assert.equal(live(result.mountCalls, '/magic-sessionmanager/user/user-7/sessions').length, 1);
  assert.equal(result.calls.filter((call) => call.method !== 'GET').length, 0, 'no mutation');
});

test('Content Manager side panel: renders nothing for other content types', async () => {
  const result = await checkStrictEntry(
    <Form method="PUT" initialValues={{}}>
      <SidePanelHost model="api::article.article" documentId="a-1" document={{}} />
    </Form>,
    { permissions: ALL, whileMounted: () => wait(150) }
  );
  assert.equal(result.mountCalls.filter((call) => call.fromPlugin).length, 0);
});
