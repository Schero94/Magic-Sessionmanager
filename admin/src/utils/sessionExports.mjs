const CSV_HEADERS = [
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
];

/** Quotes one CSV field and escapes embedded double quotes. */
const escapeCsvValue = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

/**
 * Serializes the complete filtered session collection to CSV rows.
 * Downloading is left to the admin page so the formatter can be tested
 * without creating a file containing session data.
 *
 * @param {object[]} sessions Complete filtered session collection.
 * @param {object} options Export fallbacks and session presentation functions.
 * @param {string} options.unavailableValue Localized missing-value label.
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

    return [
      session.id,
      getSessionStatus(session),
      session.user?.email || '',
      session.user?.username || '',
      deviceInfo.device,
      deviceInfo.browser,
      deviceInfo.os,
      session.ipAddress || unavailableValue,
      new Date(session.loginTime).toISOString(),
      new Date(session.lastActive || session.loginTime).toISOString(),
      session.logoutTime ? new Date(session.logoutTime).toISOString() : '',
      session.minutesSinceActive,
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
 * @param {string} options.unavailableValue Localized missing-value label.
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
