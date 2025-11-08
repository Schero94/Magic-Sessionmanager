'use strict';

/**
 * Bootstrap: Mount middleware for session tracking
 * Sessions are managed via api::session.session content type
 *
 * NOTE: For multi-instance deployments, consider Redis locks or session store
 */

const getClientIp = require('./utils/getClientIp');

module.exports = async ({ strapi }) => {
  strapi.log.info('[magic-sessionmanager] 🚀 Bootstrap starting...');

  try {
    // Initialize License Guard
    const licenseGuardService = strapi.plugin('magic-sessionmanager').service('license-guard');
    
    // Wait a bit for all services to be ready
    setTimeout(async () => {
      const licenseStatus = await licenseGuardService.initialize();
      
      if (!licenseStatus.valid) {
        strapi.log.error('╔════════════════════════════════════════════════════════════════╗');
        strapi.log.error('║  ❌ SESSION MANAGER - NO VALID LICENSE                         ║');
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
        strapi.log.info('║  ✅ SESSION MANAGER LICENSE ACTIVE                             ║');
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
        strapi.log.info('║  🔄 Auto-pinging every 15 minutes                              ║');
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
    
    strapi.log.info('[magic-sessionmanager] ⏰ Periodic cleanup scheduled (every 30 minutes)');
    
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

          // Find and terminate session by token
          const sessions = await strapi.entityService.findMany('api::session.session', {
            filters: {
              token: token,
              isActive: true,
            },
            limit: 1,
          });

          if (sessions.length > 0) {
            await sessionService.terminateSession({ sessionId: sessions[0].id });
            strapi.log.info(`[magic-sessionmanager] 🚪 Logout via /api/auth/logout - Session ${sessions[0].id} terminated`);
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

    strapi.log.info('[magic-sessionmanager] ✅ /api/auth/logout route registered');

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
          
          strapi.log.info(`[magic-sessionmanager] 🔍 Login detected! User: ${user.id} (${user.email || user.username}) from IP: ${ip}`);
          
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
            strapi.log.warn(`[magic-sessionmanager] 🚫 Blocking login: ${blockReason}`);
            
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
          
          // Create a new session
          const newSession = await sessionService.createSession({
            userId: user.id,
            ip,
            userAgent,
            token: ctx.body.jwt, // Store JWT token reference
          });
          
          strapi.log.info(`[magic-sessionmanager] ✅ Session created for user ${user.id} (IP: ${ip})`);
          
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
          strapi.log.error('[magic-sessionmanager] ❌ Error creating session:', err);
          // Don't throw - login should still succeed even if session creation fails
        }
      }
    });

    strapi.log.info('[magic-sessionmanager] ✅ Login/Logout interceptor middleware mounted');

    // Mount lastSeen update middleware
    strapi.server.use(
      require('./middlewares/last-seen')({ strapi, sessionService })
    );

    strapi.log.info('[magic-sessionmanager] ✅ LastSeen middleware mounted');
    strapi.log.info('[magic-sessionmanager] ✅ Bootstrap complete');
    strapi.log.info('[magic-sessionmanager] 🎉 Session Manager ready! Sessions stored in api::session.session');
    
  } catch (err) {
    strapi.log.error('[magic-sessionmanager] ❌ Bootstrap error:', err);
  }
};
