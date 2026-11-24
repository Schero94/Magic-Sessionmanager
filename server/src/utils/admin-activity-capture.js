'use strict';

// @ts-check

/**
 * Captures admin panel sign-ins and Content Manager activity.
 *
 * Sign-ins (Strapi 5.63, `@strapi/admin`):
 * - `admin.auth.success` ({ user, provider }) - emitted by the login
 *   controller for local and SSO sign-ins
 *   (`dist/server/server/src/controllers/authentication.js`). It is the event
 *   behind the documented `admin.auth.events.onConnectionSuccess` config
 *   callback (docs: Configurations > Admin panel > Authentication).
 * - `admin.auth.error` ({ error, provider, reason, user? }) - failed sign-in;
 *   Strapi itself resolves `user` only when the typed email belongs to an
 *   existing admin (`audit-logs/auth.js`, the `onConnectionError` callback).
 *   The plugin stores that id and the reason code, never the typed email,
 *   the password or the request body.
 * - `admin.logout` ({ user }) - sign-out from the admin panel.
 * - The request behind an event comes from `strapi.requestContext.get()`
 *   (Strapi's AsyncLocalStorage around every request,
 *   `@strapi/core/dist/services/request-context.js`), for the client IP,
 *   user agent and device id.
 * - One server middleware sees what emits no event: a sign-in rejected by
 *   Strapi's `admin::rateLimit` with 429 (recorded as a lockout), and the
 *   sessions created by the first-admin registration, an invited admin's
 *   registration and a password reset.
 *
 * Content Manager activity: the same middleware looks at the matched route
 * after the handler ran (`ctx.state.route`, set by Strapi's endpoint composer)
 * and records successful Content Manager calls of an admin
 * (`ctx.state.user`) that open, create, edit, publish, unpublish, discard,
 * clone or delete an entry. List views, counts and configuration calls are
 * not activity.
 *
 * Nothing here awaits a database write: the service queues and flushes in
 * the background, so a request is not slowed down.
 */

const {
  SECURITY_EVENTS,
  describeContentManagerRequest,
  handlerName,
  safeReason,
} = require('./security-log-model');
const { getRequestIp, getRequestUserAgent } = require('./admin-request-info');
const { resolveSecurityLogSettings } = require('./security-log-settings');
const { getPluginSettings, peekCachedSettings } = require('./settings-loader');

const SERVICE = 'security-log';
const AUTH_HANDLERS = Object.freeze({
  login: 'authentication.login',
  registerAdmin: 'authentication.registerAdmin',
  register: 'authentication.register',
  resetPassword: 'authentication.resetPassword',
});
const SESSION_CREATING = Object.freeze({
  [AUTH_HANDLERS.registerAdmin]: 'registration',
  [AUTH_HANDLERS.register]: 'registration',
  [AUTH_HANDLERS.resetPassword]: 'password_reset',
});

/**
 * Current feature switches without awaiting. Before the first settings load
 * (or right after a change) it answers "maybe" and starts a reload; the
 * background flush then decides with fresh settings.
 *
 * @param {any} strapi Strapi instance.
 * @returns {ReturnType<typeof resolveSecurityLogSettings>|null} Switches, or null when unknown.
 */
function peekSwitches(strapi) {
  const cached = peekCachedSettings();
  if (!cached) {
    getPluginSettings(strapi).catch(() => {});
    return null;
  }
  return resolveSecurityLogSettings(cached);
}

/**
 * Device id the admin panel sent with the request (a random UUID per
 * browser). Read as one bounded string field; the rest of the body is not
 * read.
 *
 * @param {any} ctx Koa context.
 * @returns {string|null} Device id.
 */
function bodyDeviceId(ctx) {
  const value = ctx?.request?.body?.deviceId;
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null;
}

/**
 * Request facts of the current request, if there is one.
 *
 * @param {any} strapi Strapi instance.
 * @returns {{ip: string|null, userAgent: string|null, deviceId: string|null}} Facts.
 */
function currentRequestFacts(strapi) {
  const ctx = currentContext(strapi);
  return {
    ip: ctx ? getRequestIp(ctx) : null,
    userAgent: ctx ? getRequestUserAgent(ctx) : null,
    deviceId: ctx ? bodyDeviceId(ctx) : null,
  };
}

/**
 * The Koa context of the request that emitted an event, if any.
 *
 * @param {any} strapi Strapi instance.
 * @returns {any|null} Context.
 */
function currentContext(strapi) {
  try {
    return strapi.requestContext?.get?.() || null;
  } catch {
    return null;
  }
}

/**
 * Typed email of the current sign-in request, bounded. Only handed to the
 * security log to look up an existing admin; it is never stored or logged.
 *
 * @param {any} ctx Koa context.
 * @returns {string|null} Email or null.
 */
function attemptedEmailOf(ctx) {
  const email = ctx?.request?.body?.email;
  return typeof email === 'string' && email.length <= 254 ? email : null;
}

/**
 * Creates the Koa middleware. It runs the request first and only then looks
 * at the matched route; errors are re-thrown unchanged.
 *
 * @param {any} strapi Strapi instance.
 * @param {() => any} getService Returns the admin-activity service.
 * @returns {(ctx: any, next: () => Promise<any>) => Promise<any>} Middleware.
 */
function createCaptureMiddleware(strapi, getService) {
  return async function adminActivityCapture(ctx, next) {
    let thrown = null;
    let result;
    try {
      result = await next();
    } catch (error) {
      thrown = error;
    }
    try {
      const route = ctx.state?.route;
      const plugin = route?.info?.pluginName;
      if (plugin === 'content-manager') {
        if (!thrown) observeContentManager(strapi, getService, ctx, route);
      } else if (plugin === 'admin') {
        observeAuthentication(strapi, getService, ctx, route, thrown);
      }
    } catch {
      // Capture must never change the response.
    }
    if (thrown) throw thrown;
    return result;
  };
}

/**
 * Records a successful Content Manager call of an admin.
 *
 * @param {any} strapi Strapi instance.
 * @param {() => any} getService Service getter.
 * @param {any} ctx Koa context after the handler.
 * @param {any} route Matched route.
 * @returns {void}
 */
function observeContentManager(strapi, getService, ctx, route) {
  const adminId = ctx.state?.user?.id;
  const strategy = ctx.state?.auth?.strategy?.name;
  if (adminId === undefined || (strategy !== 'admin' && strategy !== 'admin-token')) return;
  const switches = peekSwitches(strapi);
  if (switches && !switches.content) return;
  const entry = describeContentManagerRequest({
    status: ctx.status,
    route,
    params: ctx.params,
    query: ctx.query,
    requestBody: ctx.request?.body,
    responseBody: ctx.body,
  });
  if (!entry) return;
  getService()?.recordContentAction({ ...entry, adminUserId: adminId });
}

/**
 * Records what the auth events do not cover: lockouts (429 from
 * `admin::rateLimit`) and sessions created by registration or password reset.
 *
 * @param {any} strapi Strapi instance.
 * @param {() => any} getService Service getter.
 * @param {any} ctx Koa context after the handler.
 * @param {any} route Matched route.
 * @param {unknown} thrown Error thrown downstream, if any.
 * @returns {void}
 */
function observeAuthentication(strapi, getService, ctx, route, thrown) {
  const name = handlerName(route?.handler);
  if (!name || !(name === AUTH_HANDLERS.login || name in SESSION_CREATING)) return;
  const switches = peekSwitches(strapi);
  if (switches && !switches.signIns) return;
  const error = /** @type {any} */ (thrown);
  const status = error
    ? error.name === 'RateLimitError'
      ? 429
      : Number(error.status) || 500
    : Number(ctx.status);
  const facts = {
    ip: getRequestIp(ctx),
    userAgent: getRequestUserAgent(ctx),
    deviceId: bodyDeviceId(ctx),
  };
  if (name === AUTH_HANDLERS.login) {
    if (status !== 429) return;
    getService()?.record({
      event: SECURITY_EVENTS.ADMIN_LOCKOUT,
      actorType: 'admin',
      targetType: 'admin',
      // Resolved to an existing admin in the background, then dropped.
      attemptedEmail: attemptedEmailOf(ctx),
      meta: { reason: 'rate_limited', provider: 'local' },
      ...facts,
    });
    return;
  }
  if (status < 200 || status >= 300) return;
  const userId = ctx.body?.data?.user?.id;
  if (userId === undefined) return;
  getService()?.record({
    event: SECURITY_EVENTS.ADMIN_SIGN_IN,
    actorType: 'admin',
    actorId: userId,
    targetType: 'admin',
    targetId: userId,
    meta: { reason: /** @type {any} */ (SESSION_CREATING)[name], provider: 'local' },
    ...facts,
    // A password reset gives the browser a new device id server-side.
    deviceId: name === AUTH_HANDLERS.resetPassword ? null : facts.deviceId,
  });
}

/**
 * Installs the event listeners, the middleware, the admin-deletion hook and
 * the daily retention job. Returns the function that removes them again
 * (the Koa middleware stays mounted but becomes a no-op).
 *
 * @param {any} strapi Strapi instance.
 * @param {{log: {warn: Function, info: Function, debug: Function},
 *   runExclusive?: (name: string, ms: number, job: () => Promise<void>) => Promise<void>}} options
 *   Logger and an optional cluster lease runner for the retention job.
 * @returns {() => Promise<void>} Uninstall.
 * @sideeffect Subscribes to the event hub and database lifecycles, mounts a server middleware,
 *   adds a cron job.
 */
function installAdminActivityCapture(strapi, { log, runExclusive }) {
  const getService = () => {
    const service = strapi.plugin('magic-sessionmanager')?.service(SERVICE);
    return service && !service.isStopped() ? service : null;
  };
  /** @type {Array<() => void>} */
  const cleanups = [];

  const on = (event, listener) => {
    const off = strapi.eventHub?.on?.(event, (payload) => {
      try {
        listener(payload);
      } catch {
        // A listener error must not reach Strapi's login.
      }
    });
    if (typeof off === 'function') cleanups.push(off);
  };

  on('admin.auth.success', (payload) => {
    const switches = peekSwitches(strapi);
    if (switches && !switches.signIns) return;
    const id = payload?.user?.id;
    getService()?.record({
      event: SECURITY_EVENTS.ADMIN_SIGN_IN,
      actorType: 'admin',
      actorId: id,
      targetType: 'admin',
      targetId: id,
      meta: { provider: safeReason(payload?.provider) || 'local' },
      ...currentRequestFacts(strapi),
    });
  });

  on('admin.auth.error', (payload) => {
    const switches = peekSwitches(strapi);
    if (switches && !switches.signIns) return;
    // Strapi 5.58+ sets `user` only when the typed email belongs to an
    // existing admin. Older versions (5.50) send no user: then the typed
    // email is resolved to an existing admin in the background, never stored.
    const id = payload?.user?.id ?? null;
    getService()?.record({
      event: SECURITY_EVENTS.ADMIN_SIGN_IN_FAILED,
      actorType: 'admin',
      actorId: id,
      targetType: 'admin',
      targetId: id,
      ...(id === null
        ? { attemptedEmail: attemptedEmailOf(currentContext(strapi)), actorFromEmail: true }
        : {}),
      meta: {
        reason: safeReason(payload?.reason) || 'invalid_credentials',
        provider: safeReason(payload?.provider) || 'local',
      },
      ...currentRequestFacts(strapi),
    });
  });

  on('admin.logout', (payload) => {
    const switches = peekSwitches(strapi);
    if (switches && !switches.signIns) return;
    const id = payload?.user?.id;
    getService()?.record({
      event: SECURITY_EVENTS.ADMIN_SIGN_OUT,
      actorType: 'admin',
      actorId: id,
      targetType: 'admin',
      targetId: id,
      ...currentRequestFacts(strapi),
    });
  });

  strapi.server.use(createCaptureMiddleware(strapi, getService));

  // Deleting an admin deletes what was recorded about them. Strapi deletes
  // admins one by one through the Query Engine (`services/user.js`
  // deleteById / deleteByIds), so `afterDelete` sees every deletion.
  try {
    const unsubscribe = strapi.db.lifecycles.subscribe({
      models: ['admin::user'],
      async afterDelete(event) {
        const id = event?.result?.id;
        if (id === undefined) return;
        try {
          await strapi.plugin('magic-sessionmanager').service(SERVICE).deleteAdminData(id);
        } catch (err) {
          log.warn(
            '[security-log] Data of a deleted admin could not be removed:',
            err?.name || 'Error'
          );
        }
      },
    });
    if (typeof unsubscribe === 'function') cleanups.push(unsubscribe);
  } catch (err) {
    log.warn('[security-log] Could not watch admin deletions:', err?.name || 'Error');
  }

  const jobName = 'magic-sessionmanager-security-log-retention';
  const retention = async () => {
    const job = async () => {
      const service = strapi.plugin('magic-sessionmanager').service(SERVICE);
      const removed = await service.cleanup();
      if (removed.expired || removed.orphans) {
        log.info(
          `[security-log] Retention removed ${removed.expired} expired events and ${removed.orphans} of deleted admins`
        );
      }
    };
    try {
      if (runExclusive) await runExclusive('job:security-log-retention', 23 * 60 * 60 * 1000, job);
      else await job();
    } catch (err) {
      log.warn('[security-log] Retention failed:', err?.name || 'Error');
    }
  };
  try {
    strapi.cron.add({ [jobName]: { task: retention, options: { rule: '17 3 * * *' } } });
    cleanups.push(() => strapi.cron.remove(jobName));
  } catch (err) {
    log.warn('[security-log] Retention job could not be scheduled:', err?.name || 'Error');
  }

  return async () => {
    for (const cleanup of cleanups.splice(0)) {
      try {
        cleanup();
      } catch {
        // keep removing the others
      }
    }
    try {
      await strapi.plugin('magic-sessionmanager')?.service(SERVICE)?.stop();
    } catch {
      // nothing left to write
    }
  };
}

module.exports = {
  createCaptureMiddleware,
  installAdminActivityCapture,
  observeAuthentication,
  observeContentManager,
};
