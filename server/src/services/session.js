'use strict';

const { encryptToken, decryptToken, generateSessionId, hashToken } = require('../utils/encryption');
const { createLogger } = require('../utils/logger');
const { parseUserAgent } = require('../utils/user-agent-parser');

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

module.exports = ({ strapi }) => {
  const log = createLogger(strapi);
  
  return {
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
      
      // Generate token hashes for O(1) lookups (no need to decrypt all tokens)
      const tokenHashValue = token ? hashToken(token) : null;
      const refreshTokenHashValue = refreshToken ? hashToken(refreshToken) : null;
      
      // Using Document Service API (Strapi v5)
      const session = await strapi.documents(SESSION_UID).create({
        data: {
          user: userId, // userId should be documentId (string)
          ipAddress: ip.substring(0, 45),
          userAgent: userAgent.substring(0, 500),
          loginTime: now,
          lastActive: now,
          isActive: true,
          token: encryptedToken,              // Encrypted Access Token
          tokenHash: tokenHashValue,           // SHA-256 hash for fast lookup
          refreshToken: encryptedRefreshToken, // Encrypted Refresh Token
          refreshTokenHash: refreshTokenHashValue, // SHA-256 hash for fast lookup
          sessionId: sessionId,                // Unique identifier
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
   * Terminate a session or all sessions for a user
   * Supports both numeric id (legacy) and documentId (Strapi v5)
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

        log.info(`Session ${sessionId} terminated`);
      } else if (userId) {
        // Strapi v5: If numeric id provided, look up documentId first
        let userDocumentId = userId;
        if (!isNaN(userId)) {
          const user = await strapi.entityService.findOne(USER_UID, parseInt(userId, 10));
          if (user) {
            userDocumentId = user.documentId;
          }
        }
        
        // Find all active sessions for user - use Deep Filtering (Strapi v5)
        const activeSessions = await strapi.documents(SESSION_UID).findMany({
          filters: {
            user: { documentId: userDocumentId }, // Deep filtering syntax
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

        log.info(`All sessions terminated for user ${userDocumentId}`);
      }
    } catch (err) {
      log.error('Error terminating session:', err);
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

      // Enhance sessions with accurate online status and device info
      const now = new Date();
      const enhancedSessions = sessions.map(session => {
        const lastActiveTime = session.lastActive ? new Date(session.lastActive) : new Date(session.loginTime);
        const timeSinceActive = now - lastActiveTime;
        
        // Session is "truly active" if within timeout window AND isActive is true
        const isTrulyActive = session.isActive && (timeSinceActive < inactivityTimeout);
        
        // Parse user agent to get device info (if not already stored)
        const parsedUA = parseUserAgent(session.userAgent);
        const deviceType = session.deviceType || parsedUA.deviceType;
        const browserName = session.browserName || (parsedUA.browserVersion 
          ? `${parsedUA.browserName} ${parsedUA.browserVersion}` 
          : parsedUA.browserName);
        const osName = session.osName || (parsedUA.osVersion 
          ? `${parsedUA.osName} ${parsedUA.osVersion}` 
          : parsedUA.osName);
        
        // Remove sensitive fields and internal Strapi fields
        const { 
          token, tokenHash, refreshToken, refreshTokenHash,
          locale, publishedAt,
          ...safeSession 
        } = session;
        
        return {
          ...safeSession,
          deviceType,
          browserName,
          osName,
          isTrulyActive,
          minutesSinceActive: Math.floor(timeSinceActive / 1000 / 60),
        };
      });

      return enhancedSessions;
    } catch (err) {
      log.error('Error getting all sessions:', err);
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

      // Enhance sessions with accurate online status and device info
      const now = new Date();
      const enhancedSessions = sessions.map(session => {
        const lastActiveTime = session.lastActive ? new Date(session.lastActive) : new Date(session.loginTime);
        const timeSinceActive = now - lastActiveTime;
        
        // Session is "truly active" if within timeout window
        const isTrulyActive = timeSinceActive < inactivityTimeout;
        
        // Parse user agent to get device info (if not already stored)
        const parsedUA = parseUserAgent(session.userAgent);
        const deviceType = session.deviceType || parsedUA.deviceType;
        const browserName = session.browserName || (parsedUA.browserVersion 
          ? `${parsedUA.browserName} ${parsedUA.browserVersion}` 
          : parsedUA.browserName);
        const osName = session.osName || (parsedUA.osVersion 
          ? `${parsedUA.osName} ${parsedUA.osVersion}` 
          : parsedUA.osName);
        
        // Remove sensitive fields and internal Strapi fields
        const { 
          token, tokenHash, refreshToken, refreshTokenHash,
          locale, publishedAt,
          ...safeSession 
        } = session;
        
        return {
          ...safeSession,
          deviceType,
          browserName,
          osName,
          isTrulyActive,
          minutesSinceActive: Math.floor(timeSinceActive / 1000 / 60),
        };
      });

      // Only return truly active sessions
      return enhancedSessions.filter(s => s.isTrulyActive);
    } catch (err) {
      log.error('Error getting active sessions:', err);
      throw err;
    }
  },

  /**
   * Get all sessions for a specific user
   * Supports both numeric id (legacy) and documentId (Strapi v5)
   * @param {string|number} userId - User documentId or numeric id
   * @returns {Promise<Array>} User's sessions with accurate online status
   */
  async getUserSessions(userId) {
    try {
      // Strapi v5: If numeric id provided, look up documentId first
      let userDocumentId = userId;
      if (!isNaN(userId)) {
        const user = await strapi.entityService.findOne(USER_UID, parseInt(userId, 10));
        if (user) {
          userDocumentId = user.documentId;
        }
      }
      
      const sessions = await strapi.documents(SESSION_UID).findMany( {
        filters: { user: { documentId: userDocumentId } },
        sort: { loginTime: 'desc' },
      });

      // Get inactivity timeout from config (default: 15 minutes)
      const config = strapi.config.get('plugin::magic-sessionmanager') || {};
      const inactivityTimeout = config.inactivityTimeout || 15 * 60 * 1000; // 15 min in ms

      // Enhance sessions with accurate online status and device info
      const now = new Date();
      const enhancedSessions = sessions.map(session => {
        const lastActiveTime = session.lastActive ? new Date(session.lastActive) : new Date(session.loginTime);
        const timeSinceActive = now - lastActiveTime;
        
        // Session is "truly active" if:
        // 1. isActive = true AND
        // 2. lastActive is within timeout window
        const isTrulyActive = session.isActive && (timeSinceActive < inactivityTimeout);
        
        // Parse user agent to get device info (if not already stored)
        const parsedUA = parseUserAgent(session.userAgent);
        const deviceType = session.deviceType || parsedUA.deviceType;
        const browserName = session.browserName || (parsedUA.browserVersion 
          ? `${parsedUA.browserName} ${parsedUA.browserVersion}` 
          : parsedUA.browserName);
        const osName = session.osName || (parsedUA.osVersion 
          ? `${parsedUA.osName} ${parsedUA.osVersion}` 
          : parsedUA.osName);
        
        // Remove sensitive fields and internal Strapi fields
        const { 
          token, tokenHash, refreshToken, refreshTokenHash,
          locale, publishedAt,
          ...safeSession 
        } = session;
        
        return {
          ...safeSession,
          deviceType,
          browserName,
          osName,
          isTrulyActive,
          minutesSinceActive: Math.floor(timeSinceActive / 1000 / 60),
        };
      });

      return enhancedSessions;
    } catch (err) {
      log.error('Error getting user sessions:', err);
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
      log.debug('Error touching session:', err.message);
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
      
      log.info(`[CLEANUP] Cleaning up sessions inactive since before ${cutoffTime.toISOString()}`);
      
      // Find all active sessions
      const activeSessions = await strapi.documents(SESSION_UID).findMany({
        filters: { isActive: true },
        fields: ['lastActive', 'loginTime'],
      });
      
      // Deactivate old sessions
      let deactivatedCount = 0;
      for (const session of activeSessions) {
        const lastActiveTime = session.lastActive ? new Date(session.lastActive) : new Date(session.loginTime);
        
        if (lastActiveTime < cutoffTime) {
          await strapi.documents(SESSION_UID).update({
            documentId: session.documentId,
            data: { isActive: false },
          });
          deactivatedCount++;
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
   * Delete a single session from database
   * WARNING: This permanently deletes the record!
   * @param {number} sessionId - Session ID to delete
   * @returns {Promise<boolean>} Success status
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
   * Delete all inactive sessions from database
   * WARNING: This permanently deletes records!
   * @returns {Promise<number>} Number of deleted sessions
   */
  async deleteInactiveSessions() {
    try {
      log.info('[DELETE] Deleting all inactive sessions...');
      
      // Find all inactive sessions (documentId is always included automatically)
      const inactiveSessions = await strapi.documents(SESSION_UID).findMany({
        filters: { isActive: false },
      });
      
      let deletedCount = 0;
      
      // Delete each inactive session
      for (const session of inactiveSessions) {
        await strapi.documents(SESSION_UID).delete({ documentId: session.documentId });
        deletedCount++;
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
