import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActivityCsv,
  buildActivityParams,
  buildSignInCsv,
  buildSignInParams,
  getActivityTone,
  getEntryPath,
  getEventListLayout,
  getEventPlace,
  getSessionStatePresentation,
  getSignInEventPresentation,
  hasActivityPageFilters,
  parseActivityPageQuery,
  periodStart,
  toExportParams,
} from '../admin/src/pages/AdminPanel/adminActivityModel.mjs';

const NOW = new Date('2026-11-24T12:00:00.000Z');

test('periods: days back from now, "all" sends no start', () => {
  assert.equal(periodStart('1', NOW), '2026-11-23T12:00:00.000Z');
  assert.equal(periodStart('30', NOW), '2026-10-25T12:00:00.000Z');
  assert.equal(periodStart('all', NOW), undefined);
  assert.equal(periodStart('x', NOW), undefined);
});

test('list parameters: known filters only, admin as string, export drops paging', () => {
  assert.deepEqual(buildSignInParams({ adminId: 4, event: 'failed', period: '7' }, NOW), {
    page: 1,
    pageSize: 20,
    event: 'failed',
    adminId: '4',
    from: '2026-11-17T12:00:00.000Z',
  });
  assert.equal(buildSignInParams({ event: 'nope' }, NOW).event, 'all');
  assert.deepEqual(
    buildActivityParams({ action: 'publish', contentType: 'api::article.article' }, NOW),
    { page: 1, pageSize: 20, action: 'publish', contentType: 'api::article.article' }
  );
  assert.equal(buildActivityParams({ contentType: 'all' }, NOW).contentType, undefined);
  assert.deepEqual(toExportParams({ page: 2, pageSize: 20, event: 'all' }, '99'), {
    event: 'all',
    cursor: '99',
  });
});

test('each event has its own label, icon and one semantic tone in every list', () => {
  const events = [
    'admin.sign-in',
    'admin.sign-in.failed',
    'admin.lockout',
    'admin.sign-out',
    'admin.session.revoked',
    'settings.updated',
    'security-log.read',
    'security-log.retention.purged',
    'user.new-device',
  ].map((event) => getSignInEventPresentation({ event }));
  assert.equal(new Set(events.map((entry) => entry.label.messageId)).size, events.length);
  assert.equal(new Set(events.map((entry) => entry.icon)).size, events.length);
  assert.deepEqual(
    events.map((entry) => entry.tone),
    [
      'success',
      'danger',
      'danger',
      'neutral',
      'warning',
      'secondary',
      'secondary',
      'neutral',
      'neutral',
    ]
  );
  assert.equal(
    getSignInEventPresentation({
      event: 'security-log.read',
      read: { list: 'content', exported: true },
    }).detail.defaultMessage,
    'Content Manager activity exported'
  );
  assert.equal(
    getSignInEventPresentation({ event: 'settings.updated', change: { viaToken: true } }).detail
      .defaultMessage,
    'With an admin API token'
  );
  assert.equal(
    getSignInEventPresentation({ event: 'admin.sign-in.failed', reason: 'account_inactive' }).detail
      .defaultMessage,
    'Account is deactivated'
  );
  assert.equal(
    getSignInEventPresentation({ event: 'admin.session.revoked', scope: 'one_browser' }).detail
      .defaultMessage,
    'One browser'
  );
  assert.equal(getSessionStatePresentation({ state: 'unknown' }), null);
  assert.equal(getSessionStatePresentation({ state: 'active' }).tone, 'success');
});

test('entry links: open existing entries, never deleted ones or unknown types', () => {
  const row = (overrides) => ({
    action: 'update',
    contentType: { uid: 'api::article.article', kind: 'collection', exists: true },
    entry: { documentId: 'abc123', locale: 'de' },
    ...overrides,
  });
  assert.equal(
    getEntryPath(row()),
    '/content-manager/collection-types/api%3A%3Aarticle.article/abc123?plugins[i18n][locale]=de'
  );
  assert.equal(getEntryPath(row({ action: 'delete' })), null);
  assert.equal(
    getEntryPath(
      row({ contentType: { uid: 'api::gone.gone', kind: 'collection', exists: false } })
    ),
    null
  );
  assert.equal(
    getEntryPath(
      row({
        contentType: { uid: 'api::home.home', kind: 'single', exists: true },
        entry: { documentId: null, locale: null },
      })
    ),
    '/content-manager/single-types/api%3A%3Ahome.home'
  );
  assert.equal(getActivityTone('publish'), 'success');
  assert.equal(getActivityTone('view'), 'neutral');
});

test('CSV: stable English headers, machine values, formula injection neutralised', () => {
  const signIns = buildSignInCsv([
    {
      at: '2026-11-24T10:00:00.000Z',
      event: 'admin.sign-in',
      admin: { id: 1, name: '=HYPERLINK("x")' },
      ipAddress: '203.0.113.0',
      ipAnonymized: true,
      location: { country: 'Exampleland', city: 'Sample City' },
      browser: 'Chrome 131',
      os: 'macOS',
      deviceType: 'desktop',
      session: { state: 'active' },
    },
  ]).split('\n');
  assert.match(signIns[0], /^"Time","Event","Reason","Admin","Admin ID","IP Address"/);
  assert.match(signIns[1], /"'=HYPERLINK\(""x""\)"/);
  assert.match(signIns[1], /"203\.0\.113\.0","yes"/);
  const activity = buildActivityCsv([
    {
      at: '2026-11-24T10:00:00.000Z',
      action: 'delete',
      admin: { id: 2, name: 'Ben Muster' },
      contentType: { name: 'Article', uid: 'api::article.article' },
      entry: { documentId: null, locale: null, title: null, count: 3 },
    },
  ]).split('\n');
  assert.equal(activity[0].split(',').length, 10);
  assert.match(
    activity[1],
    /"delete","Ben Muster","2","Article","api::article.article","","","","3"/
  );
});

test('list layout follows the container width: stacked, table, full table', () => {
  assert.equal(getEventListLayout(0, { showAdmin: true }), 'full', 'unmeasured: desktop first');
  assert.equal(getEventListLayout(320, { showAdmin: true }), 'stacked');
  assert.equal(getEventListLayout(718, { showAdmin: true }), 'stacked', 'page at 768 px');
  assert.equal(getEventListLayout(800, { showAdmin: true }), 'table');
  assert.equal(getEventListLayout(654, { showAdmin: false }), 'stacked', 'dialog at 768 px');
  assert.equal(
    getEventListLayout(760, { showAdmin: false }),
    'table',
    'one admin: no Admin column'
  );
  assert.equal(getEventListLayout(999), 'table');
  assert.equal(getEventListLayout(1000), 'full');
});

test('activity page query: known values only, defaults otherwise', () => {
  assert.deepEqual(parseActivityPageQuery({}), {
    event: 'all',
    period: '30',
    adminId: null,
    page: 1,
    pageSize: 20,
  });
  assert.deepEqual(
    parseActivityPageQuery({
      event: 'changes',
      period: '7',
      adminId: '12',
      page: '3',
      pageSize: '50',
    }),
    { event: 'changes', period: '7', adminId: 12, page: 3, pageSize: 50 }
  );
  assert.deepEqual(
    parseActivityPageQuery({ event: 'x', period: '2', adminId: '0x1', page: '-1', pageSize: '7' }),
    { event: 'all', period: '30', adminId: null, page: 1, pageSize: 20 }
  );
  assert.equal(hasActivityPageFilters(parseActivityPageQuery({})), false);
  assert.equal(hasActivityPageFilters(parseActivityPageQuery({ adminId: '4' })), true);
  assert.equal(buildSignInParams({ event: 'changes' }, NOW).event, 'changes');
  assert.equal(
    getEventPlace({ location: { city: 'Sample City', country: 'Exampleland' } }),
    'Sample City, Exampleland'
  );
  assert.equal(getEventPlace({ location: null }), '');
});

test('app-user, impersonation and webhook events get their own label and a semantic tone', () => {
  const expected = {
    'user.sign-in.failed': 'danger',
    'user.sign-in.refused': 'danger',
    'user.lockout': 'danger',
    'user.lockout.lifted': 'secondary',
    'user.session.limit': 'warning',
    'user.password-change.ended-others': 'warning',
    'user.sign-in.new-device': 'secondary',
    'user.sign-in.impossible-travel': 'danger',
    'user.not-me': 'danger',
    'user.data.exported': 'secondary',
    'impersonation.started': 'warning',
    'webhook.delivered': 'neutral',
  };
  const labels = new Set();
  for (const [event, tone] of Object.entries(expected)) {
    const presentation = getSignInEventPresentation({ event });
    assert.equal(presentation.tone, tone, event);
    assert.notEqual(presentation.key, 'other', `${event} has its own presentation`);
    labels.add(presentation.label.messageId);
  }
  assert.equal(labels.size, Object.keys(expected).length);
});
