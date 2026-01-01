'use strict';

/**
 * Bootstrap: Mount middleware for session tracking
 * Sessions are managed via plugin::magic-sessionmanager.session content type
 *
 * [SUCCESS] Migrated to strapi.documents() API (Strapi v5 Best Practice)
 *
 * NOTE: For multi-instance deployments, consider Redis locks or session store
 */

const getClientIp = require('./utils/getClientIp');
const { encryptToken, decryptToken, hashToken } = require('./utils/encryption');
const { createLogger } = require('./utils/logger');

const SESSION_UID = 'plugin::magic-sessionmanager.session';
const USER_UID = 'plugin::users-permissions.user';

module.exports = async ({ strapi }) => {
  const log = createLogger(strapi);
  
  log.info('[START] Bootstrap starting...');

  try {
    // Create index on tokenHash for O(1) session lookup performance
    await ensureTokenHashIndex(strapi, log);
    
    // Initialize License Guard
    const licenseGuardService = strapi.plugin('magic-sessionmanager').service('license-guard');
    
    // Wait a bit for all services to be ready
    setTimeout(async () => {
      const licenseStatus = await licenseGuardService.initialize();
      
      if (!licenseStatus.valid) {
        log.error('╔════════════════════════════════════════════════════════════════╗');
        log.error('║  [ERROR] SESSION MANAGER - NO VALID LICENSE                         ║');
        log.error('║                                                                ║');
        log.error('║  This plugin requires a valid license to operate.             ║');
        log.error('║  Please activate your license via Admin UI:                   ║');
        log.error('║  Go to Settings → Sessions → License                          ║');
        log.error('║                                                                ║');
        log.error('║  The plugin will run with limited functionality until         ║');
        log.error('║  a valid license is activated.                                ║');
        log.error('╚════════════════════════════════════════════════════════════════╝');
      } else if (licenseStatus.valid) {
        const pluginStore = strapi.store({
          type: 'plugin',
          name: 'magic-sessionmanager',
        });
        const storedKey = await pluginStore.get({ key: 'licenseKey' });
        
        log.info('╔════════════════════════════════════════════════════════════════╗');
        log.info('║  [SUCCESS] SESSION MANAGER LICENSE ACTIVE                             ║');
        log.info('║                                                                ║');
        
        if (licenseStatus.data) {
          log.info(`║  License: ${licenseStatus.data.licenseKey}`.padEnd(66) + '║');
          log.info(`║  User: ${licenseStatus.data.firstName} ${licenseStatus.data.lastName}`.padEnd(66) + '║');
          log.info(`║  Email: ${licenseStatus.data.email}`.padEnd(66) + '║');
        } else if (storedKey) {
          log.info(`║  License: ${storedKey} (Offline Mode)`.padEnd(66) + '║');
          log.info(`║  Status: Grace Period Active`.padEnd(66) + '║');
        }
        
        log.info('║                                                                ║');
        log.info('║  [RELOAD] Auto-pinging every 15 minutes                              ║');
        log.info('╚════════════════════════════════════════════════════════════════╝');
      }
    }, 3000); // Wait 3 seconds for API to be ready

    // Get session service
    const sessionService = strapi
      .plugin('magic-sessionmanager')
      .service('session');

    // Cleanup inactive sessions on startup
    log.info('Running initial session cleanup...');
    await sessionService.cleanupInactiveSessions();

    // Schedule periodic cleanup every 30 minutes
    const cleanupInterval = 30 * 60 * 1000; // 30 minutes
    
    const cleanupIntervalHandle = setInterval(async () => {
      try {
        // Get fresh reference to service to avoid scope issues
        const service = strapi.plugin('magic-sessionmanager').service('session');
        await service.cleanupInactiveSessions();
      } catch (err) {
        log.error('Periodic cleanup error:', err);
      }
    }, cleanupInterval);
    
    log.info('[TIME] Periodic cleanup scheduled (every 30 minutes)');
    
    // Store interval handle for cleanup on shutdown
    if (!strapi.sessionManagerIntervals) {
      strapi.sessionManagerIntervals = {};
    }
    strapi.sessionManagerIntervals.cleanup = cleanupIntervalHandle;

    // HIGH PRIORITY: Register /api/auth/logout route BEFORE other plugins
    strapi.server.routes([{
      method: 'POST',
      path: '/api/auth/logout',
      handler: async (ctx) => {
        try {
          const token = ctx.request.headers?.authorization?.replace('Bearer ', '');
          
          if (!token) {
            ctx.status = 200;
            ctx.body = { message: 'Logged out successfully' };
            return;
          }

          // Find session by decrypting tokens and matching
          // Since tokens are encrypted, we need to get all active sessions and check each one
          const allSessions = await strapi.documents(SESSION_UID).findMany( {
            filters: {
              isActive: true,
            },
          });

          // Find matching session by decrypting and comparing tokens
          const matchingSession = allSessions.find(session => {
            if (!session.token) return false;
            try {
              const decrypted = decryptToken(session.token);
              return decrypted === token;
            } catch (err) {
              return false;
            }
          });

          if (matchingSession) {
            await sessionService.terminateSession({ sessionId: matchingSession.documentId });
            log.info(`[LOGOUT] Logout via /api/auth/logout - Session ${matchingSession.documentId} terminated`);
          }

          ctx.status = 200;
          ctx.body = { message: 'Logged out successfully' };
        } catch (err) {
          log.error('Logout error:', err);
          ctx.status = 200;
          ctx.body = { message: 'Logged out successfully' };
        }
      },
      config: {
        auth: false,
      },
    }]);

    log.info('[SUCCESS] /api/auth/logout route registered');

    // Middleware to intercept logins
    strapi.server.use(async (ctx, next) => {
      // Execute the actual request
      await next();
      
      // Check if this was a successful login request
      const isAuthLocal = ctx.path === '/api/auth/local' && ctx.method === 'POST';
      const isMagicLink = ctx.path.includes('/magic-link/login') && ctx.method === 'POST';
      
      if ((isAuthLocal || isMagicLink) && ctx.status === 200 && ctx.body && ctx.body.user) {
        try {
          const user = ctx.body.user;
          
          // Extract REAL client IP (handles proxies, load balancers, Cloudflare, etc.)
          const ip = getClientIp(ctx);
          const userAgent = ctx.request.headers?.['user-agent'] || ctx.request.header?.['user-agent'] || 'unknown';
          
          // Strapi v5: Use documentId for session creation
          log.info(`[CHECK] Login detected! User: ${user.documentId || user.id} (${user.email || user.username}) from IP: ${ip}`);
          
          // Get config
          const config = strapi.config.get('plugin::magic-sessionmanager') || {};
          
          // Check if we should analyze this session (Premium/Advanced features)
          let shouldBlock = false;
          let blockReason = '';
          let geoData = null;
          
          // Premium: Get geolocation data
          if (config.enableGeolocation || config.enableSecurityScoring) {
            try {
              const geolocationService = strapi.plugin('magic-sessionmanager').service('geolocation');
              geoData = await geolocationService.getIpInfo(ip);
              
              // Advanced: Auto-blocking
              if (config.blockSuspiciousSessions && geoData) {
                if (geoData.isThreat) {
                  shouldBlock = true;
                  blockReason = 'Known threat IP detected';
                } else if (geoData.isVpn && config.alertOnVpnProxy) {
                  shouldBlock = true;
                  blockReason = 'VPN detected';
                } else if (geoData.isProxy && config.alertOnVpnProxy) {
                  shouldBlock = true;
                  blockReason = 'Proxy detected';
                } else if (geoData.securityScore < 50) {
                  shouldBlock = true;
                  blockReason = `Low security score: ${geoData.securityScore}/100`;
                }
              }
              
              // Advanced: Geo-fencing
              if (config.enableGeofencing && geoData && geoData.country_code) {
                const countryCode = geoData.country_code;
                
                // Check blocked countries
                if (config.blockedCountries && config.blockedCountries.includes(countryCode)) {
                  shouldBlock = true;
                  blockReason = `Country ${countryCode} is blocked`;
                }
                
                // Check allowed countries (whitelist)
                if (config.allowedCountries && config.allowedCountries.length > 0) {
                  if (!config.allowedCountries.includes(countryCode)) {
                    shouldBlock = true;
                    blockReason = `Country ${countryCode} is not in allowlist`;
                  }
                }
              }
            } catch (geoErr) {
              log.warn('Geolocation check failed:', geoErr.message);
            }
          }
          
          // Block if needed
          if (shouldBlock) {
            log.warn(`[BLOCKED] Blocking login: ${blockReason}`);
            
            // Don't create session, return error
            ctx.status = 403;
            ctx.body = {
              error: {
                status: 403,
                message: 'Login blocked for security reasons',
                details: { reason: blockReason }
              }
            };
            return; // Stop here
          }
          
          // Create a new session (Strapi v5: Use documentId instead of numeric id)
          // If login response doesn't include documentId, fetch it from DB
          let userDocId = user.documentId;
          if (!userDocId && user.id) {
            const fullUser = await strapi.entityService.findOne(USER_UID, user.id);
            userDocId = fullUser?.documentId || user.id;
          }
          
          const newSession = await sessionService.createSession({
            userId: userDocId,
            ip,
            userAgent,
            token: ctx.body.jwt,              // Store Access Token (encrypted)
            refreshToken: ctx.body.refreshToken, // Store Refresh Token (encrypted) if exists
          });
          
          log.info(`[SUCCESS] Session created for user ${userDocId} (IP: ${ip})`);
          
          // Advanced: Send notifications
          if (geoData && (config.enableEmailAlerts || config.enableWebhooks)) {
            try {
              const notificationService = strapi.plugin('magic-sessionmanager').service('notifications');
              
              // Determine if suspicious
              const isSuspicious = geoData.isVpn || geoData.isProxy || geoData.isThreat || geoData.securityScore < 70;
              
              // Email alerts
              if (config.enableEmailAlerts && config.alertOnSuspiciousLogin && isSuspicious) {
                await notificationService.sendSuspiciousLoginAlert({
                  user,
                  session: newSession,
                  reason: {
                    isVpn: geoData.isVpn,
                    isProxy: geoData.isProxy,
                    isThreat: geoData.isThreat,
                    securityScore: geoData.securityScore,
                  },
                  geoData,
                });
              }
              
              // Webhook notifications (Discord/Slack)
              if (config.enableWebhooks) {
                const webhookData = notificationService.formatDiscordWebhook({
                  event: isSuspicious ? 'login.suspicious' : 'login.success',
                  session: newSession,
                  user,
                  geoData,
                });
                
                if (config.discordWebhookUrl) {
                  await notificationService.sendWebhook({
                    event: 'session.login',
                    data: webhookData,
                    webhookUrl: config.discordWebhookUrl,
                  });
                }
              }
            } catch (notifErr) {
              log.warn('Notification failed:', notifErr.message);
            }
          }
        } catch (err) {
          log.error('[ERROR] Error creating session:', err);
          // Don't throw - login should still succeed even if session creation fails
        }
      }
    });

    log.info('[SUCCESS] Login/Logout interceptor middleware mounted');

    // Middleware to block refresh token requests for terminated sessions
    strapi.server.use(async (ctx, next) => {
      // Check if this is a refresh token request (Strapi v5: /api/auth/refresh)
      const isRefreshToken = ctx.path === '/api/auth/refresh' && ctx.method === 'POST';
      
      if (isRefreshToken) {
        try {
          const refreshToken = ctx.request.body?.refreshToken;
          
          if (refreshToken) {
            // Find session with this refresh token
            const allSessions = await strapi.documents(SESSION_UID).findMany( {
              filters: {
                isActive: true,
              },
            });

            // Find matching session by decrypting and comparing refresh tokens
            const matchingSession = allSessions.find(session => {
              if (!session.refreshToken) return false;
              try {
                const decrypted = decryptToken(session.refreshToken);
                return decrypted === refreshToken;
              } catch (err) {
                return false;
              }
            });

            if (!matchingSession) {
              // No active session with this refresh token - Block!
              log.warn('[BLOCKED] Blocked refresh token request - no active session');
              ctx.status = 401;
              ctx.body = {
                error: {
                  status: 401,
                  message: 'Session terminated. Please login again.',
                  name: 'UnauthorizedError'
                }
              };
              return; // Don't continue
            }
            
            log.info(`[SUCCESS] Refresh token allowed for session ${matchingSession.documentId}`);
          }
        } catch (err) {
          log.error('Error checking refresh token:', err);
          // On error, allow request to continue (fail-open for availability)
        }
      }
      
      // Continue with request
      await next();
      
      // AFTER: If refresh token response was successful, update session with new tokens
      if (isRefreshToken && ctx.status === 200 && ctx.body && ctx.body.jwt) {
        try {
          const oldRefreshToken = ctx.request.body?.refreshToken;
          const newAccessToken = ctx.body.jwt;
          const newRefreshToken = ctx.body.refreshToken;
          
          if (oldRefreshToken) {
            // Find session and update with new tokens
            const allSessions = await strapi.documents(SESSION_UID).findMany( {
              filters: {
                isActive: true,
              },
            });

            const matchingSession = allSessions.find(session => {
              if (!session.refreshToken) return false;
              try {
                const decrypted = decryptToken(session.refreshToken);
                return decrypted === oldRefreshToken;
              } catch (err) {
                return false;
              }
            });

            if (matchingSession) {
              const encryptedToken = newAccessToken ? encryptToken(newAccessToken) : matchingSession.token;
              const encryptedRefreshToken = newRefreshToken ? encryptToken(newRefreshToken) : matchingSession.refreshToken;
              
              // Generate new hashes for fast lookup
              const newTokenHash = newAccessToken ? hashToken(newAccessToken) : matchingSession.tokenHash;
              const newRefreshTokenHash = newRefreshToken ? hashToken(newRefreshToken) : matchingSession.refreshTokenHash;
              
              await strapi.documents(SESSION_UID).update({
                documentId: matchingSession.documentId,
                data: {
                  token: encryptedToken,
                  tokenHash: newTokenHash,
                  refreshToken: encryptedRefreshToken,
                  refreshTokenHash: newRefreshTokenHash,
                  lastActive: new Date(),
                },
              });
              
              log.info(`[REFRESH] Tokens refreshed for session ${matchingSession.documentId}`);
            }
          }
        } catch (err) {
          log.error('Error updating refreshed tokens:', err);
        }
      }
    });

    log.info('[SUCCESS] Refresh Token interceptor middleware mounted');

    // Mount lastSeen update middleware (uses tokenHash for O(1) lookup)
    strapi.server.use(
      require('./middlewares/last-seen')({ strapi })
    );

    log.info('[SUCCESS] LastSeen middleware mounted');

    // Auto-enable Content-API permissions for authenticated users
    await ensureContentApiPermissions(strapi, log);

    log.info('[SUCCESS] Bootstrap complete');
    log.info('[READY] Session Manager ready! Sessions stored in plugin::magic-sessionmanager.session');
    
  } catch (err) {
    log.error('[ERROR] Bootstrap error:', err);
  }
};

/**
 * Auto-enable Content-API permissions for authenticated users
 * This ensures plugin endpoints are accessible after installation
 * NOTE: Uses entityService as users-permissions plugin doesn't have documentId support
 * @param {object} strapi - Strapi instance
 * @param {object} log - Logger instance
 */
async function ensureContentApiPermissions(strapi, log) {
  try {
    const ROLE_UID = 'plugin::users-permissions.role';
    const PERMISSION_UID = 'plugin::users-permissions.permission';

    // Get the authenticated role using entityService (users-permissions uses numeric IDs)
    const roles = await strapi.entityService.findMany(ROLE_UID, {
      filters: { type: 'authenticated' },
      limit: 1,
    });

    const authenticatedRole = roles?.[0];

    if (!authenticatedRole) {
      log.warn('Authenticated role not found - skipping permission setup');
      return;
    }

    // Content-API actions that should be enabled for authenticated users
    const requiredActions = [
      'plugin::magic-sessionmanager.session.logout',
      'plugin::magic-sessionmanager.session.logoutAll',
      'plugin::magic-sessionmanager.session.getOwnSessions',
      'plugin::magic-sessionmanager.session.getUserSessions',
      'plugin::magic-sessionmanager.session.getCurrentSession',
      'plugin::magic-sessionmanager.session.terminateOwnSession',
    ];

    // Get existing permissions for this role using entityService
    const existingPermissions = await strapi.entityService.findMany(PERMISSION_UID, {
      filters: {
        role: authenticatedRole.id,
        action: { $in: requiredActions },
      },
    });

    // Find which actions are missing
    const existingActions = existingPermissions.map(p => p.action);
    const missingActions = requiredActions.filter(action => !existingActions.includes(action));

    if (missingActions.length === 0) {
      log.debug('Content-API permissions already configured');
      return;
    }

    // Create missing permissions using entityService
    for (const action of missingActions) {
      await strapi.entityService.create(PERMISSION_UID, {
        data: {
          action,
          role: authenticatedRole.id,
        },
      });
      log.info(`[PERMISSION] Enabled ${action} for authenticated users`);
    }

    log.info('[SUCCESS] Content-API permissions configured for authenticated users');
  } catch (err) {
    log.warn('Could not auto-configure permissions:', err.message);
    log.warn('Please manually enable plugin permissions in Settings > Users & Permissions > Roles > Authenticated');
  }
}

/**
 * Create database index on tokenHash for O(1) session lookup
 * This is critical for performance - without index, DB does full table scan
 * @param {object} strapi - Strapi instance
 * @param {object} log - Logger instance
 */
async function ensureTokenHashIndex(strapi, log) {
  try {
    const knex = strapi.db.connection;
    const tableName = 'magic_sessions';
    const indexName = 'idx_magic_sessions_token_hash';
    
    // Check if index already exists
    const hasIndex = await knex.schema.hasTable(tableName).then(async (exists) => {
      if (!exists) return false;
      
      // Check for existing index (PostgreSQL and MySQL compatible)
      const dialect = strapi.db.dialect.client;
      
      if (dialect === 'postgres') {
        const result = await knex.raw(`
          SELECT indexname FROM pg_indexes 
          WHERE tablename = ? AND indexname = ?
        `, [tableName, indexName]);
        return result.rows.length > 0;
      } else if (dialect === 'mysql' || dialect === 'mysql2') {
        const result = await knex.raw(`
          SHOW INDEX FROM ${tableName} WHERE Key_name = ?
        `, [indexName]);
        return result[0].length > 0;
      } else if (dialect === 'sqlite' || dialect === 'better-sqlite3') {
        const result = await knex.raw(`
          SELECT name FROM sqlite_master 
          WHERE type='index' AND name = ?
        `, [indexName]);
        return result.length > 0;
      }
      
      return false;
    });
    
    if (hasIndex) {
      log.debug('[INDEX] tokenHash index already exists');
      return;
    }
    
    // Create composite index on tokenHash + isActive for optimal lookup
    await knex.schema.alterTable(tableName, (table) => {
      table.index(['token_hash', 'is_active'], indexName);
    });
    
    log.info('[INDEX] Created tokenHash index for O(1) session lookup');
  } catch (err) {
    // Index creation might fail if columns don't exist yet (first run)
    // This is fine - it will be created on next restart after schema sync
    log.debug('[INDEX] Could not create tokenHash index (will retry on next startup):', err.message);
  }
}
