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
const {
  getPluginSettings,
  getSessionCreationGraceMs,
} = require('./utils/settings-loader');
const { extractBearerToken } = require('./utils/extract-token');
const {
  setSessionRejectionReason,
  consumeSessionRejectionReason,
} = require('./utils/rejection-cache');
const { evaluateGeoFirewall } = require('./utils/geo-firewall');
const { REVOCATION_UID } = require('./utils/session-revocation');
const { getNativeSessionManager } = require('./utils/native-session-manager');
const { CONTENT_API_PERMISSIONS_VERSION } = require('./utils/content-api-permissions');
const {
  classifyJwtIssuingRequest,
  isFailedLoginTrackedPath,
  shouldRunPreAuthGeoGuard,
} = require('./utils/auth-routes');
const {
  getRefreshCookieName,
  getIncomingRefreshToken,
  getOutgoingRefreshToken,
  stripAuthTokensFromResponse,
} = require('./utils/refresh-token');

const SESSION_UID = 'plugin::magic-sessionmanager.session';

const JWT_WRAPPED_FLAG = Symbol.for('magic-sessionmanager.jwt.wrapped');
const deferredContentApiPermissionSetup = new WeakMap();

async function getRequestSettings(strapi, ctx) {
  let settings = {};
  try {
    settings = await getPluginSettings(strapi);
  } catch {
    settings = {};
  }

  if (ctx && ctx.state) {
    ctx.state.__magicSessionSettings = settings;
  }

  return settings;
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
    log.error('[BOOTSTRAP] Encryption self-check failed:', e?.name || 'Error');
    throw e;
  }

  try {
    await ensureSessionLookupIndexes(strapi, log);

    await registerSessionAwareAuthStrategy(strapi, log);

    const licenseGuardService = strapi.plugin('magic-sessionmanager').service('license-guard');
    await licenseGuardService.initialize();
    log.info('[SUCCESS] Session Manager active - all features are available without a license key');

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
      log.warn('Initial cleanup failed:', cleanupErr?.name || 'Error');
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
          log.error('Periodic cleanup error:', err?.name || 'Error');
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
          log.error('Retention cleanup error:', err?.name || 'Error');
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

    mountRefreshTokenInterceptor({ strapi, log, sessionService });

    mountLogoutInterceptor({ strapi, log, sessionService });

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

    const contentApiPermissionsReady = await ensureContentApiPermissions(strapi, log);
    mountDeferredContentApiPermissionRetry({
      strapi,
      log,
      initiallyReady: contentApiPermissionsReady,
    });

    log.info('[SUCCESS] Bootstrap complete');
    log.info('[READY] Session Manager ready! Sessions stored in plugin::magic-sessionmanager.session');

  } catch (err) {
    log.error('[ERROR] Bootstrap error:', err?.name || 'Error');
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
    if (!shouldRunPreAuthGeoGuard(ctx.path, ctx.method)) {
      return next();
    }

    const settings = await getRequestSettings(strapi, ctx);

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
      const decision = evaluateGeoFirewall(settings, geoData);

      if (decision.blocked) {
        log.warn(`[PRE-BLOCKED] Login rejected (${decision.reason})`);
        ctx.status = 403;
        ctx.body = {
          error: {
            status: 403,
            name: 'ForbiddenError',
            message: decision.reason?.startsWith('geo_lookup_unavailable:')
              ? 'Login temporarily unavailable. Please contact support.'
              : 'Login blocked for security reasons. Please contact support.',
          },
        };
        ctx.state.__magicSessionGeoData = geoData;
        return;
      }

      if (decision.status === 'ok') {
        ctx.state.__magicSessionGeoData = geoData;
      }
    } catch (err) {
      const failureDecision = evaluateGeoFirewall(settings, { _status: 'error' });
      if (failureDecision.blocked) {
        log.warn('[PRE-BLOCKED] Login rejected because GeoIP lookup failed');
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
      log.debug('Pre-login geo guard error (allowing by configured policy):', err?.name || 'Error');
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
  if (hasRegisteredRoute(strapi, 'POST', '/api/auth/logout')) {
    log.debug('[LOGOUT] Using the users-permissions logout route');
    return;
  }

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

        try {
          decoded = await jwtService.verify(token);
        } catch (verifyErr) {
          const isExpired = verifyErr?.name === 'TokenExpiredError' || /expired/i.test(verifyErr?.message || '');
          if (isExpired && jwt) {
            try {
              const jwtSecret = strapi.config.get('plugin::users-permissions.jwtSecret');
              if (jwtSecret) {
                decoded = jwt.verify(token, jwtSecret, { ignoreExpiration: true });
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

        const userDocumentId = await resolveUserDocumentId(strapi, decoded.id);
        if (!userDocumentId) {
          ctx.status = 401;
          ctx.body = { error: { status: 401, name: 'UnauthorizedError', message: 'Invalid token' } };
          return;
        }

        await sessionService.terminateAuthenticatedSession({
          userDocumentId,
          accessToken: token,
          refreshToken: null,
        });

        ctx.status = 200;
        ctx.body = { ok: true, message: 'Logged out successfully' };
      } catch (err) {
        log.error('Logout error:', err?.name || 'Error');
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

function hasRegisteredRoute(strapi, method, path) {
  try {
    const apiPrefix = strapi.config.get('api.rest.prefix', '/api');
    const directRoutes = strapi.server.listRoutes?.() || [];
    const contentRoutes = strapi.server.api?.('content-api')?.listRoutes?.() || [];

    return [...directRoutes, ...contentRoutes].some((route) => {
      const methods = route.methods || (Array.isArray(route.method) ? route.method : [route.method]);
      const routePaths = new Set([
        route.path,
        route.path?.startsWith(apiPrefix) ? route.path : `${apiPrefix}${route.path}`,
      ]);
      return routePaths.has(path) &&
        methods.some((value) => String(value).toUpperCase() === method);
    });
  } catch {
    return false;
  }
}

function failClosedAuthResponse({ ctx, strapi, log, operation, error }) {
  stripAuthTokensFromResponse(ctx, getRefreshCookieName(strapi));
  ctx.status = 503;
  if (typeof ctx.set === 'function') ctx.set('Retry-After', '1');
  ctx.body = {
    error: {
      status: 503,
      name: 'ServiceUnavailableError',
      message: 'Authentication temporarily unavailable. Please try again.',
    },
  };
  log.error(`[AUTH-FAIL-CLOSED] ${operation}:`, error?.name || 'Error');
}

/**
 * Returns whether Users & Permissions owns token lifecycle for this request.
 * This reads configuration only and never resolves the origin during bootstrap.
 *
 * @param {object} strapi
 * @returns {boolean}
 */
function usesNativeRefreshSessions(strapi) {
  return strapi.config.get('plugin::users-permissions.jwtManagement', 'legacy-support') === 'refresh';
}

/**
 * Validates a newly issued refresh token and resolves its canonical owner and
 * native session ID before Magic writes a metadata sidecar.
 *
 * @param {{strapi: object, nativeSessionManager: object, refreshToken: string, user?: object}} params
 * @returns {Promise<{userId: string, userDocumentId: string, sessionId: string}>}
 * @throws {Error} If the token, owner, or native session cannot be resolved.
 */
async function resolveNativeRefreshSession({ strapi, nativeSessionManager, refreshToken, user }) {
  if (!refreshToken) throw new Error('native auth response contains no refresh token');

  const validation = await nativeSessionManager.validateRefreshToken(refreshToken);
  if (!validation?.isValid || !validation.userId || !validation.sessionId) {
    throw new Error('new native refresh token could not be validated');
  }

  const userId = String(validation.userId);
  if (user?.id != null && String(user.id) !== userId) {
    throw new Error('native refresh token owner does not match the authentication response');
  }

  const resolvedUserDocumentId = await resolveUserDocumentId(strapi, userId);
  if (user?.documentId && resolvedUserDocumentId && user.documentId !== resolvedUserDocumentId) {
    throw new Error('native refresh token owner does not match the authentication response');
  }
  const userDocumentId = resolvedUserDocumentId || user?.documentId;
  if (!userDocumentId) throw new Error('native refresh token owner has no resolvable user documentId');

  return { userId, userDocumentId, sessionId: String(validation.sessionId) };
}

/**
 * Best-effort compensation for a native session whose Magic sidecar could not
 * be persisted. Only the exact newly issued session is revoked.
 *
 * @param {{nativeSessionManager: object, nativeSession: object, log: object}} params
 * @returns {Promise<void>}
 */
async function compensateNativeSession({ nativeSessionManager, nativeSession, log }) {
  if (!nativeSession?.userId || !nativeSession?.sessionId) return;

  try {
    const revoked = await nativeSessionManager.revokeSessionById(
      String(nativeSession.userId),
      String(nativeSession.sessionId)
    );
    if (!revoked) log.warn('[AUTH-COMPENSATION] Newly issued native session was already absent');
  } catch (err) {
    // Do not include token material or opaque native API error payloads here.
    log.error('[AUTH-COMPENSATION] Native session revocation failed:', err?.name || 'Error');
  }
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
    if (!isFailedLoginTrackedPath(ctx.path, ctx.method)) return next();

    const settings = await getRequestSettings(strapi, ctx);
    const maxFailed = Number(settings.maxFailedLogins) || 0;
    if (maxFailed <= 0) return next();

    const ip = getClientIp(ctx);
    if (!ip || ip === 'unknown') return next();

    const now = Date.now();
    const existing = failed.get(ip);
    if (existing && existing.blockedUntil > now) {
      const retrySec = Math.ceil((existing.blockedUntil - now) / 1000);
      ctx.set('Retry-After', String(retrySec));
      log.warn(`[LOCKOUT] Rejected login from locked client (${retrySec}s remaining)`);
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
          `[LOCKOUT] Client locked for 15min after ${entry.count} failed login attempts`
        );
      }
    }
  });

  log.info('[SUCCESS] Failed-login lockout middleware mounted');
}

/**
 * After a successful login/MFA/OTP, creates a Magic metadata sidecar for the
 * issued session. Native refresh mode validates Strapi's refresh token and
 * links its session ID; legacy mode keeps the existing token behavior.
 * Geo-blocking already happened in `mountPreLoginGeoGuard`.
 *
 * @param {{strapi: object, log: object, sessionService: object}} deps
 */
function mountLoginInterceptor({ strapi, log, sessionService }) {
  strapi.server.use(async (ctx, next) => {
    const requestType = classifyJwtIssuingRequest(ctx.path, ctx.method);
    const previousAccessToken = requestType === 'rotate-current' ? extractBearerToken(ctx) : null;
    const nativeMode = usesNativeRefreshSessions(strapi);
    await next();

    if (requestType !== 'new-session' && requestType !== 'rotate-current') return;
    if (ctx.status < 200 || ctx.status >= 300) return;
    if (!ctx.body || !ctx.body.jwt) return;

    const refreshCookieName = getRefreshCookieName(strapi);

    if (requestType === 'rotate-current') {
      if (nativeMode) {
        let nativeSessionManager;
        let nativeSession;
        try {
          if (!previousAccessToken) throw new Error('current access token is missing');
          nativeSessionManager = getNativeSessionManager(strapi);
          const newRefreshToken = getOutgoingRefreshToken(ctx, refreshCookieName);
          nativeSession = await resolveNativeRefreshSession({
            strapi,
            nativeSessionManager,
            refreshToken: newRefreshToken,
            user: ctx.body.user || ctx.state?.user,
          });

          const matchingSession = await strapi.documents(SESSION_UID).findFirst({
            filters: { tokenHash: hashToken(previousAccessToken), isActive: true },
            fields: ['documentId'],
          });

          if (matchingSession) {
            const rotated = await sessionService.rotateSessionTokens({
              sessionId: matchingSession.documentId,
              expectedAccessToken: previousAccessToken,
              accessToken: ctx.body.jwt,
              refreshToken: newRefreshToken,
              nativeSessionId: nativeSession.sessionId,
            });
            if (!rotated) throw new Error('current sidecar changed before native password rotation was linked');
            log.info('[PASSWORD] Native session link updated');
          } else {
            const userAgent = ctx.request.headers?.['user-agent'] || 'unknown';
            const createdSidecar = await sessionService.createSession({
              userId: nativeSession.userDocumentId,
              ip: getClientIp(ctx),
              userAgent,
              token: ctx.body.jwt,
              refreshToken: newRefreshToken,
              geoData: ctx.state?.__magicSessionGeoData || null,
              nativeSessionId: nativeSession.sessionId,
            });
            if (!createdSidecar?.documentId) {
              throw new Error('native password-change sidecar creation returned no documentId');
            }
          }
        } catch (err) {
          if (nativeSessionManager && nativeSession) {
            await compensateNativeSession({ nativeSessionManager, nativeSession, log });
          }
          failClosedAuthResponse({
            ctx,
            strapi,
            log,
            operation: 'native change-password sidecar synchronization failed',
            error: err,
          });
        }
        return;
      }

      try {
        if (!previousAccessToken) throw new Error('current access token is missing');
        const matchingSession = await strapi.documents(SESSION_UID).findFirst({
          filters: {
            tokenHash: hashToken(previousAccessToken),
            isActive: true,
          },
          fields: ['documentId'],
        });
        if (!matchingSession) throw new Error('current session was not found');

        const rotated = await sessionService.rotateSessionTokens({
          sessionId: matchingSession.documentId,
          expectedAccessToken: previousAccessToken,
          accessToken: ctx.body.jwt,
          refreshToken: getOutgoingRefreshToken(ctx, refreshCookieName),
        });
        if (!rotated) throw new Error('current session changed before token rotation');
        log.info('[PASSWORD] Legacy session tokens rotated');
      } catch (err) {
        failClosedAuthResponse({ ctx, strapi, log, operation: 'change-password rotation failed', error: err });
      }
      return;
    }

    let nativeSessionManager;
    let nativeSession;
    try {
      const user = ctx.body.user;
      if (!user) throw new Error('authentication response contains no user');
      await getRequestSettings(strapi, ctx);
      const ip = getClientIp(ctx);
      const headers = ctx.request.headers || ctx.request.header || {};
      const userAgent = headers['user-agent'] || 'unknown';

      log.info('[CHECK] Login detected; creating end-user session metadata');

      let userDocId;
      if (nativeMode) {
        nativeSessionManager = getNativeSessionManager(strapi);
        nativeSession = await resolveNativeRefreshSession({
          strapi,
          nativeSessionManager,
          refreshToken: getOutgoingRefreshToken(ctx, refreshCookieName),
          user,
        });
        userDocId = nativeSession.userDocumentId;
      } else {
        userDocId = user.documentId;
        if (!userDocId && user.id) {
          userDocId = await resolveUserDocumentId(strapi, user.id);
        }
      }

      if (!userDocId) {
        throw new Error(`could not resolve documentId for user ${user.id || 'unknown'}`);
      }

      const geoData = ctx.state?.__magicSessionGeoData || null;

      const newSession = await sessionService.createSession({
        userId: userDocId,
        ip,
        userAgent,
        token: ctx.body.jwt,
        refreshToken: getOutgoingRefreshToken(ctx, refreshCookieName),
        geoData,
        ...(nativeSession ? { nativeSessionId: nativeSession.sessionId } : {}),
      });

      if (!newSession?.documentId) {
        throw new Error(`session creation returned no documentId for user ${userDocId}`);
      }

      log.info('[SUCCESS] End-user session metadata created');

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
        // "New" is defined as never having seen this country before. We
        // swallow lookup errors because this is purely informational alerting.
        let isNewLocation = false;
        if (settings.alertOnNewLocation && (geoData.country_code || geoData.country)) {
          try {
            const normalizeCountryToken = (value) => {
              if (typeof value !== 'string') return null;
              const normalized = value.trim().toUpperCase();
              return normalized.length > 0 ? normalized : null;
            };

            const countryTokensFromGeo = (rawGeo) => {
              let parsedGeo = rawGeo;
              if (typeof rawGeo === 'string') {
                try {
                  parsedGeo = JSON.parse(rawGeo);
                } catch {
                  parsedGeo = null;
                }
              }

              if (!parsedGeo || typeof parsedGeo !== 'object') return [];

              return [parsedGeo.country_code, parsedGeo.country]
                .map(normalizeCountryToken)
                .filter(Boolean);
            };

            const previousSessions = await strapi.documents(SESSION_UID).findMany({
              filters: {
                user: { documentId: userDocId },
                documentId: { $ne: newSession.documentId },
              },
              fields: ['geoLocation'],
              sort: { loginTime: 'desc' },
              limit: 50,
            });

            const previousCountries = new Set(
              (previousSessions || []).flatMap((session) => countryTokensFromGeo(session.geoLocation))
            );
            const currentCountries = countryTokensFromGeo(geoData);

            if (
              currentCountries.length > 0 &&
              previousCountries.size > 0 &&
              !currentCountries.some((country) => previousCountries.has(country))
            ) {
              isNewLocation = true;
            }
          } catch (locErr) {
            log.debug('New-location check failed (non-fatal):', locErr?.name || 'Error');
          }
        }

        if (settings.enableEmailAlerts) {
          if (settings.alertOnVpnProxy && (geoData.isVpn || geoData.isProxy)) {
            await notificationService.sendVpnProxyAlert({
              user,
              session: newSession,
              reason: {
                isVpn: geoData.isVpn,
                isProxy: geoData.isProxy,
              },
              geoData,
            });
          }

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
        log.warn('Notification failed:', notifErr?.name || 'Error');
      }
    } catch (err) {
      if (nativeSessionManager && nativeSession) {
        await compensateNativeSession({ nativeSessionManager, nativeSession, log });
      }
      failClosedAuthResponse({ ctx, strapi, log, operation: 'session creation failed', error: err });
    }
  });

  log.info('[SUCCESS] Login interceptor middleware mounted');
}

/**
 * Synchronizes successful refreshes with Magic metadata without taking
 * ownership of Strapi's native token rotation. Legacy mode requires an active
 * Magic sidecar; native mode lets Strapi validate pre-existing sessions even
 * when no sidecar exists, then links the rotated child after success.
 *
 * @param {{strapi: object, log: object, sessionService: object}} deps
 */
function mountRefreshTokenInterceptor({ strapi, log, sessionService }) {
  strapi.server.use(async (ctx, next) => {
    const isRefreshToken = ctx.path === '/api/auth/refresh' && ctx.method === 'POST';
    if (!isRefreshToken) return next();

    const cookieName = getRefreshCookieName(strapi);
    const oldRefreshToken = getIncomingRefreshToken(ctx, cookieName);
    const nativeMode = usesNativeRefreshSessions(strapi);
    const nativeSessionManager = nativeMode ? getNativeSessionManager(strapi) : null;
    let matchingSession = null;
    let nativeInputValidation = null;

    try {
      if (oldRefreshToken) {
        if (nativeMode) {
          // Validate the origin on the request path, but leave invalid-token
          // decisions and all rotation to Strapi's own refresh controller.
          nativeInputValidation = await nativeSessionManager.validateRefreshToken(oldRefreshToken);
        }

        matchingSession = await strapi.documents(SESSION_UID).findFirst({
          filters: {
            refreshTokenHash: hashToken(oldRefreshToken),
            ...(!nativeMode ? { isActive: true } : {}),
          },
          fields: ['documentId', 'isActive', 'nativeSessionId'],
        });

        if (nativeMode && matchingSession && matchingSession.isActive === false) {
          log.warn('[BLOCKED] Blocked refresh token request for an inactive Magic sidecar');
          ctx.status = 401;
          ctx.body = {
            error: {
              status: 401,
              name: 'UnauthorizedError',
              message: 'Session terminated. Please login again.',
            },
          };
          return;
        }

        if (!nativeMode && !matchingSession) {
          log.warn('[BLOCKED] Blocked refresh token request - no active session');
          ctx.status = 401;
          ctx.body = {
            error: {
              status: 401,
              name: 'UnauthorizedError',
              message: 'Session terminated. Please login again.',
            },
          };
          return;
        }
      }
    } catch (err) {
      failClosedAuthResponse({ ctx, strapi, log, operation: 'refresh validation failed', error: err });
      return;
    }

    await next();

    if (ctx.status >= 200 && ctx.status < 300 && ctx.body && ctx.body.jwt) {
      if (nativeMode) {
        let nativeSession;
        try {
          const newRefreshToken = getOutgoingRefreshToken(ctx, cookieName);
          nativeSession = await resolveNativeRefreshSession({
            strapi,
            nativeSessionManager,
            refreshToken: newRefreshToken,
          });

          if (
            nativeInputValidation?.isValid &&
            String(nativeInputValidation.userId) !== nativeSession.userId
          ) {
            throw new Error('rotated native refresh token changed its owner');
          }

          if (matchingSession) {
            const rotated = await sessionService.rotateSessionTokens({
              sessionId: matchingSession.documentId,
              expectedRefreshToken: oldRefreshToken,
              accessToken: ctx.body.jwt,
              refreshToken: newRefreshToken,
              nativeSessionId: nativeSession.sessionId,
            });
            if (!rotated) throw new Error('current sidecar changed before native refresh was linked');
            log.info('[REFRESH] Native session link updated');
          } else {
            const userAgent = ctx.request.headers?.['user-agent'] || 'unknown';
            const createdSidecar = await sessionService.createSession({
              userId: nativeSession.userDocumentId,
              ip: getClientIp(ctx),
              userAgent,
              token: ctx.body.jwt,
              refreshToken: newRefreshToken,
              geoData: ctx.state?.__magicSessionGeoData || null,
              nativeSessionId: nativeSession.sessionId,
            });
            if (!createdSidecar?.documentId) {
              throw new Error('native refresh sidecar creation returned no documentId');
            }
          }
        } catch (err) {
          if (nativeSession) {
            await compensateNativeSession({ nativeSessionManager, nativeSession, log });
          }
          failClosedAuthResponse({
            ctx,
            strapi,
            log,
            operation: 'native refresh sidecar synchronization failed',
            error: err,
          });
        }
        return;
      }

      try {
        if (!oldRefreshToken || !matchingSession) {
          throw new Error('refresh response issued without a tracked input token');
        }
        const rotated = await sessionService.rotateSessionTokens({
          sessionId: matchingSession.documentId,
          expectedRefreshToken: oldRefreshToken,
          accessToken: ctx.body.jwt,
          refreshToken: getOutgoingRefreshToken(ctx, cookieName),
        });
        if (!rotated) throw new Error('refresh token was already consumed');
        log.info('[REFRESH] Legacy session tokens refreshed');
      } catch (err) {
        failClosedAuthResponse({ ctx, strapi, log, operation: 'refresh rotation failed', error: err });
      }
    }
  });

  log.info('[SUCCESS] Refresh token interceptor middleware mounted');
}

/**
 * Synchronizes a successful Users & Permissions logout with the authenticated
 * user's Magic sidecar. In native mode, Strapi has already revoked the native
 * session before this middleware resumes, so no second native revoke is sent.
 *
 * @param {{strapi: object, log: object, sessionService: object}} deps
 * @returns {void}
 */
function mountLogoutInterceptor({ strapi, log, sessionService }) {
  strapi.server.use(async (ctx, next) => {
    if (ctx.path !== '/api/auth/logout' || ctx.method !== 'POST') return next();

    const refreshToken = getIncomingRefreshToken(ctx, getRefreshCookieName(strapi));
    const accessToken = extractBearerToken(ctx);
    const nativeMode = usesNativeRefreshSessions(strapi);
    const jwtManagement = strapi.config.get('plugin::users-permissions.jwtManagement', 'legacy-support');

    await next();

    const isUsersPermissionsLogoutRoute =
      ctx.state?.route?.handler === 'auth.logout' &&
      ctx.state?.route?.info?.pluginName === 'users-permissions';
    const isSuccessful =
      isUsersPermissionsLogoutRoute &&
      ctx.status >= 200 &&
      ctx.status < 300;
    const isLegacyMissingRoute =
      jwtManagement === 'legacy-support' &&
      ctx.status === 404 &&
      isUsersPermissionsLogoutRoute;
    const authenticatedUser = ctx.state?.user;

    if (!authenticatedUser || (!isSuccessful && !isLegacyMissingRoute)) return;

    try {
      if (nativeMode) {
        const nativeSessionId = ctx.state?.session?.id;
        if (!nativeSessionId) throw new Error('authenticated logout has no native session identifier');

        const nativeSessionManager = getNativeSessionManager(strapi);
        const nativeSessionStillActive = await nativeSessionManager.isSessionActive(nativeSessionId);
        if (nativeSessionStillActive) {
          throw new Error('Users & Permissions logout returned success while the native session remains active');
        }
        // Strapi has already revoked this native session. The service call
        // below synchronizes its Magic sidecar without issuing another revoke.
      }

      const userDocumentId = authenticatedUser.documentId ||
        await resolveUserDocumentId(strapi, authenticatedUser.id);

      if (!userDocumentId) {
        throw new Error('authenticated logout user has no resolvable documentId');
      }

      await sessionService.terminateAuthenticatedSession({
        userDocumentId,
        refreshToken,
        accessToken,
      });

      ctx.status = 200;
      ctx.body = {
        ok: true,
        message: 'Logged out successfully',
      };
    } catch (err) {
      failClosedAuthResponse({ ctx, strapi, log, operation: 'logout termination failed', error: err });
    }
  });

  log.info('[SUCCESS] Logout interceptor middleware mounted');
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
    if (effectiveVersion >= CONTENT_API_PERMISSIONS_VERSION) {
      log.debug('Content-API permissions already at current version (skipping auto-setup)');
      return true;
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
      return false;
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
      await pluginStore.set({
        key: 'contentApiPermissionsVersion',
        value: CONTENT_API_PERMISSIONS_VERSION,
      });
      log.debug('Content-API permissions already configured');
      return true;
    }

    for (const action of missingActions) {
      await strapi.documents(PERMISSION_UID).create({
        data: { action, role: authenticatedRole.id },
      });
      log.info(`[PERMISSION] Enabled ${action} for authenticated users`);
    }

    await pluginStore.set({
      key: 'contentApiPermissionsVersion',
      value: CONTENT_API_PERMISSIONS_VERSION,
    });
    log.info('[SUCCESS] Content-API permissions configured for authenticated users');
    return true;
  } catch (err) {
    log.warn('Could not auto-configure permissions:', err?.name || 'Error');
    log.warn('Please manually enable plugin permissions in Settings > Users & Permissions > Roles > Authenticated');
    return false;
  }
}

/**
 * Retries incomplete Authenticated-role permission setup before a Magic
 * Content API route reaches Strapi's route auth and policies. Failed attempts
 * use a cooldown, and the route's existing authentication remains authoritative.
 *
 * @param {{strapi: object, log: object, initiallyReady?: boolean, retryCooldownMs?: number}} deps
 * @returns {void}
 */
function mountDeferredContentApiPermissionRetry({
  strapi,
  log,
  initiallyReady = false,
  retryCooldownMs = 5000,
}) {
  deferredContentApiPermissionSetup.set(strapi, {
    ready: initiallyReady,
    pending: null,
    retryAfter: 0,
  });

  strapi.server.use(async (ctx, next) => {
    const configuredPrefix = strapi.config.get('api.rest.prefix', '/api') ?? '/api';
    const normalizedApiPrefix = String(configuredPrefix)
      .split('/')
      .filter(Boolean)
      .join('/');
    const routePrefix = `${normalizedApiPrefix ? `/${normalizedApiPrefix}` : ''}/magic-sessionmanager`;
    if (ctx.path !== routePrefix && !ctx.path?.startsWith(`${routePrefix}/`)) {
      return next();
    }

    const state = deferredContentApiPermissionSetup.get(strapi);
    if (!state.ready) {
      if (!state.pending && Date.now() >= state.retryAfter) {
        state.pending = ensureContentApiPermissions(strapi, log);
      }

      if (state.pending) {
        const pendingSetup = state.pending;
        try {
          state.ready = await pendingSetup;
          if (!state.ready) state.retryAfter = Date.now() + retryCooldownMs;
        } catch (err) {
          state.retryAfter = Date.now() + retryCooldownMs;
          log.warn('Deferred Content-API permission setup failed:', err?.name || 'Error');
        } finally {
          if (state.pending === pendingSetup) state.pending = null;
        }
      }
    }

    return next();
  });
}

/**
 * Creates composite DB indexes for access- and refresh-token session lookups.
 * Safe to call repeatedly — existing indexes are skipped.
 *
 * @param {object} strapi - Strapi instance
 * @param {object} log - Logger instance
 */
async function ensureSessionLookupIndexes(strapi, log) {
  try {
    const knex = strapi.db.connection;
    const tableName = 'magic_sessions';
    const definitions = [
      { column: 'token_hash', name: 'idx_magic_sessions_token_hash' },
      { column: 'refresh_token_hash', name: 'idx_magic_sessions_refresh_hash' },
    ];

    if (!(await knex.schema.hasTable(tableName))) return;

    for (const definition of definitions) {
      const dialect = strapi.db.dialect.client;
      let hasIndex = false;

      if (dialect === 'postgres') {
        const result = await knex.raw(
          'SELECT indexname FROM pg_indexes WHERE tablename = ? AND indexname = ?',
          [tableName, definition.name]
        );
        hasIndex = result.rows.length > 0;
      } else if (dialect === 'mysql' || dialect === 'mysql2') {
        const result = await knex.raw('SHOW INDEX FROM ?? WHERE Key_name = ?', [tableName, definition.name]);
        hasIndex = result[0].length > 0;
      } else if (dialect === 'sqlite' || dialect === 'better-sqlite3') {
        const result = await knex.raw(
          "SELECT name FROM sqlite_master WHERE type='index' AND name = ?",
          [definition.name]
        );
        hasIndex = result.length > 0;
      }

      if (hasIndex) {
        log.debug(`[INDEX] ${definition.name} already exists`);
        continue;
      }

      await knex.schema.alterTable(tableName, (table) => {
        table.index([definition.column, 'is_active'], definition.name);
      });

      log.info(`[INDEX] Created ${definition.name}`);
    }
  } catch (err) {
    log.debug('[INDEX] Could not create session lookup indexes (will retry on next startup):', err?.name || 'Error');
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
 * After the Users & Permissions verifier succeeds, native refresh mode checks
 * that the embedded Strapi session is still active. The wrapper then applies
 * persistent revocation, user-state, and Magic sidecar policies. Strict mode
 * rejects unresolved users and missing sidecars outside the legacy issuance
 * grace; relaxed mode preserves its configured no-sidecar behavior. A
 * persistent revocation record always blocks.
 *
 * This wrapper is idempotent: it can be called multiple times in hot-reload
 * scenarios without double-wrapping the verify function.
 *
 * @param {object} strapi
 * @param {object} log Strapi logger
 * @returns {Promise<void>}
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

      if (!decoded) return decoded;

      const tokenHashValue = hashToken(token);
      const nativeMode = usesNativeRefreshSessions(strapi);
      if (nativeMode) {
        if (typeof decoded.sessionId !== 'string' || decoded.sessionId.length === 0) {
          setSessionRejectionReason(tokenHashValue, 'manual');
          strapi.log.info('[magic-sessionmanager] [JWT-REJECTED] Native access token has no session identifier');
          return null;
        }

        try {
          const nativeSessionManager = getNativeSessionManager(strapi);
          const nativeSessionActive = await nativeSessionManager.isSessionActive(decoded.sessionId);
          if (!nativeSessionActive) {
            setSessionRejectionReason(tokenHashValue, 'manual');
            strapi.log.info('[magic-sessionmanager] [JWT-REJECTED] Native session is missing or revoked');
            return null;
          }
        } catch (err) {
          setSessionRejectionReason(tokenHashValue, 'manual');
          strapi.log.error(
            '[magic-sessionmanager] [JWT] Native session validation failed closed:',
            err?.name || 'Error'
          );
          return null;
        }
      }

      if (!decoded.id) return decoded;

      let revocation;
      try {
        revocation = await strapi.documents(REVOCATION_UID).findFirst({
          filters: { tokenHash: tokenHashValue },
          fields: ['documentId', 'expiresAt'],
        });
      } catch (err) {
        // A missing or unreadable deny-list must never turn a deleted session
        // back into an accepted JWT, including when enforcement is relaxed.
        strapi.log.error('[magic-sessionmanager] [JWT] Revocation lookup failed; rejecting token:', err?.name || 'Error');
        return null;
      }

      if (revocation) {
        const expiry = revocation.expiresAt ? new Date(revocation.expiresAt).getTime() : null;
        if (expiry === null || !Number.isFinite(expiry) || expiry > Date.now()) {
          setSessionRejectionReason(tokenHashValue, 'manual');
          strapi.log.info('[magic-sessionmanager] [JWT-REJECTED] Token hash is revoked');
          return null;
        }
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
      const gracePeriodMs = nativeMode ? 0 : getSessionCreationGraceMs(settings);

      try {
        const userDocId = await resolveUserDocumentId(strapi, decoded.id);

        if (!userDocId) {
          if (strictMode) {
            strapi.log.warn('[magic-sessionmanager] [JWT] User documentId could not be resolved; rejecting in strict mode');
            return null;
          }
          strapi.log.debug('[magic-sessionmanager] [JWT] No documentId found in relaxed mode');
          return decoded;
        }

        let userRecord;
        try {
          userRecord = await strapi.documents('plugin::users-permissions.user').findOne({
            documentId: userDocId,
            fields: ['documentId', 'blocked'],
          });
        } catch (err) {
          if (strictMode) {
            strapi.log.error('[magic-sessionmanager] [JWT] User lookup failed in strict mode; rejecting token:', err?.name || 'Error');
            return null;
          }
          strapi.log.debug('[magic-sessionmanager] [JWT] User lookup failed in relaxed mode:', err?.name || 'Error');
        }

        if (!userRecord && strictMode) {
          strapi.log.warn('[magic-sessionmanager] [JWT] User record could not be resolved; rejecting in strict mode');
          return null;
        }

        if (userRecord?.blocked === true) {
          strapi.log.info('[magic-sessionmanager] [JWT-BLOCKED] User is blocked');
          setSessionRejectionReason(tokenHashValue, 'blocked');
          return null;
        }

        const thisSession = await strapi.documents(SESSION_UID).findFirst({
          filters: {
            user: { documentId: userDocId },
            tokenHash: tokenHashValue,
            ...(nativeMode ? { nativeSessionId: decoded.sessionId } : {}),
          },
          fields: [
            'documentId',
            'isActive',
            'terminatedManually',
            'terminationReason',
            'lastActive',
            'loginTime',
            ...(nativeMode ? ['nativeSessionId'] : []),
          ],
        });

        if (thisSession) {
          // Preserve an existing terminal reason. A manually terminated
          // session must not later be relabelled as expired merely because it
          // also crossed the maximum-age threshold.
          if (thisSession.isActive === false) {
            const reason =
              thisSession.terminationReason ||
              (thisSession.terminatedManually === true ? 'manual' : null);

            if (reason) {
              strapi.log.info(
                    `[magic-sessionmanager] [JWT-REJECTED] Session inactive (reason: ${reason})`
              );
              setSessionRejectionReason(tokenHashValue, reason);
              return null;
            }
          }

          if (isSessionExpired(thisSession, maxSessionAgeDays)) {
            strapi.log.info(
                  `[magic-sessionmanager] [JWT-EXPIRED] Session exceeded max age of ${maxSessionAgeDays} days`
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

          const inactivityTimeout = settings.inactivityTimeout || 15 * 60 * 1000;
          const lastActiveMs = thisSession.lastActive
            ? new Date(thisSession.lastActive).getTime()
            : thisSession.loginTime
              ? new Date(thisSession.loginTime).getTime()
              : 0;
          const idleFor = Date.now() - lastActiveMs;

          if (idleFor > inactivityTimeout) {
            strapi.log.info(
                  `[magic-sessionmanager] [JWT-IDLE] Session too idle to reactivate (${Math.round(idleFor / 1000)}s > ${inactivityTimeout / 1000}s)`
            );
            await strapi.documents(SESSION_UID).update({
              documentId: thisSession.documentId,
              data: {
                isActive: false,
                terminatedManually: false,
                terminationReason: 'idle',
                logoutTime: new Date(),
              },
            });
            setSessionRejectionReason(tokenHashValue, 'idle');
            return null;
          }

          if (thisSession.isActive) {
            resetErrorCounter();
            return decoded;
          }

          // An inactive legacy row without a reason may be reactivated only
          // while it is still inside the inactivity window.
          await strapi.documents(SESSION_UID).update({
            documentId: thisSession.documentId,
            data: { isActive: true, lastActive: new Date() },
          });
          strapi.log.info(
                '[magic-sessionmanager] [JWT-REACTIVATED] Session reactivated'
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
                '[magic-sessionmanager] [JWT-BLOCKED] No session matches this token (strictMode)'
          );
          return null;
        }

        strapi.log.warn(
              '[magic-sessionmanager] [JWT-WARN] No session matches this token (non-strict: allowing)'
        );
        resetErrorCounter();
        return decoded;

      } catch (err) {
        if (strictMode) {
          strapi.log.error('[magic-sessionmanager] [JWT] Session check failed in strict mode; rejecting token:', err?.name || 'Error');
          return null;
        }
        if (shouldFailOpen()) {
          strapi.log.warn('[magic-sessionmanager] [JWT] Session check error (allowing):', err?.name || 'Error');
          return decoded;
        }
        strapi.log.error('[magic-sessionmanager] [JWT] Too many consecutive errors, blocking request:', err?.name || 'Error');
        return null;
      }
    };

    jwtService.verify[JWT_WRAPPED_FLAG] = true;
    jwtService[JWT_WRAPPED_FLAG] = true;

    strapi.log.info('[magic-sessionmanager] [AUTH] [SUCCESS] JWT verify wrapped with session validation');

  } catch (err) {
        strapi.log.warn('[magic-sessionmanager] [AUTH] Could not wrap JWT verify:', err?.name || 'Error');
    strapi.log.warn('[magic-sessionmanager] [AUTH] Session validation will only work via middleware (plugin endpoints)');
  }
}

module.exports.__private = {
  registerSessionAwareAuthStrategy,
  mountPreLoginGeoGuard,
  mountLoginInterceptor,
  mountRefreshTokenInterceptor,
  mountLogoutInterceptor,
  mountLogoutRoute,
  ensureContentApiPermissions,
  mountDeferredContentApiPermissionRetry,
};
