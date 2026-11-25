'use strict';

// @ts-check

/**
 * "This wasn't me" links in the new-device and impossible-travel emails
 * (4.17).
 *
 * A token is `<payload>.<signature>` in base64url: the payload names the
 * session and its user, an expiry (72 hours) and a random nonce; the
 * signature is HMAC-SHA256 with a key derived from SESSION_ENCRYPTION_KEY
 * for this purpose only. Single use: issuing the link stores the nonce in
 * the shared registry until the expiry; using it takes the nonce (one
 * atomic delete), so a second use, also on another process, fails. Opening
 * the link (GET) never uses it; only the confirmation (POST) does, so mail
 * scanners that prefetch links cannot end sessions.
 */

const crypto = require('node:crypto');
const { derivePurposeKey } = require('./encryption');

const LIFETIME_MS = 72 * 60 * 60 * 1000;
const NONCE_PREFIX = 'notme:';
const DOCUMENT_ID = /^[A-Za-z0-9]{1,64}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,400}\.[A-Za-z0-9_-]{43}$/;

/** @returns {Buffer} Signing key. */
const signingKey = () => derivePurposeKey('not-me-link');

/**
 * @param {string} payload Encoded payload.
 * @returns {string} base64url HMAC.
 */
const sign = (payload) =>
  crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url');

/**
 * Issues a link token for one session and stores its nonce.
 *
 * @param {object} coordinator Coordinator (shared registry).
 * @param {{sessionId: string, userId: string, now?: number}} input Session and user documentIds.
 * @returns {Promise<string|null>} Token, or null when the ids are not valid.
 * @sideeffect Stores the nonce in the shared registry until the expiry.
 */
async function issueNotMeToken(coordinator, { sessionId, userId, now = Date.now() }) {
  if (!DOCUMENT_ID.test(String(sessionId)) || !DOCUMENT_ID.test(String(userId))) return null;
  const nonce = crypto.randomBytes(18).toString('hex');
  const payload = Buffer.from(
    JSON.stringify({ s: sessionId, u: userId, e: now + LIFETIME_MS, n: nonce })
  ).toString('base64url');
  await coordinator.registryPut(
    `${NONCE_PREFIX}${nonce}`,
    { s: sessionId, u: userId },
    LIFETIME_MS
  );
  return `${payload}.${sign(payload)}`;
}

/**
 * Checks a token without using it (signature, shape and expiry).
 *
 * @param {unknown} token Token from the link.
 * @param {{now?: number}} [options] Clock.
 * @returns {{sessionId: string, userId: string, nonce: string, expiresAt: number}|null} Claims.
 */
function readNotMeToken(token, { now = Date.now() } = {}) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
  const [payload, signature] = token.split('.');
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (
    !claims ||
    !DOCUMENT_ID.test(String(claims.s)) ||
    !DOCUMENT_ID.test(String(claims.u)) ||
    !/^[a-f0-9]{36}$/.test(String(claims.n)) ||
    !Number.isFinite(claims.e) ||
    claims.e <= now
  ) {
    return null;
  }
  return { sessionId: claims.s, userId: claims.u, nonce: claims.n, expiresAt: claims.e };
}

/**
 * Uses a token once.
 *
 * @param {object} coordinator Coordinator (shared registry).
 * @param {unknown} token Token from the confirmation form.
 * @returns {Promise<{sessionId: string, userId: string}|null>} Claims, or null when invalid,
 *   expired or already used.
 * @sideeffect Removes the nonce from the shared registry.
 */
async function consumeNotMeToken(coordinator, token) {
  const claims = readNotMeToken(token);
  if (!claims) return null;
  const stored = await coordinator.registryTake(`${NONCE_PREFIX}${claims.nonce}`);
  if (!stored || stored.s !== claims.sessionId || stored.u !== claims.userId) return null;
  return { sessionId: claims.sessionId, userId: claims.userId };
}

module.exports = { LIFETIME_MS, consumeNotMeToken, issueNotMeToken, readNotMeToken };
