'use strict';

const { parseUserAgent } = require('./user-agent-parser');

const SESSION_UID = 'plugin::magic-sessionmanager.session';

/**
 * Enhances a raw session record with computed display fields and strips all
 * sensitive tokens and internal metadata before returning.
 *
 * Side effect: may persist freshly-looked-up geo data back to the session
 * record (fire-and-forget — failures are swallowed).
 *
 * @param {object} session - Raw session from DB
 * @param {object} [opts]
 * @param {number} [opts.inactivityTimeout] - ms before a session counts as idle
 * @param {object} [opts.geolocationService]
 * @param {{remaining: number}} [opts.geoCounter] - Shared geo lookup budget
 * @param {object} [opts.strapi]
 * @param {Date}   [opts.now]
 * @returns {Promise<object>} Enhanced session (safe for API response)
 */
async function enhanceSession(session, opts = {}) {
  const {
    inactivityTimeout = 15 * 60 * 1000,
    geolocationService,
    geoCounter,
    strapi,
    now = new Date(),
  } = opts;

  if (!session || typeof session !== 'object') {
    return session;
  }

  let lastActiveTime;
  if (session.lastActive) {
    lastActiveTime = new Date(session.lastActive);
  } else if (session.loginTime) {
    lastActiveTime = new Date(session.loginTime);
  } else {
    lastActiveTime = new Date(0);
  }
  const timeSinceActive = Math.max(0, now - lastActiveTime);
  const isTrulyActive = !!session.isActive && timeSinceActive < inactivityTimeout;

  const parsedUA = parseUserAgent(session.userAgent);
  const deviceType = session.deviceType || parsedUA.deviceType;
  const browserName =
    session.browserName ||
    (parsedUA.browserVersion
      ? `${parsedUA.browserName} ${parsedUA.browserVersion}`
      : parsedUA.browserName);
  const osName =
    session.osName ||
    (parsedUA.osVersion
      ? `${parsedUA.osName} ${parsedUA.osVersion}`
      : parsedUA.osName);

  let geoLocation = session.geoLocation;
  if (typeof geoLocation === 'string') {
    try {
      geoLocation = JSON.parse(geoLocation);
    } catch {
      geoLocation = null;
    }
  }

  if (
    !geoLocation &&
    session.ipAddress &&
    geolocationService &&
    geoCounter &&
    geoCounter.remaining > 0
  ) {
    geoCounter.remaining--;
    try {
      const geoData = await geolocationService.getIpInfo(session.ipAddress);
      if (geoData && geoData._status === 'ok' && geoData.country && geoData.country !== 'Unknown') {
        geoLocation = {
          country: geoData.country,
          country_code: geoData.country_code,
          country_flag: geoData.country_flag,
          city: geoData.city,
          region: geoData.region,
          timezone: geoData.timezone,
        };

        if (strapi) {
          strapi
            .documents(SESSION_UID)
            .update({
              documentId: session.documentId,
              data: {
                geoLocation,
                securityScore: geoData.securityScore || null,
              },
            })
            .catch(() => { /* fire-and-forget */ });
        }
      }
    } catch {
      // geo lookup failed, continue without it
    }
  }

  const {
    token,
    tokenHash,
    refreshToken,
    refreshTokenHash,
    locale,
    publishedAt,
    geoLocation: _geo,
    ...safeSession
  } = session;

  return {
    ...safeSession,
    id: session.documentId,
    deviceType,
    browserName,
    osName,
    geoLocation,
    isTrulyActive,
    minutesSinceActive: Math.floor(timeSinceActive / 1000 / 60),
  };
}

/**
 * Enhances an array of sessions with a shared geo lookup budget so a single
 * request can't exhaust the geolocation API rate limit.
 *
 * @param {Array} sessions
 * @param {object} [opts]
 * @param {number} [maxGeoLookups]
 * @returns {Promise<Array>}
 */
async function enhanceSessions(sessions, opts = {}, maxGeoLookups = 20) {
  const geoCounter = { remaining: maxGeoLookups };
  const now = new Date();

  return Promise.all(
    sessions.map((s) => enhanceSession(s, { ...opts, geoCounter, now }))
  );
}

module.exports = { enhanceSession, enhanceSessions };
