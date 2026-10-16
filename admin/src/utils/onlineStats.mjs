/**
 * Returns a stable user identifier for de-duplicating concurrent sessions.
 *
 * @param {object} session Session row.
 * @returns {string|null} Document ID or non-secret fallback identifier.
 */
export function getSessionUserKey(session) {
  return (
    session?.user?.documentId ||
    session?.user?.id ||
    session?.user?.email ||
    session?.user?.username ||
    null
  );
}

/**
 * Validates the count-only Users & Permissions API response.
 *
 * @param {object} response API response body
 * @returns {{totalUsers: number, blockedUsers: number}|null} Valid counts or null
 */
export function normalizeUserCounts(response) {
  const totalUsers = response?.data?.totalUsers;
  const blockedUsers = response?.data?.blockedUsers;

  if (
    response?.success !== true ||
    !Number.isSafeInteger(totalUsers) || totalUsers < 0 ||
    !Number.isSafeInteger(blockedUsers) || blockedUsers < 0 ||
    blockedUsers > totalUsers
  ) {
    return null;
  }

  return { totalUsers, blockedUsers };
}

/**
 * Counts unique active users by recent activity window and adds user totals.
 *
 * @param {object[]} sessions Session rows returned by the admin API.
 * @param {{now?: number, totalUsers?: number, blockedUsers?: number}} options
 *   Clock and Users & Permissions totals for deterministic display.
 * @returns {{onlineNow: number, offline: number, last15min: number, last30min: number, totalUsers: number, blocked: number}}
 *   Dashboard widget metrics.
 */
export function computeOnlineUserStats(sessions, {
  now = Date.now(),
  totalUsers = null,
  blockedUsers = null,
} = {}) {
  const fifteenMin = 15 * 60 * 1000;
  const thirtyMin = 30 * 60 * 1000;

  const onlineNow = new Set();
  const last15min = new Set();
  const last30min = new Set();

  for (const session of sessions || []) {
    if (!session?.isActive) continue;

    const userKey = getSessionUserKey(session);
    if (!userKey) continue;

    const lastActive = session.lastActive
      ? new Date(session.lastActive)
      : new Date(session.loginTime);
    const lastActiveMs = lastActive.getTime();
    if (!Number.isFinite(lastActiveMs)) continue;

    const timeSinceActive = now - lastActiveMs;

    if (timeSinceActive < fifteenMin) {
      onlineNow.add(userKey);
      last15min.add(userKey);
      last30min.add(userKey);
    } else if (timeSinceActive < thirtyMin) {
      last30min.add(userKey);
    }
  }

  const hasTotalUsers = Number.isSafeInteger(totalUsers) && totalUsers >= 0;
  const hasBlockedUsers = Number.isSafeInteger(blockedUsers) && blockedUsers >= 0;

  return {
    onlineNow: onlineNow.size,
    last15min: last15min.size,
    last30min: last30min.size,
    offline: hasTotalUsers ? Math.max(0, totalUsers - onlineNow.size) : null,
    totalUsers: hasTotalUsers ? totalUsers : null,
    blocked: hasBlockedUsers ? blockedUsers : null,
  };
}
