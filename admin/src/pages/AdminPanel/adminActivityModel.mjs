import { escapeCsvValue } from '../../utils/sessionExports.mjs';
import {
  SETTINGS_FIELD_LABELS,
  SETTINGS_TAB_FIELDS,
  SETTINGS_TAB_IDS,
  SETTINGS_TAB_LABELS,
} from '../Settings/settingsTabs.mjs';

/**
 * Pure helpers of the admin sign-in history and Content Manager activity
 * views: filter options, request parameters, one presentation table per
 * event, entry links and CSV export. No React, so `node --test` covers them.
 */

/** Sign-in history filter of one admin (API values of `event`). */
export const SIGN_IN_FILTER_OPTIONS = Object.freeze([
  'all',
  'succeeded',
  'failed',
  'signed-out',
  'impersonation',
]);

/**
 * Filter of the activity of all admins: adds settings changes, token reads
 * and retention runs, which belong to no single admin's history.
 */
export const ALL_ADMINS_FILTER_OPTIONS = Object.freeze([...SIGN_IN_FILTER_OPTIONS, 'changes']);

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
    event: ALL_ADMINS_FILTER_OPTIONS.includes(filters.event) ? filters.event : 'all',
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

/** Detail of a `security-log.read` row per list: [listed, exported]. */
const LOG_READ_DETAILS = Object.freeze({
  'sign-ins': [
    message('adminPanel.activity.read.signIns', 'Sign-in history listed'),
    message('adminPanel.activity.read.signInsExport', 'Sign-in history exported'),
  ],
  content: [
    message('adminPanel.activity.read.content', 'Content Manager activity listed'),
    message('adminPanel.activity.read.contentExport', 'Content Manager activity exported'),
  ],
  'user-activity': [
    message('adminPanel.activity.read.userActivity', 'App-user security activity listed'),
    message('adminPanel.activity.read.userActivityExport', 'App-user security activity exported'),
  ],
});

/**
 * Presentation of an event without a reason line (app-user, impersonation
 * and webhook events); the app-user view adds its own second line
 * (eventText.mjs `userEventDetailText`).
 *
 * @param {string} key Stable key (data attribute).
 * @param {string} tone Badge tone.
 * @param {string} icon Icon key.
 * @param {string} messageId Label id.
 * @param {string} defaultMessage English label.
 * @returns {{key: string, tone: string, icon: string,
 *   label: {messageId: string, defaultMessage: string}, detail: null}} Presentation.
 */
const appUserEvent = (key, tone, icon, messageId, defaultMessage) => ({
  key,
  tone,
  icon,
  label: message(messageId, defaultMessage),
  detail: null,
});

/**
 * One presentation per security event (admin and app-user events alike):
 * label, badge tone, icon and an optional detail. The tones are semantic and the same in every list:
 * success = signed in, danger = sign-in failed or locked out (a security
 * signal), warning = signed out by another admin, secondary (blue) = a
 * settings change or a read of the log with an API token, neutral = the
 * admin's own sign-out and housekeeping (retention). The icon key repeats the meaning in a second channel, because
 * the DS dark theme draws every badge background in the same grey.
 *
 * @param {{event: string, reason?: string|null, scope?: string|null}} row Event row.
 * @returns {{key: string, tone: string, icon: string,
 *   label: {messageId: string, defaultMessage: string},
 *   detail: {messageId: string, defaultMessage: string}|null}} Presentation.
 */
export function getEventPresentation(row) {
  switch (row?.event) {
    case 'admin.sign-in':
      return {
        key: 'sign-in',
        tone: 'success',
        icon: 'signIn',
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
        tone: 'danger',
        icon: 'failed',
        label: message('adminPanel.activity.event.failed', 'Sign-in failed'),
        detail: FAILURE_REASONS[row.reason] || null,
      };
    case 'admin.lockout':
      return {
        key: 'lockout',
        tone: 'danger',
        icon: 'lockout',
        label: message('adminPanel.activity.event.lockout', 'Locked out'),
        detail: FAILURE_REASONS.rate_limited,
      };
    case 'admin.sign-out':
      return {
        key: 'sign-out',
        tone: 'neutral',
        icon: 'signOut',
        label: message('adminPanel.activity.event.signOut', 'Signed out'),
        detail: null,
      };
    case 'admin.session.revoked':
      return {
        key: 'revoked',
        tone: 'warning',
        icon: 'revoked',
        label: message('adminPanel.activity.event.revoked', 'Signed out by an admin'),
        detail:
          row.scope === 'one_browser'
            ? message('adminPanel.activity.scope.oneBrowser', 'One browser')
            : message('adminPanel.activity.scope.everywhere', 'Every browser'),
      };
    case 'settings.updated':
      return {
        key: 'settings',
        tone: 'secondary',
        icon: 'settings',
        label: message('adminPanel.activity.event.settings', 'Settings changed'),
        detail: row.change?.viaToken
          ? message('adminPanel.activity.via.token', 'With an admin API token')
          : null,
      };
    case 'security-log.read':
      return {
        key: 'log-read',
        tone: 'secondary',
        icon: row.read?.via === 'admin-panel' ? 'export' : 'logRead',
        // 4.22: exports of the app-user activity from the admin panel are recorded too.
        label:
          row.read?.via === 'admin-panel'
            ? message('adminPanel.activity.event.logExported', 'Security log exported')
            : message('adminPanel.activity.event.logRead', 'Log read with an API token'),
        detail:
          LOG_READ_DETAILS[row.read?.list || 'sign-ins']?.[row.read?.exported ? 1 : 0] || null,
      };
    case 'security-log.retention.purged':
      return {
        key: 'purged',
        tone: 'neutral',
        icon: 'purged',
        label: message('adminPanel.activity.event.purged', 'Old events deleted'),
        detail: null,
      };
    // 4.22.1: recorded once per key at start-up.
    case 'config.encryption-key.weak':
      return {
        key: 'weak-key',
        tone: 'danger',
        icon: 'settings',
        label: message('adminPanel.activity.event.weakKey', 'Weak encryption key'),
        detail: message(
          'adminPanel.activity.event.weakKey.detail',
          'SESSION_ENCRYPTION_KEY is shorter than 32 bytes. The next major version will refuse to start with it.'
        ),
      };
    // App-user events (4.17 / 4.18), listed by the app-user Security activity (4.22) only.
    // The admin lists never return them; the labels are plain because that view is about app
    // users already.
    case 'user.sign-in.failed':
      return appUserEvent(
        'user-failed',
        'danger',
        'failed',
        'adminPanel.activity.event.userFailed',
        'Sign-in failed'
      );
    case 'user.sign-in.refused':
      return appUserEvent(
        'user-refused',
        'danger',
        'refused',
        'adminPanel.activity.event.userRefused',
        'Sign-in refused'
      );
    case 'user.lockout':
      return appUserEvent(
        'user-lockout',
        'danger',
        'lockout',
        'adminPanel.activity.event.userLockout',
        'Locked out'
      );
    case 'user.lockout.lifted':
      return appUserEvent(
        'user-unlock',
        'secondary',
        'unlock',
        'adminPanel.activity.event.userUnlock',
        'Lock lifted'
      );
    case 'user.session.limit':
      return appUserEvent(
        'user-limit',
        'warning',
        'limit',
        'adminPanel.activity.event.userLimit',
        'Session limit reached'
      );
    case 'user.password-change.ended-others':
      return appUserEvent(
        'user-password',
        'warning',
        'password',
        'adminPanel.activity.event.userPassword',
        'Signed out after a password change'
      );
    case 'user.sign-in.new-device':
      return appUserEvent(
        'user-device',
        'secondary',
        'device',
        'adminPanel.activity.event.userNewDevice',
        'Sign-in from a new device'
      );
    case 'user.sign-in.impossible-travel':
      return appUserEvent(
        'user-travel',
        'danger',
        'travel',
        'adminPanel.activity.event.userTravel',
        'Impossible travel'
      );
    case 'user.not-me':
      return appUserEvent(
        'user-not-me',
        'danger',
        'notMe',
        'adminPanel.activity.event.userNotMe',
        'Reported as "This wasn’t me"'
      );
    case 'user.data.exported':
      return appUserEvent(
        'user-export',
        'secondary',
        'export',
        'adminPanel.activity.event.userExport',
        'Personal data exported'
      );
    case 'impersonation.started':
      return appUserEvent(
        'impersonation-started',
        'warning',
        'impersonation',
        'adminPanel.activity.event.impersonationStarted',
        'Impersonation started'
      );
    case 'impersonation.ended':
      return appUserEvent(
        'impersonation-ended',
        'neutral',
        'impersonationEnd',
        'adminPanel.activity.event.impersonationEnded',
        'Impersonation ended'
      );
    case 'impersonation.expired':
      return appUserEvent(
        'impersonation-expired',
        'neutral',
        'expired',
        'adminPanel.activity.event.impersonationExpired',
        'Impersonation timed out'
      );
    case 'impersonation.write':
      return appUserEvent(
        'impersonation-write',
        'warning',
        'impersonation',
        'adminPanel.activity.event.impersonationWrite',
        'Change made while signed in as this admin'
      );
    case 'impersonation.refused':
      return appUserEvent(
        'impersonation-refused',
        'danger',
        'refused',
        'adminPanel.activity.event.impersonationRefused',
        'Impersonation request refused'
      );
    default:
      if (typeof row?.event === 'string' && row.event.startsWith('impersonation.')) {
        return appUserEvent(
          'impersonation',
          'warning',
          'impersonation',
          'adminPanel.activity.event.impersonation',
          'Impersonation'
        );
      }
      if (typeof row?.event === 'string' && row.event.startsWith('webhook.')) {
        return appUserEvent(
          'webhook',
          'neutral',
          'webhook',
          'adminPanel.activity.event.webhook',
          'Webhook delivery'
        );
      }
      return {
        key: 'other',
        tone: 'neutral',
        icon: 'other',
        label: message('adminPanel.activity.event.other', 'Security event'),
        detail: null,
      };
  }
}

/**
 * The sign-in history's name for getEventPresentation (4.19 API of this module).
 *
 * @param {{event: string, reason?: string|null, scope?: string|null}} row Event row.
 * @returns {ReturnType<typeof getEventPresentation>} Presentation.
 */
export const getSignInEventPresentation = (row) => getEventPresentation(row);

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

/** Events in the "Recent security activity" table. */
export const RECENT_EVENT_LIMIT = 8;

/** Page sizes of the full "Sign-in activity" page. */
export const ACTIVITY_PAGE_SIZE_OPTIONS = Object.freeze(['10', '20', '50', '100']);

/**
 * Narrowest list width (px) for the table, per list: the cross-admin list
 * has an extra Admin column. Below it the list shows stacked rows. Widths are
 * of the list container, not the viewport, because the same list sits in the
 * page, in a card and in the admin details dialog. Measured on Strapi 5.63:
 * the six-column table needs about 800 px (the page at a 768 px viewport
 * gives 718 px, so it scrolled sideways there), the five-column table of
 * one admin (details dialog) about 740 px; stacked rows read better than a
 * table that scrolls.
 */
export const EVENT_TABLE_MIN_WIDTH = Object.freeze({ withAdmin: 800, withoutAdmin: 740 });

/** List width (px) from which "Done by" gets its own column instead of a second line. */
export const EVENT_TABLE_FULL_WIDTH = 1000;

/**
 * Layout of an event list for its container width: `stacked` rows (phones,
 * narrow dialogs, the Content Manager side panel), a `table` whose "Done by"
 * folds into the event cell, or the `full` table with every column. 0 (not
 * measured yet) counts as wide, so the first paint on desktop is the table.
 * A list with an extra subject column (Admin, or User in the app-user view)
 * needs the wider minimum; `minWidth` overrides both.
 *
 * @param {number} width Container width in px; 0 when unknown.
 * @param {{showAdmin?: boolean, wide?: boolean, minWidth?: number}} [options] Whether a
 *   subject column is shown (`showAdmin` and `wide` are the same), or an own minimum.
 * @returns {'stacked'|'table'|'full'} Layout.
 */
export function getEventListLayout(width, { showAdmin = false, wide = false, minWidth } = {}) {
  if (!width) return 'full';
  const min =
    Number.isFinite(minWidth) && minWidth > 0
      ? minWidth
      : showAdmin || wide
        ? EVENT_TABLE_MIN_WIDTH.withAdmin
        : EVENT_TABLE_MIN_WIDTH.withoutAdmin;
  if (width < min) return 'stacked';
  return width >= EVENT_TABLE_FULL_WIDTH ? 'full' : 'table';
}

/**
 * "City, Country" of an event, or '' when no location was recorded.
 *
 * @param {{location?: {city?: string|null, country?: string|null}|null}} row Event row.
 * @returns {string} Place.
 */
export function getEventPlace(row) {
  return [row?.location?.city, row?.location?.country].filter(Boolean).join(', ');
}

/**
 * Filters of the full "Sign-in activity" page from the URL query. Unknown
 * values fall back to the defaults, so a hand-edited URL never breaks the
 * page.
 *
 * @param {Record<string, unknown>|null|undefined} query Parsed URL query.
 * @returns {{event: string, period: string, adminId: number|null, page: number,
 *   pageSize: number}} Filters.
 */
export function parseActivityPageQuery(query) {
  const source = query || {};
  const event = ALL_ADMINS_FILTER_OPTIONS.includes(String(source.event))
    ? String(source.event)
    : 'all';
  const period = PERIOD_OPTIONS.includes(String(source.period)) ? String(source.period) : '30';
  const adminId = /^[1-9][0-9]{0,11}$/.test(String(source.adminId ?? ''))
    ? Number(source.adminId)
    : null;
  const page = Number.parseInt(String(source.page ?? ''), 10);
  const pageSize = String(source.pageSize ?? '');
  return {
    event,
    period,
    adminId,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: ACTIVITY_PAGE_SIZE_OPTIONS.includes(pageSize) ? Number(pageSize) : EVENT_PAGE_SIZE,
  };
}

/**
 * Whether the page shows a narrowed list (for the "Clear filters" action).
 *
 * @param {{event: string, period: string, adminId: number|null}} view Parsed filters.
 * @returns {boolean} True when a filter differs from the default.
 */
export function hasActivityPageFilters(view) {
  return view.event !== 'all' || view.period !== '30' || view.adminId !== null;
}

/**
 * Changed settings of a `settings.updated` event, grouped by the Configuration
 * tab that shows them, in tab order, with the labels the Settings page uses
 * (`SETTINGS_TAB_LABELS`, `SETTINGS_FIELD_LABELS`). Keys keep their recorded
 * order inside a tab; two keys with the same label (allowed and blocked
 * countries) appear once. A key the Settings page does not know (an older or
 * newer plugin version, a preserved key) goes to a last group without a tab
 * and keeps its raw name.
 *
 * @param {unknown} keys Changed key names from the API.
 * @returns {Array<{tab: string|null, label: {messageId: string, defaultMessage: string}|null,
 *   fields: Array<{key: string, label: {messageId: string, defaultMessage: string}|null}>}>}
 *   Groups.
 */
export function groupChangedSettings(keys) {
  const list = Array.isArray(keys) ? keys.filter((key) => typeof key === 'string' && key) : [];
  /** @type {Map<string, Array<{key: string, label: {messageId: string, defaultMessage: string}}>>} */
  const byTab = new Map();
  const unknown = [];
  const seen = new Set();
  for (const key of list) {
    const tab = SETTINGS_TAB_IDS.find((id) => SETTINGS_TAB_FIELDS[id]?.includes(key));
    const entry = SETTINGS_FIELD_LABELS[key];
    if (!tab || !entry) {
      if (!seen.has(`raw:${key}`)) unknown.push({ key, label: null });
      seen.add(`raw:${key}`);
      continue;
    }
    if (seen.has(`label:${entry[0]}`)) continue;
    seen.add(`label:${entry[0]}`);
    if (!byTab.has(tab)) byTab.set(tab, []);
    byTab.get(tab).push({ key, label: message(entry[0], entry[1]) });
  }
  const groups = SETTINGS_TAB_IDS.filter((tab) => byTab.has(tab)).map((tab) => ({
    tab,
    label: message(SETTINGS_TAB_LABELS[tab][0], SETTINGS_TAB_LABELS[tab][1]),
    fields: byTab.get(tab),
  }));
  if (unknown.length) groups.push({ tab: null, label: null, fields: unknown });
  return groups;
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
