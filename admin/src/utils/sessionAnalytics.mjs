import { getSessionEndReason, getSessionStatus } from './sessionStatus.mjs';
import { getDevicePresentation } from './devicePresentation.mjs';

/**
 * Bucket key for devices, browsers and operating systems that could not be
 * recognised. It is a translation key, never a display label: the page maps
 * it to a translated "Unknown device" / "Other or unknown" text (UX-09, I18N-11).
 */
export const ANALYTICS_OTHER_KEY = 'other';

/** Increments one named count in an analytics accumulator. */
function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

/** Returns a stable, non-secret identity key for user de-duplication. */
function getUserKey(session) {
  return session?.user?.documentId ||
    session?.user?.id ||
    session?.user?.email ||
    session?.user?.username ||
    null;
}

/** Parses a timestamp to epoch milliseconds, or NaN. */
const toTime = (value) => (value ? Date.parse(value) : Number.NaN);

/**
 * Duration of one session in whole minutes, from login to the last moment
 * the session was really used (F5):
 *
 * - logged out by the user: the logout time (logging out is activity);
 * - active, or ended by inactivity, expiry, an administrator or a block: the
 *   last recorded activity. The minutes an idle session waited for the
 *   server's cleanup job are not counted. When no activity timestamp exists,
 *   the logout time is the only end marker and is used instead;
 * - still active without any activity timestamp: now;
 * - ended without any end timestamp: unknown (null), so it cannot inflate the average.
 *
 * @param {object} session Session row.
 * @param {number} [now] Reference clock in epoch milliseconds.
 * @returns {number|null} Non-negative minutes, or null for invalid dates.
 */
export function getSessionDurationMinutes(session, now = Date.now()) {
  const start = toTime(session?.loginTime);
  if (!Number.isFinite(start)) return null;

  const lastActive = toTime(session?.lastActive);
  const logoutTime = toTime(session?.logoutTime);
  const endedByUser = getSessionEndReason(session) === 'logout';

  let end;
  if (endedByUser) {
    end = Number.isFinite(logoutTime) ? logoutTime : lastActive;
  } else if (Number.isFinite(lastActive)) {
    end = lastActive;
  } else if (Number.isFinite(logoutTime)) {
    end = logoutTime;
  } else {
    end = session?.isActive ? now : Number.NaN;
  }

  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / 60000));
}

/**
 * Turns a bucket map ({ key: count }) into bar rows sorted by count (then key),
 * scaled to the largest bucket. Invalid and zero counts are dropped.
 *
 * @param {Record<string, number>|null|undefined} counts Bucket counts.
 * @returns {Array<{key: string, count: number, percent: number}>} Rows for a bar list.
 */
export function getAnalyticsBarRows(counts) {
  const entries = Object.entries(counts || {})
    .filter(([, count]) => Number.isFinite(count) && count > 0);
  if (entries.length === 0) return [];

  const max = Math.max(...entries.map(([, count]) => count));
  return entries
    .sort(([keyA, a], [keyB, b]) => b - a || keyA.localeCompare(keyB))
    .map(([key, count]) => ({
      key,
      count,
      percent: Math.max(0, Math.min(100, Math.round((count / max) * 100))),
    }));
}

/**
 * Aggregates device, browser, user, login and lifecycle metrics from session
 * rows without making network requests. Device and browser detection uses
 * the shared presentation helpers, so Analytics, the dashboard and the user
 * panel classify a session identically.
 *
 * @param {object[]} sessions Normalized session rows.
 * @param {{now?: number}} options Injectable clock for stable tests.
 * @returns {{
 *   totalSessions: number,
 *   activeSessions: number,
 *   todayLogins: number,
 *   weekLogins: number,
 *   devices: Record<string, number>,
 *   browsers: Record<string, number>,
 *   operatingSystems: Record<string, number>,
 *   loginHours: number[],
 *   peakHour: number|null,
 *   uniqueUsers: number,
 *   uniqueIPs: number,
 *   loggedOut: number,
 *   terminated: number,
 *   mobileRatio: number,
 *   avgSessionDuration: number,
 * }} Counts and distributions consumed by the analytics page. Device keys are
 *   normalised device types ('desktop', 'mobile', 'tablet', 'api', 'bot') or
 *   ANALYTICS_OTHER_KEY; browser and OS keys are proper names or ANALYTICS_OTHER_KEY.
 */
export function computeSessionAnalytics(sessions = [], { now = Date.now() } = {}) {
  const rows = Array.isArray(sessions) ? sessions : [];
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const devices = {};
  const browsers = {};
  const operatingSystems = {};
  const loginHours = Array(24).fill(0);
  const uniqueUsers = new Set();
  const uniqueIPs = new Set();
  const durations = [];
  let todayLogins = 0;
  let weekLogins = 0;
  let loggedOut = 0;
  let terminated = 0;

  for (const session of rows) {
    const loginTime = toTime(session?.loginTime);

    if (Number.isFinite(loginTime)) {
      if (loginTime > dayAgo) todayLogins++;
      if (loginTime > weekAgo) weekLogins++;
      loginHours[new Date(loginTime).getHours()]++;
    }

    const device = getDevicePresentation(session || {});
    increment(devices, device.deviceType || ANALYTICS_OTHER_KEY);
    increment(browsers, device.browser || ANALYTICS_OTHER_KEY);
    increment(operatingSystems, device.os || ANALYTICS_OTHER_KEY);

    const userKey = getUserKey(session);
    if (userKey) uniqueUsers.add(userKey);
    if (session?.ipAddress) uniqueIPs.add(session.ipAddress);

    const status = getSessionStatus(session);
    if (status === 'loggedout') loggedOut++;
    else if (status === 'terminated') terminated++;

    const duration = getSessionDurationMinutes(session, now);
    if (duration !== null) durations.push(duration);
  }

  const mobileCount = (devices.mobile || 0) + (devices.tablet || 0);
  const maxLogins = Math.max(...loginHours);

  return {
    totalSessions: rows.length,
    activeSessions: rows.filter((session) => session?.isActive && session?.isTrulyActive).length,
    todayLogins,
    weekLogins,
    devices,
    browsers,
    operatingSystems,
    loginHours,
    peakHour: maxLogins > 0 ? loginHours.indexOf(maxLogins) : null,
    uniqueUsers: uniqueUsers.size,
    uniqueIPs: uniqueIPs.size,
    loggedOut,
    terminated,
    mobileRatio: rows.length > 0 ? Math.round((mobileCount / rows.length) * 100) : 0,
    avgSessionDuration: durations.length > 0
      ? Math.floor(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
      : 0,
  };
}
