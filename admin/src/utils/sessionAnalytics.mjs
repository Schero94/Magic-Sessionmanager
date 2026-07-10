import { getSessionStatus } from './sessionStatus.mjs';

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function getUserKey(session) {
  return session?.user?.documentId ||
    session?.user?.id ||
    session?.user?.email ||
    session?.user?.username ||
    null;
}

function getDurationMinutes(session, now) {
  const start = Date.parse(session?.loginTime);
  if (!Number.isFinite(start)) return null;

  const endValue = session.logoutTime || session.lastActive;
  const end = endValue ? Date.parse(endValue) : now;
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / 60000));
}

export function computeSessionAnalytics(sessions = [], { now = Date.now() } = {}) {
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

  for (const session of sessions) {
    const ua = String(session?.userAgent || '').toLowerCase();
    const loginTime = Date.parse(session?.loginTime);

    if (Number.isFinite(loginTime)) {
      if (loginTime > dayAgo) todayLogins++;
      if (loginTime > weekAgo) weekLogins++;
      loginHours[new Date(loginTime).getHours()]++;
    }

    if (ua.includes('tablet') || ua.includes('ipad') || (ua.includes('android') && !ua.includes('mobile'))) {
      increment(devices, 'Tablet');
    } else if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
      increment(devices, 'Mobile');
    } else {
      increment(devices, 'Desktop');
    }

    if (ua.includes('edg')) increment(browsers, 'Edge');
    else if (ua.includes('chrome')) increment(browsers, 'Chrome');
    else if (ua.includes('firefox')) increment(browsers, 'Firefox');
    else if (ua.includes('safari')) increment(browsers, 'Safari');
    else if (ua.includes('postman') || ua.includes('curl')) increment(browsers, 'API Client');
    else increment(browsers, 'Other');

    if (ua.includes('android')) increment(operatingSystems, 'Android');
    else if (ua.includes('ios') || ua.includes('iphone') || ua.includes('ipad')) increment(operatingSystems, 'iOS');
    else if (ua.includes('windows') || ua.includes('win32') || ua.includes('win64')) increment(operatingSystems, 'Windows');
    else if (ua.includes('mac') || ua.includes('darwin')) increment(operatingSystems, 'macOS');
    else if (ua.includes('linux')) increment(operatingSystems, 'Linux');
    else increment(operatingSystems, 'Other');

    const userKey = getUserKey(session);
    if (userKey) uniqueUsers.add(userKey);
    if (session?.ipAddress) uniqueIPs.add(session.ipAddress);

    const status = getSessionStatus(session);
    if (status === 'loggedout') loggedOut++;
    else if (!session?.isActive && status === 'terminated') terminated++;

    const duration = getDurationMinutes(session, now);
    if (duration !== null) durations.push(duration);
  }

  const mobileCount = (devices.Mobile || 0) + (devices.Tablet || 0);

  return {
    totalSessions: sessions.length,
    activeSessions: sessions.filter((session) => session?.isActive && session?.isTrulyActive).length,
    todayLogins,
    weekLogins,
    devices,
    browsers,
    operatingSystems,
    loginHours,
    peakHour: loginHours.indexOf(Math.max(...loginHours)),
    uniqueUsers: uniqueUsers.size,
    uniqueIPs: uniqueIPs.size,
    loggedOut,
    terminated,
    mobileRatio: sessions.length > 0 ? Math.round((mobileCount / sessions.length) * 100) : 0,
    avgSessionDuration: durations.length > 0
      ? Math.floor(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
      : 0,
  };
}
