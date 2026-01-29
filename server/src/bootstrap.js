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
    
    // CRITICAL: Replace the users-permissions auth strategy with our session-aware version
    // This ensures ALL authenticated requests (including /api/users/me) check for active sessions
    await registerSessionAwareAuthStrategy(strapi, log);
    
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

          // Find session by tokenHash - O(1) DB lookup instead of O(n) decrypt loop!
          const tokenHashValue = hashToken(token);
          const matchingSession = await strapi.documents(SESSION_UID).findFirst({
            filters: {
              tokenHash: tokenHashValue,
              isActive: true,
            },
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
          // NOTE: entityService is deprecated, but required here for numeric ID -> documentId conversion
          let userDocId = user.documentId;
          if (!userDocId && user.id) {
            const fullUser = await strapi.entityService.findOne(USER_UID, user.id, {
              fields: ['documentId'],
            });
            userDocId = fullUser?.documentId;
            
            if (!userDocId) {
              log.error(`[ERROR] Could not get documentId for user ${user.id} - session NOT created!`);
              // Continue without creating session - user will need to login again
              return;
            }
          }
          
          if (!userDocId) {
            log.error('[ERROR] No user documentId available - cannot create session');
            return;
          }
          
          log.debug(`[SESSION] Creating session for user documentId: ${userDocId}`);
          
          const newSession = await sessionService.createSession({
            userId: userDocId,
            ip,
            userAgent,
            token: ctx.body.jwt,              // Store Access Token (encrypted)
            refreshToken: ctx.body.refreshToken, // Store Refresh Token (encrypted) if exists
            geoData,                           // Store geolocation data if available
          });
          
          if (newSession?.documentId) {
            log.info(`[SUCCESS] Session ${newSession.documentId} created for user ${userDocId} (IP: ${ip})`);
          } else {
            log.error(`[ERROR] Session creation returned no documentId for user ${userDocId}`);
          }
          
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
            // Find session by refreshTokenHash - O(1) DB lookup instead of O(n) decrypt loop!
            const refreshTokenHashValue = hashToken(refreshToken);
            const matchingSession = await strapi.documents(SESSION_UID).findFirst({
              filters: {
                refreshTokenHash: refreshTokenHashValue,
                isActive: true,
              },
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
            // Find session by refreshTokenHash - O(1) DB lookup instead of O(n) decrypt loop!
            const oldRefreshTokenHash = hashToken(oldRefreshToken);
            const matchingSession = await strapi.documents(SESSION_UID).findFirst({
              filters: {
                refreshTokenHash: oldRefreshTokenHash,
                isActive: true,
              },
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
    // IMPORTANT: Pass sessionService for touch() functionality
    strapi.server.use(
      require('./middlewares/last-seen')({ strapi, sessionService })
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

/**
 * Register session-aware auth strategy that wraps users-permissions JWT strategy
 * This ensures ALL authenticated requests check for active sessions
 * @param {object} strapi - Strapi instance
 * @param {object} log - Logger instance
 */
async function registerSessionAwareAuthStrategy(strapi, log) {
  try {
    // In Strapi v5, we need to wrap the users-permissions authenticate function
    // The strategy is stored in the plugin's services
    const usersPermissionsPlugin = strapi.plugin('users-permissions');
    
    if (!usersPermissionsPlugin) {
      strapi.log.warn('[magic-sessionmanager] [AUTH] users-permissions plugin not found');
      return;
    }
    
    // Try to get the JWT service
    const jwtService = usersPermissionsPlugin.service('jwt');
    
    if (!jwtService || !jwtService.verify) {
      strapi.log.warn('[magic-sessionmanager] [AUTH] JWT service not found or no verify method');
      return;
    }
    
    // Store original verify function
    const originalVerify = jwtService.verify.bind(jwtService);
    
    strapi.log.info('[magic-sessionmanager] [AUTH] Wrapping JWT verify function...');
    
    // Wrap the verify function to add session checking
    jwtService.verify = async function(token) {
      // First, verify the JWT normally
      const decoded = await originalVerify(token);
      
      // If verification failed, return the result
      if (!decoded || !decoded.id) {
        return decoded;
      }
      
      // Get config - strictSessionEnforcement must be explicitly enabled to block
      const config = strapi.config.get('plugin::magic-sessionmanager') || {};
      const strictMode = config.strictSessionEnforcement === true;
      
      // Now check if THIS SPECIFIC session (by token hash) is valid
      try {
        // Hash the token to find the specific session
        const tokenHashValue = hashToken(token);
        
        // Get user documentId
        let userDocId = null;
        
        // decoded.id is numeric, we need documentId
        const user = await strapi.entityService.findOne(
          'plugin::users-permissions.user',
          decoded.id,
          { fields: ['documentId'] }
        );
        
        userDocId = user?.documentId;
        
        if (!userDocId) {
          // Can't determine user - allow through (fail-open)
          strapi.log.debug('[magic-sessionmanager] [JWT] No documentId found, allowing through');
          return decoded;
        }
        
        // Find THIS SPECIFIC session by token hash
        const thisSession = await strapi.documents(SESSION_UID).findFirst({
          filters: {
            user: { documentId: userDocId },
            tokenHash: tokenHashValue,
          },
          fields: ['documentId', 'isActive', 'terminatedManually', 'lastActive'],
        });
        
        if (thisSession) {
          // Found the specific session for this token
          
          if (thisSession.terminatedManually === true) {
            // This specific session was manually terminated → BLOCK
            strapi.log.info(
              `[magic-sessionmanager] [JWT-BLOCKED] Session was manually terminated (user: ${userDocId.substring(0, 8)}...)`
            );
            return null;
          }
          
          if (thisSession.isActive) {
            // Session is active → allow
            return decoded;
          }
          
          // Session is inactive but NOT manually terminated → reactivate
          await strapi.documents(SESSION_UID).update({
            documentId: thisSession.documentId,
            data: {
              isActive: true,
              lastActive: new Date(),
            },
          });
          strapi.log.info(
            `[magic-sessionmanager] [JWT-REACTIVATED] Session reactivated for user ${userDocId.substring(0, 8)}...`
          );
          return decoded;
        }
        
        // No session found for this specific token - check if user has ANY sessions
        // This handles tokens issued before session manager was installed
        const anyActiveSessions = await strapi.documents(SESSION_UID).findMany({
          filters: {
            user: { documentId: userDocId },
            isActive: true,
          },
          limit: 1,
        });
        
        if (anyActiveSessions && anyActiveSessions.length > 0) {
          // User has other active sessions - allow this token (backward compatibility)
          strapi.log.debug(
            `[magic-sessionmanager] [JWT] No session for token but user has other active sessions (allowing)`
          );
          return decoded;
        }
        
        // Check for any manually terminated sessions
        const terminatedSessions = await strapi.documents(SESSION_UID).findMany({
          filters: {
            user: { documentId: userDocId },
            terminatedManually: true,
          },
          limit: 1,
        });
        
        if (terminatedSessions && terminatedSessions.length > 0) {
          // User was logged out (all sessions terminated) → BLOCK
          strapi.log.info(
            `[magic-sessionmanager] [JWT-BLOCKED] User ${userDocId.substring(0, 8)}... has terminated sessions`
          );
          return null;
        }
        
        // No sessions at all - session was never created
        if (strictMode) {
          strapi.log.info(
            `[magic-sessionmanager] [JWT-BLOCKED] No sessions exist for user ${userDocId.substring(0, 8)}... (strictMode)`
          );
          return null;
        }
        
        // Non-strict mode: Allow through but warn
        strapi.log.warn(
          `[magic-sessionmanager] [JWT-WARN] No session for user ${userDocId.substring(0, 8)}... (allowing)`
        );
        return decoded;
        
      } catch (err) {
        // On ANY error, allow through (fail-open for availability)
        strapi.log.warn('[magic-sessionmanager] [JWT] Session check error (allowing):', err.message);
        return decoded;
      }
    };
    
    strapi.log.info('[magic-sessionmanager] [AUTH] [SUCCESS] JWT verify wrapped with session validation');
    
  } catch (err) {
    strapi.log.warn('[magic-sessionmanager] [AUTH] Could not wrap JWT verify:', err.message);
    strapi.log.warn('[magic-sessionmanager] [AUTH] Session validation will only work via middleware (plugin endpoints)');
  }
}
