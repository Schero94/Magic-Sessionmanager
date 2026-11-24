import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActivityCsv,
  buildActivityParams,
  buildSignInCsv,
  buildSignInParams,
  getActivityTone,
  getEntryPath,
  getSessionStatePresentation,
  getSignInEventPresentation,
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

test('each sign-in event has its own label; danger is never used for an event', () => {
  const events = [
    'admin.sign-in',
    'admin.sign-in.failed',
    'admin.lockout',
    'admin.sign-out',
    'admin.session.revoked',
    'user.new-device',
  ].map((event) => getSignInEventPresentation({ event }));
  assert.equal(new Set(events.map((entry) => entry.label.messageId)).size, events.length);
  assert.ok(events.every((entry) => entry.tone !== 'danger'));
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
