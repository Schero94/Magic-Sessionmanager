export function getSessionUserKey(session) {
  return (
    session?.user?.documentId ||
    session?.user?.id ||
    session?.user?.email ||
    session?.user?.username ||
    null
  );
}

export function computeOnlineUserStats(sessions, {
  now = Date.now(),
  totalUsers = 0,
  blockedUsers = 0,
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

  return {
    onlineNow: onlineNow.size,
    last15min: last15min.size,
    last30min: last30min.size,
    offline: Math.max(0, totalUsers - onlineNow.size),
    totalUsers,
    blocked: blockedUsers,
  };
}
