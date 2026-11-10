import { getSessionUserKey } from './onlineStats.mjs';

/**
 * The four home widget tiles, in display order (2 x 2): Online users, Active
 * sessions, Idle sessions, Blocked users (IA D4, decision I.2-2).
 */
export const WIDGET_STAT_KEYS = Object.freeze([
  'onlineUsers',
  'activeSessions',
  'idleSessions',
  'blockedUsers',
]);

/**
 * Derives the session-based widget values. "Online" uses the one rule shared
 * by every screen: a user is online when at least one of their sessions is
 * open and used within the configured inactivity timeout (`isTrulyActive`,
 * computed by the server). No fixed time windows are applied in the browser.
 *
 * @param {object[]} sessions Session rows from GET /sessions.
 * @returns {{onlineUsers: number, activeSessions: number, idleSessions: number, sessionCount: number}} Tile values.
 */
export function computeWidgetStats(sessions) {
  const rows = Array.isArray(sessions) ? sessions : [];
  const onlineUsers = new Set();
  let activeSessions = 0;
  let idleSessions = 0;

  for (const session of rows) {
    if (!session || typeof session !== 'object' || session.isActive !== true) continue;
    if (session.isTrulyActive === true) {
      activeSessions += 1;
      const userKey = getSessionUserKey(session);
      if (userKey) onlineUsers.add(userKey);
    } else {
      idleSessions += 1;
    }
  }

  return {
    onlineUsers: onlineUsers.size,
    activeSessions,
    idleSessions,
    sessionCount: rows.length,
  };
}

/**
 * Maps the count-only `GET /sessions/stats` payload to the widget tiles.
 * The server counts every session (no list is loaded), so the numbers are
 * exact for any number of sessions.
 *
 * @param {unknown} payload Response body `{ data: { total, active, idle, usersOnline } }`.
 * @returns {{onlineUsers: number, activeSessions: number, idleSessions: number, sessionCount: number}}
 * @throws {Error} When the payload is not a stats object.
 */
export function widgetStatsFromCounts(payload) {
  const data = /** @type {any} */ (payload)?.data;
  const read = (value) => (Number.isFinite(value) && value >= 0 ? Math.floor(value) : NaN);
  const stats = {
    onlineUsers: read(data?.usersOnline),
    activeSessions: read(data?.active),
    idleSessions: read(data?.idle),
    sessionCount: read(data?.total),
  };
  if (Object.values(stats).some((value) => Number.isNaN(value))) {
    throw new Error('Invalid session statistics response');
  }
  return stats;
}
