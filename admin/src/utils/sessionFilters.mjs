import { getSessionStatus } from './sessionStatus.mjs';

/**
 * Shows the full session history on first visit so idle and ended sessions are
 * not hidden behind a live-only filter.
 * @type {string}
 */
export const DEFAULT_SESSION_FILTER = 'all';

const VALID_SESSION_FILTERS = new Set(['all', 'active', 'idle', 'loggedout', 'terminated']);

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
