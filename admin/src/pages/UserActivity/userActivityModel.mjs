import { escapeCsvValue } from '../../utils/sessionExports.mjs';
import {
  ACTIVITY_PAGE_SIZE_OPTIONS,
  EVENT_PAGE_SIZE,
  PERIOD_OPTIONS,
  periodStart,
} from '../AdminPanel/adminActivityModel.mjs';

/**
 * Pure helpers of the app-user security activity (4.22): filter options,
 * request parameters, the URL state of the full page, the second line of
 * every event in plain words, links and the CSV export. The labels, tones
 * and icons of the events come from the shared getEventPresentation
 * (AdminPanel/adminActivityModel.mjs), so an event looks the same in every
 * list. No React, so `node --test` covers it.
 */

/** Plugin id (pluginId.js; repeated so `node --test` loads this module without a bundler). */
const pluginId = 'magic-sessionmanager';

/** Filter groups (API values of `event`), in menu order. */
export const USER_ACTIVITY_FILTER_OPTIONS = Object.freeze([
  'all',
  'failed',
  'lockouts',
  'suspicious',
  'sessions',
  'privacy',
  'impersonation',
]);

/** Labels of the filter groups. */
export const USER_ACTIVITY_FILTER_LABELS = Object.freeze({
  all: ['userActivity.filter.all', 'All events'],
  failed: ['userActivity.filter.failed', 'Failed and refused sign-ins'],
  lockouts: ['userActivity.filter.lockouts', 'Lockouts and unlocks'],
  suspicious: [
    'userActivity.filter.suspicious',
    'New devices, impossible travel, “This wasn’t me”',
  ],
  sessions: ['userActivity.filter.sessions', 'Session limit and password change'],
  privacy: ['userActivity.filter.privacy', 'Personal data exports'],
  impersonation: ['userActivity.filter.impersonation', 'Impersonation'],
});

/** Admin API path of the list (the export is `${path}/export`). */
export const USER_ACTIVITY_API_PATH = `/${pluginId}/user-activity`;

/** Full page (relative to the admin root). */
export const USER_ACTIVITY_PAGE_PATH = `/plugins/${pluginId}/app-users/activity`;

/** Settings tab with "Record failed and refused sign-ins". */
export const USER_ACTIVITY_SETTINGS_PATH = `/settings/${pluginId}/general?tab=login-protection`;

/** Events in the card on the App users tab. */
export const RECENT_USER_EVENT_LIMIT = 8;

/** Events in the user's Sessions panel in the Content Manager. */
export const PANEL_USER_EVENT_LIMIT = 3;

/** Content Manager uid of Users & Permissions users. */
const USER_UID = 'plugin::users-permissions.user';

/** Shape of a Users & Permissions documentId. */
const DOCUMENT_ID = /^[A-Za-z0-9]{1,64}$/;

/**
 * Full page path, optionally filtered to one user ("Show all" of the panel).
 *
 * @param {string|null|undefined} [userId] documentId of the user.
 * @returns {string} Path relative to the admin root.
 */
export function userActivityPagePath(userId) {
  return typeof userId === 'string' && DOCUMENT_ID.test(userId)
    ? `${USER_ACTIVITY_PAGE_PATH}?userId=${encodeURIComponent(userId)}`
    : USER_ACTIVITY_PAGE_PATH;
}

/**
 * Content Manager edit view of an app user, or null.
 *
 * @param {{documentId?: string}|null|undefined} user User of a row.
 * @returns {string|null} Path relative to the admin root.
 */
export function getUserEntryPath(user) {
  if (!user || typeof user.documentId !== 'string' || !DOCUMENT_ID.test(user.documentId)) {
    return null;
  }
  return `/content-manager/collection-types/${USER_UID}/${encodeURIComponent(user.documentId)}`;
}

/**
 * Query of the list.
 *
 * @param {{event?: string, userId?: string|null, period?: string, page?: number,
 *   pageSize?: number}} filters Filters.
 * @param {Date} [now] Clock.
 * @returns {Record<string, string|number>} Query parameters.
 */
export function buildUserActivityParams(filters, now) {
  const params = {
    page: filters.page || 1,
    pageSize: filters.pageSize || EVENT_PAGE_SIZE,
    event: USER_ACTIVITY_FILTER_OPTIONS.includes(filters.event) ? filters.event : 'all',
  };
  if (typeof filters.userId === 'string' && DOCUMENT_ID.test(filters.userId)) {
    params.userId = filters.userId;
  }
  const from = periodStart(filters.period || 'all', now);
  if (from) params.from = from;
  return params;
}

/**
 * Filters of the full page from the URL query. Unknown values fall back to
 * the defaults, so a hand-edited URL never breaks the page.
 *
 * @param {Record<string, unknown>|null|undefined} query Parsed URL query.
 * @returns {{event: string, period: string, userId: string|null, page: number,
 *   pageSize: number}} Filters.
 */
export function parseUserActivityQuery(query) {
  const source = query || {};
  const event = USER_ACTIVITY_FILTER_OPTIONS.includes(String(source.event))
    ? String(source.event)
    : 'all';
  const period = PERIOD_OPTIONS.includes(String(source.period)) ? String(source.period) : '30';
  const userId = DOCUMENT_ID.test(String(source.userId ?? '')) ? String(source.userId) : null;
  const page = Number.parseInt(String(source.page ?? ''), 10);
  const pageSize = String(source.pageSize ?? '');
  return {
    event,
    period,
    userId,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: ACTIVITY_PAGE_SIZE_OPTIONS.includes(pageSize) ? Number(pageSize) : EVENT_PAGE_SIZE,
  };
}

/**
 * Whether the page shows a narrowed list (for "Clear filters").
 *
 * @param {{event: string, period: string, userId: string|null}} view Parsed filters.
 * @returns {boolean} True when a filter differs from the default.
 */
export function hasUserActivityFilters(view) {
  return view.event !== 'all' || view.period !== '30' || view.userId !== null;
}

const message = (messageId, defaultMessage, values) => ({
  messageId,
  defaultMessage,
  ...(values ? { values } : {}),
});

const REFUSAL_REASONS = Object.freeze({
  lockout: message('userActivity.detail.refused.lockout', 'The account or IP address was locked'),
  'too-many-attempts': message(
    'userActivity.detail.refused.tooMany',
    'Too many sign-ins at the same time'
  ),
  country: message('userActivity.detail.refused.country', 'Sign-ins from this country are blocked'),
  risk: message('userActivity.detail.refused.risk', 'Risky address (VPN, proxy or Tor)'),
  'location-unavailable': message(
    'userActivity.detail.refused.location',
    'The location could not be checked'
  ),
});

const IMPERSONATION_REFUSALS = Object.freeze({
  disabled: message('userActivity.detail.impersonation.disabled', 'Impersonation is turned off'),
  blocked: message('userActivity.detail.impersonation.blocked', 'The account is blocked'),
  'already-active': message(
    'userActivity.detail.impersonation.alreadyActive',
    'Someone is already impersonating this user'
  ),
  'api-token': message(
    'userActivity.detail.impersonation.apiToken',
    'Admin API tokens cannot impersonate'
  ),
  'call-credentials': message(
    'userActivity.detail.impersonation.callCredentials',
    'A sign-in, password or email request was blocked'
  ),
  'call-account': message(
    'userActivity.detail.impersonation.callAccount',
    'A data export or “This wasn’t me” request was blocked'
  ),
  'call-sessions': message(
    'userActivity.detail.impersonation.callSessions',
    'A request to end sessions was blocked'
  ),
  // 4.22.1: every GraphQL mutation is refused while impersonating.
  'call-mutation': message(
    'userActivity.detail.impersonation.callMutation',
    'A GraphQL mutation was blocked'
  ),
});

const UNKNOWN_ACCOUNT = message(
  'userActivity.detail.unknownAccount',
  'No account with this email or username'
);

/**
 * What happened, in plain words, as message descriptors (the second line of
 * the event cell and the "What happened" row of the details). Only facts the
 * server returned are used; an event without facts has no second line.
 *
 * @param {{event: string, details?: Record<string, any>|null}} row App-user event row.
 * @returns {Array<{messageId: string, defaultMessage: string, values?: object}>} Parts.
 */
export function getUserEventDetail(row) {
  const d = row?.details || {};
  const parts = [];
  switch (row?.event) {
    case 'user.sign-in.failed':
      if (d.unknownAccount) parts.push(UNKNOWN_ACCOUNT);
      break;
    case 'user.sign-in.refused':
      if (d.reason === 'session-limit') {
        parts.push(
          Number.isInteger(d.limit)
            ? message(
                'userActivity.detail.refused.limit',
                'Session limit of {limit, number} reached',
                { limit: d.limit }
              )
            : message('userActivity.detail.refused.limitReached', 'Session limit reached')
        );
      } else if (REFUSAL_REASONS[d.reason]) parts.push(REFUSAL_REASONS[d.reason]);
      if (d.unknownAccount) parts.push(UNKNOWN_ACCOUNT);
      break;
    case 'user.lockout':
      if (Number.isInteger(d.minutes) && Number.isInteger(d.failures)) {
        parts.push(
          d.kind === 'ip'
            ? message(
                'userActivity.detail.lockout.ip',
                'IP address locked for {minutes, plural, one {# minute} other {# minutes}} after {failures, plural, one {# failed sign-in} other {# failed sign-ins}}',
                { minutes: d.minutes, failures: d.failures }
              )
            : message(
                'userActivity.detail.lockout.account',
                'Account locked for {minutes, plural, one {# minute} other {# minutes}} after {failures, plural, one {# failed sign-in} other {# failed sign-ins}}',
                { minutes: d.minutes, failures: d.failures }
              )
        );
      }
      break;
    case 'user.lockout.lifted':
      parts.push(
        d.kind === 'ip'
          ? message('userActivity.detail.unlock.ip', 'An admin unlocked an IP address')
          : message('userActivity.detail.unlock.account', 'An admin unlocked the account')
      );
      break;
    case 'user.session.limit':
      if (Number.isInteger(d.ended)) {
        parts.push(
          Number.isInteger(d.limit)
            ? message(
                'userActivity.detail.limit.ended',
                '{ended, plural, one {# older session} other {# older sessions}} ended to stay within {limit, number}',
                { ended: d.ended, limit: d.limit }
              )
            : message(
                'userActivity.detail.limit.endedOnly',
                '{ended, plural, one {# older session} other {# older sessions}} ended',
                { ended: d.ended }
              )
        );
      }
      break;
    case 'user.password-change.ended-others':
      if (Number.isInteger(d.ended)) {
        parts.push(
          message(
            'userActivity.detail.password.ended',
            '{ended, plural, =0 {No other session was open} one {# other session ended} other {# other sessions ended}}',
            { ended: d.ended }
          )
        );
      }
      break;
    case 'user.sign-in.impossible-travel':
      if (Number.isInteger(d.distanceKm) && Number.isInteger(d.speedKmh)) {
        parts.push(
          message(
            'userActivity.detail.travel.distance',
            '{distance, number} km from the last sign-in, {speed, number} km/h',
            { distance: d.distanceKm, speed: d.speedKmh }
          )
        );
      }
      if (d.from && d.to) {
        parts.push(
          message('userActivity.detail.travel.countries', '{from} to {to}', {
            from: d.from,
            to: d.to,
          })
        );
      }
      if (d.action === 'reauthenticate') {
        parts.push(
          message(
            'userActivity.detail.travel.reauthenticate',
            'All sessions ended, a new sign-in was required'
          )
        );
      }
      break;
    case 'user.not-me':
      parts.push(
        d.scope === 'all'
          ? message('userActivity.detail.notMe.all', 'The user ended all their sessions')
          : message('userActivity.detail.notMe.session', 'The user ended that session')
      );
      break;
    case 'user.data.exported':
      if (Number.isInteger(d.sessions) && Number.isInteger(d.events)) {
        parts.push(
          message(
            'userActivity.detail.export.counts',
            'The user downloaded {count, plural, one {# session} other {# sessions}} and {events, plural, one {# security event} other {# security events}}',
            { count: d.sessions, events: d.events }
          )
        );
      }
      break;
    case 'impersonation.started':
      if (Number.isInteger(d.durationMinutes)) {
        parts.push(
          message(
            'userActivity.detail.impersonation.duration',
            'For {minutes, plural, one {# minute} other {# minutes}}',
            { minutes: d.durationMinutes }
          )
        );
      }
      break;
    case 'impersonation.ended':
      if (d.endReason === 'disabled') {
        parts.push(
          message(
            'userActivity.detail.impersonation.endedDisabled',
            'Ended because impersonation was turned off'
          )
        );
      } else if (d.endReason === 'failed') {
        parts.push(
          message('userActivity.detail.impersonation.endedFailed', 'Could not be completed')
        );
      } else {
        parts.push(message('userActivity.detail.impersonation.endedByAdmin', 'Ended by an admin'));
      }
      break;
    case 'impersonation.expired':
      parts.push(message('userActivity.detail.impersonation.expired', 'The time ran out'));
      break;
    case 'impersonation.refused':
      if (IMPERSONATION_REFUSALS[d.refusal]) parts.push(IMPERSONATION_REFUSALS[d.refusal]);
      break;
    default:
      break;
  }
  return parts;
}

/** CSV columns (stable English identifiers, not translated). */
export const USER_ACTIVITY_CSV_HEADERS = Object.freeze([
  'Time',
  'Event',
  'Reason',
  'User',
  'User ID',
  'User Document ID',
  'IP Address',
  'IP Anonymized',
  'Country',
  'City',
  'Browser',
  'OS',
  'Device',
  'Done By',
  'Done By Admin ID',
]);

/**
 * App-user security activity as CSV. Values are machine data (event names,
 * codes, ISO times), independent of the admin language; the email is only
 * there when the server returned it to this reader. User-controlled text is
 * quoted and formula-escaped.
 *
 * @param {object[]} rows Rows from the API.
 * @returns {string} CSV text.
 */
export function buildUserActivityCsv(rows) {
  const lines = rows.map((row) => {
    const d = row.details || {};
    return [
      row.at || '',
      row.event || '',
      d.reason || d.refusal || d.endReason || d.kind || d.scope || '',
      row.user?.email || row.user?.username || '',
      row.user?.id ?? '',
      row.user?.documentId || '',
      row.ipAddress || '',
      row.ipAnonymized ? 'yes' : 'no',
      row.location?.country || '',
      row.location?.city || '',
      row.browser || '',
      row.os || '',
      row.deviceType || '',
      row.actor?.type === 'system' ? 'system' : row.actor?.name || '',
      row.actor?.type === 'admin' ? (row.actor.id ?? '') : '',
    ];
  });
  return [USER_ACTIVITY_CSV_HEADERS, ...lines]
    .map((cells) => cells.map(escapeCsvValue).join(','))
    .join('\n');
}
