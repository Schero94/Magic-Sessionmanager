'use strict';

const { encryptToken, generateSessionId, hashToken } = require('../utils/encryption');
const { createLogger } = require('../utils/logger');
const { parseUserAgent } = require('../utils/user-agent-parser');
const { resolveUserDocumentId } = require('../utils/resolve-user');
const { enhanceSessions, shouldResolveGeoData } = require('../utils/enhance-session');
const { getPluginSettings } = require('../utils/settings-loader');
const {
  cleanupExpiredAccessTokenRevocations,
  persistAccessTokenRevocation,
} = require('../utils/session-revocation');
const { getNativeSessionManager } = require('../utils/native-session-manager');
const {
  NATIVE_SESSION_PREFIX,
  mapNativeSessionToView,
  markSessionsTruncated,
  parseNativeSessionKey,
} = require('../utils/native-session-view');

/**
 * Session Service
 *
 * All session data is accessed via `strapi.documents()` (Strapi v5 Document
 * Service). JWT tokens are encrypted (AES-256-GCM) before storage; a SHA-256
 * hash of the raw token is kept for O(1) lookups.
 */

const SESSION_UID = 'plugin::magic-sessionmanager.session';
const USER_UID = 'plugin::users-permissions.user';
const MAX_SESSIONS_QUERY = 1000;
const USER_PAGE_SIZE = 100;
const NATIVE_LIST_CONCURRENCY = 8;

/**
 * Applies an asynchronous mapper to a list with a fixed number of workers.
 *
 * @template T, R
 * @param {T[]} items Items to process.
 * @param {number} concurrency Maximum number of active mapper calls.
 * @param {(item: T, index: number) => Promise<R>} mapper Per-item operation.
 * @returns {Promise<R[]>} Results in input order.
 */
async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await mapper(items[index], index);
      }
    })
  );

  return results;
}

/**
 * Reads the internal Users & Permissions document ID from a Magic sidecar.
 *
 * @param {object} session Magic session row.
 * @returns {string|null} Related user document ID.
 */
function getSessionUserDocumentId(session) {
  if (session?.user && typeof session.user === 'object' && session.user.documentId) {
    return String(session.user.documentId);
  }
  if (typeof session?.user === 'string' && Number.isNaN(Number(session.user))) {
    return session.user;
  }
  return null;
}

/**
 * Reflects native revocation in the returned view while keeping the
 * non-secret native session ID available to current-session consumers.
 *
 * @param {object[]} sessions Raw Magic sidecar rows.
 * @param {Map<string, Set<string>>} activeIdsByUser Confirmed active native IDs.
 * @returns {object[]} Safe rows ready for the existing session enhancer.
 */
function reconcileSidecarViews(sessions, activeIdsByUser) {
  return sessions.map((session) => {
    const nativeSessionId = session.nativeSessionId;
    if (!nativeSessionId) return session;

    const userDocumentId = getSessionUserDocumentId(session);
    const activeIds = userDocumentId ? activeIdsByUser.get(userDocumentId) : null;
    if (activeIds?.has(String(nativeSessionId))) return session;

    return { ...session, isActive: false };
  });
}

/**
 * Prevents the legacy enhancer from turning an absent native device signal
 * into guessed "unknown" browser, OS, or device-type values.
 *
 * @param {object[]} sessions Enhanced session view rows.
 * @returns {object[]} The same rows with native-only unavailable fields explicit.
 */
function normalizeNativeViewFields(sessions) {
  for (const session of sessions) {
    if (
      typeof session.documentId !== 'string' ||
      !session.documentId.startsWith(NATIVE_SESSION_PREFIX)
    ) {
      continue;
    }
    session.deviceType = null;
    session.browserName = null;
    session.osName = null;
  }
  return sessions;
}

/**
 * Holds a physical row lock for a selected session until the surrounding
 * Strapi transaction completes. The physical table and column are used only
 * for locking; session reads and writes continue through Document Service.
 *
 * @param {Function} trx - Strapi transaction's Knex query builder
 * @param {string} documentId - Selected session documentId
 * @returns {Promise<void>}
 */
async function lockSessionRow(trx, documentId) {
  // PostgreSQL/MySQL hold this explicit row lock. Knex strips FOR UPDATE on
  // SQLite, which serializes writes at database level: after a read snapshot,
  // a competing commit makes the stale transaction's later write block/fail
  // instead of overwriting that committed result.
  await trx('magic_sessions').where({ document_id: documentId }).forUpdate().first('document_id');
}

module.exports = ({ strapi }) => {
  const log = createLogger(strapi);

  /**
   * Loads the minimum safe user fields needed to call Strapi's public
   * Users & Permissions session API.
   *
   * @param {string} documentId Users & Permissions documentId.
   * @returns {Promise<object|null>} User record with its numeric Strapi ID.
   */
  async function findNativeUserByDocumentId(documentId) {
    if (!documentId) return null;
    return strapi.documents(USER_UID).findOne({
      documentId,
      fields: ['id', 'documentId', 'email', 'username'],
    });
  }

  /**
   * Resolves a sidecar relation to its native numeric Users & Permissions ID.
   *
   * @param {object} session Magic sidecar row.
   * @returns {Promise<object>} User record with numeric ID and documentId.
   * @throws {Error} When the related user cannot be resolved safely.
   */
  async function resolveNativeUserForSidecar(session) {
    const relation = session?.user;
    const documentId =
      getSessionUserDocumentId(session) ||
      (relation && typeof relation === 'object' && relation.id
        ? await resolveUserDocumentId(strapi, relation.id)
        : null);
    const populatedUser = relation && typeof relation === 'object' ? relation : null;
    if (populatedUser?.id && populatedUser.documentId) return populatedUser;

    const user = await findNativeUserByDocumentId(documentId);
    if (!user?.id || !user?.documentId) {
      throw new Error(
        'Cannot safely resolve the Users & Permissions owner for a native session sidecar.'
      );
    }
    return user;
  }

  /**
   * Revokes a linked native session before any Magic sidecar mutation. A
   * missing or already-expired native record is safe because Strapi no longer
   * accepts it; an API failure or an ownership inconsistency is not.
   *
   * @param {object} nativeManager Checked Users & Permissions session facade.
   * @param {object} session Magic sidecar row.
   * @returns {Promise<boolean>} Whether a currently active native session was revoked.
   * @throws {Error} When native state cannot be safely reconciled.
   */
  async function revokeNativeSessionForSidecar(nativeManager, session) {
    if (!session?.nativeSessionId) return false;

    const nativeSessionId = String(session.nativeSessionId);
    const user = await resolveNativeUserForSidecar(session);
    const userId = String(user.id);
    const ownedSessions = await nativeManager.listSessions(userId);
    if (!Array.isArray(ownedSessions)) {
      throw new Error(
        'Users & Permissions returned an invalid session list; Magic session data was left unchanged.'
      );
    }

    const isOwned = ownedSessions.some(
      (nativeSession) =>
        String(nativeSession?.sessionId) === nativeSessionId &&
        String(nativeSession?.userId) === userId
    );
    if (!isOwned) {
      if (await nativeManager.isSessionActive(nativeSessionId)) {
        throw new Error(
          'Native session ownership could not be confirmed; Magic session data was left unchanged.'
        );
      }
      return false;
    }

    if (!(await nativeManager.isSessionActive(nativeSessionId))) return false;
    const revoked = await nativeManager.revokeSessionById(userId, nativeSessionId);
    if (!revoked) {
      throw new Error(
        'Native session revocation was not confirmed; Magic session data was left unchanged.'
      );
    }
    return true;
  }

  /**
   * Resolves a native-only view key to exactly one Users & Permissions owner,
   * verifies that owner's public session list, then revokes the native row.
   *
   * @param {object} nativeManager Checked Users & Permissions session facade.
   * @param {string} viewKey URL-safe `native_` view key.
   * @returns {Promise<boolean>} Whether the native session was revoked.
   * @throws {Error} When the key is malformed or ownership cannot be confirmed.
   */
  async function revokeNativeSessionForViewKey(
    nativeManager,
    viewKey,
    expectedUserDocumentId = null
  ) {
    const parsed = parseNativeSessionKey(viewKey);
    if (!parsed) throw new Error('Invalid native session view key.');
    if (expectedUserDocumentId && parsed.userDocumentId !== expectedUserDocumentId) {
      throw new Error('Native session view key belongs to a different user.');
    }

    const owner = await findNativeUserByDocumentId(parsed.userDocumentId);
    if (!owner?.id || owner.documentId !== parsed.userDocumentId) return false;

    const userId = String(owner.id);
    const sessions = await nativeManager.listSessions(userId);
    if (!Array.isArray(sessions)) {
      throw new Error('Users & Permissions returned an invalid session list.');
    }

    const isOwned = sessions.some(
      (session) =>
        String(session?.sessionId) === parsed.nativeSessionId &&
        String(session?.userId) === userId &&
        (!session.origin || session.origin === 'users-permissions')
    );
    if (!isOwned) {
      if (await nativeManager.isSessionActive(parsed.nativeSessionId)) {
        throw new Error('Native session ownership could not be confirmed.');
      }
      return false;
    }

    if (!(await nativeManager.isSessionActive(parsed.nativeSessionId))) return false;
    const revoked = await nativeManager.revokeSessionById(userId, parsed.nativeSessionId);
    if (!revoked) throw new Error('Native session revocation was not confirmed.');
    return true;
  }

  /**
   * Reads and validates active native sessions for one owner, reconciling only
   * explicitly linked sidecar IDs and never exposing the native metadata blob.
   *
   * @param {object} nativeManager Checked Users & Permissions session facade.
   * @param {object} user Users & Permissions user record.
   * @param {Set<string>} linkedIds Native IDs already represented by sidecars.
   * @returns {Promise<{activeLinkedIds:Set<string>, nativeOnly:object[], nativeOnlyTruncated:boolean}>}
   */
  async function listNativeSessionsForUser(nativeManager, user, linkedIds = new Set()) {
    if (!user?.id || !user?.documentId) {
      throw new Error('Users & Permissions user pagination returned a record without both IDs.');
    }

    const userId = String(user.id);
    const sessions = await nativeManager.listSessions(userId);
    if (!Array.isArray(sessions)) {
      throw new Error('Users & Permissions returned an invalid session list.');
    }

    const activeLinkedIds = new Set();
    const nativeOnly = [];
    let nativeOnlyTruncated = false;
    for (const session of sessions) {
      const nativeSessionId = typeof session?.sessionId === 'string' ? session.sessionId : '';
      if (!nativeSessionId || String(session.userId) !== userId) {
        throw new Error(
          'Users & Permissions returned a session without a valid owner or session ID.'
        );
      }
      if (session.origin && session.origin !== 'users-permissions') {
        throw new Error('Users & Permissions returned a session from an unexpected origin.');
      }
      if (session.status && session.status !== 'active') continue;

      const isActive = await nativeManager.isSessionActive(nativeSessionId);
      if (!isActive) continue;

      if (linkedIds.has(nativeSessionId)) {
        activeLinkedIds.add(nativeSessionId);
      } else {
        if (nativeOnly.length < MAX_SESSIONS_QUERY + 1) {
          nativeOnly.push(mapNativeSessionToView(session, user));
        } else {
          nativeOnlyTruncated = true;
        }
      }
    }

    return { activeLinkedIds, nativeOnly, nativeOnlyTruncated };
  }

  /**
   * Collects a bounded view of native end-user sessions. User pages are read
   * sequentially while public native session calls fan out through a fixed
   * worker pool. Any page or native API failure rejects the whole operation.
   *
   * @param {object} nativeManager Checked Users & Permissions session facade.
   * @param {object[]} sidecars Magic rows used to reconcile linked native IDs.
   * @param {object} [options]
   * @param {object} [options.user] Restricts collection to one user.
   * @returns {Promise<{activeIdsByUser:Map<string,Set<string>>,nativeOnly:object[],truncated:boolean}>}
   */
  async function collectNativeSessionViews(nativeManager, sidecars, { user: singleUser } = {}) {
    const linkedIdsByUser = new Map();
    for (const session of sidecars) {
      const userDocumentId = getSessionUserDocumentId(session);
      if (!userDocumentId || !session.nativeSessionId) continue;
      if (!linkedIdsByUser.has(userDocumentId)) linkedIdsByUser.set(userDocumentId, new Set());
      linkedIdsByUser.get(userDocumentId).add(String(session.nativeSessionId));
    }

    const activeIdsByUser = new Map();
    const nativeOnly = [];
    let truncated = false;
    const visitedUserIds = new Set();
    const scanPage = async (users) => {
      const pageResults = await mapWithConcurrency(users, NATIVE_LIST_CONCURRENCY, async (user) => {
        if (!user?.documentId) {
          throw new Error(
            'Users & Permissions user pagination returned a record without a documentId.'
          );
        }
        return {
          user,
          ...(await listNativeSessionsForUser(
            nativeManager,
            user,
            linkedIdsByUser.get(String(user.documentId)) || new Set()
          )),
        };
      });

      for (const result of pageResults) {
        const userDocumentId = String(result.user.documentId);
        visitedUserIds.add(userDocumentId);
        activeIdsByUser.set(userDocumentId, result.activeLinkedIds);
        if (result.nativeOnlyTruncated) truncated = true;
        for (const session of result.nativeOnly) {
          if (nativeOnly.length < MAX_SESSIONS_QUERY + 1) nativeOnly.push(session);
          else truncated = true;
        }
      }
    };

    if (singleUser) {
      await scanPage([singleUser]);
    } else {
      let start = 0;
      while (true) {
        const users = await strapi.documents(USER_UID).findMany({
          fields: ['id', 'documentId', 'email', 'username'],
          sort: { documentId: 'asc' },
          start,
          limit: USER_PAGE_SIZE,
        });
        if (!Array.isArray(users)) {
          throw new Error('Users & Permissions user pagination returned an invalid page.');
        }
        if (users.length === 0) break;

        await scanPage(users);
        start += users.length;

        const hasUnvisitedLinkedOwners = [...linkedIdsByUser.keys()].some(
          (documentId) => !visitedUserIds.has(documentId)
        );
        if (nativeOnly.length > MAX_SESSIONS_QUERY && !hasUnvisitedLinkedOwners) {
          truncated = true;
          break;
        }
        if (users.length < USER_PAGE_SIZE) break;
      }
    }

    if (nativeOnly.length > MAX_SESSIONS_QUERY) truncated = true;
    return { activeIdsByUser, nativeOnly, truncated };
  }

  /**
   * Revokes a user's active native sessions before callers mutate any linked
   * Magic rows. The current native session may be excluded for logout-others.
   *
   * @param {object} nativeManager Checked Users & Permissions session facade.
   * @param {object} user Users & Permissions owner record.
   * @param {string|null} exceptNativeSessionId Native session to retain.
   * @returns {Promise<Set<string>>} IDs confirmed revoked by Strapi.
   * @throws {Error} If any native operation fails or a revoke is unconfirmed.
   */
  async function revokeNativeUserSessions(nativeManager, user, exceptNativeSessionId = null) {
    if (!user?.id || !user?.documentId) {
      throw new Error('Cannot safely resolve the Users & Permissions owner for native revocation.');
    }
    const userId = String(user.id);
    const sessions = await nativeManager.listSessions(userId);
    if (!Array.isArray(sessions)) {
      throw new Error(
        'Users & Permissions returned an invalid session list; Magic session data was left unchanged.'
      );
    }

    const revokedIds = new Set();
    for (const session of sessions) {
      const nativeSessionId = typeof session?.sessionId === 'string' ? session.sessionId : '';
      if (!nativeSessionId || String(session.userId) !== userId) {
        throw new Error(
          'Users & Permissions returned a session without a valid owner or session ID.'
        );
      }
      if (session.origin && session.origin !== 'users-permissions') {
        throw new Error('Users & Permissions returned a session from an unexpected origin.');
      }
      if (
        nativeSessionId === exceptNativeSessionId ||
        (session.status && session.status !== 'active')
      ) {
        continue;
      }
      if (!(await nativeManager.isSessionActive(nativeSessionId))) continue;
      const revoked = await nativeManager.revokeSessionById(userId, nativeSessionId);
      if (!revoked) {
        throw new Error(
          'Native session revocation was not confirmed; Magic session data was left unchanged.'
        );
      }
      revokedIds.add(nativeSessionId);
    }

    return revokedIds;
  }

  /**
   * Returns the common options passed to `enhanceSessions`.
   * @returns {Promise<object>}
   */
  async function getEnhanceOpts() {
    const settings = await getPluginSettings(strapi);
    return {
      inactivityTimeout: settings.inactivityTimeout || 15 * 60 * 1000,
      geolocationService: shouldResolveGeoData(settings)
        ? strapi.plugin('magic-sessionmanager').service('geolocation')
        : null,
      strapi,
    };
  }

  /**
   * Deletes a session only after a still-valid access-token hash has been
   * durably recorded for JWT rejection. A storage failure leaves the session
   * row intact so the verifier can continue to reject the token.
   *
   * @param {object} session Session with documentId, tokenHash and ciphertext
   * @returns {Promise<void>}
   * @sideeffect Persists a token-hash revocation and deletes session data
   */
  async function deleteSessionPreservingRevocation(session) {
    if (session?.nativeSessionId) {
      const nativeManager = getNativeSessionManager(strapi);
      if (nativeManager) await revokeNativeSessionForSidecar(nativeManager, session);
    }
    await persistAccessTokenRevocation(strapi, session);
    await strapi.documents(SESSION_UID).delete({ documentId: session.documentId });
  }

  /**
   * Removes expired revocation hashes. Failures leave extra deny records in
   * place, so cleanup can report a warning without weakening JWT checks.
   *
   * @returns {Promise<number>} Number of expired records removed
   */
  async function cleanupExpiredRevocations() {
    try {
      return await cleanupExpiredAccessTokenRevocations(strapi);
    } catch (err) {
      log.warn('[REVOCATION] Expired-token cleanup failed:', err?.name || 'Error');
      return 0;
    }
  }

  return {
    /**
     * Create a new session record.
     * @param {Object} params
     * @param {string} params.userId - User documentId
     * @param {string} [params.ip]
     * @param {string} [params.userAgent]
     * @param {string} [params.token] - Access token (will be encrypted)
     * @param {string} [params.refreshToken] - Refresh token (will be encrypted)
     * @param {string} [params.nativeSessionId] - Native Users & Permissions session ID.
     * @param {object} [params.geoData]
     * @returns {Promise<object>} Created session
     * @throws {Error} When userId is missing
     */
    async createSession({
      userId,
      ip = 'unknown',
      userAgent = 'unknown',
      token,
      refreshToken,
      nativeSessionId,
      geoData,
    }) {
      if (!userId) {
        throw new Error('createSession: userId is required');
      }

      try {
        const now = new Date();
        const sessionId = generateSessionId(userId);

        const nativeManager = getNativeSessionManager(strapi);
        const encryptedToken = token && !nativeManager ? encryptToken(token) : null;
        const encryptedRefreshToken =
          refreshToken && !nativeManager ? encryptToken(refreshToken) : null;
        const tokenHashValue = token ? hashToken(token) : null;
        const refreshTokenHashValue = refreshToken ? hashToken(refreshToken) : null;

        const parsedUA = parseUserAgent(userAgent);

        const safeIp = (typeof ip === 'string' ? ip : 'unknown').substring(0, 45);
        const safeUa = (typeof userAgent === 'string' ? userAgent : 'unknown').substring(0, 500);

        const session = await strapi.documents(SESSION_UID).create({
          data: {
            user: userId,
            ipAddress: safeIp,
            userAgent: safeUa,
            loginTime: now,
            lastActive: now,
            isActive: true,
            token: encryptedToken,
            tokenHash: tokenHashValue,
            refreshToken: encryptedRefreshToken,
            refreshTokenHash: refreshTokenHashValue,
            ...(typeof nativeSessionId === 'string' && nativeSessionId ? { nativeSessionId } : {}),
            sessionId,
            deviceType: parsedUA.deviceType,
            browserName: parsedUA.browserVersion
              ? `${parsedUA.browserName} ${parsedUA.browserVersion}`
              : parsedUA.browserName,
            osName: parsedUA.osVersion
              ? `${parsedUA.osName} ${parsedUA.osVersion}`
              : parsedUA.osName,
            geoLocation: geoData
              ? {
                  country: geoData.country,
                  country_code: geoData.country_code,
                  country_flag: geoData.country_flag,
                  city: geoData.city,
                  region: geoData.region,
                  timezone: geoData.timezone,
                }
              : null,
            securityScore: geoData?.securityScore ?? null,
          },
        });

        log.info('[SUCCESS] End-user session metadata created');
        return session;
      } catch (err) {
        log.error('Error creating session:', err?.name || 'Error');
        throw err;
      }
    },

    /**
     * Atomically replaces the stored tokens only while the caller still owns
     * the expected active token. This prevents two concurrent refresh
     * requests from both committing a rotation.
     *
     * @returns {Promise<boolean>} Whether exactly one session was rotated
     */
    async rotateSessionTokens({
      sessionId,
      expectedAccessToken,
      expectedRefreshToken,
      accessToken,
      refreshToken,
      nativeSessionId,
    }) {
      if (!sessionId || !accessToken || (!expectedAccessToken && !expectedRefreshToken)) {
        return false;
      }

      const where = { documentId: sessionId, isActive: true };
      if (expectedAccessToken) where.tokenHash = hashToken(expectedAccessToken);
      if (expectedRefreshToken) where.refreshTokenHash = hashToken(expectedRefreshToken);

      const nativeManager = getNativeSessionManager(strapi);
      const data = {
        token: nativeManager ? null : encryptToken(accessToken),
        tokenHash: hashToken(accessToken),
        lastActive: new Date(),
      };
      if (refreshToken) {
        data.refreshToken = nativeManager ? null : encryptToken(refreshToken);
        data.refreshTokenHash = hashToken(refreshToken);
      }
      if (typeof nativeSessionId === 'string' && nativeSessionId) {
        data.nativeSessionId = nativeSessionId;
      }

      const result = await strapi.db.query(SESSION_UID).updateMany({ where, data });
      return result?.count === 1;
    },

    /**
     * Terminates the active session identified by a raw refresh token.
     * Used by Strapi's built-in cookie/body logout endpoint.
     */
    async terminateSessionByRefreshToken(refreshToken) {
      if (!refreshToken) return false;
      const nativeManager = getNativeSessionManager(strapi);
      if (nativeManager) {
        const session = await strapi.documents(SESSION_UID).findFirst({
          filters: { refreshTokenHash: hashToken(refreshToken), isActive: true },
          populate: { user: { fields: ['id', 'documentId'] } },
          fields: ['documentId', 'nativeSessionId'],
        });
        if (!session) return false;

        await revokeNativeSessionForSidecar(nativeManager, session);
        const result = await strapi.db.query(SESSION_UID).updateMany({
          where: {
            documentId: session.documentId,
            refreshTokenHash: hashToken(refreshToken),
            isActive: true,
          },
          data: {
            isActive: false,
            terminatedManually: false,
            terminationReason: 'logout',
            logoutTime: new Date(),
          },
        });
        return result?.count === 1;
      }

      const result = await strapi.db.query(SESSION_UID).updateMany({
        where: {
          refreshTokenHash: hashToken(refreshToken),
          isActive: true,
        },
        data: {
          isActive: false,
          terminatedManually: false,
          terminationReason: 'logout',
          logoutTime: new Date(),
        },
      });
      return result?.count === 1;
    },

    /**
     * Terminates the authenticated user's active session. A raw access token
     * is authoritative when present, and a supplied refresh token must match
     * the same row. Refresh-token-only lookup is used when access is absent.
     *
     * @param {Object} params
     * @param {string} params.userDocumentId - Authenticated user's documentId
     * @param {string|null} [params.refreshToken=null] - Raw refresh token
     * @param {string|null} [params.accessToken=null] - Raw access token
     * @returns {Promise<boolean>} Whether one owned active session was terminated
     * @throws {Error} When the Document Service lookup or termination fails
     * @sideeffect Marks the matching session inactive with logout metadata
     */
    async terminateAuthenticatedSession({
      userDocumentId,
      refreshToken = null,
      accessToken = null,
    }) {
      if (!userDocumentId || (!refreshToken && !accessToken)) return false;

      const selectedTokenFilters = {
        user: { documentId: userDocumentId },
        isActive: true,
      };
      if (accessToken) {
        selectedTokenFilters.tokenHash = hashToken(accessToken);
        if (refreshToken) {
          selectedTokenFilters.refreshTokenHash = hashToken(refreshToken);
        }
      } else {
        selectedTokenFilters.refreshTokenHash = hashToken(refreshToken);
      }

      const session = await strapi.documents(SESSION_UID).findFirst({
        filters: selectedTokenFilters,
        fields: ['documentId'],
      });
      if (!session) return false;

      return strapi.db.transaction(async ({ trx }) => {
        await lockSessionRow(trx, session.documentId);

        const result = await this.terminateSession({
          sessionId: session.documentId,
          reason: 'logout',
          expectedFilters: selectedTokenFilters,
        });
        return result?.terminatedCount === 1;
      });
    },

    /**
     * Terminates a single session, all sessions of a user, or all sessions
     * of a user EXCEPT one with a typed reason so the JWT-verify wrapper
     * can communicate the cause to the client.
     *
     * Supported reasons:
     *   - 'logout':   user clicked logout
     *   - 'manual':   admin terminated a session
     *   - 'idle':     inactivity timeout cleanup
     *   - 'expired':  maxSessionAgeDays exceeded
     *   - 'blocked':  the owning user was marked blocked
     *
     * For backwards compatibility `terminatedManually` is still set true
     * only when reason === 'manual'; logout/idle/expired/blocked paths set it
     * false so reporting dashboards that queried that boolean continue
     * to work, while new code relies on `terminationReason`.
     *
     * @param {Object} params
     * @param {string} [params.sessionId]        Terminate exactly this session
     * @param {string|number} [params.userId]    Terminate every active session
     *                                           of this user …
     * @param {string} [params.exceptSessionId]  … except for this one. Only
     *                                           meaningful together with
     *                                           `userId`. Used by
     *                                           /logout-other-devices so
     *                                           the caller stays logged in.
     * @param {object} [params.expectedFilters]  Internal predicates that must
     *                                           still match before a
     *                                           single-session update.
     * @param {'logout'|'manual'|'idle'|'expired'|'blocked'} [params.reason='manual']
     * @returns {Promise<{terminatedCount: number}>}
     */
    async terminateSession({
      sessionId,
      userId,
      exceptSessionId = null,
      reason = 'manual',
      expectedFilters = null,
    }) {
      try {
        const now = new Date();
        const nativeManager = getNativeSessionManager(strapi);
        const validReasons = ['logout', 'manual', 'idle', 'expired', 'blocked'];
        const finalReason = validReasons.includes(reason) ? reason : 'manual';

        const updateData = {
          isActive: false,
          terminatedManually: finalReason === 'manual',
          terminationReason: finalReason,
          logoutTime: now,
        };

        if (sessionId) {
          const sessionLookup = nativeManager
            ? {
                fields: ['documentId', 'nativeSessionId'],
                populate: { user: { fields: ['id', 'documentId'] } },
              }
            : { fields: ['documentId'] };
          const existing = expectedFilters
            ? await strapi.documents(SESSION_UID).findFirst({
                filters: {
                  ...expectedFilters,
                  documentId: sessionId,
                },
                ...sessionLookup,
              })
            : await strapi.documents(SESSION_UID).findOne({
                documentId: sessionId,
                ...sessionLookup,
              });

          if (!existing) {
            if (
              nativeManager &&
              typeof sessionId === 'string' &&
              sessionId.startsWith(NATIVE_SESSION_PREFIX)
            ) {
              const expectedUserDocumentId = userId
                ? await resolveUserDocumentId(strapi, userId)
                : null;
              if (userId && !expectedUserDocumentId) return { terminatedCount: 0 };
              const revoked = await revokeNativeSessionForViewKey(
                nativeManager,
                sessionId,
                expectedUserDocumentId
              );
              return { terminatedCount: revoked ? 1 : 0 };
            }
            log.warn('Session not found for termination');
            return { terminatedCount: 0 };
          }

          if (nativeManager) await revokeNativeSessionForSidecar(nativeManager, existing);

          await strapi.documents(SESSION_UID).update({
            documentId: sessionId,
            data: updateData,
          });

          log.info(`Session terminated (reason: ${finalReason})`);
          return { terminatedCount: 1 };
        }

        if (userId) {
          const userDocumentId = await resolveUserDocumentId(strapi, userId);
          if (!userDocumentId) return { terminatedCount: 0 };

          let exceptMagicSessionId = exceptSessionId;
          let nativeRevokedIds = new Set();
          if (nativeManager) {
            const nativeUser = await findNativeUserByDocumentId(userDocumentId);
            if (!nativeUser?.id) {
              throw new Error(
                'Cannot safely resolve the Users & Permissions user for native revocation.'
              );
            }

            let exceptNativeSessionId = null;
            if (typeof exceptSessionId === 'string') {
              if (exceptSessionId.startsWith(NATIVE_SESSION_PREFIX)) {
                const parsed = parseNativeSessionKey(exceptSessionId);
                if (!parsed) throw new Error('Invalid native session view key.');
                if (parsed.userDocumentId !== userDocumentId) {
                  throw new Error('Native session view key belongs to a different user.');
                }
                exceptNativeSessionId = parsed.nativeSessionId;
                const linkedCurrentSidecar = await strapi.documents(SESSION_UID).findFirst({
                  filters: {
                    user: { documentId: userDocumentId },
                    nativeSessionId: parsed.nativeSessionId,
                  },
                  fields: ['documentId', 'nativeSessionId'],
                });
                if (linkedCurrentSidecar) {
                  exceptMagicSessionId = linkedCurrentSidecar.documentId;
                }
              } else {
                exceptNativeSessionId = exceptSessionId;
              }
            }
            if (
              typeof exceptSessionId === 'string' &&
              !exceptSessionId.startsWith(NATIVE_SESSION_PREFIX)
            ) {
              const exceptSidecar = await strapi.documents(SESSION_UID).findOne({
                documentId: exceptSessionId,
                fields: ['documentId', 'nativeSessionId'],
                populate: { user: { fields: ['id', 'documentId'] } },
              });
              if (exceptSidecar && getSessionUserDocumentId(exceptSidecar) === userDocumentId) {
                exceptMagicSessionId = exceptSidecar.documentId;
                exceptNativeSessionId = exceptSidecar.nativeSessionId || exceptNativeSessionId;
              }
            }

            nativeRevokedIds = await revokeNativeUserSessions(
              nativeManager,
              nativeUser,
              exceptNativeSessionId
            );
          }

          const filters = { user: { documentId: userDocumentId }, isActive: true };
          if (exceptMagicSessionId) {
            filters.documentId = { $ne: exceptMagicSessionId };
          }

          let terminatedCount = 0;
          const terminatedKeys = new Set(
            [...nativeRevokedIds].map((nativeSessionId) => `native:${nativeSessionId}`)
          );
          const batchSize = 500;

          while (true) {
            const activeSessions = await strapi.documents(SESSION_UID).findMany({
              filters,
              fields: ['documentId', 'nativeSessionId'],
              limit: batchSize,
            });

            if (!activeSessions || activeSessions.length === 0) break;

            let batchTerminated = 0;
            for (const session of activeSessions) {
              try {
                await strapi.documents(SESSION_UID).update({
                  documentId: session.documentId,
                  data: updateData,
                });
                terminatedKeys.add(
                  session.nativeSessionId
                    ? `native:${session.nativeSessionId}`
                    : `magic:${session.documentId}`
                );
                terminatedCount = terminatedKeys.size;
                batchTerminated++;
              } catch (err) {
                log.debug('Failed to terminate an end-user session:', err?.name || 'Error');
              }
            }

            if (batchTerminated === 0) {
              log.warn('Could not terminate remaining active sessions for one user');
              break;
            }
          }

          const label = exceptSessionId ? 'OTHER sessions' : 'ALL sessions';
          log.info(
            `${label} terminated (reason: ${finalReason}, count: ${terminatedCount})`
          );
          return { terminatedCount: nativeManager ? terminatedKeys.size : terminatedCount };
        }

        return { terminatedCount: 0 };
      } catch (err) {
        log.error('Error terminating session:', err?.name || 'Error');
        throw err;
      }
    },

    /**
     * Get ALL sessions (active + inactive) with enhanced display fields.
     * @returns {Promise<Array>}
     */
    async getAllSessions() {
      try {
        const nativeManager = getNativeSessionManager(strapi);
        const sessions = await strapi.documents(SESSION_UID).findMany({
          populate: { user: { fields: ['documentId', 'email', 'username'] } },
          sort: { loginTime: 'desc' },
          limit: nativeManager ? MAX_SESSIONS_QUERY + 1 : MAX_SESSIONS_QUERY,
        });

        if (!nativeManager) {
          return enhanceSessions(sessions, await getEnhanceOpts(), 20);
        }

        const sidecars = sessions.slice(0, MAX_SESSIONS_QUERY + 1);
        const allSidecars = await strapi.documents(SESSION_UID).findMany({
          populate: { user: { fields: ['documentId'] } },
          limit: MAX_SESSIONS_QUERY + 1,
        });
        const nativeData = await collectNativeSessionViews(nativeManager, [
          ...sidecars,
          ...(Array.isArray(allSidecars) ? allSidecars : []),
        ]);
        const reconciled = reconcileSidecarViews(sidecars, nativeData.activeIdsByUser);
        const merged = [...reconciled, ...nativeData.nativeOnly];
        merged.sort((a, b) => new Date(b.loginTime || 0) - new Date(a.loginTime || 0));

        const enhanced = normalizeNativeViewFields(
          await enhanceSessions(merged, await getEnhanceOpts(), 20)
        );
        const truncated =
          sessions.length > MAX_SESSIONS_QUERY ||
          !Array.isArray(allSidecars) ||
          allSidecars.length > MAX_SESSIONS_QUERY ||
          nativeData.truncated ||
          enhanced.length > MAX_SESSIONS_QUERY;
        return markSessionsTruncated(enhanced.slice(0, MAX_SESSIONS_QUERY), truncated);
      } catch (err) {
        log.error('Error getting all sessions:', err?.name || 'Error');
        throw err;
      }
    },

    /**
     * Get only sessions that are both `isActive: true` AND still within their
     * activity window.
     * @returns {Promise<Array>}
     */
    async getActiveSessions() {
      try {
        const nativeManager = getNativeSessionManager(strapi);
        const sessions = await strapi.documents(SESSION_UID).findMany({
          filters: { isActive: true },
          populate: { user: { fields: ['documentId', 'email', 'username'] } },
          sort: { loginTime: 'desc' },
          limit: nativeManager ? MAX_SESSIONS_QUERY + 1 : MAX_SESSIONS_QUERY,
        });

        if (!nativeManager) {
          const enhanced = await enhanceSessions(sessions, await getEnhanceOpts(), 20);
          return enhanced.filter((s) => s.isTrulyActive);
        }

        const sidecars = sessions.slice(0, MAX_SESSIONS_QUERY + 1);
        const allSidecars = await strapi.documents(SESSION_UID).findMany({
          populate: { user: { fields: ['documentId'] } },
          limit: MAX_SESSIONS_QUERY + 1,
        });
        const nativeData = await collectNativeSessionViews(nativeManager, [
          ...sidecars,
          ...(Array.isArray(allSidecars) ? allSidecars : []),
        ]);
        const reconciled = reconcileSidecarViews(sidecars, nativeData.activeIdsByUser);
        const merged = [...reconciled, ...nativeData.nativeOnly];
        merged.sort((a, b) => new Date(b.loginTime || 0) - new Date(a.loginTime || 0));
        const enhanced = normalizeNativeViewFields(
          await enhanceSessions(merged, await getEnhanceOpts(), 20)
        ).filter((session) => session.isTrulyActive);
        const truncated =
          sessions.length > MAX_SESSIONS_QUERY ||
          !Array.isArray(allSidecars) ||
          allSidecars.length > MAX_SESSIONS_QUERY ||
          nativeData.truncated ||
          enhanced.length > MAX_SESSIONS_QUERY;
        return markSessionsTruncated(enhanced.slice(0, MAX_SESSIONS_QUERY), truncated);
      } catch (err) {
        log.error('Error getting active sessions:', err?.name || 'Error');
        throw err;
      }
    },

    /**
     * Get all sessions for a user (any state).
     * @param {string|number} userId
     * @returns {Promise<Array>}
     */
    async getUserSessions(userId) {
      try {
        const userDocumentId = await resolveUserDocumentId(strapi, userId);
        if (!userDocumentId) return [];

        const nativeManager = getNativeSessionManager(strapi);
        if (nativeManager) {
          const nativeUser = await findNativeUserByDocumentId(userDocumentId);
          if (!nativeUser?.id) return [];

          const sessions = await strapi.documents(SESSION_UID).findMany({
            filters: { user: { documentId: userDocumentId } },
            populate: { user: { fields: ['documentId', 'email', 'username'] } },
            sort: { loginTime: 'desc' },
            limit: MAX_SESSIONS_QUERY + 1,
          });
          const sidecars = sessions.map((session) => ({
            ...session,
            user: session.user || {
              documentId: userDocumentId,
              email: nativeUser.email,
              username: nativeUser.username,
            },
          }));
          const nativeData = await collectNativeSessionViews(nativeManager, sidecars, {
            user: nativeUser,
          });
          const reconciled = reconcileSidecarViews(sidecars, nativeData.activeIdsByUser);
          const merged = [...reconciled, ...nativeData.nativeOnly];
          merged.sort((a, b) => new Date(b.loginTime || 0) - new Date(a.loginTime || 0));
          const enhanced = normalizeNativeViewFields(
            await enhanceSessions(merged, await getEnhanceOpts(), 20)
          );
          const truncated =
            sessions.length > MAX_SESSIONS_QUERY ||
            nativeData.truncated ||
            enhanced.length > MAX_SESSIONS_QUERY;
          return markSessionsTruncated(enhanced.slice(0, MAX_SESSIONS_QUERY), truncated);
        }

        const sessions = await strapi.documents(SESSION_UID).findMany({
          filters: { user: { documentId: userDocumentId } },
          sort: { loginTime: 'desc' },
          limit: MAX_SESSIONS_QUERY,
        });

        return enhanceSessions(sessions, await getEnhanceOpts(), 20);
      } catch (err) {
        log.error('Error getting user sessions:', err?.name || 'Error');
        throw err;
      }
    },

    /**
     * In-memory coalescing cache for touch() calls. Two concurrent requests
     * from the same session would both pass the rate-limit check (because
     * neither has committed its update yet) and both fire an UPDATE. The
     * cache short-circuits the second caller if ANY write was issued within
     * `rateLimit` ms, regardless of whether the DB value is visible yet.
     * Bounded at 10 000 entries to cap memory; evicted on every read.
     */
    _lastTouchCache: new Map(),

    /**
     * Update lastActive timestamp on a session (rate-limited + coalesced).
     *
     * @param {Object} params
     * @param {string|number} [params.userId]
     * @param {string} [params.sessionId]
     * @param {string} [params.token] - Raw JWT (will be hashed for lookup)
     * @returns {Promise<void>}
     */
    async touch({ userId, sessionId, token }) {
      try {
        const now = new Date();
        const settings = await getPluginSettings(strapi);
        const rateLimit = settings.lastSeenRateLimit || 30000;

        let session = null;
        let sessionDocId = sessionId;

        if (sessionId) {
          session = await strapi.documents(SESSION_UID).findOne({
            documentId: sessionId,
            fields: ['documentId', 'lastActive'],
          });
          sessionDocId = sessionId;
        } else if (token && userId) {
          const tokenHashVal = hashToken(token);
          const sessions = await strapi.documents(SESSION_UID).findMany({
            filters: { user: { documentId: userId }, tokenHash: tokenHashVal, isActive: true },
            fields: ['documentId', 'lastActive'],
            limit: 1,
          });

          if (sessions && sessions.length > 0) {
            session = sessions[0];
            sessionDocId = session.documentId;
          }
        }

        if (!session || !sessionDocId) return;

        // Coalesce with in-memory cache: if we issued an UPDATE for this
        // session within the last `rateLimit` ms, skip — even if the DB
        // value is not yet visible to a parallel findOne.
        const cached = this._lastTouchCache.get(sessionDocId);
        if (cached && now.getTime() - cached < rateLimit) {
          return;
        }

        const lastActiveTime = session.lastActive ? new Date(session.lastActive).getTime() : 0;
        if (now.getTime() - lastActiveTime <= rateLimit) {
          return;
        }

        // Stamp the cache BEFORE awaiting the UPDATE so a concurrent
        // second caller sees the stamp and bails out.
        this._lastTouchCache.set(sessionDocId, now.getTime());
        if (this._lastTouchCache.size > 10_000) {
          const cutoff = now.getTime() - rateLimit;
          for (const [k, ts] of this._lastTouchCache) {
            if (ts < cutoff) this._lastTouchCache.delete(k);
          }
        }

        await strapi.documents(SESSION_UID).update({
          documentId: sessionDocId,
          data: { lastActive: now },
        });
        log.debug('[TOUCH] End-user session lastActive updated');
      } catch (err) {
        log.debug('Error touching session:', err?.name || 'Error');
      }
    },

    /**
     * Marks sessions that have been idle past `inactivityTimeout` as
     * terminated. The cleanup stores the real cause in `terminationReason:
     * 'idle'` and keeps `terminatedManually: false`, because this is not a
     * manual/admin termination. The JWT-verify wrapper treats
     * `terminationReason` as authoritative, so idle sessions cannot be
     * silently reactivated while reporting remains semantically correct.
     *
     * Processes in batches by collecting IDs first, then updating — this
     * avoids pagination-skew issues caused by mutating the queried set.
     *
     * @param {Object} [options]
     * @param {boolean} [options.useDbDirect=false]  When true, performs a
     *   single knex UPDATE which is orders of magnitude faster for large
     *   installations but bypasses Document Service lifecycle hooks. Use
     *   only when the savings are needed and hooks are known to be safe
     *   to skip.
     * @returns {Promise<number>} Number of sessions deactivated
     */
    async cleanupInactiveSessions({ useDbDirect = false } = {}) {
      try {
        const settings = await getPluginSettings(strapi);
        const nativeManager = getNativeSessionManager(strapi);
        const inactivityTimeout = settings.inactivityTimeout || 15 * 60 * 1000;

        const now = new Date();
        const cutoffTime = new Date(now.getTime() - inactivityTimeout);

        log.info(
          `[CLEANUP] Cleaning up sessions inactive since before ${cutoffTime.toISOString()}`
        );

        if (useDbDirect && !nativeManager) {
          // Fast path: single SQL UPDATE. Drains the entire backlog in one
          // statement, regardless of size. Uses snake_case since Strapi
          // content-type field names map to snake_case columns by default.
          // `terminated_manually` stays false because this cleanup is NOT
          // a manual termination — we communicate the real cause via the
          // new `termination_reason` column.
          try {
            const deactivated = await strapi.db
              .connection('magic_sessions')
              .where('is_active', true)
              .andWhere(function whereIdle() {
                this.where('last_active', '<', cutoffTime).orWhere(function whereNullLastActive() {
                  this.whereNull('last_active').andWhere('login_time', '<', cutoffTime);
                });
              })
              .update({
                is_active: false,
                terminated_manually: false,
                termination_reason: 'idle',
                logout_time: now,
              });
            await cleanupExpiredRevocations();
            log.info(`[SUCCESS] Cleanup (db-direct) complete: ${deactivated} sessions deactivated`);
            return deactivated;
          } catch (err) {
            log.warn(
              '[CLEANUP] DB-direct cleanup failed, falling back to Document Service:',
              err?.name || 'Error'
            );
          }
        }

        const sessionsToDeactivate = [];
        const BATCH = 500;
        let start = 0;

        while (true) {
          const batch = await strapi.documents(SESSION_UID).findMany({
            filters: { isActive: true },
            fields: ['documentId', 'lastActive', 'loginTime', 'nativeSessionId'],
            populate: { user: { fields: ['id', 'documentId'] } },
            limit: BATCH,
            start,
            sort: { loginTime: 'asc' },
          });

          if (!batch || batch.length === 0) break;

          for (const session of batch) {
            const lastActiveTime = session.lastActive
              ? new Date(session.lastActive)
              : session.loginTime
                ? new Date(session.loginTime)
                : null;

            if (lastActiveTime && lastActiveTime < cutoffTime) {
              sessionsToDeactivate.push(session);
            }
          }

          if (batch.length < BATCH) break;
          start += BATCH;

          if (start > 50000) {
            log.warn(
              '[CLEANUP] Reached safety cap of 50k scanned sessions; consider enabling useDbDirect for this installation size.'
            );
            break;
          }
        }

        let deactivatedCount = 0;
        for (const session of sessionsToDeactivate) {
          try {
            if (nativeManager) await revokeNativeSessionForSidecar(nativeManager, session);
            await strapi.documents(SESSION_UID).update({
              documentId: session.documentId,
              data: {
                isActive: false,
                terminatedManually: false,
                terminationReason: 'idle',
                logoutTime: now,
              },
            });
            deactivatedCount++;
          } catch (err) {
            log.debug('[CLEANUP] Failed to deactivate an end-user session:', err?.name || 'Error');
          }
        }

        await cleanupExpiredRevocations();
        log.info(`[SUCCESS] Cleanup complete: ${deactivatedCount} sessions deactivated`);
        return deactivatedCount;
      } catch (err) {
        log.error('Error cleaning up inactive sessions:', err?.name || 'Error');
        throw err;
      }
    },

    /**
     * Removes a session while keeping a minimal deny record for any unexpired
     * access token associated with it.
     *
     * @param {string} sessionId Session documentId
     * @returns {Promise<boolean>} Whether the session existed and was removed
     * @sideeffect Persists token-hash revocation before deleting session data
     */
    async deleteSession(sessionId) {
      try {
        const session = await strapi.documents(SESSION_UID).findOne({
          documentId: sessionId,
          fields: ['documentId', 'token', 'tokenHash', 'nativeSessionId'],
          populate: { user: { fields: ['id', 'documentId'] } },
        });
        if (!session) {
          const nativeManager = getNativeSessionManager(strapi);
          if (
            !nativeManager ||
            typeof sessionId !== 'string' ||
            !sessionId.startsWith(NATIVE_SESSION_PREFIX)
          ) {
            return false;
          }
          return revokeNativeSessionForViewKey(nativeManager, sessionId);
        }

        await deleteSessionPreservingRevocation(session);
        log.info('[DELETE] Session details removed with token revocation preserved');
        return true;
      } catch (err) {
        log.error('Error deleting session:', err?.name || 'Error');
        throw err;
      }
    },

    /**
     * Removes session rows that have been inactive past the configured
     * retention window. Before deleting a row, it keeps a hash record for any
     * still-valid access token. This uses Document Service so no delete path
     * can bypass revocation persistence.
     *
     * @param {Object} [options]
     * @param {number} [options.retentionDays]    Overrides the stored setting.
     * @returns {Promise<number>} Number of sessions deleted
     */
    async deleteOldSessions({ retentionDays } = {}) {
      try {
        const settings = await getPluginSettings(strapi);
        const effectiveDays = Number.isFinite(retentionDays)
          ? retentionDays
          : settings.retentionDays || 90;

        if (effectiveDays === -1) {
          log.debug('[RETENTION] retentionDays=-1 (forever) — skipping');
          return 0;
        }

        const cutoffDate = new Date(Date.now() - effectiveDays * 24 * 60 * 60 * 1000);
        log.info(
          `[RETENTION] Deleting inactive sessions older than ${effectiveDays} days (before ${cutoffDate.toISOString()})`
        );

        let deletedCount = 0;
        const BATCH = 200;
        let consecutiveNoProgressBatches = 0;

        while (true) {
          const batch = await strapi.documents(SESSION_UID).findMany({
            filters: {
              isActive: false,
              $or: [
                { logoutTime: { $lt: cutoffDate } },
                { logoutTime: { $null: true }, lastActive: { $lt: cutoffDate } },
                {
                  logoutTime: { $null: true },
                  lastActive: { $null: true },
                  loginTime: { $lt: cutoffDate },
                },
              ],
            },
            fields: ['documentId', 'token', 'tokenHash', 'nativeSessionId'],
            populate: { user: { fields: ['id', 'documentId'] } },
            sort: { loginTime: 'asc' },
            limit: BATCH,
          });

          if (!batch || batch.length === 0) break;

          const deletedBeforeBatch = deletedCount;
          for (const session of batch) {
            try {
              await deleteSessionPreservingRevocation(session);
              deletedCount++;
            } catch (err) {
              log.debug('[RETENTION] Failed to delete an end-user session:', err?.name || 'Error');
            }
          }

          if (deletedCount === deletedBeforeBatch) {
            consecutiveNoProgressBatches++;
            if (consecutiveNoProgressBatches >= 3) {
              log.warn(
                '[RETENTION] No progress on 3 consecutive batches, aborting to prevent infinite loop'
              );
              break;
            }
          } else {
            consecutiveNoProgressBatches = 0;
          }

          if (batch.length < BATCH) break;
        }

        await cleanupExpiredRevocations();
        log.info(`[SUCCESS] Retention deleted ${deletedCount} old session(s)`);
        return deletedCount;
      } catch (err) {
        log.error('Error in retention cleanup:', err?.name || 'Error');
        return 0;
      }
    },

    /**
     * Removes all inactive session rows, retaining deny hashes for unexpired
     * access tokens. A failed hash write leaves its session row in place.
     *
     * @returns {Promise<number>} Number of session rows removed
     * @sideeffect Writes revocation records before deleting session rows
     */
    async deleteInactiveSessions() {
      try {
        log.info('[DELETE] Deleting all inactive sessions...');

        let deletedCount = 0;
        const BATCH_SIZE = 100;
        let consecutiveEmptyLoops = 0;

        while (true) {
          const batch = await strapi.documents(SESSION_UID).findMany({
            filters: { isActive: false },
            fields: ['documentId', 'token', 'tokenHash', 'nativeSessionId'],
            populate: { user: { fields: ['id', 'documentId'] } },
            limit: BATCH_SIZE,
          });

          if (!batch || batch.length === 0) break;

          const deleteResults = await Promise.allSettled(
            batch.map((session) => deleteSessionPreservingRevocation(session))
          );

          const successful = deleteResults.filter((r) => r.status === 'fulfilled').length;
          deletedCount += successful;

          if (successful === 0) {
            consecutiveEmptyLoops++;
            if (consecutiveEmptyLoops >= 3) {
              log.warn(
                '[DELETE] No progress on 3 consecutive batches, aborting to prevent infinite loop'
              );
              break;
            }
          } else {
            consecutiveEmptyLoops = 0;
          }

          if (batch.length < BATCH_SIZE) break;
        }

        await cleanupExpiredRevocations();
        log.info(`[SUCCESS] Deleted ${deletedCount} inactive sessions`);
        return deletedCount;
      } catch (err) {
        log.error('Error deleting inactive sessions:', err?.name || 'Error');
        throw err;
      }
    },
  };
};
