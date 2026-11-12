'use strict';

/**
 * Notices every Users & Permissions session that Strapi creates while a
 * request runs, whichever code created it.
 *
 * The login and refresh interceptors in `bootstrap.js` link sessions that
 * Strapi's own auth routes create. Other code can create native sessions as
 * well: a custom auth controller on another path, the GraphQL `login` and
 * `register` mutations, or another plugin that calls
 * `strapi.sessionManager('users-permissions').generateRefreshToken()` or the
 * refresh-mode `jwt.issue()`. Those sessions used to stay without a Magic
 * session row.
 *
 * A database lifecycle subscriber on `admin::session` records the
 * `sessionId` and `userId` of each new active Users & Permissions row on the
 * Koa context of the request that created it. The request context comes from
 * `strapi.requestContext.get()`, which Strapi binds to every HTTP request
 * with AsyncLocalStorage. After the response is ready, the interceptor links
 * the recorded sessions whose access token is in the response, or revokes
 * them when it fails the request closed.
 *
 * Nothing is recorded outside a request (cron jobs, scripts) and admin-panel
 * sessions (origin `admin`) are ignored. Tokens and user data are never
 * logged.
 *
 * Docs: Strapi 5 lifecycle hooks, programmatic `strapi.db.lifecycles.subscribe`
 * (docs.strapi.io/cms/backend-customization/models#lifecycle-hooks); request
 * context `strapi.requestContext.get()`
 * (docs.strapi.io/cms/backend-customization/requests-responses). Installed
 * 5.61.0: `@strapi/core/dist/services/request-context.js`,
 * `@strapi/database/dist/lifecycles/index.js`.
 */

const NATIVE_SESSION_UID = 'admin::session';
const NATIVE_ORIGIN = 'users-permissions';

/** Key on `ctx.state` holding the sessions created during the request. */
const CREATED_STATE_KEY = '__magicSessionNativeCreated';

/** Upper bound of recorded sessions per request. */
const MAX_RECORDED_PER_REQUEST = 20;

/** Largest string response body that is parsed when looking for a token. */
const MAX_PARSED_BODY_BYTES = 256 * 1024;

/** Most access-token candidates checked in one response. */
const MAX_TOKEN_CANDIDATES = 10;

/**
 * Records one created native session on the current request, if any.
 *
 * @param {object} strapi
 * @param {object} row The created `admin::session` row (lifecycle `event.result`).
 * @returns {boolean} Whether the session was recorded.
 */
function recordCreatedNativeSession(strapi, row) {
  if (!row || row.origin !== NATIVE_ORIGIN || row.status !== 'active') return false;
  if (typeof row.sessionId !== 'string' || !row.sessionId) return false;
  if (row.userId == null || row.userId === '') return false;

  let ctx;
  try {
    ctx = strapi?.requestContext?.get?.();
  } catch {
    return false;
  }
  if (!ctx || typeof ctx !== 'object' || !ctx.state || typeof ctx.state !== 'object') {
    return false;
  }

  const list = Array.isArray(ctx.state[CREATED_STATE_KEY]) ? ctx.state[CREATED_STATE_KEY] : [];
  if (list.length >= MAX_RECORDED_PER_REQUEST) return false;
  list.push({ sessionId: row.sessionId, userId: String(row.userId) });
  ctx.state[CREATED_STATE_KEY] = list;
  return true;
}

/**
 * Subscribes to native session creation. Call once in bootstrap; call the
 * returned function in destroy.
 *
 * @param {object} strapi
 * @returns {() => void} Unsubscribe function (no-op when not subscribed).
 * @sideeffect Registers a database lifecycle subscriber.
 */
function subscribeNativeSessionCreation(strapi) {
  const lifecycles = strapi?.db?.lifecycles;
  if (!lifecycles || typeof lifecycles.subscribe !== 'function') return () => {};
  if (!strapi?.contentTypes?.[NATIVE_SESSION_UID]) return () => {};

  const unsubscribe = lifecycles.subscribe({
    models: [NATIVE_SESSION_UID],
    afterCreate(event) {
      try {
        recordCreatedNativeSession(strapi, event?.result);
      } catch {
        // Recording is diagnostic only; it must never fail Strapi's write.
      }
    },
  });
  return typeof unsubscribe === 'function' ? unsubscribe : () => {};
}

/**
 * Native sessions created during this request.
 *
 * @param {object} ctx Koa context.
 * @returns {Array<{sessionId: string, userId: string}>}
 */
function getCreatedNativeSessions(ctx) {
  const list = ctx?.state?.[CREATED_STATE_KEY];
  return Array.isArray(list) ? list.slice() : [];
}

/**
 * Whether a value is a promise-like object.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isThenable(value) {
  return Boolean(value) && typeof value === 'object' && typeof value.then === 'function';
}

/**
 * Reads a JSON response body as an object. String bodies (GraphQL responses
 * are serialised before this middleware resumes) are parsed when they are
 * small enough; buffers and streams are not read.
 *
 * @param {unknown} body `ctx.body`.
 * @returns {object|null}
 */
function readJsonBody(body) {
  if (body && typeof body === 'object' && !Buffer.isBuffer(body) && !isStream(body)) return body;
  if (typeof body !== 'string' || body.length === 0) return null;
  if (Buffer.byteLength(body, 'utf8') > MAX_PARSED_BODY_BYTES) return null;
  const first = body.trimStart()[0];
  if (first !== '{') return null;
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} value
 * @returns {boolean}
 */
function isStream(value) {
  return typeof value.pipe === 'function';
}

/**
 * Collects access-token candidates from a response body: the REST shape
 * `{ jwt }` and the GraphQL shape `{ data: { <mutation>: { jwt } } }`.
 *
 * @param {unknown} body `ctx.body`.
 * @returns {string[]} Up to ten candidate strings.
 */
function findAccessTokenCandidates(body) {
  const json = readJsonBody(body);
  if (!json) return [];
  const candidates = [];
  const add = (value) => {
    if (typeof value === 'string' && value.length > 0 && value.length <= 8192) {
      if (!candidates.includes(value)) candidates.push(value);
    }
  };
  add(json.jwt);
  const data = json.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const value of Object.values(data)) {
      if (candidates.length >= MAX_TOKEN_CANDIDATES) break;
      if (value && typeof value === 'object' && !Array.isArray(value)) add(value.jwt);
    }
  }
  return candidates.slice(0, MAX_TOKEN_CANDIDATES);
}

/**
 * Revokes native sessions created during this request, for example when the
 * plugin fails a login closed after Strapi already created the session.
 * Only sessions recorded on this request are touched.
 *
 * @param {{ctx: object, nativeSessionManager: object, log: object, except?: string|null}} params
 * @returns {Promise<number>} Number of sessions revoked.
 * @sideeffect Deletes native `admin::session` rows through Strapi's API.
 */
async function revokeCreatedNativeSessions({ ctx, nativeSessionManager, log, except = null }) {
  let revoked = 0;
  for (const created of getCreatedNativeSessions(ctx)) {
    if (except && created.sessionId === except) continue;
    try {
      if (await nativeSessionManager.revokeSessionById(created.userId, created.sessionId)) {
        revoked += 1;
      }
    } catch (err) {
      log?.error?.('[AUTH-COMPENSATION] Native session revocation failed:', err?.name || 'Error');
    }
  }
  return revoked;
}

module.exports = {
  CREATED_STATE_KEY,
  MAX_RECORDED_PER_REQUEST,
  MAX_PARSED_BODY_BYTES,
  recordCreatedNativeSession,
  subscribeNativeSessionCreation,
  getCreatedNativeSessions,
  findAccessTokenCandidates,
  revokeCreatedNativeSessions,
  isThenable,
};
