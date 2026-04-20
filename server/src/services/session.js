'use strict';

const { encryptToken, generateSessionId, hashToken } = require('../utils/encryption');
const { createLogger } = require('../utils/logger');
const { parseUserAgent } = require('../utils/user-agent-parser');
const { resolveUserDocumentId } = require('../utils/resolve-user');
const { enhanceSessions } = require('../utils/enhance-session');
const { getPluginSettings } = require('../utils/settings-loader');

/**
 * Session Service
 *
 * All session data is accessed via `strapi.documents()` (Strapi v5 Document
 * Service). JWT tokens are encrypted (AES-256-GCM) before storage; a SHA-256
 * hash of the raw token is kept for O(1) lookups.
 */

const SESSION_UID = 'plugin::magic-sessionmanager.session';
const MAX_SESSIONS_QUERY = 1000;

module.exports = ({ strapi }) => {
  const log = createLogger(strapi);

  /**
   * Returns the common options passed to `enhanceSessions`.
   * @returns {Promise<object>}
   */
  async function getEnhanceOpts() {
    const settings = await getPluginSettings(strapi);
    return {
      inactivityTimeout: settings.inactivityTimeout || 15 * 60 * 1000,
      geolocationService: strapi.plugin('magic-sessionmanager').service('geolocation'),
      strapi,
    };
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
     * @param {object} [params.geoData]
     * @returns {Promise<object>} Created session
     * @throws {Error} When userId is missing
     */
    async createSession({ userId, ip = 'unknown', userAgent = 'unknown', token, refreshToken, geoData }) {
      if (!userId) {
        throw new Error('createSession: userId is required');
      }

      try {
        const now = new Date();
        const sessionId = generateSessionId(userId);

        const encryptedToken = token ? encryptToken(token) : null;
        const encryptedRefreshToken = refreshToken ? encryptToken(refreshToken) : null;
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
            securityScore: geoData?.securityScore || null,
          },
        });

        log.info(`[SUCCESS] Session ${session.documentId} (${sessionId}) created for user ${userId}`);
        return session;
      } catch (err) {
        log.error('Error creating session:', err);
        throw err;
      }
    },

    /**
     * Terminates a single session or all sessions of a user.
     * @param {Object} params
     * @param {string} [params.sessionId]
     * @param {string|number} [params.userId]
     * @returns {Promise<void>}
     */
    async terminateSession({ sessionId, userId }) {
      try {
        const now = new Date();

        if (sessionId) {
          const existing = await strapi.documents(SESSION_UID).findOne({
            documentId: sessionId,
            fields: ['documentId'],
          });

          if (!existing) {
            log.warn(`Session ${sessionId} not found for termination`);
            return;
          }

          await strapi.documents(SESSION_UID).update({
            documentId: sessionId,
            data: { isActive: false, terminatedManually: true, logoutTime: now },
          });

          log.info(`Session ${sessionId} terminated (manual)`);
        } else if (userId) {
          const userDocumentId = await resolveUserDocumentId(strapi, userId);
          if (!userDocumentId) return;

          const activeSessions = await strapi.documents(SESSION_UID).findMany({
            filters: { user: { documentId: userDocumentId }, isActive: true },
            fields: ['documentId'],
            limit: MAX_SESSIONS_QUERY,
          });

          for (const session of activeSessions) {
            await strapi.documents(SESSION_UID).update({
              documentId: session.documentId,
              data: { isActive: false, terminatedManually: true, logoutTime: now },
            });
          }

          log.info(`All sessions terminated (manual) for user ${userDocumentId}`);
        }
      } catch (err) {
        log.error('Error terminating session:', err);
        throw err;
      }
    },

    /**
     * Get ALL sessions (active + inactive) with enhanced display fields.
     * @returns {Promise<Array>}
     */
    async getAllSessions() {
      try {
        const sessions = await strapi.documents(SESSION_UID).findMany({
          populate: { user: { fields: ['documentId', 'email', 'username'] } },
          sort: { loginTime: 'desc' },
          limit: MAX_SESSIONS_QUERY,
        });

        return enhanceSessions(sessions, await getEnhanceOpts(), 20);
      } catch (err) {
        log.error('Error getting all sessions:', err);
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
        const sessions = await strapi.documents(SESSION_UID).findMany({
          filters: { isActive: true },
          populate: { user: { fields: ['documentId', 'email', 'username'] } },
          sort: { loginTime: 'desc' },
          limit: MAX_SESSIONS_QUERY,
        });

        const enhanced = await enhanceSessions(sessions, await getEnhanceOpts(), 20);
        return enhanced.filter((s) => s.isTrulyActive);
      } catch (err) {
        log.error('Error getting active sessions:', err);
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

        const sessions = await strapi.documents(SESSION_UID).findMany({
          filters: { user: { documentId: userDocumentId } },
          sort: { loginTime: 'desc' },
          limit: MAX_SESSIONS_QUERY,
        });

        return enhanceSessions(sessions, await getEnhanceOpts(), 20);
      } catch (err) {
        log.error('Error getting user sessions:', err);
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
        log.debug(`[TOUCH] Session ${sessionDocId.substring(0, 8)}... lastActive updated`);
      } catch (err) {
        log.debug('Error touching session:', err.message);
      }
    },

    /**
     * Marks sessions that have been idle past `inactivityTimeout` as
     * terminated. Historically this set `terminatedManually: false`, which
     * allowed the JWT-verify wrapper to immediately reactivate the session
     * on the next request — nullifying the idle-logout feature. The cleanup
     * now sets `terminatedManually: true` so the session cannot be silently
     * reactivated; the JWT-verify wrapper still separately enforces the
     * inactivity check for fast-idled sessions.
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
        const inactivityTimeout = settings.inactivityTimeout || 15 * 60 * 1000;

        const now = new Date();
        const cutoffTime = new Date(now.getTime() - inactivityTimeout);

        log.info(`[CLEANUP] Cleaning up sessions inactive since before ${cutoffTime.toISOString()}`);

        if (useDbDirect) {
          // Fast path: single SQL UPDATE. Drains the entire backlog in one
          // statement, regardless of size. Uses snake_case since Strapi
          // content-type field names map to snake_case columns by default.
          try {
            const deactivated = await strapi.db.connection('magic_sessions')
              .where('is_active', true)
              .andWhere(function whereIdle() {
                this.where('last_active', '<', cutoffTime)
                  .orWhere(function whereNullLastActive() {
                    this.whereNull('last_active').andWhere('login_time', '<', cutoffTime);
                  });
              })
              .update({
                is_active: false,
                terminated_manually: true,
                logout_time: now,
              });
            log.info(`[SUCCESS] Cleanup (db-direct) complete: ${deactivated} sessions deactivated`);
            return deactivated;
          } catch (err) {
            log.warn('[CLEANUP] DB-direct cleanup failed, falling back to Document Service:', err.message);
          }
        }

        const idsToDeactivate = [];
        const BATCH = 500;
        let start = 0;

        while (true) {
          const batch = await strapi.documents(SESSION_UID).findMany({
            filters: { isActive: true },
            fields: ['documentId', 'lastActive', 'loginTime'],
            limit: BATCH,
            start,
            sort: { loginTime: 'asc' },
          });

          if (!batch || batch.length === 0) break;

          for (const session of batch) {
            const lastActiveTime = session.lastActive
              ? new Date(session.lastActive)
              : (session.loginTime ? new Date(session.loginTime) : null);

            if (lastActiveTime && lastActiveTime < cutoffTime) {
              idsToDeactivate.push(session.documentId);
            }
          }

          if (batch.length < BATCH) break;
          start += BATCH;

          if (start > 50000) {
            log.warn('[CLEANUP] Reached safety cap of 50k scanned sessions; consider enabling useDbDirect for this installation size.');
            break;
          }
        }

        let deactivatedCount = 0;
        for (const documentId of idsToDeactivate) {
          try {
            await strapi.documents(SESSION_UID).update({
              documentId,
              data: {
                isActive: false,
                terminatedManually: true,
                logoutTime: now,
              },
            });
            deactivatedCount++;
          } catch (err) {
            log.debug(`[CLEANUP] Failed to deactivate session ${documentId}:`, err.message);
          }
        }

        log.info(`[SUCCESS] Cleanup complete: ${deactivatedCount} sessions deactivated`);
        return deactivatedCount;
      } catch (err) {
        log.error('Error cleaning up inactive sessions:', err);
        throw err;
      }
    },

    /**
     * Permanently deletes a single session.
     * @param {string} sessionId
     * @returns {Promise<boolean>}
     */
    async deleteSession(sessionId) {
      try {
        await strapi.documents(SESSION_UID).delete({ documentId: sessionId });
        log.info(`[DELETE] Session ${sessionId} permanently deleted`);
        return true;
      } catch (err) {
        log.error('Error deleting session:', err);
        throw err;
      }
    },

    /**
     * Permanently deletes sessions that have been inactive past the
     * configured retention window. Distinct from `deleteInactiveSessions`
     * (which deletes ALL inactive sessions) — this only drops rows older
     * than `retentionDays`, so recently-terminated sessions stay queryable
     * for audits.
     *
     * @param {Object} [options]
     * @param {number} [options.retentionDays]    Overrides the stored setting.
     * @param {boolean} [options.useDbDirect]     Fast-path via single SQL
     *   DELETE. Bypasses lifecycle hooks; use only when necessary.
     * @returns {Promise<number>} Number of sessions deleted
     */
    async deleteOldSessions({ retentionDays, useDbDirect } = {}) {
      try {
        const settings = await getPluginSettings(strapi);
        const effectiveDays = Number.isFinite(retentionDays)
          ? retentionDays
          : (settings.retentionDays || 90);

        if (effectiveDays === -1) {
          log.debug('[RETENTION] retentionDays=-1 (forever) — skipping');
          return 0;
        }

        const cutoffDate = new Date(Date.now() - effectiveDays * 24 * 60 * 60 * 1000);
        const wantDbDirect = useDbDirect ?? settings.cleanupUseDbDirect === true;

        log.info(`[RETENTION] Deleting inactive sessions older than ${effectiveDays} days (before ${cutoffDate.toISOString()})`);

        if (wantDbDirect) {
          try {
            const deleted = await strapi.db.connection('magic_sessions')
              .where('is_active', false)
              .andWhere(function whereOldEnough() {
                this.where('logout_time', '<', cutoffDate)
                  .orWhere(function whereNullLogout() {
                    this.whereNull('logout_time').andWhere(function whereOldByActivity() {
                      this.where('last_active', '<', cutoffDate)
                        .orWhere(function whereNullActivity() {
                          this.whereNull('last_active').andWhere('login_time', '<', cutoffDate);
                        });
                    });
                  });
              })
              .del();
            log.info(`[SUCCESS] Retention (db-direct) deleted ${deleted} old session(s)`);
            return deleted;
          } catch (err) {
            log.warn('[RETENTION] DB-direct delete failed, falling back to Document Service:', err.message);
          }
        }

        let deletedCount = 0;
        const BATCH = 200;

        while (true) {
          const batch = await strapi.documents(SESSION_UID).findMany({
            filters: {
              isActive: false,
              $or: [
                { logoutTime: { $lt: cutoffDate } },
                { logoutTime: { $null: true }, lastActive: { $lt: cutoffDate } },
                { logoutTime: { $null: true }, lastActive: { $null: true }, loginTime: { $lt: cutoffDate } },
              ],
            },
            fields: ['documentId'],
            sort: { loginTime: 'asc' },
            limit: BATCH,
          });

          if (!batch || batch.length === 0) break;

          for (const session of batch) {
            try {
              await strapi.documents(SESSION_UID).delete({ documentId: session.documentId });
              deletedCount++;
            } catch (err) {
              log.debug(`[RETENTION] Failed to delete session ${session.documentId}:`, err.message);
            }
          }

          if (batch.length < BATCH) break;
        }

        log.info(`[SUCCESS] Retention deleted ${deletedCount} old session(s)`);
        return deletedCount;
      } catch (err) {
        log.error('Error in retention cleanup:', err);
        return 0;
      }
    },

    /**
     * Permanently deletes all inactive sessions.
     * Uses an inner scan loop that tolerates partial failures.
     * @returns {Promise<number>}
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
            fields: ['documentId'],
            limit: BATCH_SIZE,
          });

          if (!batch || batch.length === 0) break;

          const deleteResults = await Promise.allSettled(
            batch.map((session) =>
              strapi.documents(SESSION_UID).delete({ documentId: session.documentId })
            )
          );

          const successful = deleteResults.filter((r) => r.status === 'fulfilled').length;
          deletedCount += successful;

          if (successful === 0) {
            consecutiveEmptyLoops++;
            if (consecutiveEmptyLoops >= 3) {
              log.warn('[DELETE] No progress on 3 consecutive batches, aborting to prevent infinite loop');
              break;
            }
          } else {
            consecutiveEmptyLoops = 0;
          }

          if (batch.length < BATCH_SIZE) break;
        }

        log.info(`[SUCCESS] Deleted ${deletedCount} inactive sessions`);
        return deletedCount;
      } catch (err) {
        log.error('Error deleting inactive sessions:', err);
        throw err;
      }
    },
  };
};
