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
const { encryptToken, decryptToken } = require('./utils/encryption');

const SESSION_UID = 'plugin::magic-sessionmanager.session';
const USER_UID = 'plugin::users-permissions.user';

module.exports = async ({ strapi }) => {
  strapi.log.info('[magic-sessionmanager] [START] Bootstrap starting...');

  try {
    // Initialize License Guard
    const licenseGuardService = strapi.plugin('magic-sessionmanager').service('license-guard');
    
    // Wait a bit for all services to be ready
    setTimeout(async () => {
      const licenseStatus = await licenseGuardService.initialize();
      
      if (!licenseStatus.valid) {
        strapi.log.error('╔════════════════════════════════════════════════════════════════╗');
        strapi.log.error('║  [ERROR] SESSION MANAGER - NO VALID LICENSE                         ║');
        strapi.log.error('║                                                                ║');
        strapi.log.error('║  This plugin requires a valid license to operate.             ║');
        strapi.log.error('║  Please activate your license via Admin UI:                   ║');
        strapi.log.error('║  Go to Settings → Sessions → License                          ║');
        strapi.log.error('║                                                                ║');
        strapi.log.error('║  The plugin will run with limited functionality until         ║');
        strapi.log.error('║  a valid license is activated.                                ║');
        strapi.log.error('╚════════════════════════════════════════════════════════════════╝');
      } else if (licenseStatus.valid) {
        const pluginStore = strapi.store({
          type: 'plugin',
          name: 'magic-sessionmanager',
        });
        const storedKey = await pluginStore.get({ key: 'licenseKey' });
        
        strapi.log.info('╔════════════════════════════════════════════════════════════════╗');
        strapi.log.info('║  [SUCCESS] SESSION MANAGER LICENSE ACTIVE                             ║');
        strapi.log.info('║                                                                ║');
        
        if (licenseStatus.data) {
          strapi.log.info(`║  License: ${licenseStatus.data.licenseKey}`.padEnd(66) + '║');
          strapi.log.info(`║  User: ${licenseStatus.data.firstName} ${licenseStatus.data.lastName}`.padEnd(66) + '║');
          strapi.log.info(`║  Email: ${licenseStatus.data.email}`.padEnd(66) + '║');
        } else if (storedKey) {
          strapi.log.info(`║  License: ${storedKey} (Offline Mode)`.padEnd(66) + '║');
          strapi.log.info(`║  Status: Grace Period Active`.padEnd(66) + '║');
        }
        
        strapi.log.info('║                                                                ║');
        strapi.log.info('║  [RELOAD] Auto-pinging every 15 minutes                              ║');
        strapi.log.info('╚════════════════════════════════════════════════════════════════╝');
      }
    }, 3000); // Wait 3 seconds for API to be ready

    // Get session service
    const sessionService = strapi
      .plugin('magic-sessionmanager')
      .service('session');

    // Cleanup inactive sessions on startup
    strapi.log.info('[magic-sessionmanager] Running initial session cleanup...');
    await sessionService.cleanupInactiveSessions();

    // Schedule periodic cleanup every 30 minutes
    const cleanupInterval = 30 * 60 * 1000; // 30 minutes
    
    const cleanupIntervalHandle = setInterval(async () => {
      try {
        // Get fresh reference to service to avoid scope issues
        const service = strapi.plugin('magic-sessionmanager').service('session');
        await service.cleanupInactiveSessions();
      } catch (err) {
        strapi.log.error('[magic-sessionmanager] Periodic cleanup error:', err);
      }
    }, cleanupInterval);
    
    strapi.log.info('[magic-sessionmanager] [TIME] Periodic cleanup scheduled (every 30 minutes)');
    
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
            strapi.log.info(`[magic-sessionmanager] [LOGOUT] Logout via /api/auth/logout - Session ${matchingSession.documentId} terminated`);
          }

          ctx.status = 200;
          ctx.body = { message: 'Logged out successfully' };
        } catch (err) {
          strapi.log.error('[magic-sessionmanager] Logout error:', err);
          ctx.status = 200;
          ctx.body = { message: 'Logged out successfully' };
        }
      },
      config: {
        auth: false,
      },
    }]);

    strapi.log.info('[magic-sessionmanager] [SUCCESS] /api/auth/logout route registered');

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
          strapi.log.info(`[magic-sessionmanager] [CHECK] Login detected! User: ${user.documentId || user.id} (${user.email || user.username}) from IP: ${ip}`);
          
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
              strapi.log.warn('[magic-sessionmanager] Geolocation check failed:', geoErr.message);
            }
          }
          
          // Block if needed
          if (shouldBlock) {
            strapi.log.warn(`[magic-sessionmanager] [BLOCKED] Blocking login: ${blockReason}`);
            
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
          
          strapi.log.info(`[magic-sessionmanager] [SUCCESS] Session created for user ${userDocId} (IP: ${ip})`);
          
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
              strapi.log.warn('[magic-sessionmanager] Notification failed:', notifErr.message);
            }
          }
        } catch (err) {
          strapi.log.error('[magic-sessionmanager] [ERROR] Error creating session:', err);
          // Don't throw - login should still succeed even if session creation fails
        }
      }
    });

    strapi.log.info('[magic-sessionmanager] [SUCCESS] Login/Logout interceptor middleware mounted');

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
              strapi.log.warn('[magic-sessionmanager] [BLOCKED] Blocked refresh token request - no active session');
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
            
            strapi.log.info(`[magic-sessionmanager] [SUCCESS] Refresh token allowed for session ${matchingSession.documentId}`);
          }
        } catch (err) {
          strapi.log.error('[magic-sessionmanager] Error checking refresh token:', err);
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
              
              await strapi.documents(SESSION_UID).update({
                documentId: matchingSession.documentId,
                data: {
                  token: encryptedToken,
                  refreshToken: encryptedRefreshToken,
                  lastActive: new Date(),
                },
              });
              
              strapi.log.info(`[magic-sessionmanager] [REFRESH] Tokens refreshed for session ${matchingSession.documentId}`);
            }
          }
        } catch (err) {
          strapi.log.error('[magic-sessionmanager] Error updating refreshed tokens:', err);
        }
      }
    });

    strapi.log.info('[magic-sessionmanager] [SUCCESS] Refresh Token interceptor middleware mounted');

    // Mount lastSeen update middleware
    strapi.server.use(
      require('./middlewares/last-seen')({ strapi, sessionService })
    );

    strapi.log.info('[magic-sessionmanager] [SUCCESS] LastSeen middleware mounted');

    // Auto-enable Content-API permissions for authenticated users
    await ensureContentApiPermissions(strapi);

    strapi.log.info('[magic-sessionmanager] [SUCCESS] Bootstrap complete');
    strapi.log.info('[magic-sessionmanager] [READY] Session Manager ready! Sessions stored in plugin::magic-sessionmanager.session');
    
  } catch (err) {
    strapi.log.error('[magic-sessionmanager] [ERROR] Bootstrap error:', err);
  }
};

/**
 * Auto-enable Content-API permissions for authenticated users
 * This ensures plugin endpoints are accessible after installation
 * @param {object} strapi - Strapi instance
 */
async function ensureContentApiPermissions(strapi) {
  try {
    // Get the authenticated role
    const authenticatedRole = await strapi.query('plugin::users-permissions.role').findOne({
      where: { type: 'authenticated' },
    });

    if (!authenticatedRole) {
      strapi.log.warn('[magic-sessionmanager] Authenticated role not found - skipping permission setup');
      return;
    }

    // Content-API actions that should be enabled for authenticated users
    const requiredActions = [
      'plugin::magic-sessionmanager.session.logout',
      'plugin::magic-sessionmanager.session.logoutAll',
      'plugin::magic-sessionmanager.session.getOwnSessions',
      'plugin::magic-sessionmanager.session.getUserSessions',
    ];

    // Get existing permissions for this role
    const existingPermissions = await strapi.query('plugin::users-permissions.permission').findMany({
      where: {
        role: authenticatedRole.id,
        action: { $in: requiredActions },
      },
    });

    // Find which actions are missing
    const existingActions = existingPermissions.map(p => p.action);
    const missingActions = requiredActions.filter(action => !existingActions.includes(action));

    if (missingActions.length === 0) {
      strapi.log.debug('[magic-sessionmanager] Content-API permissions already configured');
      return;
    }

    // Create missing permissions
    for (const action of missingActions) {
      await strapi.query('plugin::users-permissions.permission').create({
        data: {
          action,
          role: authenticatedRole.id,
        },
      });
      strapi.log.info(`[magic-sessionmanager] [PERMISSION] Enabled ${action} for authenticated users`);
    }

    strapi.log.info('[magic-sessionmanager] [SUCCESS] Content-API permissions configured for authenticated users');
  } catch (err) {
    strapi.log.warn('[magic-sessionmanager] Could not auto-configure permissions:', err.message);
    strapi.log.warn('[magic-sessionmanager] Please manually enable plugin permissions in Settings > Users & Permissions > Roles > Authenticated');
  }
}
