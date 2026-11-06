import { getSessionUserKey } from './onlineStats.mjs';
import { toValidDate } from './sessionDates.mjs';

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

/** The four home widget tiles, in display order (2 x 2). */
export const WIDGET_STAT_KEYS = Object.freeze(['onlineNow', 'last15min', 'lastHour', 'today']);

/**
 * Returns the start of the local day for a reference time.
 *
 * @param {number} now Reference time in ms.
 * @returns {number} Local midnight in ms.
 */
export function startOfLocalDay(now) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Counts unique users for the home widget:
 * - onlineNow: users with a valid session that is active right now (isTrulyActive).
 * - last15min / lastHour / today: users with session activity in that window,
 *   including sessions that have since ended.
 * Rows without a user key or a valid activity time are ignored.
 *
 * @param {object[]} sessions Session rows from the admin API.
 * @param {{now?: number}} [options] Reference time.
 * @returns {{onlineNow: number, last15min: number, lastHour: number, today: number, sessionCount: number}} Tile values.
 */
export function computeWidgetStats(sessions, { now = Date.now() } = {}) {
  const rows = Array.isArray(sessions) ? sessions : [];
  const dayStart = startOfLocalDay(now);
  const onlineNow = new Set();
  const last15min = new Set();
  const lastHour = new Set();
  const today = new Set();

  for (const session of rows) {
    const userKey = getSessionUserKey(session);
    if (!userKey) continue;

    if (session.isActive === true && session.isTrulyActive === true) onlineNow.add(userKey);

    const activity = toValidDate(session.lastActive) || toValidDate(session.loginTime);
    if (!activity) continue;
    // Small clock skew between server and browser must not drop fresh activity.
    const at = Math.min(activity.getTime(), now);
    const age = now - at;

    if (age < FIFTEEN_MINUTES) last15min.add(userKey);
    if (age < ONE_HOUR) lastHour.add(userKey);
    if (at >= dayStart) today.add(userKey);
  }

  return {
    onlineNow: onlineNow.size,
    last15min: last15min.size,
    lastHour: lastHour.size,
    today: today.size,
    sessionCount: rows.length,
  };
}
