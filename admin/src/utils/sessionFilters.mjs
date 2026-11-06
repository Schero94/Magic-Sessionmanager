import { SESSION_END_REASONS, getSessionEndReason, getSessionState } from './sessionStatus.mjs';
import { getDevicePresentation } from './devicePresentation.mjs';
import { presentText } from './missingValue.mjs';

/**
 * Shows the full session history on first visit so idle and ended sessions are
 * not hidden behind a live-only filter.
 * @type {string}
 */
export const DEFAULT_SESSION_FILTER = 'all';

/** Status filter options in display order (IA D1): All sessions, Open, Active, Idle, Ended. */
export const SESSION_FILTER_OPTIONS = Object.freeze(['all', 'open', 'active', 'idle', 'ended']);

/** End reason filter, offered only while the status filter is "ended" (IA D1). */
export const DEFAULT_END_REASON_FILTER = 'all';

/** End reason options in display order: All reasons, then the six reasons of IA A.4. */
export const END_REASON_FILTER_OPTIONS = Object.freeze(['all', ...SESSION_END_REASONS]);

const VALID_SESSION_FILTERS = new Set(SESSION_FILTER_OPTIONS);
const VALID_END_REASON_FILTERS = new Set(END_REASON_FILTER_OPTIONS);

/**
 * @param {unknown} value Raw filter value, for example from the URL query.
 * @returns {boolean} Whether the value is one of the supported status filters.
 */
export function isSessionFilter(value) {
  return typeof value === 'string' && VALID_SESSION_FILTERS.has(value);
}

/**
 * @param {unknown} value Raw end reason filter value from the URL query.
 * @returns {boolean} Whether the value is one of the supported reason filters.
 */
export function isEndReasonFilter(value) {
  return typeof value === 'string' && VALID_END_REASON_FILTERS.has(value);
}

/**
 * @param {object} session Session row.
 * @param {string} status Status filter.
 * @returns {boolean} Whether the row matches the status filter.
 */
const matchesStatus = (session, status) => {
  if (status === 'all') return true;
  if (status === 'open') return session?.isActive === true;
  return getSessionState(session) === status;
};

/**
 * Applies the dashboard status filter and, for "ended", the optional end
 * reason filter. Unknown status values return no rows rather than silently
 * broadening results; an unknown reason is treated as "all reasons".
 *
 * @param {object[]} sessions Normalized session rows.
 * @param {string} [status] Status filter: all, open, active, idle or ended.
 * @param {string} [reason] End reason filter, used only with status "ended".
 * @returns {object[]} Rows matching the filters, in their original order.
 */
export function filterSessionsByStatus(sessions, status = DEFAULT_SESSION_FILTER, reason = DEFAULT_END_REASON_FILTER) {
  if (!Array.isArray(sessions) || !VALID_SESSION_FILTERS.has(status)) return [];
  const byReason = status === 'ended' && isEndReasonFilter(reason) && reason !== DEFAULT_END_REASON_FILTER;
  if (status === 'all') return sessions;

  return sessions.filter((session) =>
    matchesStatus(session, status) && (!byReason || getSessionEndReason(session) === reason)
  );
}

/**
 * Builds the lower-case text a dashboard search matches against: username,
 * e-mail, IP address, browser, operating system and device type key. Callers
 * may add translated text (for example the localized device type label) so a
 * German administrator can also search for "Mobilgerät".
 *
 * @param {object} session Session row.
 * @param {string} [extraText] Additional searchable text.
 * @returns {string} Lower-case haystack without missing-value placeholders.
 */
export function getSessionSearchText(session, extraText = '') {
  const row = session || {};
  const device = getDevicePresentation(row);
  return [
    row.user?.username,
    row.user?.email,
    row.ipAddress,
    device.browser,
    device.os,
    device.deviceType,
    extraText,
  ]
    .map(presentText)
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * Filters rows by a free-text query. An empty query returns the input.
 *
 * @param {object[]} sessions Session rows.
 * @param {string} query Search text from the URL (`search`).
 * @param {(session: object) => string} [getExtraText] Adds translated searchable text per row.
 * @returns {object[]} Matching rows in their original order.
 */
export function filterSessionsBySearch(sessions, query, getExtraText) {
  if (!Array.isArray(sessions)) return [];
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (!needle) return sessions;

  return sessions.filter((session) =>
    getSessionSearchText(session, getExtraText ? getExtraText(session) : '').includes(needle)
  );
}

/**
 * Returns open sessions (active or idle). Ended rows are not part of the
 * user's current-session panel.
 *
 * @param {object[]} sessions Session rows returned by the user-scoped API.
 * @returns {object[]} Current active or idle sessions.
 */
export function getManageableSessions(sessions) {
  if (!Array.isArray(sessions)) return [];
  return sessions.filter((session) => session?.isActive === true);
}
