import { getSessionStatus } from './sessionStatus.mjs';
import { getDevicePresentation } from './devicePresentation.mjs';
import { presentText } from './missingValue.mjs';

/**
 * Shows the full session history on first visit so idle and ended sessions are
 * not hidden behind a live-only filter.
 * @type {string}
 */
export const DEFAULT_SESSION_FILTER = 'all';

/** Status filters offered by the dashboard, in display order. */
export const SESSION_FILTER_OPTIONS = Object.freeze(['all', 'active', 'idle', 'loggedout', 'terminated']);

const VALID_SESSION_FILTERS = new Set(SESSION_FILTER_OPTIONS);

/**
 * @param {unknown} value Raw filter value, for example from the URL query.
 * @returns {boolean} Whether the value is one of the supported status filters.
 */
export function isSessionFilter(value) {
  return typeof value === 'string' && VALID_SESSION_FILTERS.has(value);
}

/**
 * Applies one of the dashboard's explicit status filters.
 * Unknown filter values return no rows rather than silently broadening results.
 * @param {object[]} sessions Normalized session rows.
 * @param {string} status Requested status filter.
 * @returns {object[]} Rows matching the requested status.
 */
export function filterSessionsByStatus(sessions, status = DEFAULT_SESSION_FILTER) {
  if (!Array.isArray(sessions) || !VALID_SESSION_FILTERS.has(status)) return [];
  if (status === 'all') return sessions;

  return sessions.filter((session) => getSessionStatus(session) === status);
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
 * @param {string} query Search text from the URL (`_q`).
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
 * Returns sessions that are still valid in the authoritative session store.
 * This includes idle sessions that remain refreshable, but excludes logged-out
 * or revoked rows from the user's current-session panel.
 * @param {object[]} sessions Session rows returned by the user-scoped API.
 * @returns {object[]} Current active or idle sessions.
 */
export function getManageableSessions(sessions) {
  if (!Array.isArray(sessions)) return [];
  return sessions.filter((session) => session?.isActive === true);
}
