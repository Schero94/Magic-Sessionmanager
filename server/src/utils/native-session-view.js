'use strict';

const NATIVE_SESSION_PREFIX = 'native_';

/**
 * Builds a URL-safe view key carrying the owner document ID and native
 * session ID as one opaque route value.
 *
 * @param {string} userDocumentId Users & Permissions owner documentId.
 * @param {string} nativeSessionId Native Users & Permissions session ID.
 * @returns {string} Stable `native_`-prefixed URL-safe key.
 */
function createNativeSessionKey(userDocumentId, nativeSessionId) {
  if (
    typeof userDocumentId !== 'string' ||
    !userDocumentId ||
    typeof nativeSessionId !== 'string' ||
    !nativeSessionId
  ) {
    throw new TypeError('Native session view keys require an owner documentId and session ID.');
  }

  const payload = Buffer.from(JSON.stringify([userDocumentId, nativeSessionId])).toString(
    'base64url'
  );
  if (payload.length > 2048) {
    throw new RangeError('Native session view key exceeds the supported URL-safe length.');
  }
  return `${NATIVE_SESSION_PREFIX}${payload}`;
}

/**
 * Parses and validates a URL-safe native key without resolving its owner.
 *
 * @param {string} value Native session view key.
 * @returns {{userDocumentId:string,nativeSessionId:string}|null} Decoded pair, or null for an invalid key.
 */
function parseNativeSessionKey(value) {
  if (typeof value !== 'string' || !value.startsWith(NATIVE_SESSION_PREFIX)) return null;

  const encoded = value.slice(NATIVE_SESSION_PREFIX.length);
  if (!encoded || encoded.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;

  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== encoded) return null;

    const payload = JSON.parse(decoded);
    if (
      !Array.isArray(payload) ||
      payload.length !== 2 ||
      typeof payload[0] !== 'string' ||
      !payload[0] ||
      typeof payload[1] !== 'string' ||
      !payload[1]
    ) {
      return null;
    }

    return {
      userDocumentId: payload[0],
      nativeSessionId: payload[1],
    };
  } catch {
    return null;
  }
}

/**
 * Converts an actual Users & Permissions session into Magic's established
 * session row shape without guessing device, network, or termination details.
 *
 * @param {object} session Native Users & Permissions session data.
 * @param {object} user Safe user fields associated with the native session.
 * @returns {object} A token-free, stable view row for existing consumers.
 */
function mapNativeSessionToView(session, user) {
  const nativeId = String(session.sessionId);
  const stableId = createNativeSessionKey(String(user.documentId), nativeId);
  const metadata = session.metadata && typeof session.metadata === 'object' ? session.metadata : {};
  const loginAt =
    typeof metadata.loginAt === 'string' && !Number.isNaN(Date.parse(metadata.loginAt))
      ? new Date(metadata.loginAt)
      : null;
  const createdAt =
    session.createdAt && !Number.isNaN(new Date(session.createdAt).getTime())
      ? new Date(session.createdAt)
      : null;
  const userView = {
    documentId: user.documentId,
    email: user.email,
    username: user.username,
  };

  return {
    documentId: stableId,
    id: stableId,
    sessionId: stableId,
    nativeSessionId: nativeId,
    user: userView,
    ipAddress: null,
    userAgent: null,
    loginTime: loginAt || createdAt,
    logoutTime: null,
    lastActive: createdAt || loginAt,
    isActive: true,
    terminatedManually: false,
    geoLocation: null,
    securityScore: null,
    deviceType: null,
    deviceName: typeof metadata.deviceName === 'string' ? metadata.deviceName : undefined,
    browserName: null,
    osName: null,
  };
}

/**
 * Adds a non-enumerable truncation indicator while preserving the array API.
 *
 * @param {object[]} sessions Session rows returned to existing callers.
 * @param {boolean} truncated Whether the service result exceeded its cap.
 * @returns {object[]} The same array with a non-enumerable `truncated` flag.
 */
function markSessionsTruncated(sessions, truncated) {
  Object.defineProperty(sessions, 'truncated', {
    value: Boolean(truncated),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return sessions;
}

module.exports = {
  NATIVE_SESSION_PREFIX,
  createNativeSessionKey,
  parseNativeSessionKey,
  mapNativeSessionToView,
  markSessionsTruncated,
};
