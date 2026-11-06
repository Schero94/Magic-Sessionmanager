/**
 * Column names of the CSV export.
 *
 * These are deliberately stable English, machine-readable identifiers and are
 * NOT translated (I18N-11): spreadsheets, SIEM imports and scripts address the
 * columns by name, so a German and an English administrator must produce the
 * same file. Cell values are data (status keys, ISO timestamps, device type
 * keys), not UI text, for the same reason.
 */
export const CSV_HEADERS = Object.freeze([
  'ID',
  'Status',
  'User Email',
  'Username',
  'Device',
  'Browser',
  'OS',
  'IP Address',
  'Login Time',
  'Last Active',
  'Logout Time',
  'Minutes Idle',
]);

/** Quotes one CSV field and escapes embedded double quotes. */
const escapeCsvValue = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

/**
 * Converts a timestamp to ISO 8601, or '' when it is missing or invalid.
 * `new Date(undefined).toISOString()` throws, which used to abort the whole
 * export when one legacy row had no login time.
 *
 * @param {unknown} value Timestamp.
 * @returns {string} ISO string or ''.
 */
export function toIsoTimestamp(value) {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(/** @type {any} */ (value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

/**
 * Serializes the complete filtered session collection to CSV rows.
 * Downloading is left to the admin page so the formatter can be tested
 * without creating a file containing session data.
 *
 * @param {object[]} sessions Complete filtered session collection.
 * @param {object} options Export fallbacks and session presentation functions.
 * @param {string} options.unavailableValue Value written for missing details.
 * @param {(session: object, unavailableValue: string) => object} options.getDeviceInfo
 *   Normalizes optional device fields.
 * @param {(session: object) => string} options.getSessionStatus
 *   Returns the normalized lifecycle status.
 * @returns {string} CSV text with a header and one row per supplied session.
 */
export function buildSessionCsv(sessions, { unavailableValue, getDeviceInfo, getSessionStatus }) {
  const rows = Array.isArray(sessions) ? sessions : [];
  const csvRows = rows.map((session) => {
    const deviceInfo = getDeviceInfo(session, unavailableValue);
    const minutesIdle = Number.isFinite(session.minutesSinceActive) ? session.minutesSinceActive : '';

    return [
      session.id,
      getSessionStatus(session),
      session.user?.email || '',
      session.user?.username || '',
      deviceInfo.device,
      deviceInfo.browser,
      deviceInfo.os,
      session.ipAddress || unavailableValue,
      toIsoTimestamp(session.loginTime),
      toIsoTimestamp(session.lastActive || session.loginTime),
      toIsoTimestamp(session.logoutTime),
      minutesIdle,
    ];
  });

  return [
    CSV_HEADERS.map(escapeCsvValue).join(','),
    ...csvRows.map((row) => row.map(escapeCsvValue).join(',')),
  ].join('\n');
}

/**
 * Builds a JSON export for the full filtered set, independent of pagination.
 * The output includes normalized session data but never token material.
 *
 * @param {object[]} sessions Complete filtered session collection.
 * @param {object} options Export metadata, fallbacks and presentation functions.
 * @param {string} options.filterStatus Selected status filter.
 * @param {number} options.totalSessions Total sessions before filtering.
 * @param {string} options.exportedAt ISO timestamp for deterministic tests.
 * @param {string} options.unavailableValue Value written for missing details.
 * @param {(session: object, unavailableValue: string) => object} options.getDeviceInfo
 *   Normalizes optional device fields.
 * @param {(session: object) => string} options.getSessionStatus
 *   Returns the normalized lifecycle status.
 * @returns {string} Pretty-printed JSON document.
 */
export function buildSessionJson(sessions, {
  filterStatus,
  totalSessions,
  exportedAt,
  unavailableValue,
  getDeviceInfo,
  getSessionStatus,
}) {
  const rows = Array.isArray(sessions) ? sessions : [];
  const exportData = {
    exportedAt,
    filter: filterStatus,
    totalSessions,
    exportedSessions: rows.length,
    sessions: rows.map((session) => {
      const deviceInfo = getDeviceInfo(session, unavailableValue);

      return {
        id: session.id,
        status: getSessionStatus(session),
        user: {
          id: session.user?.documentId || session.user?.id,
          email: session.user?.email,
          username: session.user?.username,
        },
        device: {
          type: deviceInfo.device,
          browser: deviceInfo.browser,
          browserVersion: deviceInfo.browserVersion,
          os: deviceInfo.os,
        },
        ipAddress: session.ipAddress || unavailableValue,
        loginTime: session.loginTime,
        lastActive: session.lastActive,
        logoutTime: session.logoutTime,
        minutesSinceActive: session.minutesSinceActive,
        isActive: session.isActive,
        isTrulyActive: session.isTrulyActive,
      };
    }),
  };

  return JSON.stringify(exportData, null, 2);
}
