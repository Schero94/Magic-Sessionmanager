import { escapeCsvValue } from '../../utils/sessionExports.mjs';

/**
 * Pure helpers of the admin sign-in history and Content Manager activity
 * views: filter options, request parameters, one presentation table per
 * event, entry links and CSV export. No React, so `node --test` covers them.
 */

/** Sign-in history filter (API values of `event`). */
export const SIGN_IN_FILTER_OPTIONS = Object.freeze(['all', 'succeeded', 'failed', 'signed-out']);

/** Content Manager action filter (API values of `action`). */
export const ACTIVITY_ACTION_OPTIONS = Object.freeze([
  'all',
  'view',
  'create',
  'update',
  'publish',
  'unpublish',
  'discard',
  'delete',
  'clone',
]);

/** Period filter: days back from now, or `all`. */
export const PERIOD_OPTIONS = Object.freeze(['1', '7', '30', '90', 'all']);

/** Rows per page of either list. */
export const EVENT_PAGE_SIZE = 20;

/** Most rows in one CSV export. */
export const MAX_EVENT_EXPORT_ROWS = 10000;

/**
 * Start of a period as ISO date, or undefined for "all".
 *
 * @param {string} period One of PERIOD_OPTIONS.
 * @param {Date} [now] Clock.
 * @returns {string|undefined} ISO date.
 */
export function periodStart(period, now = new Date()) {
  const days = Number.parseInt(period, 10);
  if (!Number.isInteger(days) || days <= 0) return undefined;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Query of the sign-in history list.
 *
 * @param {{adminId?: number, event?: string, period?: string, page?: number, pageSize?: number}} filters
 * @param {Date} [now] Clock.
 * @returns {Record<string, string|number>} Query parameters.
 */
export function buildSignInParams(filters, now) {
  const params = {
    page: filters.page || 1,
    pageSize: filters.pageSize || EVENT_PAGE_SIZE,
    event: SIGN_IN_FILTER_OPTIONS.includes(filters.event) ? filters.event : 'all',
  };
  if (filters.adminId) params.adminId = String(filters.adminId);
  const from = periodStart(filters.period || 'all', now);
  if (from) params.from = from;
  return params;
}

/**
 * Query of the activity list.
 *
 * @param {{adminId?: number, action?: string, contentType?: string, period?: string,
 *   page?: number, pageSize?: number}} filters
 * @param {Date} [now] Clock.
 * @returns {Record<string, string|number>} Query parameters.
 */
export function buildActivityParams(filters, now) {
  const params = {
    page: filters.page || 1,
    pageSize: filters.pageSize || EVENT_PAGE_SIZE,
    action: ACTIVITY_ACTION_OPTIONS.includes(filters.action) ? filters.action : 'all',
  };
  if (filters.adminId) params.adminId = String(filters.adminId);
  if (filters.contentType && filters.contentType !== 'all')
    params.contentType = filters.contentType;
  const from = periodStart(filters.period || 'all', now);
  if (from) params.from = from;
  return params;
}

/** Export query: the list filters without paging. */
export function toExportParams(params, cursor) {
  const { page: _page, pageSize: _pageSize, ...rest } = params;
  return cursor ? { ...rest, cursor } : rest;
}

const message = (messageId, defaultMessage) => ({ messageId, defaultMessage });

/** Failed sign-in reasons as Strapi reports them. */
const FAILURE_REASONS = Object.freeze({
  invalid_credentials: message(
    'adminPanel.activity.reason.invalidCredentials',
    'Wrong email or password'
  ),
  account_inactive: message('adminPanel.activity.reason.accountInactive', 'Account is deactivated'),
  login_not_allowed: message('adminPanel.activity.reason.notAllowed', 'Sign-in is not allowed'),
  rate_limited: message('adminPanel.activity.reason.rateLimited', 'Too many attempts'),
});

/**
 * One presentation per sign-in history event: label, badge tone and an
 * optional detail. Danger is not used: a failed attempt is a warning, a
 * sign-out is neutral.
 *
 * @param {{event: string, reason?: string|null, scope?: string|null}} row Event row.
 * @returns {{key: string, tone: string, label: {messageId: string, defaultMessage: string},
 *   detail: {messageId: string, defaultMessage: string}|null}} Presentation.
 */
export function getSignInEventPresentation(row) {
  switch (row?.event) {
    case 'admin.sign-in':
      return {
        key: 'sign-in',
        tone: 'success',
        label: message('adminPanel.activity.event.signIn', 'Signed in'),
        detail:
          row.reason === 'registration'
            ? message('adminPanel.activity.reason.registration', 'First sign-in after registration')
            : row.reason === 'password_reset'
              ? message(
                  'adminPanel.activity.reason.passwordReset',
                  'Signed in after a password reset'
                )
              : null,
      };
    case 'admin.sign-in.failed':
      return {
        key: 'failed',
        tone: 'warning',
        label: message('adminPanel.activity.event.failed', 'Sign-in failed'),
        detail: FAILURE_REASONS[row.reason] || null,
      };
    case 'admin.lockout':
      return {
        key: 'lockout',
        tone: 'warning',
        label: message('adminPanel.activity.event.lockout', 'Locked out'),
        detail: FAILURE_REASONS.rate_limited,
      };
    case 'admin.sign-out':
      return {
        key: 'sign-out',
        tone: 'neutral',
        label: message('adminPanel.activity.event.signOut', 'Signed out'),
        detail: null,
      };
    case 'admin.session.revoked':
      return {
        key: 'revoked',
        tone: 'neutral',
        label: message('adminPanel.activity.event.revoked', 'Signed out by an admin'),
        detail:
          row.scope === 'one_browser'
            ? message('adminPanel.activity.scope.oneBrowser', 'One browser')
            : message('adminPanel.activity.scope.everywhere', 'Every browser'),
      };
    default:
      return {
        key: 'other',
        tone: 'neutral',
        label: message('adminPanel.activity.event.other', 'Security event'),
        detail: null,
      };
  }
}

/**
 * Session state of a sign-in, or null when it is not known.
 *
 * @param {{state?: string}|null|undefined} session Session field of a sign-in row.
 * @returns {{tone: string, label: {messageId: string, defaultMessage: string}}|null} Presentation.
 */
export function getSessionStatePresentation(session) {
  switch (session?.state) {
    case 'active':
      return {
        tone: 'success',
        label: message('adminPanel.activity.session.active', 'Still signed in'),
      };
    case 'signed-out':
      return {
        tone: 'neutral',
        label: message('adminPanel.activity.session.signedOut', 'Signed out'),
      };
    case 'ended':
      return {
        tone: 'neutral',
        label: message('adminPanel.activity.session.ended', 'Session ended'),
      };
    default:
      return null;
  }
}

/** Labels of Content Manager actions (activity rows and the filter). */
export const ACTIVITY_ACTION_LABELS = Object.freeze({
  all: message('adminPanel.activity.action.all', 'All actions'),
  view: message('adminPanel.activity.action.view', 'Opened'),
  create: message('adminPanel.activity.action.create', 'Created'),
  update: message('adminPanel.activity.action.update', 'Edited'),
  publish: message('adminPanel.activity.action.publish', 'Published'),
  unpublish: message('adminPanel.activity.action.unpublish', 'Unpublished'),
  discard: message('adminPanel.activity.action.discard', 'Discarded draft'),
  delete: message('adminPanel.activity.action.delete', 'Deleted'),
  clone: message('adminPanel.activity.action.clone', 'Duplicated'),
});

/**
 * Badge tone of an activity row: changes that reach the public site stand
 * out (publish success, delete warning); everything else is neutral. The DS
 * primary badge is not used: it measured 2.43:1 in the dark theme.
 *
 * @param {string} action Action.
 * @returns {string} Tone.
 */
export function getActivityTone(action) {
  if (action === 'publish') return 'success';
  if (action === 'delete') return 'warning';
  return 'neutral';
}

/**
 * Admin route of the entry in the Content Manager, or null when there is
 * nothing to open (deleted entry, unknown type, bulk action).
 *
 * @param {{action: string, contentType?: {uid: string, kind: string, exists: boolean},
 *   entry?: {documentId: string|null, locale: string|null}}} row Activity row.
 * @returns {string|null} Path relative to the admin root.
 */
export function getEntryPath(row) {
  const type = row?.contentType;
  if (!type?.exists || row.action === 'delete') return null;
  const uid = encodeURIComponent(type.uid);
  const locale = row.entry?.locale
    ? `?plugins[i18n][locale]=${encodeURIComponent(row.entry.locale)}`
    : '';
  if (type.kind === 'single') return `/content-manager/single-types/${uid}${locale}`;
  if (!row.entry?.documentId) return null;
  return `/content-manager/collection-types/${uid}/${encodeURIComponent(row.entry.documentId)}${locale}`;
}

/** CSV columns of the sign-in history (stable English identifiers, not translated). */
export const SIGN_IN_CSV_HEADERS = Object.freeze([
  'Time',
  'Event',
  'Reason',
  'Admin',
  'Admin ID',
  'IP Address',
  'IP Anonymized',
  'Country',
  'City',
  'Browser',
  'OS',
  'Device',
  'Session',
  'Signed Out By',
]);

/** CSV columns of the activity list. */
export const ACTIVITY_CSV_HEADERS = Object.freeze([
  'Time',
  'Action',
  'Admin',
  'Admin ID',
  'Content Type',
  'Content Type UID',
  'Document ID',
  'Locale',
  'Title',
  'Entries',
]);

/**
 * @param {readonly string[]} headers Column names.
 * @param {Array<Array<unknown>>} rows Cell values.
 * @returns {string} CSV text.
 */
const toCsv = (headers, rows) =>
  [headers, ...rows].map((cells) => cells.map(escapeCsvValue).join(',')).join('\n');

/**
 * Sign-in history as CSV. Values are machine data (event names, ISO times),
 * independent of the admin language; user-controlled text is quoted and
 * formula-escaped.
 *
 * @param {object[]} rows Sign-in rows from the API.
 * @returns {string} CSV text.
 */
export function buildSignInCsv(rows) {
  return toCsv(
    SIGN_IN_CSV_HEADERS,
    rows.map((row) => [
      row.at || '',
      row.event || '',
      row.reason || row.scope || '',
      row.admin?.name || '',
      row.admin?.id ?? '',
      row.ipAddress || '',
      row.ipAnonymized ? 'yes' : 'no',
      row.location?.country || '',
      row.location?.city || '',
      row.browser || '',
      row.os || '',
      row.deviceType || '',
      row.session?.state || '',
      row.actor?.name || '',
    ])
  );
}

/**
 * Content Manager activity as CSV.
 *
 * @param {object[]} rows Activity rows from the API.
 * @returns {string} CSV text.
 */
export function buildActivityCsv(rows) {
  return toCsv(
    ACTIVITY_CSV_HEADERS,
    rows.map((row) => [
      row.at || '',
      row.action || '',
      row.admin?.name || '',
      row.admin?.id ?? '',
      row.contentType?.name || '',
      row.contentType?.uid || '',
      row.entry?.documentId || '',
      row.entry?.locale || '',
      row.entry?.title || '',
      row.entry?.count ?? '',
    ])
  );
}
