import { getSessionStatus } from '../../utils/sessionStatus.mjs';
import { getDevicePresentation } from '../../utils/devicePresentation.mjs';
import { presentText } from '../../utils/missingValue.mjs';
import { DEFAULT_SESSION_FILTER, isSessionFilter } from '../../utils/sessionFilters.mjs';

/** Page sizes offered by the native pagination footer. */
export const PAGE_SIZE_OPTIONS = Object.freeze(['10', '25', '50', '100']);

/** Page size used when the URL has none (or an unsupported one). */
export const DEFAULT_PAGE_SIZE = '25';

/** Columns of the desktop table: Status, User, Device, IP, Last active, Actions. */
export const DASHBOARD_TABLE_COLUMNS = 6;

/** Background refresh interval; skipped while a dialog or mutation is open. */
export const AUTO_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Reads the dashboard state from the URL query (`useQueryParams`): page,
 * page size, status filter and search (`_q`, written by Strapi's SearchInput).
 * Invalid values fall back to defaults instead of producing an empty list.
 *
 * @param {Record<string, unknown>} [query] Parsed query object.
 * @returns {{page: number, pageSize: string, status: string, search: string}} Dashboard state.
 */
export function parseDashboardQuery(query = {}) {
  const source = query || {};
  const page = Number.parseInt(String(source.page ?? '1'), 10);
  const pageSize = PAGE_SIZE_OPTIONS.includes(String(source.pageSize)) ? String(source.pageSize) : DEFAULT_PAGE_SIZE;
  const status = isSessionFilter(source.status) ? /** @type {string} */ (source.status) : DEFAULT_SESSION_FILTER;
  const search = typeof source._q === 'string' ? source._q.trim() : '';

  return { page: Number.isFinite(page) && page >= 1 ? page : 1, pageSize, status, search };
}

/**
 * @param {{status: string, search: string}} state Parsed dashboard state.
 * @returns {boolean} Whether a status filter or search narrows the list.
 */
export function hasActiveFilters(state) {
  return Boolean(state) && (state.status !== DEFAULT_SESSION_FILTER || Boolean(state.search));
}

/**
 * Counts sessions for the four KPI cards (Active, Idle, Ended, Total). "Ended"
 * is logged out plus terminated; both parts are kept for the secondary line.
 *
 * @param {object[]} sessions All loaded sessions.
 * @returns {{active: number, idle: number, loggedOut: number, terminated: number, ended: number, total: number}} Counts.
 */
export function getSessionStats(sessions) {
  const rows = Array.isArray(sessions) ? sessions : [];
  const counts = { active: 0, idle: 0, loggedout: 0, terminated: 0 };
  for (const session of rows) {
    const status = getSessionStatus(session);
    counts[status] = (counts[status] || 0) + 1;
  }
  return {
    active: counts.active,
    idle: counts.idle,
    loggedOut: counts.loggedout,
    terminated: counts.terminated,
    ended: counts.loggedout + counts.terminated,
    total: rows.length,
  };
}

/**
 * One user identifier for every surface (table, cards, modal, action labels):
 * the username, else the e-mail address. `secondary` is the e-mail shown under
 * the username when both exist. `accessible` never is empty, so per-row
 * action labels stay distinct (DUX-06, DUX-07, DASH-09).
 *
 * @param {object} session Session row.
 * @returns {{primary: string, secondary: string, accessible: string}} Labels; '' means missing.
 */
export function getSessionUserLabels(session) {
  const username = presentText(session?.user?.username);
  const email = presentText(session?.user?.email);
  const primary = username || email;
  return {
    primary,
    secondary: username && email ? email : '',
    accessible: primary || presentText(session?.id),
  };
}

/**
 * Device facts for CSV/JSON exports: the neutral device type key ('desktop',
 * 'mobile', ...) and proper names, never translated UI words.
 *
 * @param {object} session Session row.
 * @param {string} unavailableValue Value written for missing facts.
 * @returns {{device: string, browser: string, browserVersion: string, os: string}} Export facts.
 */
export function getExportDeviceInfo(session, unavailableValue = '') {
  const device = getDevicePresentation(session);
  return {
    device: device.deviceType || unavailableValue,
    browser: device.browser || unavailableValue,
    browserVersion: device.browserVersion || '',
    os: device.os || unavailableValue,
  };
}

/**
 * Decides whether a keydown inside a table action group must not reach the
 * Design System grid cell. The DS cell calls preventDefault() on every key
 * when it holds more than one button, which blocks Enter/Space activation
 * (DASH-01). Events from the confirmation dialog are rendered in a portal but
 * still bubble through the React tree; they must not move grid focus either.
 *
 * @param {string} key KeyboardEvent.key.
 * @param {boolean} fromInsideGroup Whether the event target is inside the group's DOM.
 * @returns {boolean} True to stop propagation.
 */
export function shouldIsolateActionKey(key, fromInsideGroup) {
  if (!fromInsideGroup) return true;
  return key === 'Enter' || key === ' ' || key === 'Spacebar';
}

/**
 * Picks the session whose row should receive focus after a mutation: the
 * same row when it still exists (for example after logging it out), else the
 * row that followed it, else the one before it. Returns null for an empty list.
 *
 * @param {string[]} previousIds Row ids before the refresh, in display order.
 * @param {string[]} currentIds Row ids after the refresh, in display order.
 * @param {string} sessionId The mutated session.
 * @returns {string|null} Session id to focus, or null.
 */
export function pickFocusSessionId(previousIds, currentIds, sessionId) {
  const current = Array.isArray(currentIds) ? currentIds.map(String) : [];
  if (current.length === 0) return null;
  const target = String(sessionId);
  if (current.includes(target)) return target;

  const previous = Array.isArray(previousIds) ? previousIds.map(String) : [];
  const index = previous.indexOf(target);
  if (index >= 0) {
    for (let next = index + 1; next < previous.length; next += 1) {
      if (current.includes(previous[next])) return previous[next];
    }
    for (let before = index - 1; before >= 0; before -= 1) {
      if (current.includes(previous[before])) return previous[before];
    }
  }
  return current[0];
}
