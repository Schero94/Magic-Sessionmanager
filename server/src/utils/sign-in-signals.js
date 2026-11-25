'use strict';

// @ts-check

/**
 * Sign-in signals (4.17): new device and impossible travel.
 *
 * Device (no fingerprinting): browser family, operating system family and
 * device type from the User-Agent header, plus the optional `deviceId` that
 * the app itself sends at sign-in (Users & Permissions uses it for its
 * sessions). Nothing is read from the browser beyond what every request
 * sends; no cookie is set. The plugin stores only `deviceKey`, an
 * HMAC-SHA256 of these values with a key derived from
 * SESSION_ENCRYPTION_KEY, so the stored value cannot be linked to a device
 * outside this installation. A sign-in is from a new device when none of
 * the user's last 50 sessions has the same key (older sessions without a key
 * are compared by browser and system family). The first sign-in of a user is
 * never "new".
 *
 * Impossible travel: the great-circle distance between the locations of
 * this sign-in and the user's previous sign-in, divided by the time between
 * them. Flagged when the distance is at least the minimum (default 500 km)
 * and the speed is above the threshold (default 1000 km/h). Locations are
 * stored rounded to 0.1 degree (about 11 km), and only while the feature is
 * on.
 */

const crypto = require('node:crypto');
const { derivePurposeKey } = require('./encryption');
const { parseUserAgent } = require('./user-agent-parser');
const { getCoordinator } = require('./coordination');
const { normalizeApiPrefix } = require('./auth-routes');
const { resolveDetectionSettings } = require('./detection-settings');
const { issueNotMeToken } = require('./not-me-link');
const { SECURITY_EVENTS } = require('./security-log-model');

const SESSION_UID = 'plugin::magic-sessionmanager.session';
const HISTORY = 50;
const EARTH_RADIUS_KM = 6371.0088;

/**
 * Browser and system family (no versions) of a user agent.
 *
 * @param {string|null|undefined} userAgent User-Agent header.
 * @returns {{browser: string, os: string, deviceType: string}} Families.
 */
function deviceFamilies(userAgent) {
  const parsed = parseUserAgent(typeof userAgent === 'string' ? userAgent.slice(0, 500) : '');
  return {
    browser: String(parsed.browserName || 'unknown'),
    os: String(parsed.osName || 'unknown'),
    deviceType: String(parsed.deviceType || 'unknown'),
  };
}

/**
 * Strips the version from a stored "Chrome 131" style name.
 *
 * @param {unknown} value Stored name.
 * @returns {string} Family.
 */
function family(value) {
  return String(value || 'unknown')
    .replace(/\s+[\d.]+$/, '')
    .trim();
}

/**
 * The stored device key of a sign-in.
 *
 * @param {string|null|undefined} userAgent User-Agent header.
 * @param {unknown} [deviceId] `deviceId` the app sent at sign-in, if any.
 * @returns {string} 32 hex characters.
 */
function deviceKeyOf(userAgent, deviceId) {
  const { browser, os, deviceType } = deviceFamilies(userAgent);
  const id = typeof deviceId === 'string' && deviceId.length <= 128 ? deviceId : '';
  return crypto
    .createHmac('sha256', derivePurposeKey('device'))
    .update(`${browser}|${os}|${deviceType}|${id}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * The app-supplied device id of a sign-in request, when present.
 *
 * @param {any} ctx Koa context.
 * @returns {string|null} Device id (at most 128 characters).
 */
function requestDeviceId(ctx) {
  const value = ctx?.request?.body?.deviceId;
  return typeof value === 'string' && value && value.length <= 128 ? value : null;
}

/**
 * Great-circle distance.
 *
 * @param {{lat: number, lon: number}} a Point.
 * @param {{lat: number, lon: number}} b Point.
 * @returns {number} Kilometres.
 */
function distanceKm(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Rounded coordinates from a lookup result, or null.
 *
 * @param {any} geo Lookup result or stored location.
 * @returns {{lat: number, lon: number}|null} Point rounded to 0.1 degree.
 */
function pointOf(geo) {
  const lat = Number(geo?.latitude);
  const lon = Number(geo?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return null;
  }
  if (geo?.latitude === null || geo?.longitude === null) return null;
  return { lat: Math.round(lat * 10) / 10, lon: Math.round(lon * 10) / 10 };
}

/**
 * Evaluates two sign-ins for impossible travel.
 *
 * @param {{point: {lat: number, lon: number}|null, at: number}} previous Previous sign-in.
 * @param {{point: {lat: number, lon: number}|null, at: number}} current This sign-in.
 * @param {{speedKmh: number, minDistanceKm: number}} limits Thresholds.
 * @returns {{flagged: boolean, distanceKm: number, speedKmh: number}|null} Result, or null
 *   when a location is missing.
 */
function evaluateTravel(previous, current, { speedKmh, minDistanceKm }) {
  if (!previous?.point || !current?.point) return null;
  const km = distanceKm(previous.point, current.point);
  // At least one minute, so two sign-ins in the same second do not divide by zero.
  const hours = Math.max(current.at - previous.at, 60 * 1000) / (60 * 60 * 1000);
  const speed = km / hours;
  return {
    flagged: km >= minDistanceKm && speed > speedKmh,
    distanceKm: Math.round(km),
    speedKmh: Math.round(speed),
  };
}

/**
 * Previous sessions of a user, newest first, without the new one.
 *
 * @param {any} strapi Strapi instance.
 * @param {string} userDocumentId User.
 * @param {string} exceptSessionId New session.
 * @returns {Promise<any[]>} Rows with the fields the signals need.
 */
async function previousSessions(strapi, userDocumentId, exceptSessionId) {
  const rows = await strapi.documents(SESSION_UID).findMany({
    filters: { user: { documentId: userDocumentId }, documentId: { $ne: exceptSessionId } },
    fields: [
      'documentId',
      'loginTime',
      'deviceKey',
      'browserName',
      'osName',
      'deviceType',
      'geoLocation',
    ],
    sort: [{ loginTime: 'desc' }, { id: 'desc' }],
    limit: HISTORY,
  });
  return Array.isArray(rows) ? rows : [];
}

/**
 * Whether a sign-in names a device this account has signed in with before:
 * the request carries an app-supplied device id and one of the account's
 * sessions has the same device key (browser, system, device type and that
 * id). Without a device id nothing is recognised, because a user agent alone
 * is easy to copy. Used by the account lockout (security review 2, L1).
 *
 * @param {any} strapi Strapi instance.
 * @param {string|null} userDocumentId Account.
 * @param {{userAgent: string|null, deviceId: string|null}} request Sign-in request facts.
 * @returns {Promise<boolean>}
 */
async function isRecognizedDevice(strapi, userDocumentId, { userAgent, deviceId }) {
  if (typeof userDocumentId !== 'string' || !userDocumentId) return false;
  if (typeof deviceId !== 'string' || !deviceId) return false;
  const deviceKey = deviceKeyOf(userAgent || '', deviceId);
  const count = await strapi.documents(SESSION_UID).count({
    filters: { user: { documentId: userDocumentId }, deviceKey },
  });
  return Number(count) > 0;
}

/**
 * Whether a sign-in comes from a device the user has not used in their last
 * 50 sessions.
 *
 * @param {any[]} previous Previous sessions (newest first).
 * @param {{deviceKey: string, userAgent: string|null}} current This sign-in.
 * @returns {boolean} True for a new device; false for the first sign-in.
 */
function isNewDevice(previous, { deviceKey, userAgent }) {
  if (previous.length === 0) return false;
  if (previous.some((row) => row.deviceKey && row.deviceKey === deviceKey)) return false;
  const families = deviceFamilies(userAgent);
  return !previous.some(
    (row) =>
      !row.deviceKey &&
      family(row.browserName) === families.browser &&
      family(row.osName) === families.os
  );
}

/**
 * The location of a stored session (its rounded point and country).
 *
 * @param {any} row Session row.
 * @returns {{point: {lat: number, lon: number}|null, country: string|null}} Location.
 */
function storedLocation(row) {
  let geo = row?.geoLocation;
  if (typeof geo === 'string') {
    try {
      geo = JSON.parse(geo);
    } catch {
      geo = null;
    }
  }
  return {
    point: pointOf(geo),
    country: typeof geo?.country_code === 'string' ? geo.country_code : null,
  };
}

/**
 * The "This wasn't me" URL for a session, or null when the server has no
 * absolute http(s) URL (`server.url`) to build it from.
 *
 * @param {any} strapi Strapi instance.
 * @param {string} sessionId Session documentId.
 * @param {string} userId User documentId.
 * @returns {Promise<string|null>} URL.
 * @sideeffect Stores the link's single-use nonce.
 */
async function notMeUrl(strapi, sessionId, userId) {
  const base = String(strapi.config.get('server.absoluteUrl') || '').replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+/.test(base)) return null;
  const token = await issueNotMeToken(getCoordinator(strapi), { sessionId, userId });
  if (!token) return null;
  const prefix = normalizeApiPrefix(strapi.config.get('api.rest.prefix', '/api'));
  // The token travels in the fragment, which browsers never send to the
  // server, so it does not reach access logs or proxies (security review 2,
  // L5). The confirmation page copies it into its form with a CSP-hashed
  // script; `?token=` links sent before 4.22.1 keep working until they expire.
  return `${base}${prefix}/magic-sessionmanager/not-me#token=${encodeURIComponent(token)}`;
}

/**
 * Evaluates the new-device and impossible-travel signals of a new session
 * and acts on them: security log event (and the selected webhooks), email
 * with the "This wasn't me" link, and the re-sign-in decision. Emails are
 * sent in the background; nothing here changes the response.
 *
 * @param {{strapi: any, settings: Record<string, any>, user: any, userDocumentId: string,
 *   session: any, geoData: any, deviceKey: string, userAgent: string|null, ip: string|null,
 *   record: (input: any) => unknown, now?: number}} input Sign-in facts.
 * @returns {Promise<{newDevice: boolean, travel: object|null, reauthenticate: boolean}>} Outcome.
 */
async function runSignInSignals({
  strapi,
  settings,
  user,
  userDocumentId,
  session,
  geoData,
  deviceKey,
  userAgent,
  ip,
  record,
  now = Date.now(),
}) {
  const outcome = { newDevice: false, travel: null, reauthenticate: false };
  const detection = resolveDetectionSettings(settings);
  const plugin = strapi.plugin('magic-sessionmanager');
  const emails = settings.enableEmailAlerts === true;
  // A webhook only counts when one is set up, so the default event
  // selection alone never turns detection on.
  const hasWebhookTarget =
    (detection.genericWebhookEnabled && !!detection.genericWebhookUrl) ||
    (settings.enableWebhooks === true &&
      !!(settings.discordWebhookUrl || settings.slackWebhookUrl));
  const wantNewDevice =
    (emails && detection.alertOnNewDevice) ||
    (hasWebhookTarget && detection.webhookEvents.includes('login.new_device'));
  const wantTravel = detection.impossibleTravelEnabled;
  if ((!wantNewDevice && !wantTravel) || !session?.documentId) return outcome;

  const previous = await previousSessions(strapi, userDocumentId, session.documentId);
  const families = deviceFamilies(userAgent);
  let link;
  const linkOnce = async () => {
    if (link === undefined) link = await notMeUrl(strapi, session.documentId, userDocumentId);
    return link;
  };
  const notifications = plugin.service('notifications');
  const facts = { user, session, geoData, device: { browser: families.browser, os: families.os } };

  if (wantNewDevice && isNewDevice(previous, { deviceKey, userAgent })) {
    outcome.newDevice = true;
    record({
      event: SECURITY_EVENTS.USER_NEW_DEVICE,
      actorType: 'user',
      actorId: userDocumentId,
      targetType: 'user',
      targetId: userDocumentId,
      ip,
      userAgent,
      meta: { browser: families.browser, os: families.os, deviceType: families.deviceType },
    });
    if (emails && detection.alertOnNewDevice) {
      const url = await linkOnce();
      notifications.sendSignInSignalEmail('newDevice', { ...facts, link: url }).catch(() => {});
    }
  }

  if (wantTravel) {
    const before = previous.find((row) => storedLocation(row).point);
    const result = before
      ? evaluateTravel(
          { point: storedLocation(before).point, at: new Date(before.loginTime).getTime() },
          { point: pointOf(geoData), at: now },
          {
            speedKmh: detection.impossibleTravelSpeedKmh,
            minDistanceKm: detection.impossibleTravelMinDistanceKm,
          }
        )
      : null;
    if (result?.flagged) {
      outcome.travel = result;
      record({
        event: SECURITY_EVENTS.USER_IMPOSSIBLE_TRAVEL,
        actorType: 'user',
        actorId: userDocumentId,
        targetType: 'user',
        targetId: userDocumentId,
        ip,
        userAgent,
        meta: {
          distanceKm: result.distanceKm,
          speedKmh: result.speedKmh,
          from: storedLocation(before).country,
          to: typeof geoData?.country_code === 'string' ? geoData.country_code : null,
          action: detection.impossibleTravelAction,
        },
      });
      if (emails && detection.alertOnImpossibleTravel) {
        const url = await linkOnce();
        notifications
          .sendSignInSignalEmail('impossibleTravel', { ...facts, travel: result, link: url })
          .catch(() => {});
      }
      outcome.reauthenticate = detection.impossibleTravelAction === 'reauthenticate';
    }
  }
  return outcome;
}

module.exports = {
  isRecognizedDevice,
  notMeUrl,
  runSignInSignals,
  deviceFamilies,
  deviceKeyOf,
  distanceKm,
  evaluateTravel,
  isNewDevice,
  pointOf,
  previousSessions,
  requestDeviceId,
  storedLocation,
};
