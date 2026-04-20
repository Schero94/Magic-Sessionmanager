'use strict';

/**
 * Bootstrap: Mount middleware for session tracking.
 *
 * Sessions are managed via the `plugin::magic-sessionmanager.session` content
 * type using the Strapi v5 Document Service. This bootstrap also wraps the
 * users-permissions JWT verify function so ALL authenticated requests are
 * validated against the session store.
 *
 * For multi-instance deployments, consider Redis locks for session
 * reactivation or a shared session store.
 */

const getClientIp = require('./utils/getClientIp');
const { encryptToken, hashToken } = require('./utils/encryption');
const { createLogger } = require('./utils/logger');
const { resolveUserDocumentId } = require('./utils/resolve-user');
const { getPluginSettings } = require('./utils/settings-loader');
const { extractBearerToken } = require('./utils/extract-token');
const {
  setSessionRejectionReason,
  consumeSessionRejectionReason,
} = require('./utils/rejection-cache');

const SESSION_UID = 'plugin::magic-sessionmanager.session';

const JWT_WRAPPED_FLAG = Symbol.for('magic-sessionmanager.jwt.wrapped');

/**
 * Pre-check paths that should be geo-checked BEFORE the login proceeds.
 * Returning true for a path indicates an incoming login/MFA step that we want
 * to block at the network layer if the IP is suspicious.
 */
const LOGIN_PATHS = new Set([
  '/api/auth/local',
  '/api/magic-link/login-totp',
  '/api/magic-link/otp/verify',
  '/api/magic-link/verify-mfa-totp',
]);

/**
 * Dynamic login path matcher for paths that include dynamic segments or query.
 * @param {string} path
 * @param {string} method
 * @returns {boolean}
 */
function isLoginPath(path, method) {
  if (!path) return false;
  if (LOGIN_PATHS.has(path)) return true;
  if (path.startsWith('/api/magic-link/login') && (method === 'GET' || method === 'POST')) return true;
  return false;
}

module.exports = async ({ strapi }) => {
  const log = createLogger(strapi);

  log.info('[START] Bootstrap starting...');

  // Fail fast on missing production secrets. getEncryptionKey() throws
  // when NODE_ENV=production and SESSION_ENCRYPTION_KEY is missing, so a
  // bad deploy dies here with a clear error instead of silently failing
  // later when the first encrypted-token read/write happens.
  try {
    encryptToken('self-test');
  } catch (e) {
    log.error(`[BOOTSTRAP] ${e.message}`);
    throw e;
  }

  try {
    await ensureTokenHashIndex(strapi, log);

    await registerSessionAwareAuthStrategy(strapi, log);

    const licenseGuardService = strapi.plugin('magic-sessionmanager').service('license-guard');

    setTimeout(async () => {
      try {
        const licenseStatus = await licenseGuardService.initialize();

        if (!licenseStatus.valid) {
          log.error('╔════════════════════════════════════════════════════════════════╗');
          log.error('║  [ERROR] SESSION MANAGER - NO VALID LICENSE                    ║');
          log.error('║                                                                ║');
          log.error('║  This plugin requires a valid license to operate.              ║');
          log.error('║  Please activate your license via Admin UI:                    ║');
          log.error('║  Go to Settings → Sessions → License                           ║');
          log.error('║                                                                ║');
          log.error('║  The plugin will run with limited functionality until          ║');
          log.error('║  a valid license is activated.                                 ║');
          log.error('╚════════════════════════════════════════════════════════════════╝');
        } else {
          const pluginStore = strapi.store({
            type: 'plugin',
            name: 'magic-sessionmanager',
          });
          const storedKey = await pluginStore.get({ key: 'licenseKey' });

          log.info('╔════════════════════════════════════════════════════════════════╗');
          log.info('║  [SUCCESS] SESSION MANAGER LICENSE ACTIVE                      ║');
          log.info('║                                                                ║');

          if (licenseStatus.data) {
            const maskedKey = licenseStatus.data.licenseKey
              ? `${licenseStatus.data.licenseKey.substring(0, 8)}...`
              : 'N/A';
            log.info(`║  License: ${maskedKey}`.padEnd(66) + '║');
            log.info(`║  User: ${licenseStatus.data.firstName} ${licenseStatus.data.lastName}`.padEnd(66) + '║');
          } else if (storedKey) {
            log.info(`║  License: ${storedKey.substring(0, 8)}... (Offline Mode)`.padEnd(66) + '║');
            log.info('║  Status: Grace Period Active'.padEnd(66) + '║');
          }

          log.info('║                                                                ║');
          log.info('║  [RELOAD] Auto-pinging every 15 minutes                        ║');
          log.info('╚════════════════════════════════════════════════════════════════╝');
        }
      } catch (licErr) {
        log.error('License initialization failed:', licErr);
      }
    }, 3000);

    const sessionService = strapi.plugin('magic-sessionmanager').service('session');

    if (!strapi.sessionManagerIntervals) {
      strapi.sessionManagerIntervals = {};
    }

    log.info('Running initial session cleanup...');
    try {
      const settings = await getPluginSettings(strapi);
      await sessionService.cleanupInactiveSessions({
        useDbDirect: settings.cleanupUseDbDirect === true,
      });
    } catch (cleanupErr) {
      log.warn('Initial cleanup failed:', cleanupErr.message);
    }

    // Schedule the idle-session cleanup using setTimeout recursion instead
    // of setInterval, so that changes to `settings.cleanupInterval` take
    // effect on the next scheduled tick rather than requiring a restart.
    // The minimum is clamped to 5 minutes to avoid pathological configs
    // from turning the job into a hot loop.
    const scheduleIdleCleanup = async () => {
      let intervalMs = 30 * 60 * 1000;
      let useDbDirect = false;
      try {
        const settings = await getPluginSettings(strapi);
        intervalMs = Math.max(5 * 60 * 1000, settings.cleanupInterval || intervalMs);
        useDbDirect = settings.cleanupUseDbDirect === true;
      } catch {
        // use defaults
      }

      const handle = setTimeout(async () => {
        try {
          const service = strapi.plugin('magic-sessionmanager').service('session');
          await service.cleanupInactiveSessions({ useDbDirect });
        } catch (err) {
          log.error('Periodic cleanup error:', err);
        }
        scheduleIdleCleanup();
      }, intervalMs);

      strapi.sessionManagerIntervals.cleanupTimeout = handle;
    };
    await scheduleIdleCleanup();

    // Separate scheduler for retention (permanently-delete inactive sessions
    // older than settings.retentionDays). We run this at most once per day,
    // because retention is a slow-moving property and more frequent runs
    // add no business value.
    const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
    const scheduleRetention = async () => {
      let useDbDirect = false;
      try {
        const settings = await getPluginSettings(strapi);
        useDbDirect = settings.cleanupUseDbDirect === true;
      } catch {
        // use defaults
      }

      const handle = setTimeout(async () => {
        try {
          const service = strapi.plugin('magic-sessionmanager').service('session');
          await service.deleteOldSessions({ useDbDirect });
        } catch (err) {
          log.error('Retention cleanup error:', err);
        }
        scheduleRetention();
      }, RETENTION_INTERVAL_MS);

      strapi.sessionManagerIntervals.retentionTimeout = handle;
    };
    // Delay the first retention run by 5 minutes so Strapi bootstrap is
    // fully settled and we do not compete with startup DB activity.
    strapi.sessionManagerIntervals.retentionStartup = setTimeout(() => {
      scheduleRetention();
    }, 5 * 60 * 1000);

    log.info('[TIME] Dynamic cleanup + retention scheduled');

    mountPreLoginGeoGuard({ strapi, log });

    // Mounted BEFORE the login interceptor so a locked-out IP is short-
    // circuited before we hit the auth handler. The lockout is a no-op
    // when settings.maxFailedLogins is 0.
    mountFailedLoginLockout({ strapi, log });

    mountLogoutRoute({ strapi, log, sessionService });

    mountLoginInterceptor({ strapi, log, sessionService });

    mountRefreshTokenInterceptor({ strapi, log });

    // Mount response decorator BEFORE last-seen so it wraps every request
    // and can write a structured reason header/body on 401s produced by
    // downstream auth middleware.
    strapi.server.use(
      require('./middlewares/session-rejection-headers')({}, { strapi })
    );
    log.info('[SUCCESS] Session-rejection-headers middleware mounted');

    strapi.server.use(
      require('./middlewares/last-seen')({ strapi, sessionService })
    );
    log.info('[SUCCESS] LastSeen middleware mounted');

    await ensureContentApiPermissions(strapi, log);

    log.info('[SUCCESS] Bootstrap complete');
    log.info('[READY] Session Manager ready! Sessions stored in plugin::magic-sessionmanager.session');

  } catch (err) {
    log.error('[ERROR] Bootstrap error:', err);
  }
};

/**
 * Pre-login geo guard: blocks suspicious IPs BEFORE the login controller runs,
 * so no JWT/refresh token is ever generated for a blocked request.
 *
 * Fixes the "geo-block bypass" issue where a JWT was generated, stored
 * server-side and then discarded — leaving a cryptographically valid token
 * that could be abused if logged anywhere.
 *
 * @param {{strapi: object, log: object}} deps
 */
function mountPreLoginGeoGuard({ strapi, log }) {
  strapi.server.use(async (ctx, next) => {
    if (!isLoginPath(ctx.path, ctx.method)) {
      return next();
    }

    let settings = {};
    try {
      settings = await getPluginSettings(strapi);
    } catch {
      settings = {};
    }

    const needsGeoCheck =
      settings.blockSuspiciousSessions ||
      settings.enableGeofencing ||
      settings.enableGeolocation;

    if (!needsGeoCheck) {
      return next();
    }

    const ip = getClientIp(ctx);
    if (!ip || ip === 'unknown') {
      return next();
    }

    try {
      const geolocationService = strapi.plugin('magic-sessionmanager').service('geolocation');
      const geoData = await geolocationService.getIpInfo(ip);

      const geoStatus = geoData?._status || 'error';
      const geoTrusted = geoStatus === 'ok' || geoStatus === 'private';

      if (!geoTrusted && settings.blockSuspiciousSessions) {
        log.warn(`[PRE-BLOCKED] Geo lookup unavailable (status=${geoStatus}) for ${ip} (fail-closed)`);
        ctx.status = 403;
        ctx.body = {
          error: {
            status: 403,
            name: 'ForbiddenError',
            message: 'Login temporarily unavailable. Please contact support.',
          },
        };
        return;
      }

      let blockReason = null;

      if (settings.blockSuspiciousSessions && geoStatus === 'ok') {
        if (geoData.isThreat) blockReason = 'threat_ip';
        else if (geoData.isVpn && settings.alertOnVpnProxy) blockReason = 'vpn_detected';
        else if (geoData.isProxy && settings.alertOnVpnProxy) blockReason = 'proxy_detected';
        // The numeric security-score threshold is only applied when the
        // admin has enabled score evaluation. Threat/VPN/Proxy always apply
        // because those are unambiguous signals.
        else if (
          settings.enableSecurityScoring !== false &&
          typeof geoData.securityScore === 'number' &&
          geoData.securityScore < 50
        ) {
          blockReason = `low_security_score:${geoData.securityScore}`;
        }
      }

      if (!blockReason && settings.enableGeofencing && geoStatus === 'ok' && geoData.country_code) {
        const cc = geoData.country_code;
        if (Array.isArray(settings.blockedCountries) && settings.blockedCountries.includes(cc)) {
          blockReason = `country_blocked:${cc}`;
        }
        if (!blockReason && Array.isArray(settings.allowedCountries) && settings.allowedCountries.length > 0) {
          if (!settings.allowedCountries.includes(cc)) {
            blockReason = `country_not_allowed:${cc}`;
          }
        }
      }

      if (blockReason) {
        log.warn(`[PRE-BLOCKED] Login rejected (${blockReason}) from IP ${ip}`);
        ctx.status = 403;
        ctx.body = {
          error: {
            status: 403,
            name: 'ForbiddenError',
            message: 'Login blocked for security reasons. Please contact support.',
          },
        };
        ctx.state.__magicSessionGeoData = geoData;
        return;
      }

      if (geoStatus === 'ok') {
        ctx.state.__magicSessionGeoData = geoData;
      }
    } catch (err) {
      log.debug('Pre-login geo guard error (allowing):', err.message);
    }

    await next();
  });

  log.info('[SUCCESS] Pre-login geo guard mounted');
}

/**
 * Mounts the `/api/auth/logout` route. Unlike the previous implementation, this
 * version REQUIRES a cryptographically valid JWT (or a just-expired JWT whose
 * signature is still verifiable) AND verifies that the session belongs to the
 * authenticated user before terminating.
 *
 * This closes the "anyone with a JWT can kill any session" IDOR.
 *
 * @param {{strapi: object, log: object, sessionService: object}} deps
 */
function mountLogoutRoute({ strapi, log, sessionService }) {
  let jwt = null;
  try {
    jwt = require('jsonwebtoken');
  } catch {
    jwt = null;
  }

  strapi.server.routes([{
    method: 'POST',
    path: '/api/auth/logout',
    handler: async (ctx) => {
      try {
        const token = extractBearerToken(ctx);

        if (!token) {
          ctx.status = 401;
          ctx.body = { error: { status: 401, name: 'UnauthorizedError', message: 'Authorization token required' } };
          return;
        }

        const jwtService = strapi.plugin('users-permissions').service('jwt');
        let decoded = null;
        let expiredButValid = false;

        try {
          decoded = await jwtService.verify(token);
        } catch (verifyErr) {
          const isExpired = verifyErr?.name === 'TokenExpiredError' || /expired/i.test(verifyErr?.message || '');
          if (isExpired && jwt) {
            try {
              const jwtSecret = strapi.config.get('plugin::users-permissions.jwtSecret');
              if (jwtSecret) {
                decoded = jwt.verify(token, jwtSecret, { ignoreExpiration: true });
                expiredButValid = !!decoded;
              }
            } catch {
              decoded = null;
            }
          }
          if (!decoded) {
            ctx.status = 401;
            ctx.body = { error: { status: 401, name: 'UnauthorizedError', message: 'Invalid token' } };
            return;
          }
        }

        if (!decoded || !decoded.id) {
          ctx.status = 401;
          ctx.body = { error: { status: 401, name: 'UnauthorizedError', message: 'Invalid token' } };
          return;
        }

        const userDocId = await resolveUserDocumentId(strapi, decoded.id);

        const tokenHashValue = hashToken(token);
        const matchingSession = await strapi.documents(SESSION_UID).findFirst({
          filters: {
            tokenHash: tokenHashValue,
            ...(userDocId ? { user: { documentId: userDocId } } : {}),
          },
          fields: ['documentId', 'isActive'],
        });

        if (matchingSession && matchingSession.isActive) {
          await sessionService.terminateSession({ sessionId: matchingSession.documentId });
          log.info(`[LOGOUT] Session ${matchingSession.documentId} terminated (expiredButValid=${expiredButValid})`);
        }

        ctx.status = 200;
        ctx.body = { message: 'Logged out successfully' };
      } catch (err) {
        log.error('Logout error:', err);
        ctx.status = 500;
        ctx.body = { error: { status: 500, name: 'InternalServerError', message: 'Logout failed' } };
      }
    },
    config: {
      auth: false,
    },
  }]);

  log.info('[SUCCESS] /api/auth/logout route registered (auth-verified)');
}

/**
 * In-memory IP-based lockout after `maxFailedLogins` failed attempts within
 * a 15-minute rolling window. Lockout duration = 15 minutes.
 *
 * Trade-offs of the in-memory approach:
 *  - single-process only (multi-instance deployments share nothing)
 *  - resets on restart (attackers can reset by crashing the process)
 * These are acceptable for a first-line defense that runs BEFORE the
 * auth handler and adds no new DB writes. For multi-instance deployments,
 * swap this with a Redis-backed counter.
 *
 * The feature is opt-in via `settings.maxFailedLogins > 0`. When the
 * setting is 0 or missing, the middleware is a no-op (still mounted for
 * live-reload).
 *
 * @param {{strapi: object, log: object}} deps
 */
function mountFailedLoginLockout({ strapi, log }) {
  const WINDOW_MS = 15 * 60 * 1000;
  const failed = new Map(); // ip → { count, firstFailAt, blockedUntil }

  const prune = (now) => {
    if (failed.size < 5000) return;
    for (const [k, v] of failed) {
      if (v.blockedUntil < now && now - v.firstFailAt > WINDOW_MS) failed.delete(k);
    }
  };

  const recordFailure = (ip, max) => {
    const now = Date.now();
    prune(now);
    const entry = failed.get(ip) || { count: 0, firstFailAt: now, blockedUntil: 0 };
    if (now - entry.firstFailAt > WINDOW_MS) {
      entry.count = 0;
      entry.firstFailAt = now;
      entry.blockedUntil = 0;
    }
    entry.count += 1;
    if (entry.count >= max) {
      entry.blockedUntil = now + WINDOW_MS;
    }
    failed.set(ip, entry);
    return entry;
  };

  const clearFailures = (ip) => failed.delete(ip);

  strapi.server.use(async (ctx, next) => {
    if (!isLoginPath(ctx.path, ctx.method)) return next();

    let maxFailed = 0;
    try {
      const settings = await getPluginSettings(strapi);
      maxFailed = Number(settings.maxFailedLogins) || 0;
    } catch {
      maxFailed = 0;
    }
    if (maxFailed <= 0) return next();

    const ip = getClientIp(ctx);
    if (!ip || ip === 'unknown') return next();

    const now = Date.now();
    const existing = failed.get(ip);
    if (existing && existing.blockedUntil > now) {
      const retrySec = Math.ceil((existing.blockedUntil - now) / 1000);
      ctx.set('Retry-After', String(retrySec));
      log.warn(`[LOCKOUT] Rejected login from locked IP ${ip} (${retrySec}s remaining)`);
      ctx.status = 429;
      ctx.body = {
        error: {
          status: 429,
          name: 'TooManyRequestsError',
          message: 'Too many failed login attempts. Please try again later.',
          details: { retryAfter: retrySec },
        },
      };
      return;
    }

    await next();

    // Count every 4xx from a login endpoint as a failure. 5xx is almost
    // always a server bug and we don't want to punish the user for it.
    // 200 with a jwt resets the counter.
    if (ctx.status === 200 && ctx.body && ctx.body.jwt) {
      clearFailures(ip);
    } else if (ctx.status >= 400 && ctx.status < 500 && ctx.status !== 429) {
      const entry = recordFailure(ip, maxFailed);
      if (entry.blockedUntil > now) {
        log.warn(
          `[LOCKOUT] IP ${ip} locked for 15min after ${entry.count} failed login attempts`
        );
      }
    }
  });

  log.info('[SUCCESS] Failed-login lockout middleware mounted');
}

/**
 * After a successful login/MFA/OTP, creates a session record for the new JWT.
 * Geo-blocking already happened in `mountPreLoginGeoGuard`, so this handler
 * only records the session and (optionally) sends notifications.
 *
 * @param {{strapi: object, log: object, sessionService: object}} deps
 */
/**
 * Returns true for any users-permissions / magic-link endpoint that is
 * expected to mint a fresh JWT on success. Keeping this as an explicit
 * whitelist (rather than "any path that returns a jwt") prevents us
 * from accidentally creating sessions for unrelated endpoints that
 * might include a jwt field in their response for some reason.
 *
 * @param {string} path
 * @param {string} method
 * @returns {boolean}
 */
function isJwtIssuingPath(path, method) {
  if (!path) return false;
  const get = method === 'GET';
  const post = method === 'POST';

  // users-permissions core
  if (post && path === '/api/auth/local') return true;
  if (post && path === '/api/auth/local/register') return true;
  if (post && path === '/api/auth/reset-password') return true;
  if ((get || post) && path === '/api/auth/email-confirmation') return true;

  // users-permissions OAuth flow: /api/auth/:provider/callback
  // The provider segment is any non-empty alnum/dash token.
  if (get && /^\/api\/auth\/[a-z0-9-]+\/callback$/i.test(path)) return true;

  // magic-link
  if ((get || post) && path.startsWith('/api/magic-link/login')) return true;
  if (post && path === '/api/magic-link/verify-mfa-totp') return true;
  if (post && path === '/api/magic-link/otp/verify') return true;
  if (post && path === '/api/magic-link/login-totp') return true;

  // passwordless-compat alias that ships with magic-link v5
  if ((get || post) && path.startsWith('/api/passwordless/')) return true;

  return false;
}

function mountLoginInterceptor({ strapi, log, sessionService }) {
  strapi.server.use(async (ctx, next) => {
    await next();

    if (!isJwtIssuingPath(ctx.path, ctx.method)) return;
    if (ctx.status !== 200) return;
    if (!ctx.body || !ctx.body.jwt || !ctx.body.user) return;

    try {
      const user = ctx.body.user;
      const ip = getClientIp(ctx);
      const headers = ctx.request.headers || ctx.request.header || {};
      const userAgent = headers['user-agent'] || 'unknown';

      log.info(`[CHECK] Login detected! User: ${user.documentId || user.id} (${user.email || user.username}) from IP: ${ip}`);

      let userDocId = user.documentId;
      if (!userDocId && user.id) {
        userDocId = await resolveUserDocumentId(strapi, user.id);
      }

      if (!userDocId) {
        log.error(`[ERROR] Could not resolve documentId for user ${user.id || 'unknown'} - session NOT created!`);
        return;
      }

      const geoData = ctx.state?.__magicSessionGeoData || null;

      const newSession = await sessionService.createSession({
        userId: userDocId,
        ip,
        userAgent,
        token: ctx.body.jwt,
        refreshToken: ctx.body.refreshToken,
        geoData,
      });

      if (!newSession?.documentId) {
        log.error(`[ERROR] Session creation returned no documentId for user ${userDocId}`);
        return;
      }

      log.info(`[SUCCESS] Session ${newSession.documentId} created for user ${userDocId} (IP: ${ip})`);

      try {
        const settings = await getPluginSettings(strapi);
        if (!geoData || !(settings.enableEmailAlerts || settings.enableWebhooks)) {
          return;
        }

        const notificationService = strapi.plugin('magic-sessionmanager').service('notifications');

        // Security scoring is gated by the admin-facing `enableSecurityScoring`
        // toggle. When disabled, we still evaluate VPN/Proxy/Threat flags but
        // skip the numeric-score threshold check, so a false-positive score
        // cannot itself mark a session as suspicious.
        const scoreEvaluationEnabled = settings.enableSecurityScoring !== false;
        const lowScore = scoreEvaluationEnabled
          && typeof geoData.securityScore === 'number'
          && geoData.securityScore < 70;
        const isSuspicious = geoData.isVpn || geoData.isProxy || geoData.isThreat || lowScore;

        // New-location detection: compare to the user's previous sessions.
        // "New" is defined as never having seen this country (or city, when
        // the user has only one historical country) before. We swallow
        // lookup errors — this is purely informational alerting.
        let isNewLocation = false;
        if (settings.alertOnNewLocation && (geoData.country_code || geoData.country)) {
          try {
            const previousSessions = await strapi.documents(SESSION_UID).findMany({
              filters: {
                userId: userDocId,
                documentId: { $ne: newSession.documentId },
              },
              fields: ['geoCountry', 'geoCity'],
              sort: [{ createdAt: 'desc' }],
              limit: 50,
            });
            const countries = new Set(
              (previousSessions || [])
                .map((s) => s.geoCountry)
                .filter((v) => typeof v === 'string' && v.length > 0)
            );
            const currentCountry = geoData.country_code || geoData.country || null;
            if (currentCountry && countries.size > 0 && !countries.has(currentCountry)) {
              isNewLocation = true;
            }
          } catch (locErr) {
            log.debug('New-location check failed (non-fatal):', locErr.message);
          }
        }

        if (settings.enableEmailAlerts) {
          if (settings.alertOnSuspiciousLogin && isSuspicious) {
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

          if (settings.alertOnNewLocation && isNewLocation) {
            await notificationService.sendNewLocationAlert({
              user,
              session: newSession,
              geoData,
            });
          }
        }

        if (settings.enableWebhooks) {
          const webhookEvent = isSuspicious
            ? 'login.suspicious'
            : isNewLocation
              ? 'login.new_location'
              : 'login.success';

          // Fan out to every configured webhook channel. Each failure is
          // isolated: a broken Slack URL does not stop Discord delivery.
          const targets = [];
          if (settings.discordWebhookUrl) {
            targets.push({
              url: settings.discordWebhookUrl,
              payload: notificationService.formatDiscordWebhook({
                event: webhookEvent,
                session: newSession,
                user,
                geoData,
              }),
            });
          }
          if (settings.slackWebhookUrl) {
            targets.push({
              url: settings.slackWebhookUrl,
              payload: notificationService.formatSlackWebhook({
                event: webhookEvent,
                session: newSession,
                user,
                geoData,
              }),
            });
          }

          await Promise.allSettled(
            targets.map((t) =>
              notificationService.sendWebhook({
                event: webhookEvent,
                data: t.payload,
                webhookUrl: t.url,
              })
            )
          );
        }
      } catch (notifErr) {
        log.warn('Notification failed:', notifErr.message);
      }
    } catch (err) {
      log.error('[ERROR] Error creating session:', err);
    }
  });

  log.info('[SUCCESS] Login interceptor middleware mounted');
}

/**
 * Refresh-token interceptor.
 *
 * NOTE ON APPLICABILITY:
 *   Strapi's default users-permissions plugin does NOT ship a
 *   POST /api/auth/refresh endpoint. This middleware only does something
 *   when a refresh-token plugin (e.g. strapi-plugin-jwt-refresh) or a
 *   custom controller is installed that exposes that route. Otherwise
 *   the middleware is a pure passthrough — mounting it unconditionally
 *   is safe and prepares the installation for future refresh-token
 *   support without requiring a second plugin install/restart cycle.
 *
 * Responsibilities when a refresh endpoint IS present:
 *   1. Block incoming requests whose refreshToken does not match an
 *      active session (defence against stale/stolen refresh tokens).
 *   2. After a successful refresh, atomically rotate the stored token +
 *      refreshToken hashes on the session so the new JWT can be
 *      validated by magicSessionAwareVerify.
 *
 * @param {{strapi: object, log: object}} deps
 */
function mountRefreshTokenInterceptor({ strapi, log }) {
  strapi.server.use(async (ctx, next) => {
    const isRefreshToken = ctx.path === '/api/auth/refresh' && ctx.method === 'POST';

    if (isRefreshToken) {
      try {
        const body = ctx.request.body;
        const refreshToken = typeof body?.refreshToken === 'string' ? body.refreshToken : null;

        if (refreshToken) {
          const refreshTokenHashValue = hashToken(refreshToken);
          const matchingSession = await strapi.documents(SESSION_UID).findFirst({
            filters: {
              refreshTokenHash: refreshTokenHashValue,
              isActive: true,
            },
            fields: ['documentId'],
          });

          if (!matchingSession) {
            log.warn('[BLOCKED] Blocked refresh token request - no active session');
            ctx.status = 401;
            ctx.body = {
              error: {
                status: 401,
                name: 'UnauthorizedError',
                message: 'Session terminated. Please login again.',
              }
            };
            return;
          }
          log.info(`[SUCCESS] Refresh token allowed for session ${matchingSession.documentId}`);
        }
      } catch (err) {
        log.error('Error checking refresh token:', err);
      }
    }

    await next();

    if (isRefreshToken && ctx.status === 200 && ctx.body && ctx.body.jwt) {
      try {
        const body = ctx.request.body;
        const oldRefreshToken = typeof body?.refreshToken === 'string' ? body.refreshToken : null;
        const newAccessToken = ctx.body.jwt;
        const newRefreshToken = ctx.body.refreshToken;

        if (!oldRefreshToken) return;

        const oldRefreshTokenHash = hashToken(oldRefreshToken);
        const matchingSession = await strapi.documents(SESSION_UID).findFirst({
          filters: {
            refreshTokenHash: oldRefreshTokenHash,
            isActive: true,
          },
          fields: ['documentId', 'token', 'tokenHash', 'refreshToken', 'refreshTokenHash'],
        });

        if (!matchingSession) return;

        const encryptedToken = newAccessToken ? encryptToken(newAccessToken) : matchingSession.token;
        const encryptedRefreshToken = newRefreshToken ? encryptToken(newRefreshToken) : matchingSession.refreshToken;
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
      } catch (err) {
        log.error('Error updating refreshed tokens:', err);
      }
    }
  });

  log.info('[SUCCESS] Refresh token interceptor middleware mounted');
}

/**
 * Auto-enables Content-API permissions for authenticated users so plugin
 * endpoints are reachable out-of-the-box. Uses a one-time marker in the plugin
 * store so admins who explicitly revoke permissions don't get them
 * re-enabled on every restart.
 *
 * @param {object} strapi - Strapi instance
 * @param {object} log - Logger instance
 */
async function ensureContentApiPermissions(strapi, log) {
  // Bump this when the list of required actions changes so existing
  // installations pick up the new permissions on next boot. Storing a
  // version (not a boolean) also lets us back out a bad migration by
  // decrementing the stored value manually.
  const PERMISSIONS_VERSION = 2;

  try {
    const pluginStore = strapi.store({ type: 'plugin', name: 'magic-sessionmanager' });
    const storedVersion = await pluginStore.get({ key: 'contentApiPermissionsVersion' });

    // Legacy rollout (boolean flag pre-v2) — treat as version 1.
    if (storedVersion === undefined) {
      const legacyFlag = await pluginStore.get({ key: 'contentApiPermissionsInitialized' });
      if (legacyFlag === true) {
        await pluginStore.set({ key: 'contentApiPermissionsVersion', value: 1 });
      }
    }

    const effectiveVersion = await pluginStore.get({ key: 'contentApiPermissionsVersion' });
    if (effectiveVersion >= PERMISSIONS_VERSION) {
      log.debug('Content-API permissions already at current version (skipping auto-setup)');
      return;
    }

    const ROLE_UID = 'plugin::users-permissions.role';
    const PERMISSION_UID = 'plugin::users-permissions.permission';

    // Document Service replaces the deprecated entityService (Strapi v5).
    // We still need the numeric `id` of the role for the permission's
    // `role` relation because users-permissions Permission stores the
    // foreign key by numeric id, not documentId.
    const roles = await strapi.documents(ROLE_UID).findMany({
      filters: { type: 'authenticated' },
      fields: ['id'],
      limit: 1,
    });

    const authenticatedRole = roles?.[0];

    if (!authenticatedRole) {
      log.warn('Authenticated role not found - skipping permission setup');
      return;
    }

    const requiredActions = [
      'plugin::magic-sessionmanager.session.logout',
      'plugin::magic-sessionmanager.session.logoutAll',
      'plugin::magic-sessionmanager.session.logoutOthers',
      'plugin::magic-sessionmanager.session.getOwnSessions',
      'plugin::magic-sessionmanager.session.getUserSessions',
      'plugin::magic-sessionmanager.session.getCurrentSession',
      'plugin::magic-sessionmanager.session.terminateOwnSession',
    ];

    const existingPermissions = await strapi.documents(PERMISSION_UID).findMany({
      filters: {
        role: authenticatedRole.id,
        action: { $in: requiredActions },
      },
      fields: ['action'],
      limit: requiredActions.length,
    });

    const existingActions = existingPermissions.map(p => p.action);
    const missingActions = requiredActions.filter(action => !existingActions.includes(action));

    if (missingActions.length === 0) {
      await pluginStore.set({ key: 'contentApiPermissionsVersion', value: PERMISSIONS_VERSION });
      log.debug('Content-API permissions already configured');
      return;
    }

    for (const action of missingActions) {
      await strapi.documents(PERMISSION_UID).create({
        data: { action, role: authenticatedRole.id },
      });
      log.info(`[PERMISSION] Enabled ${action} for authenticated users`);
    }

    await pluginStore.set({ key: 'contentApiPermissionsVersion', value: PERMISSIONS_VERSION });
    log.info('[SUCCESS] Content-API permissions configured for authenticated users');
  } catch (err) {
    log.warn('Could not auto-configure permissions:', err.message);
    log.warn('Please manually enable plugin permissions in Settings > Users & Permissions > Roles > Authenticated');
  }
}

/**
 * Creates a composite DB index on (tokenHash, isActive) for O(1) session lookup.
 * Safe to call repeatedly — existing indexes are skipped.
 *
 * @param {object} strapi - Strapi instance
 * @param {object} log - Logger instance
 */
async function ensureTokenHashIndex(strapi, log) {
  try {
    const knex = strapi.db.connection;
    const tableName = 'magic_sessions';
    const indexName = 'idx_magic_sessions_token_hash';

    const hasIndex = await knex.schema.hasTable(tableName).then(async (exists) => {
      if (!exists) return false;
      const dialect = strapi.db.dialect.client;

      if (dialect === 'postgres') {
        const result = await knex.raw(
          'SELECT indexname FROM pg_indexes WHERE tablename = ? AND indexname = ?',
          [tableName, indexName]
        );
        return result.rows.length > 0;
      } else if (dialect === 'mysql' || dialect === 'mysql2') {
        const result = await knex.raw('SHOW INDEX FROM ?? WHERE Key_name = ?', [tableName, indexName]);
        return result[0].length > 0;
      } else if (dialect === 'sqlite' || dialect === 'better-sqlite3') {
        const result = await knex.raw(
          "SELECT name FROM sqlite_master WHERE type='index' AND name = ?",
          [indexName]
        );
        return result.length > 0;
      }

      return false;
    });

    if (hasIndex) {
      log.debug('[INDEX] tokenHash index already exists');
      return;
    }

    await knex.schema.alterTable(tableName, (table) => {
      table.index(['token_hash', 'is_active'], indexName);
    });

    log.info('[INDEX] Created tokenHash index for O(1) session lookup');
  } catch (err) {
    log.debug('[INDEX] Could not create tokenHash index (will retry on next startup):', err.message);
  }
}

/**
 * Error counter for the fail-open safety net. Resets after a short quiet period
 * and disables fail-open mode entirely once too many consecutive errors occur
 * to prevent flooding-based security bypass.
 */
const sessionCheckErrors = { count: 0, lastReset: Date.now() };
const MAX_CONSECUTIVE_ERRORS = 10;
const ERROR_RESET_INTERVAL = 60 * 1000;

/**
 * Tracks a session check error and returns whether we should still fail-open.
 * @returns {boolean} true to allow the request, false to block
 */
function shouldFailOpen() {
  const now = Date.now();

  if (now - sessionCheckErrors.lastReset > ERROR_RESET_INTERVAL) {
    sessionCheckErrors.count = 0;
    sessionCheckErrors.lastReset = now;
  }

  sessionCheckErrors.count++;

  if (sessionCheckErrors.count > MAX_CONSECUTIVE_ERRORS) {
    return false;
  }

  return true;
}

/** Resets the fail-open counter after a successful session check. */
function resetErrorCounter() {
  sessionCheckErrors.count = 0;
}

/**
 * Returns true if a session has exceeded its maximum age.
 * @param {object} session
 * @param {number} maxAgeDays
 * @returns {boolean}
 */
function isSessionExpired(session, maxAgeDays = 30) {
  if (!session.loginTime) return false;
  const loginTime = new Date(session.loginTime).getTime();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  return (Date.now() - loginTime) > maxAgeMs;
}

/**
 * Wraps the users-permissions JWT verify function with session-awareness.
 *
 * After verifying the JWT cryptographically, this wrapper:
 *   1. Rejects the request if the matching session was manually terminated.
 *   2. Rejects the request if the session exceeded maxSessionAgeDays.
 *   3. Rejects the request if the user has `blocked: true`.
 *   4. In `strictSessionEnforcement` mode, rejects if no session matches the
 *      token hash. In non-strict mode, it also rejects if the user has zero
 *      active sessions — but allows through if the user has ANY active session
 *      matching this exact tokenHash.
 *
 * This wrapper is idempotent: it can be called multiple times in hot-reload
 * scenarios without double-wrapping the verify function.
 *
 * @param {object} strapi
 * @param {object} log
 */
async function registerSessionAwareAuthStrategy(strapi, log) {
  try {
    const usersPermissionsPlugin = strapi.plugin('users-permissions');

    // These two conditions are both FATAL for the plugin's purpose: without a
    // wrappable JWT verify, we cannot enforce server-side session revocation.
    // We still return instead of throwing so the rest of the plugin (admin
    // UI, settings) keeps working, but we log at ERROR so ops notices.
    if (!usersPermissionsPlugin) {
      strapi.log.error(
        '[magic-sessionmanager] [AUTH] users-permissions plugin not found — ' +
        'session revocation will NOT be enforced. Install @strapi/plugin-users-permissions.'
      );
      return;
    }

    const jwtService = usersPermissionsPlugin.service('jwt');

    if (!jwtService || !jwtService.verify) {
      strapi.log.error(
        '[magic-sessionmanager] [AUTH] users-permissions JWT service has no .verify method — ' +
        'API surface changed. Session revocation will NOT be enforced until the plugin is updated.'
      );
      return;
    }

    if (jwtService[JWT_WRAPPED_FLAG] === true) {
      strapi.log.debug('[magic-sessionmanager] [AUTH] JWT verify already wrapped, skipping');
      return;
    }

    const originalVerify = jwtService.verify.bind(jwtService);

    strapi.log.info('[magic-sessionmanager] [AUTH] Wrapping JWT verify function...');

    jwtService.verify = async function magicSessionAwareVerify(token) {
      const decoded = await originalVerify(token);

      if (!decoded || !decoded.id) {
        return decoded;
      }

      let settings;
      try {
        settings = await getPluginSettings(strapi);
      } catch {
        settings = strapi.config.get('plugin::magic-sessionmanager') || {};
      }

      const strictMode = settings.strictSessionEnforcement === true;
      const maxSessionAgeDays = settings.maxSessionAgeDays || 30;
      // Grace period: the login interceptor writes the Session record AFTER
      // ctx.body has already left the server. A client that fires its next
      // authenticated request within a few hundred ms may beat the write.
      // Without this window, strictSessionEnforcement would reject the JWT
      // as "no matching session" even though a session is being created.
      // Configurable; defaults to 5s which comfortably covers DB commit +
      // network RTT on most stacks.
      const gracePeriodMs = Math.max(
        0,
        Number(settings.sessionCreationGraceMs) || 5000
      );

      try {
        const userDocId = await resolveUserDocumentId(strapi, decoded.id);

        if (!userDocId) {
          strapi.log.debug('[magic-sessionmanager] [JWT] No documentId found, allowing through');
          return decoded;
        }

        try {
          const userRecord = await strapi.documents('plugin::users-permissions.user').findOne({
            documentId: userDocId,
            fields: ['documentId', 'blocked'],
          });
          if (userRecord && userRecord.blocked === true) {
            strapi.log.info(
              `[magic-sessionmanager] [JWT-BLOCKED] User is blocked (user: ${userDocId.substring(0, 8)}...)`
            );
            setSessionRejectionReason(hashToken(token), 'blocked');
            return null;
          }
        } catch {
          // Ignore user lookup errors and continue to session check
        }

        const tokenHashValue = hashToken(token);

        const thisSession = await strapi.documents(SESSION_UID).findFirst({
          filters: {
            user: { documentId: userDocId },
            tokenHash: tokenHashValue,
          },
          fields: ['documentId', 'isActive', 'terminatedManually', 'terminationReason', 'lastActive', 'loginTime'],
        });

        if (thisSession) {
          if (isSessionExpired(thisSession, maxSessionAgeDays)) {
            strapi.log.info(
              `[magic-sessionmanager] [JWT-EXPIRED] Session exceeded max age of ${maxSessionAgeDays} days (user: ${userDocId.substring(0, 8)}...)`
            );
            await strapi.documents(SESSION_UID).update({
              documentId: thisSession.documentId,
              data: {
                isActive: false,
                terminatedManually: false,
                terminationReason: 'expired',
                logoutTime: new Date(),
              },
            });
            setSessionRejectionReason(tokenHashValue, 'expired');
            return null;
          }

          // Terminated session — surface the real reason to the caller so
          // the client can show "You were logged out" vs "Your session
          // expired due to inactivity" vs "Your account was blocked".
          if (thisSession.isActive === false) {
            const reason =
              thisSession.terminationReason ||
              (thisSession.terminatedManually === true ? 'manual' : null);

            if (reason) {
              strapi.log.info(
                `[magic-sessionmanager] [JWT-REJECTED] Session inactive (reason: ${reason}) for user ${userDocId.substring(0, 8)}...`
              );
              setSessionRejectionReason(tokenHashValue, reason);
              return null;
            }
          }

          if (thisSession.isActive) {
            resetErrorCounter();
            return decoded;
          }

          // Inactive-but-no-reason (legacy rows from pre-terminationReason
          // cleanup, or rare races) can still be reactivated, but only if
          // the inactivity window has not elapsed. Otherwise the cleanup
          // job's purpose (idle logout) would be silently defeated.
          const inactivityTimeout = settings.inactivityTimeout || 15 * 60 * 1000;
          const lastActiveMs = thisSession.lastActive
            ? new Date(thisSession.lastActive).getTime()
            : thisSession.loginTime
              ? new Date(thisSession.loginTime).getTime()
              : 0;
          const idleFor = Date.now() - lastActiveMs;

          if (idleFor > inactivityTimeout) {
            strapi.log.info(
              `[magic-sessionmanager] [JWT-IDLE] Session too idle to reactivate (${Math.round(idleFor / 1000)}s > ${inactivityTimeout / 1000}s) for user ${userDocId.substring(0, 8)}...`
            );
            await strapi.documents(SESSION_UID).update({
              documentId: thisSession.documentId,
              data: {
                terminatedManually: false,
                terminationReason: 'idle',
                logoutTime: new Date(),
              },
            });
            setSessionRejectionReason(tokenHashValue, 'idle');
            return null;
          }

          await strapi.documents(SESSION_UID).update({
            documentId: thisSession.documentId,
            data: { isActive: true, lastActive: new Date() },
          });
          strapi.log.info(
            `[magic-sessionmanager] [JWT-REACTIVATED] Session reactivated for user ${userDocId.substring(0, 8)}...`
          );
          resetErrorCounter();
          return decoded;
        }

        // JWT has no matching session record. Before blocking, honor the
        // grace period: if the JWT was issued within the last `gracePeriodMs`
        // the login interceptor's DB write may simply not be visible yet.
        // `iat` is seconds-since-epoch per RFC 7519.
        if (gracePeriodMs > 0 && typeof decoded.iat === 'number') {
          const issuedMs = decoded.iat * 1000;
          const ageMs = Date.now() - issuedMs;
          if (ageMs >= 0 && ageMs < gracePeriodMs) {
            strapi.log.debug(
              `[magic-sessionmanager] [JWT-GRACE] New JWT (age ${ageMs}ms) inside grace window — allowing`
            );
            resetErrorCounter();
            return decoded;
          }
        }

        if (strictMode) {
          strapi.log.info(
            `[magic-sessionmanager] [JWT-BLOCKED] No session matches this token (user: ${userDocId.substring(0, 8)}..., strictMode)`
          );
          return null;
        }

        strapi.log.warn(
          `[magic-sessionmanager] [JWT-WARN] No session matches this token for user ${userDocId.substring(0, 8)}... (non-strict: allowing)`
        );
        resetErrorCounter();
        return decoded;

      } catch (err) {
        if (shouldFailOpen()) {
          strapi.log.warn('[magic-sessionmanager] [JWT] Session check error (allowing):', err.message);
          return decoded;
        }
        strapi.log.error('[magic-sessionmanager] [JWT] Too many consecutive errors, blocking request:', err.message);
        return null;
      }
    };

    jwtService.verify[JWT_WRAPPED_FLAG] = true;
    jwtService[JWT_WRAPPED_FLAG] = true;

    strapi.log.info('[magic-sessionmanager] [AUTH] [SUCCESS] JWT verify wrapped with session validation');

  } catch (err) {
    strapi.log.warn('[magic-sessionmanager] [AUTH] Could not wrap JWT verify:', err.message);
    strapi.log.warn('[magic-sessionmanager] [AUTH] Session validation will only work via middleware (plugin endpoints)');
  }
}
