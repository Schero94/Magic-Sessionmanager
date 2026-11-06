import { getSessionEndReason, getSessionState } from '../../utils/sessionStatus.mjs';
import { getDevicePresentation } from '../../utils/devicePresentation.mjs';
import { presentText } from '../../utils/missingValue.mjs';
import {
  DEFAULT_END_REASON_FILTER,
  DEFAULT_SESSION_FILTER,
  isEndReasonFilter,
  isSessionFilter,
} from '../../utils/sessionFilters.mjs';

/** Page sizes offered by the native pagination footer ("Entries per page"). */
export const PAGE_SIZE_OPTIONS = Object.freeze(['10', '25', '50', '100']);

/** Page size used when the URL has none (or an unsupported one). */
export const DEFAULT_PAGE_SIZE = '25';

/**
 * Table columns from the DS large breakpoint (IA D1.7): Status, User, Device,
 * IP address, Signed in, Last active, Actions.
 */
export const DASHBOARD_TABLE_COLUMNS = 7;

/** Columns between the medium and large breakpoint: IP address and Signed in are hidden. */
export const DASHBOARD_COMPACT_TABLE_COLUMNS = 5;

/** Background refresh interval; skipped while a dialog or mutation is open. */
export const AUTO_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

/** Per-viewer storage key for the "How sessions work" disclosure. */
export const HOW_IT_WORKS_STORAGE_KEY = 'magic-sessionmanager.dashboard.howSessionsWork';

/** Content Manager edit view of a Users & Permissions user (decision I.2-6). */
const USER_EDIT_PATH = '/content-manager/collection-types/plugin::users-permissions.user/';

/**
 * Decodes one URL query value. Search values are written URL-encoded, the
 * same way Strapi's own SearchInput writes `_q`.
 *
 * @param {unknown} value Raw query value.
 * @returns {string} Trimmed text, '' for anything that is not a string.
 */
const readQueryText = (value) => {
  if (typeof value !== 'string') return '';
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
};

/**
 * Reads the dashboard state from the URL query (`useQueryParams`): page,
 * page size, status filter, end reason filter and search. `search` is the
 * documented parameter (the user panel links to `?search=<email>`); `_q` is
 * still read so older links keep working. Invalid values fall back to
 * defaults instead of producing an empty list; the reason applies only to
 * the "ended" status.
 *
 * @param {Record<string, unknown>} [query] Parsed query object.
 * @returns {{page: number, pageSize: string, status: string, reason: string, search: string}} Dashboard state.
 */
export function parseDashboardQuery(query = {}) {
  const source = query || {};
  const page = Number.parseInt(String(source.page ?? '1'), 10);
  const pageSize = PAGE_SIZE_OPTIONS.includes(String(source.pageSize)) ? String(source.pageSize) : DEFAULT_PAGE_SIZE;
  const status = isSessionFilter(source.status) ? /** @type {string} */ (source.status) : DEFAULT_SESSION_FILTER;
  const reason = status === 'ended' && isEndReasonFilter(source.reason)
    ? /** @type {string} */ (source.reason)
    : DEFAULT_END_REASON_FILTER;
  const search = readQueryText(source.search) || readQueryText(source._q);

  return { page: Number.isFinite(page) && page >= 1 ? page : 1, pageSize, status, reason, search };
}

/**
 * Encodes a search term for the URL query (useQueryParams writes values
 * unencoded), or undefined to remove the parameter.
 *
 * @param {string} value Search text.
 * @returns {string|undefined} Encoded value.
 */
export function encodeSearchQuery(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? encodeURIComponent(text) : undefined;
}

/**
 * @param {{status: string, reason?: string, search: string}} state Parsed dashboard state.
 * @returns {boolean} Whether a status filter, reason filter or search narrows the list.
 */
export function hasActiveFilters(state) {
  if (!state) return false;
  return state.status !== DEFAULT_SESSION_FILTER
    || (Boolean(state.reason) && state.reason !== DEFAULT_END_REASON_FILTER)
    || Boolean(state.search);
}

/**
 * Stable key of the user that owns a session, for counting distinct users.
 *
 * @param {object} session Session row.
 * @returns {string} documentId, numeric id or e-mail; '' when unknown.
 */
const getUserKey = (session) => {
  const user = session?.user;
  return presentText(user?.documentId) || presentText(user?.id) || presentText(user?.email);
};

/**
 * Counts for the four KPI cards (IA D1.4): Active (with distinct users
 * online), Idle (open only), Ended (logged out, timed out, other reasons) and
 * All. "Online" describes users: a user is online when at least one of their
 * sessions is Active.
 *
 * @param {object[]} sessions All loaded sessions.
 * @returns {{
 *   active: number, idle: number, ended: number, total: number,
 *   usersOnline: number, loggedOut: number, timedOut: number, otherReasons: number,
 * }} Counts.
 */
export function getSessionStats(sessions) {
  const rows = Array.isArray(sessions) ? sessions : [];
  const stats = { active: 0, idle: 0, ended: 0, total: rows.length, usersOnline: 0, loggedOut: 0, timedOut: 0, otherReasons: 0 };
  const onlineUsers = new Set();
  for (const session of rows) {
    const state = getSessionState(session);
    stats[state] += 1;
    if (state === 'active') {
      const key = getUserKey(session);
      if (key) onlineUsers.add(key);
    } else if (state === 'ended') {
      const reason = getSessionEndReason(session);
      if (reason === 'logout') stats.loggedOut += 1;
      else if (reason === 'idle') stats.timedOut += 1;
      else stats.otherReasons += 1;
    }
  }
  stats.usersOnline = onlineUsers.size;
  return stats;
}

/**
 * One user identifier for every surface (table, cards, dialog, action labels):
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
 * Content Manager edit view of the session's user, or null when the row
 * carries no user documentId (decision I.2-6: GET /sessions populates it).
 *
 * @param {object} session Session row.
 * @returns {string|null} Admin-relative path.
 */
export function getUserEditPath(session) {
  const documentId = presentText(session?.user?.documentId);
  return documentId ? `${USER_EDIT_PATH}${encodeURIComponent(documentId)}` : null;
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
 * Reads the remembered open state of the "How sessions work" disclosure.
 * Storage can be missing or throw (private mode, blocked site data); the
 * disclosure then starts collapsed.
 *
 * @param {Pick<Storage, 'getItem'>|null|undefined} storage Usually window.localStorage.
 * @returns {boolean} Whether the disclosure was left open.
 */
export function readDisclosureOpen(storage) {
  try {
    return storage?.getItem(HOW_IT_WORKS_STORAGE_KEY) === 'open';
  } catch {
    return false;
  }
}

/**
 * Remembers the disclosure state for this viewer; failures are ignored.
 *
 * @param {Pick<Storage, 'setItem'>|null|undefined} storage Usually window.localStorage.
 * @param {boolean} open New state.
 * @returns {void}
 */
export function writeDisclosureOpen(storage, open) {
  try {
    storage?.setItem(HOW_IT_WORKS_STORAGE_KEY, open ? 'open' : 'closed');
  } catch {
    // A per-viewer convenience only; the page works without it.
  }
}

/**
 * Returns window.localStorage, or null when the accessor itself throws.
 *
 * @returns {Storage|null} Storage or null.
 */
export function getBrowserStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
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
 * Narrowest list width (px) at which every table column fits without
 * squeezing User and Device to an ellipsis. Measured on Strapi 5.61 with the
 * main menu open: 1440 px viewports give the list 1272 px (fits), 1280 px give
 * 1112 px (User and Device cut to a few letters).
 */
export const FULL_TABLE_MIN_WIDTH = 1200;

/**
 * Whether the table drops the IP address and Signed in columns (they stay in
 * the dialog). Below the DS large breakpoint always (IA D1); above it when
 * the list itself is narrower than FULL_TABLE_MIN_WIDTH, because the Strapi
 * main menu and page gutters take part of the viewport.
 *
 * @param {number|undefined} listWidth Measured list width in px (0/undefined when unknown).
 * @param {boolean} isBelowLarge Viewport is below the DS large breakpoint.
 * @returns {boolean} True for the compact table.
 */
export function shouldUseCompactTable(listWidth, isBelowLarge) {
  if (isBelowLarge) return true;
  if (!Number.isFinite(listWidth) || listWidth <= 0) return false;
  return listWidth < FULL_TABLE_MIN_WIDTH;
}

/**
 * Decides whether an isolated keydown must be handed back to the document.
 * Radix (ConfirmDialog, SimpleMenu) listens for Escape on the document in the
 * bubble phase. Portal events bubble through the React tree into the action
 * group: stopping them hides Escape from Radix, and letting them reach the
 * DS grid cell lets it call preventDefault(), which Radix reads as "do not
 * dismiss". So Escape from a portal is stopped and re-dispatched.
 *
 * @param {string} key KeyboardEvent.key.
 * @param {boolean} fromInsideGroup Whether the event target is inside the group's DOM.
 * @returns {boolean} True to re-dispatch Escape on the document.
 */
export function shouldRedispatchEscape(key, fromInsideGroup) {
  return !fromInsideGroup && key === 'Escape';
}

/**
 * Picks the session whose row should receive focus after a mutation: the
 * same row when it still exists (for example after ending it), else the
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

/**
 * Reads the HTTP status of a failed fetch-client request.
 *
 * @param {unknown} error Error thrown by useFetchClient.
 * @returns {number|null} Status code or null.
 */
export function getErrorStatus(error) {
  const err = /** @type {any} */ (error);
  const status = err?.status ?? err?.response?.status;
  return typeof status === 'number' ? status : null;
}
