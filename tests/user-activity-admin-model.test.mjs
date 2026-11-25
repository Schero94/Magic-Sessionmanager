// App-user security activity in the admin (4.22): every event type has its own plain label,
// colour and icon, the second line says what happened, the URL state and request parameters are
// bounded, and the CSV holds machine values only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  getEventListLayout,
  getEventPresentation,
  getSignInEventPresentation,
} from '../admin/src/pages/AdminPanel/adminActivityModel.mjs';
import {
  doneByText,
  userEventDetailText,
  userText,
} from '../admin/src/pages/AdminPanel/eventText.mjs';
import {
  USER_ACTIVITY_FILTER_LABELS,
  USER_ACTIVITY_FILTER_OPTIONS,
  buildUserActivityCsv,
  buildUserActivityParams,
  getUserEntryPath,
  getUserEventDetail,
  hasUserActivityFilters,
  parseUserActivityQuery,
  userActivityPagePath,
} from '../admin/src/pages/UserActivity/userActivityModel.mjs';

const require = createRequire(import.meta.url);
const {
  USER_ACTIVITY_EVENTS,
  USER_ACTIVITY_FILTERS,
} = require('../server/src/utils/user-activity-model');
const en = require('../admin/src/translations/en.json');

/** English translator with ICU-free placeholder filling (enough for these checks). */
const t = (id, defaultMessage, values = {}) => {
  const message = en[`${id}`] ?? defaultMessage;
  return message
    .replace(
      /\{(\w+), plural, (?:=0 \{([^}]*)\} )?one \{([^}]*)\} other \{([^}]*)\}\}/g,
      (_, key, zero, one, other) => {
        const n = values[key];
        const chosen = n === 0 && zero !== undefined ? zero : n === 1 ? one : other;
        return chosen.replace('#', String(n));
      }
    )
    .replace(/\{(\w+)(?:, number)?\}/g, (_, key) => String(values[key] ?? `{${key}}`));
};

test('every app-user event has its own plain label, tone and icon (no generic fallback)', () => {
  const keys = new Set();
  for (const event of USER_ACTIVITY_EVENTS) {
    const presentation = getEventPresentation({ event });
    assert.notEqual(presentation.key, 'other', event);
    assert.notEqual(presentation.key, 'impersonation', `${event} has a specific label`);
    assert.ok(en[presentation.label.messageId], `${event}: label in en.json`);
    assert.equal(en[presentation.label.messageId], presentation.label.defaultMessage);
    assert.doesNotMatch(
      presentation.label.defaultMessage,
      /App user/,
      'the view says that already'
    );
    keys.add(presentation.key);
  }
  assert.equal(keys.size, USER_ACTIVITY_EVENTS.length, 'one presentation per event');
  // Security signals are red; housekeeping is not.
  assert.equal(getEventPresentation({ event: 'user.sign-in.failed' }).tone, 'danger');
  assert.equal(getEventPresentation({ event: 'user.not-me' }).tone, 'danger');
  assert.equal(getEventPresentation({ event: 'impersonation.expired' }).tone, 'neutral');
  assert.equal(getSignInEventPresentation, getSignInEventPresentation, 'the 4.19 name stays');
});

test('the server filter groups and the admin filter menu match', () => {
  assert.deepEqual(USER_ACTIVITY_FILTER_OPTIONS, Object.keys(USER_ACTIVITY_FILTERS));
  for (const option of USER_ACTIVITY_FILTER_OPTIONS) {
    const [id, defaultMessage] = USER_ACTIVITY_FILTER_LABELS[option];
    assert.equal(en[id], defaultMessage, option);
  }
});

test('what happened, in plain words', () => {
  const detail = (row) => userEventDetailText(t, row);
  assert.equal(
    detail({ event: 'user.lockout', details: { kind: 'account', failures: 5, minutes: 15 } }),
    'Account locked for 15 minutes after 5 failed sign-ins'
  );
  assert.equal(
    detail({ event: 'user.lockout', details: { kind: 'ip', failures: 1, minutes: 1 } }),
    'IP address locked for 1 minute after 1 failed sign-in'
  );
  assert.equal(
    detail({ event: 'user.sign-in.refused', details: { reason: 'risk', unknownAccount: true } }),
    'Risky address (VPN, proxy or Tor) · No account with this email or username'
  );
  assert.equal(
    detail({ event: 'user.password-change.ended-others', details: { ended: 0 } }),
    'No other session was open'
  );
  assert.equal(
    detail({
      event: 'user.sign-in.impossible-travel',
      details: { distanceKm: 9100, speedKmh: 4550, from: 'DE', to: 'US', action: 'reauthenticate' },
    }),
    '9100 km from the last sign-in, 4550 km/h · DE to US · All sessions ended, a new sign-in was required'
  );
  assert.equal(
    detail({ event: 'impersonation.refused', details: { refusal: 'call-credentials' } }),
    'A sign-in, password or email request was blocked'
  );
  assert.equal(
    detail({ event: 'impersonation.refused', details: { refusal: 'call-mutation' } }),
    'A GraphQL mutation was blocked'
  );
  assert.equal(
    userEventDetailText(
      t,
      {
        event: 'user.lockout.lifted',
        details: { kind: 'account' },
        actor: { type: 'admin', id: 1, name: 'Ada' },
      },
      true
    ),
    'An admin unlocked the account · by Ada'
  );
  assert.deepEqual(getUserEventDetail({ event: 'user.sign-in.new-device', details: {} }), []);
  assert.deepEqual(getUserEventDetail({ event: 'user.lockout', details: null }), []);
});

test('who: email, username, User #id, IP address or Unknown account; who did it', () => {
  assert.equal(
    userText(t, { user: { id: 7, email: 'ann@example.test', username: 'ann' } }),
    'ann@example.test'
  );
  assert.equal(userText(t, { user: { id: 7, email: '', username: 'ann' } }), 'ann');
  assert.equal(userText(t, { user: { id: 7, email: '', username: '' } }), 'User #7');
  assert.equal(userText(t, { user: null, target: 'ip' }), 'IP address');
  assert.equal(userText(t, { user: null, target: 'user' }), 'Unknown account');
  assert.equal(doneByText(t, { actor: { type: 'system', id: null, name: '' } }), 'Automatic');
  assert.equal(doneByText(t, { actor: { type: 'admin', id: 4, name: '' } }), 'Admin #4');
  assert.equal(doneByText(t, { actor: null }), '');
});

test('URL state and request parameters are bounded', () => {
  const view = parseUserActivityQuery({
    event: 'failed',
    period: '7',
    userId: 'usrann',
    page: '2',
    pageSize: '50',
  });
  assert.deepEqual(view, { event: 'failed', period: '7', userId: 'usrann', page: 2, pageSize: 50 });
  assert.deepEqual(
    parseUserActivityQuery({ event: 'x', period: '3', userId: 'a b', page: '-1', pageSize: '7' }),
    { event: 'all', period: '30', userId: null, page: 1, pageSize: 20 }
  );
  assert.equal(hasUserActivityFilters(parseUserActivityQuery({})), false);
  assert.equal(hasUserActivityFilters(view), true);
  const now = new Date('2026-11-25T12:00:00Z');
  assert.deepEqual(buildUserActivityParams({ ...view }, now), {
    page: 2,
    pageSize: 50,
    event: 'failed',
    userId: 'usrann',
    from: '2026-11-18T12:00:00.000Z',
  });
  assert.equal(
    userActivityPagePath('usrann'),
    '/plugins/magic-sessionmanager/app-users/activity?userId=usrann'
  );
  assert.equal(userActivityPagePath('../x'), '/plugins/magic-sessionmanager/app-users/activity');
  assert.equal(
    getUserEntryPath({ documentId: 'usrann' }),
    '/content-manager/collection-types/plugin::users-permissions.user/usrann'
  );
  assert.equal(getUserEntryPath({ documentId: '../admin' }), null);
});

test('CSV: machine values, hidden emails stay hidden, formulas are escaped', () => {
  const csv = buildUserActivityCsv([
    {
      at: '2026-11-25T12:00:00.000Z',
      event: 'user.sign-in.refused',
      details: { reason: 'session-limit' },
      user: { id: 8, documentId: 'usrben', email: '', username: '=cmd()' },
      ipAddress: '198.51.100.0',
      ipAnonymized: true,
      actor: { type: 'system', id: null, name: '' },
    },
  ]).split('\n');
  assert.match(csv[0], /^"Time","Event","Reason","User","User ID","User Document ID","IP Address"/);
  assert.equal(
    csv[1],
    '"2026-11-25T12:00:00.000Z","user.sign-in.refused","session-limit","\'=cmd()","8","usrben","198.51.100.0","yes","","","","","","system",""'
  );
});

test('the list layout takes a subject column into account', () => {
  assert.equal(getEventListLayout(0, { wide: true }), 'full');
  assert.equal(getEventListLayout(760, { wide: true }), 'stacked');
  assert.equal(getEventListLayout(760), 'table');
  assert.equal(getEventListLayout(900, { showAdmin: true }), 'table');
  assert.equal(getEventListLayout(320), 'stacked');
  assert.equal(getEventListLayout(1200, { wide: true }), 'full');
});

test('the admin log names exports of the app-user activity', () => {
  const panel = getEventPresentation({
    event: 'security-log.read',
    read: { list: 'user-activity', exported: true, via: 'admin-panel' },
  });
  assert.equal(panel.label.defaultMessage, 'Security log exported');
  assert.equal(panel.detail.defaultMessage, 'App-user security activity exported');
  const token = getEventPresentation({
    event: 'security-log.read',
    read: { list: 'user-activity', exported: false, via: 'admin-token' },
  });
  assert.equal(token.label.defaultMessage, 'Log read with an API token');
  assert.equal(token.detail.defaultMessage, 'App-user security activity listed');
});
