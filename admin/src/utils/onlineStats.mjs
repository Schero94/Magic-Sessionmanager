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
    !Number.isSafeInteger(totalUsers) ||
    totalUsers < 0 ||
    !Number.isSafeInteger(blockedUsers) ||
    blockedUsers < 0 ||
    blockedUsers > totalUsers
  ) {
    return null;
  }

  return { totalUsers, blockedUsers };
}
