'use strict';

const { encryptToken, decryptToken, generateSessionId } = require('../utils/encryption');

/**
 * Session Service
 * Uses plugin::magic-sessionmanager.session content type with relation to users
 * All session tracking happens in the Session collection
 *
 * SECURITY: JWT tokens are encrypted before storing in database using AES-256-GCM
 * 
 * [SUCCESS] Migrated to strapi.documents() API (Strapi v5 Best Practice)
 * 
 * TODO: For production multi-instance deployments, use Redis for:
 *   - Session store instead of DB
 *   - Rate limiting locks
 *   - Distributed session state
 */

const SESSION_UID = 'plugin::magic-sessionmanager.session';
const USER_UID = 'plugin::users-permissions.user';

module.exports = ({ strapi }) => ({
  /**
   * Create a new session record
   * @param {Object} params - { userId, ip, userAgent, token, refreshToken }
   * @returns {Promise<Object>} Created session
   */
  async createSession({ userId, ip = 'unknown', userAgent = 'unknown', token, refreshToken }) {
    try {
      const now = new Date();
      
      // Generate unique session ID
      const sessionId = generateSessionId(userId);
      
      // Encrypt JWT tokens before storing (both access and refresh)
      const encryptedToken = token ? encryptToken(token) : null;
      const encryptedRefreshToken = refreshToken ? encryptToken(refreshToken) : null;
      
      // Using Document Service API (Strapi v5)
      const session = await strapi.documents(SESSION_UID).create({
        data: {
          user: userId, // userId should be documentId (string)
          ipAddress: ip.substring(0, 45),
          userAgent: userAgent.substring(0, 500),
          loginTime: now,
          lastActive: now,
          isActive: true,
          token: encryptedToken,              // [SUCCESS] Encrypted Access Token
          refreshToken: encryptedRefreshToken, // [SUCCESS] Encrypted Refresh Token
          sessionId: sessionId,                // [SUCCESS] Unique identifier
        },
      });

      strapi.log.info(`[magic-sessionmanager] [SUCCESS] Session ${session.documentId} (${sessionId}) created for user ${userId}`);

      return session;
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error creating session:', err);
      throw err;
    }
  },

  /**
   * Terminate a session or all sessions for a user
   * @param {Object} params - { sessionId | userId }
   * @returns {Promise<void>}
   */
  async terminateSession({ sessionId, userId }) {
    try {
      const now = new Date();

      if (sessionId) {
        // Using Document Service API (Strapi v5)
        await strapi.documents(SESSION_UID).update({
          documentId: sessionId,
          data: {
            isActive: false,
            logoutTime: now,
          },
        });

        strapi.log.info(`[magic-sessionmanager] Session ${sessionId} terminated`);
      } else if (userId) {
        // Find all active sessions for user - use Deep Filtering (Strapi v5)
        const activeSessions = await strapi.documents(SESSION_UID).findMany({
          filters: {
            user: { documentId: userId }, // Deep filtering syntax
            isActive: true,
          },
        });

        // Terminate all active sessions
        for (const session of activeSessions) {
          await strapi.documents(SESSION_UID).update({
            documentId: session.documentId,
            data: {
              isActive: false,
              logoutTime: now,
            },
          });
        }

        strapi.log.info(`[magic-sessionmanager] All sessions terminated for user ${userId}`);
      }
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error terminating session:', err);
      throw err;
    }
  },

  /**
   * Get ALL sessions (active + inactive) with accurate online status
   * @returns {Promise<Array>} All sessions with enhanced data
   */
  async getAllSessions() {
    try {
      const sessions = await strapi.documents(SESSION_UID).findMany( {
        populate: { user: { fields: ['id', 'email', 'username'] } },
        sort: { loginTime: 'desc' },
        limit: 1000, // Reasonable limit
      });

      // Get inactivity timeout from config (default: 15 minutes)
      const config = strapi.config.get('plugin::magic-sessionmanager') || {};
      const inactivityTimeout = config.inactivityTimeout || 15 * 60 * 1000; // 15 min in ms

      // Enhance sessions with accurate online status
      const now = new Date();
      const enhancedSessions = sessions.map(session => {
        const lastActiveTime = session.lastActive ? new Date(session.lastActive) : new Date(session.loginTime);
        const timeSinceActive = now - lastActiveTime;
        
        // Session is "truly active" if within timeout window AND isActive is true
        const isTrulyActive = session.isActive && (timeSinceActive < inactivityTimeout);
        
        // Remove sensitive token field for security
        const { token, ...sessionWithoutToken } = session;
        
        return {
          ...sessionWithoutToken,
          isTrulyActive,
          minutesSinceActive: Math.floor(timeSinceActive / 1000 / 60),
        };
      });

      return enhancedSessions;
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error getting all sessions:', err);
      throw err;
    }
  },

  /**
   * Get all active sessions with accurate online status
   * @returns {Promise<Array>} Active sessions with user data and online status
   */
  async getActiveSessions() {
    try {
      const sessions = await strapi.documents(SESSION_UID).findMany( {
        filters: { isActive: true },
        populate: { user: { fields: ['id', 'email', 'username'] } },
        sort: { loginTime: 'desc' },
      });

      // Get inactivity timeout from config (default: 15 minutes)
      const config = strapi.config.get('plugin::magic-sessionmanager') || {};
      const inactivityTimeout = config.inactivityTimeout || 15 * 60 * 1000; // 15 min in ms

      // Enhance sessions with accurate online status
      const now = new Date();
      const enhancedSessions = sessions.map(session => {
        const lastActiveTime = session.lastActive ? new Date(session.lastActive) : new Date(session.loginTime);
        const timeSinceActive = now - lastActiveTime;
        
        // Session is "truly active" if within timeout window
        const isTrulyActive = timeSinceActive < inactivityTimeout;
        
        // Remove sensitive token field for security
        const { token, ...sessionWithoutToken } = session;
        
        return {
          ...sessionWithoutToken,
          isTrulyActive,
          minutesSinceActive: Math.floor(timeSinceActive / 1000 / 60),
        };
      });

      // Only return truly active sessions
      return enhancedSessions.filter(s => s.isTrulyActive);
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error getting active sessions:', err);
      throw err;
    }
  },

  /**
   * Get all sessions for a specific user
   * @param {number} userId
   * @returns {Promise<Array>} User's sessions with accurate online status
   */
  async getUserSessions(userId) {
    try {
      const sessions = await strapi.documents(SESSION_UID).findMany( {
        filters: { user: { documentId: userId } },
        sort: { loginTime: 'desc' },
      });

      // Get inactivity timeout from config (default: 15 minutes)
      const config = strapi.config.get('plugin::magic-sessionmanager') || {};
      const inactivityTimeout = config.inactivityTimeout || 15 * 60 * 1000; // 15 min in ms

      // Enhance sessions with accurate online status
      const now = new Date();
      const enhancedSessions = sessions.map(session => {
        const lastActiveTime = session.lastActive ? new Date(session.lastActive) : new Date(session.loginTime);
        const timeSinceActive = now - lastActiveTime;
        
        // Session is "truly active" if:
        // 1. isActive = true AND
        // 2. lastActive is within timeout window
        const isTrulyActive = session.isActive && (timeSinceActive < inactivityTimeout);
        
        // Remove sensitive token field for security
        const { token, ...sessionWithoutToken } = session;
        
        return {
          ...sessionWithoutToken,
          isTrulyActive,
          minutesSinceActive: Math.floor(timeSinceActive / 1000 / 60),
        };
      });

      return enhancedSessions;
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error getting user sessions:', err);
      throw err;
    }
  },

  /**
   * Update lastActive timestamp on session (rate-limited to avoid DB noise)
   * @param {Object} params - { userId, sessionId }
   * @returns {Promise<void>}
   */
  async touch({ userId, sessionId }) {
    try {
      const now = new Date();
      const config = strapi.config.get('plugin::magic-sessionmanager') || {};
      const rateLimit = config.lastSeenRateLimit || 30000;

      // Update session lastActive only
      if (sessionId) {
        const session = await strapi.documents(SESSION_UID).findOne({ documentId: sessionId });

        if (session && session.lastActive) {
          const lastActiveTime = new Date(session.lastActive).getTime();
          const currentTime = now.getTime();

          if (currentTime - lastActiveTime > rateLimit) {
            await strapi.documents(SESSION_UID).update({ documentId: sessionId,
              data: { lastActive: now },
            });
          }
        } else if (session) {
          // First time or null
          await strapi.documents(SESSION_UID).update({ documentId: sessionId,
            data: { lastActive: now },
          });
        }
      }
    } catch (err) {
      strapi.log.debug('[magic-sessionmanager] Error touching session:', err.message);
      // Don't throw - this is a non-critical operation
    }
  },

  /**
   * Cleanup inactive sessions - set isActive to false for sessions older than inactivityTimeout
   * Should be called on bootstrap to clean up stale sessions
   */
  async cleanupInactiveSessions() {
    try {
      // Get inactivity timeout from config (default: 15 minutes)
      const config = strapi.config.get('plugin::magic-sessionmanager') || {};
      const inactivityTimeout = config.inactivityTimeout || 15 * 60 * 1000; // 15 min in ms
      
      // Calculate cutoff time
      const now = new Date();
      const cutoffTime = new Date(now.getTime() - inactivityTimeout);
      
      strapi.log.info(`[magic-sessionmanager] 🧹 Cleaning up sessions inactive since before ${cutoffTime.toISOString()}`);
      
      // Find all active sessions
      const activeSessions = await strapi.documents(SESSION_UID).findMany( {
        filters: { isActive: true },
        fields: ['id', 'lastActive', 'loginTime'],
      });
      
      // Deactivate old sessions
      let deactivatedCount = 0;
      for (const session of activeSessions) {
        const lastActiveTime = session.lastActive ? new Date(session.lastActive) : new Date(session.loginTime);
        
        if (lastActiveTime < cutoffTime) {
          await strapi.documents(SESSION_UID).update({ documentId: session.id,
            data: { isActive: false },
          });
          deactivatedCount++;
        }
      }
      
      strapi.log.info(`[magic-sessionmanager] [SUCCESS] Cleanup complete: ${deactivatedCount} sessions deactivated`);
      return deactivatedCount;
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error cleaning up inactive sessions:', err);
      throw err;
    }
  },

  /**
   * Delete a single session from database
   * WARNING: This permanently deletes the record!
   * @param {number} sessionId - Session ID to delete
   * @returns {Promise<boolean>} Success status
   */
  async deleteSession(sessionId) {
    try {
      await strapi.documents(SESSION_UID).delete({ documentId: sessionId });
      strapi.log.info(`[magic-sessionmanager] [DELETE] Session ${sessionId} permanently deleted`);
      return true;
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error deleting session:', err);
      throw err;
    }
  },

  /**
   * Delete all inactive sessions from database
   * WARNING: This permanently deletes records!
   * @returns {Promise<number>} Number of deleted sessions
   */
  async deleteInactiveSessions() {
    try {
      strapi.log.info('[magic-sessionmanager] [DELETE] Deleting all inactive sessions...');
      
      // Find all inactive sessions
      const inactiveSessions = await strapi.documents(SESSION_UID).findMany( {
        filters: { isActive: false },
        fields: ['id'],
      });
      
      let deletedCount = 0;
      
      // Delete each inactive session
      for (const session of inactiveSessions) {
        await strapi.documents(SESSION_UID).delete({ documentId: session.id });
        deletedCount++;
      }
      
      strapi.log.info(`[magic-sessionmanager] [SUCCESS] Deleted ${deletedCount} inactive sessions`);
      return deletedCount;
    } catch (err) {
      strapi.log.error('[magic-sessionmanager] Error deleting inactive sessions:', err);
      throw err;
    }
  },
});
