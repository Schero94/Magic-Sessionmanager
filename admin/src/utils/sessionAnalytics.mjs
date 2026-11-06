import { normalizeDeviceType } from './devicePresentation.mjs';

/**
 * Bucket key for devices and browsers that were not detected. It is a
 * translation key, never a display label: the page shows it as a translated
 * "Unknown" (UX-09, decision I.2-3).
 */
export const ANALYTICS_UNKNOWN_KEY = 'unknown';

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

/** Version-like trailing tokens ("17.4", "124.0.0.0", "10") of a stored name. */
const VERSION_TOKEN = /^v?\d[\w.]*$/i;

/**
 * Removes trailing version tokens from a stored browser name, so
 * "Safari 17.4" and "Safari 18" share one bucket. Missing and 'unknown'
 * values map to the unknown bucket.
 *
 * @param {unknown} value Stored name, for example "Chrome 124.0.0.0".
 * @returns {string} Name without version, or ANALYTICS_UNKNOWN_KEY.
 */
function toNameBucket(value) {
  if (typeof value !== 'string') return ANALYTICS_UNKNOWN_KEY;
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && VERSION_TOKEN.test(tokens[tokens.length - 1])) tokens.pop();
  const name = tokens.join(' ');
  if (!name || name.toLowerCase() === ANALYTICS_UNKNOWN_KEY) return ANALYTICS_UNKNOWN_KEY;
  return name;
}

/**
 * Device bucket from the stored device type the API returns (decision I.2-3).
 * The raw user agent is not re-parsed, so Strapi sessions without a user
 * agent are counted as unknown instead of being guessed.
 *
 * @param {object} session Session row.
 * @returns {string} Normalised device type or ANALYTICS_UNKNOWN_KEY.
 */
export function getDeviceBucket(session) {
  return normalizeDeviceType(session?.deviceType) || ANALYTICS_UNKNOWN_KEY;
}

/**
 * Browser bucket from the stored browser name, without its version.
 *
 * @param {object} session Session row.
 * @returns {string} Browser name or ANALYTICS_UNKNOWN_KEY.
 */
export function getBrowserBucket(session) {
  return toNameBucket(session?.browserName);
}

/**
 * Length of one session in whole minutes: from sign-in to the end of the
 * session, or to its last activity while it is still open
 * (`logoutTime || lastActive || now`, IA D6). Sessions that timed out include
 * the unused time before they were closed.
 *
 * - ended: the end time; without one, the last activity; without both,
 *   unknown (null), so it cannot inflate the average;
 * - open: the last activity; without one, now.
 *
 * @param {object} session Session row.
 * @param {number} [now] Reference clock in epoch milliseconds.
 * @returns {number|null} Non-negative minutes, or null when it cannot be computed.
 */
export function getSessionDurationMinutes(session, now = Date.now()) {
  const start = toTime(session?.loginTime);
  if (!Number.isFinite(start)) return null;

  const lastActive = toTime(session?.lastActive);
  const logoutTime = toTime(session?.logoutTime);

  let end;
  if (session?.isActive) {
    end = Number.isFinite(lastActive) ? lastActive : now;
  } else if (Number.isFinite(logoutTime)) {
    end = logoutTime;
  } else {
    end = lastActive;
  }

  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / 60000));
}

/**
 * Turns a bucket map ({ key: count }) into bar rows sorted by count (then
 * key), scaled to the largest bucket. The unknown bucket is always last.
 * Invalid and zero counts are dropped.
 *
 * @param {Record<string, number>|null|undefined} counts Bucket counts.
 * @returns {Array<{key: string, count: number, percent: number}>} Rows for a bar list.
 */
export function getAnalyticsBarRows(counts) {
  const entries = Object.entries(counts || {})
    .filter(([, count]) => Number.isFinite(count) && count > 0);
  if (entries.length === 0) return [];

  const max = Math.max(...entries.map(([, count]) => count));
  const unknownLast = (key) => (key === ANALYTICS_UNKNOWN_KEY ? 1 : 0);
  return entries
    .sort(([keyA, a], [keyB, b]) => unknownLast(keyA) - unknownLast(keyB) || b - a || keyA.localeCompare(keyB))
    .map(([key, count]) => ({
      key,
      count,
      percent: Math.max(0, Math.min(100, Math.round((count / max) * 100))),
    }));
}

/**
 * Aggregates the analytics page metrics from the loaded session rows without
 * network requests. States follow the shared rule: active = open and used
 * within the inactivity timeout (`isActive && isTrulyActive`), idle = open but
 * unused, ended = not open.
 *
 * @param {object[]} sessions Session rows from GET /sessions.
 * @param {{now?: number}} [options] Injectable clock for stable tests.
 * @returns {{
 *   totalSessions: number,
 *   activeSessions: number,
 *   idleSessions: number,
 *   endedSessions: number,
 *   signInsLast24Hours: number,
 *   signInsLast7Days: number,
 *   devices: Record<string, number>,
 *   browsers: Record<string, number>,
 *   uniqueUsers: number,
 *   avgSessionDuration: number,
 * }} Counts and distributions. Device keys are normalised device types or
 *   ANALYTICS_UNKNOWN_KEY; browser keys are proper names or ANALYTICS_UNKNOWN_KEY.
 */
export function computeSessionAnalytics(sessions = [], { now = Date.now() } = {}) {
  const rows = Array.isArray(sessions) ? sessions : [];
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const devices = {};
  const browsers = {};
  const uniqueUsers = new Set();
  const durations = [];
  let activeSessions = 0;
  let idleSessions = 0;
  let endedSessions = 0;
  let signInsLast24Hours = 0;
  let signInsLast7Days = 0;

  for (const session of rows) {
    const loginTime = toTime(session?.loginTime);
    if (Number.isFinite(loginTime)) {
      if (loginTime > dayAgo) signInsLast24Hours++;
      if (loginTime > weekAgo) signInsLast7Days++;
    }

    if (session?.isActive) {
      if (session.isTrulyActive) activeSessions++;
      else idleSessions++;
    } else {
      endedSessions++;
    }

    increment(devices, getDeviceBucket(session));
    increment(browsers, getBrowserBucket(session));

    const userKey = getUserKey(session);
    if (userKey) uniqueUsers.add(userKey);

    const duration = getSessionDurationMinutes(session, now);
    if (duration !== null) durations.push(duration);
  }

  return {
    totalSessions: rows.length,
    activeSessions,
    idleSessions,
    endedSessions,
    signInsLast24Hours,
    signInsLast7Days,
    devices,
    browsers,
    uniqueUsers: uniqueUsers.size,
    avgSessionDuration: durations.length > 0
      ? Math.floor(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
      : 0,
  };
}
