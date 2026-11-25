'use strict';

// @ts-check

/**
 * Strapi admin panel sessions: who can use the admin panel, who is signed in,
 * and signing an admin out.
 *
 * This module only reads what Strapi itself stores. Strapi 5 keeps admin
 * sessions in `admin::session` (`strapi_sessions`) with `origin = 'admin'`,
 * one `deviceId` per signed-in browser. Every access-token renewal rotates the
 * refresh row: the previous row becomes `rotated` (it is not deleted) and a new
 * `active` row is created, so `createdAt` of the active row is the last time
 * the browser renewed its token. Rows store `metadata.deviceName` (a coarse
 * label such as "Chrome on macOS") and `metadata.loginAt`; no IP address and
 * no raw user agent.
 *
 * Revocation: the admin auth strategy of Strapi 5.62
 * (`@strapi/admin/dist/server/server/src/strategies/admin.js`) calls
 * `sessionManager('admin').isSessionActive(sessionId)` on every request, and
 * `isSessionActive` only checks that the row exists and has not expired. It
 * does not check `status`, so an access token bound to a `rotated` row keeps
 * working until its own expiry if only the active row is deleted. Signing out
 * therefore deletes every row of the browser (`invalidateRefreshToken(userId,
 * deviceId)`, the call Strapi's own logout makes) or of the admin
 * (`invalidateRefreshToken(userId)`), and the admin's next request fails.
 *
 * Admin rows never reach Users & Permissions numbers: those queries filter
 * `origin = 'users-permissions'` (`native-only-insight.js`, `session-list.js`).
 *
 * Docs: https://docs.strapi.io/cms/configurations/admin-panel (Session
 * management); Query Engine https://docs.strapi.io/cms/api/query-engine.
 */

const crypto = require('node:crypto');
const { z } = require('@strapi/utils');
const { hashDeviceId } = require('./admin-request-info');
const { resolveSecurityLogSettings } = require('./security-log-settings');
const { getPluginSettings } = require('./settings-loader');

const ADMIN_ORIGIN = 'admin';
const SESSION_UID = 'admin::session';
const ADMIN_USER_UID = 'admin::user';
const SUPER_ADMIN_CODE = 'strapi-super-admin';

/** Largest page an admin can request. */
const MAX_PAGE_SIZE = 100;
/** Longest accepted search text. */
const MAX_SEARCH_LENGTH = 100;
/** Upper bound of live admin session rows read for one overview. */
const MAX_ACTIVE_ROWS = 10_000;
/** Admin list filters. */
const ADMIN_FILTERS = Object.freeze(['all', 'signed-in', 'not-signed-in']);
/** Delay of the second delete after a sign-out (a refresh that raced the first one). */
const REPEAT_SIGN_OUT_DELAY_MS = 1000;

/**
 * What the caller may see about other admins (4.17, security review F4).
 * Email, name and roles of admins are Strapi's own user data; they are
 * returned only to callers who may read them in Settings > Users
 * (`admin::users.read`). Without it the name and email are empty and the UI
 * shows "Admin #id"; role names are returned when the caller holds
 * `admin::roles.read`.
 *
 * @typedef {{identity: boolean, roles: boolean}} AdminVisibility
 */

/** Full visibility (internal callers and tests). */
const FULL_VISIBILITY = Object.freeze({ identity: true, roles: true });

/**
 * Visibility of the caller, from the ability `admin::hasPermissions` uses.
 *
 * @param {any} ability `ctx.state.userAbility`.
 * @returns {AdminVisibility} Visibility.
 */
function visibilityOf(ability) {
  const can = (action) => {
    try {
      return ability?.can?.(action) === true;
    } catch {
      return false;
    }
  };
  const identity = can('admin::users.read');
  return { identity, roles: identity || can('admin::roles.read') };
}

/**
 * Opaque handle of an admin session for the API (4.17): a SHA-256 of
 * Strapi's `sessionId`, cut to 32 hex characters. The `sessionId` is a claim
 * of the admin's access token; the list no longer returns it. The handle is
 * stable across processes and cannot be turned back into the id.
 *
 * @param {unknown} sessionId Strapi session id.
 * @returns {string} 32 hex characters ('' for a missing id).
 */
function sessionHandle(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) return '';
  return crypto
    .createHash('sha256')
    .update(`magic-sessionmanager:admin-session:${sessionId}`)
    .digest('hex')
    .slice(0, 32);
}

/** Strapi defaults, used when the host does not override them. */
const DEFAULT_POLICY = Object.freeze({
  accessTokenLifespan: 30 * 60,
  idleSessionLifespan: 2 * 60 * 60,
  maxSessionLifespan: 30 * 24 * 60 * 60,
  idleRefreshTokenLifespan: 14 * 24 * 60 * 60,
  maxRefreshTokenLifespan: 30 * 24 * 60 * 60,
});

const listQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
  search: z
    .string()
    .trim()
    .max(MAX_SEARCH_LENGTH, `search must be at most ${MAX_SEARCH_LENGTH} characters`)
    .default(''),
  filter: z.enum(ADMIN_FILTERS).default('all'),
});

const adminParamsSchema = z.strictObject({
  adminId: z.string().regex(/^[1-9][0-9]{0,11}$/, 'adminId must be a positive integer'),
});

const sessionParamsSchema = z.strictObject({
  adminId: z.string().regex(/^[1-9][0-9]{0,11}$/, 'adminId must be a positive integer'),
  // The `id` of a session from the list (an opaque handle since 4.17); a raw
  // Strapi session id is still accepted.
  sessionId: z.string().regex(/^[a-f0-9]{32}$/, 'sessionId must be a session id from the list'),
});

/**
 * Validates input against a schema without echoing values back.
 *
 * @template T
 * @param {import('zod').ZodType<T>} schema Strict zod schema.
 * @param {unknown} input Raw query or params object.
 * @returns {{ok: true, value: T}|{ok: false, errors: Array<{path: string[], message: string}>}}
 *   Parsed value, or one error per invalid field.
 */
function parseInput(schema, input) {
  const result = schema.safeParse(input ?? {});
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => ({
      path: issue.path.map(String),
      message: issue.message,
    })),
  };
}

/**
 * Returns Strapi's admin-origin session manager, or null when this Strapi
 * version has no session manager or no `admin` origin (older 5.x hosts).
 *
 * @param {any} strapi Running Strapi instance.
 * @returns {any|null} `strapi.sessionManager('admin')`, or null.
 */
function getAdminSessionManager(strapi) {
  const manager = strapi?.sessionManager;
  if (typeof manager !== 'function') return null;
  if (typeof manager.hasOrigin === 'function' && !manager.hasOrigin(ADMIN_ORIGIN)) return null;
  if (!strapi?.contentTypes?.[SESSION_UID]) return null;
  try {
    const origin = manager(ADMIN_ORIGIN);
    return origin && typeof origin.invalidateRefreshToken === 'function' ? origin : null;
  } catch {
    return null;
  }
}

/**
 * Admin session lifetimes the host runs with, in seconds. Shown in the UI so
 * every time it states comes from the real configuration.
 *
 * @param {any} strapi Running Strapi instance.
 * @returns {typeof DEFAULT_POLICY} Lifetimes in seconds.
 */
function readSessionPolicy(strapi) {
  const read = (key) => {
    const value = Number(strapi?.config?.get?.(`admin.auth.sessions.${key}`));
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_POLICY[key];
  };
  return {
    accessTokenLifespan: read('accessTokenLifespan'),
    idleSessionLifespan: read('idleSessionLifespan'),
    maxSessionLifespan: read('maxSessionLifespan'),
    idleRefreshTokenLifespan: read('idleRefreshTokenLifespan'),
    maxRefreshTokenLifespan: read('maxRefreshTokenLifespan'),
  };
}

/**
 * Converts a stored date to an ISO string, or null.
 *
 * @param {unknown} value Date, string or nothing.
 * @returns {string|null} ISO 8601 date or null.
 */
function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Query Engine condition for admin session rows Strapi still accepts: origin
 * admin, status active, idle and absolute expiry in the future.
 *
 * @param {Date} now Current time.
 * @returns {object} Query Engine `where`.
 */
function liveSessionWhere(now) {
  return {
    origin: ADMIN_ORIGIN,
    status: 'active',
    expiresAt: { $gt: now },
    $or: [{ absoluteExpiresAt: { $null: true } }, { absoluteExpiresAt: { $gt: now } }],
  };
}

/**
 * Reads live admin session rows, optionally for one admin. Token-free columns
 * only; the session table holds no tokens, but `childId` and row ids are not
 * read either.
 *
 * @param {any} strapi Running Strapi instance.
 * @param {{userId?: string, withMetadata?: boolean, now?: Date}} [options]
 * @returns {Promise<{rows: Array<Record<string, any>>, truncated: boolean}>} Rows, and
 *   whether the overview cap was reached.
 */
async function readLiveRows(strapi, { userId, withMetadata = false, now = new Date() } = {}) {
  const select = ['userId', 'sessionId', 'deviceId', 'type', 'createdAt', 'expiresAt'];
  select.push('absoluteExpiresAt');
  if (withMetadata) select.push('metadata');
  const rows = await strapi.db.query(SESSION_UID).findMany({
    select,
    where: { ...liveSessionWhere(now), ...(userId ? { userId } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    limit: MAX_ACTIVE_ROWS + 1,
  });
  const list = Array.isArray(rows) ? rows : [];
  return { rows: list.slice(0, MAX_ACTIVE_ROWS), truncated: list.length > MAX_ACTIVE_ROWS };
}

/**
 * Groups live rows into signed-in browsers (one per `deviceId`). Strapi signs
 * out per device, so one group is what one "Sign out" ends.
 *
 * @param {Array<Record<string, any>>} rows Live rows of one admin, newest first.
 * @param {string|null} currentDeviceId Device of the caller's own request.
 * @returns {Array<{id: string, device: string|null, signedInAt: string|null,
 *   lastActiveAt: string|null, endsAt: string|null, rememberMe: boolean, current: boolean}>}
 *   Sessions, most recently active first. `id` is the opaque handle of the newest row's
 *   sessionId (see sessionHandle).
 */
function groupSessionsByDevice(rows, currentDeviceId) {
  /** @type {Map<string, any>} */
  const groups = new Map();
  for (const row of rows) {
    const key = String(row.deviceId || row.sessionId);
    const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    const lastActiveAt = toIso(row.createdAt);
    const signedInAt = toIso(metadata.loginAt);
    const idle = toIso(row.expiresAt);
    const absolute = toIso(row.absoluteExpiresAt);
    const endsAt = idle && absolute ? (idle < absolute ? idle : absolute) : idle || absolute;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        id: sessionHandle(String(row.sessionId)),
        device:
          typeof metadata.deviceName === 'string' && metadata.deviceName.trim()
            ? metadata.deviceName.trim().slice(0, 120)
            : null,
        signedInAt,
        lastActiveAt,
        endsAt,
        rememberMe: row.type === 'refresh',
        current: Boolean(currentDeviceId) && key === currentDeviceId,
      });
      continue;
    }
    if (signedInAt && (!existing.signedInAt || signedInAt < existing.signedInAt)) {
      existing.signedInAt = signedInAt;
    }
    if (endsAt && (!existing.endsAt || endsAt > existing.endsAt)) existing.endsAt = endsAt;
    if (row.type === 'refresh') existing.rememberMe = true;
  }
  return [...groups.values()].sort((a, b) =>
    String(b.lastActiveAt || '').localeCompare(String(a.lastActiveAt || ''))
  );
}

/**
 * Account state of an admin user as Strapi enforces it.
 *
 * @param {Record<string, any>} user Admin user row.
 * @returns {'active'|'deactivated'|'invited'} `invited` = registration not finished.
 */
function accountState(user) {
  if (user?.isActive === true && user?.blocked !== true) return 'active';
  if (user?.hasRegistrationToken) return 'invited';
  return 'deactivated';
}

/**
 * Whether an admin user holds the Super Admin role.
 *
 * @param {Record<string, any>|null|undefined} user Admin user with `roles`.
 * @returns {boolean}
 */
function isSuperAdmin(user) {
  return Array.isArray(user?.roles) && user.roles.some((role) => role?.code === SUPER_ADMIN_CODE);
}

/**
 * Display name of an admin: first and last name, else username, else email.
 *
 * @param {Record<string, any>} user Admin user row.
 * @returns {string} Name, at most 200 characters.
 */
function displayName(user) {
  const name = [user?.firstname, user?.lastname]
    .filter((part) => typeof part === 'string' && part.trim())
    .join(' ')
    .trim();
  return (name || user?.username || user?.email || '').slice(0, 200);
}

/**
 * Decides whether `actor` may sign `target` out. The rule is mirrored in the
 * UI, but this function is the enforcement point.
 *
 * - A Super Admin can only be signed out by a Super Admin or by themselves.
 *   Since the actor is a signed-in, active admin, this also means the last
 *   active Super Admin can never be signed out by someone else.
 * - Deactivated or invited accounts have no usable session (Strapi rejects
 *   their requests); there is nothing to sign out.
 *
 * @param {{id: any, roles?: any[]}} actor Signed-in admin.
 * @param {Record<string, any>} target Target admin with `roles`.
 * @returns {null|'super-admin-protected'|'account-inactive'} Null when allowed, else the reason.
 */
function signOutBlockReason(actor, target) {
  if (accountState(target) !== 'active') return 'account-inactive';
  const self = String(actor?.id) === String(target?.id);
  if (!self && isSuperAdmin(target) && !isSuperAdmin(actor)) return 'super-admin-protected';
  return null;
}

/**
 * Loads an admin user with roles and the fields the view needs. Password,
 * reset and registration tokens are not returned (only whether a
 * registration token exists).
 *
 * @param {any} strapi Running Strapi instance.
 * @param {string|number} id Admin user id.
 * @returns {Promise<Record<string, any>|null>} Admin user or null.
 */
async function findAdmin(strapi, id) {
  const user = await strapi.db.query(ADMIN_USER_UID).findOne({
    where: { id: Number(id) },
    select: ['id', 'firstname', 'lastname', 'username', 'email', 'isActive', 'blocked'],
    populate: { roles: { select: ['id', 'name', 'code'] } },
  });
  if (!user) return null;
  const pending = await strapi.db.query(ADMIN_USER_UID).count({
    where: { id: Number(id), registrationToken: { $notNull: true } },
  });
  return { ...user, hasRegistrationToken: Number(pending) > 0 };
}

/**
 * The device of the caller's own request, so the view can mark "This
 * browser" and warn before a self sign-out.
 *
 * @param {any} strapi Running Strapi instance.
 * @param {{userId: string, sessionId?: string|null}} viewer Caller.
 * @returns {Promise<string|null>} Device id, or null.
 */
async function findCurrentDeviceId(strapi, { userId, sessionId }) {
  if (typeof sessionId !== 'string' || !sessionId) return null;
  const row = await strapi.db.query(SESSION_UID).findOne({
    select: ['userId', 'deviceId', 'origin'],
    where: { sessionId },
  });
  if (!row || row.origin !== ADMIN_ORIGIN || String(row.userId) !== String(userId)) return null;
  return typeof row.deviceId === 'string' ? row.deviceId : null;
}

/**
 * Shapes one admin for the list. Allowlisted fields only; name and email
 * are empty and roles an empty list when the caller may not see them.
 *
 * @param {Record<string, any>} user Admin user with roles.
 * @param {{count: number, lastActiveAt: string|null}|undefined} live Live session summary.
 * @param {{id: any, roles?: any[]}} actor Caller.
 * @param {AdminVisibility} [visibility] What the caller may see.
 * @returns {Record<string, any>} Admin row DTO.
 */
function toAdminRow(user, live, actor, visibility = FULL_VISIBILITY) {
  const account = accountState(user);
  const blockReason = signOutBlockReason(actor, user);
  const sessionCount = account === 'active' ? live?.count || 0 : 0;
  const self = String(actor?.id) === String(user.id);
  // Everyone may see their own row.
  const identity = visibility.identity || self;
  return {
    id: Number(user.id),
    name: identity ? displayName(user) : '',
    email: identity && typeof user.email === 'string' ? user.email : '',
    roles:
      identity || visibility.roles
        ? (Array.isArray(user.roles) ? user.roles : []).map((role) => ({
            name: String(role?.name || ''),
            superAdmin: role?.code === SUPER_ADMIN_CODE,
          }))
        : [],
    account,
    self,
    sessionCount,
    lastActiveAt: account === 'active' ? live?.lastActiveAt || null : null,
    canSignOut: blockReason === null && sessionCount > 0,
    protectedReason: blockReason === 'super-admin-protected' ? blockReason : null,
  };
}

/**
 * Summarises live rows per admin: number of signed-in browsers and the latest
 * activity.
 *
 * @param {Array<Record<string, any>>} rows Live rows.
 * @returns {Map<string, {count: number, lastActiveAt: string|null, devices: Set<string>}>}
 */
function summariseByAdmin(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = String(row.userId);
    let entry = map.get(key);
    if (!entry) {
      entry = { count: 0, lastActiveAt: null, devices: new Set() };
      map.set(key, entry);
    }
    const device = String(row.deviceId || row.sessionId);
    if (!entry.devices.has(device)) {
      entry.devices.add(device);
      entry.count += 1;
    }
    const at = toIso(row.createdAt);
    if (at && (!entry.lastActiveAt || at > entry.lastActiveAt)) entry.lastActiveAt = at;
  }
  return map;
}

/**
 * What the security log records about admin sign-ins, for the explanation on
 * the Admin panel view. Booleans only; a store failure reads as "not recorded".
 *
 * @param {any} strapi Running Strapi instance.
 * @returns {Promise<{signIns: boolean, ipAddresses: boolean, anonymizeIp: boolean}>} Flags.
 */
async function readSignInRecording(strapi) {
  try {
    const options = resolveSecurityLogSettings(await getPluginSettings(strapi));
    return {
      signIns: options.signIns,
      ipAddresses: options.signIns && options.storeIp,
      anonymizeIp: options.signIns && options.storeIp && options.anonymizeIp,
    };
  } catch {
    return { signIns: false, ipAddresses: false, anonymizeIp: false };
  }
}

/**
 * One page of admin users with their live session summary, plus count-only
 * statistics over all admins.
 *
 * @param {any} strapi Running Strapi instance.
 * @param {{page: number, pageSize: number, search: string, filter: string}} query Parsed query.
 * @param {{id: any, roles?: any[]}} actor Caller.
 * @param {AdminVisibility} [visibility] What the caller may see (see visibilityOf).
 * @returns {Promise<{data: object[], meta: object}>} Response body; `meta.recording` says
 *   whether sign-ins and IP addresses are recorded (security log settings), `meta.identity`
 *   what the caller may see. Without identity visibility the search matches the admin id
 *   only, and the list is ordered by id.
 */
async function listAdmins(strapi, query, actor, visibility = FULL_VISIBILITY) {
  const identityMeta = {
    names: visibility.identity,
    emails: visibility.identity,
    roles: visibility.roles,
  };
  const policy = readSessionPolicy(strapi);
  if (!getAdminSessionManager(strapi)) {
    return {
      data: [],
      meta: {
        supported: false,
        pagination: { page: 1, pageSize: query.pageSize, total: 0, pageCount: 1 },
        stats: null,
        policy,
        truncated: false,
        recording: await readSignInRecording(strapi),
        identity: identityMeta,
      },
    };
  }

  const users = strapi.db.query(ADMIN_USER_UID);
  const { rows, truncated } = await readLiveRows(strapi);
  const summary = summariseByAdmin(rows);

  // Only active accounts can use a session; the auth strategy rejects others.
  // `blocked` may be NULL on older rows; `$ne: true` would drop those in SQL.
  const activeAccountWhere = {
    isActive: true,
    $or: [{ blocked: false }, { blocked: { $null: true } }],
  };
  const liveIds = [...summary.keys()]
    .filter((id) => /^[0-9]{1,12}$/.test(id))
    .map((id) => Number(id));
  const signedInIds = liveIds.length
    ? (
        await users.findMany({
          select: ['id'],
          where: { id: { $in: liveIds }, ...activeAccountWhere },
        })
      ).map((row) => Number(row.id))
    : [];

  /** @type {any[]} */
  const conditions = [];
  if (query.search && visibility.identity) {
    const text = query.search;
    conditions.push({
      $or: [
        { firstname: { $containsi: text } },
        { lastname: { $containsi: text } },
        { username: { $containsi: text } },
        { email: { $containsi: text } },
      ],
    });
  } else if (query.search) {
    // Names and emails must not be probed by search: only the id matches.
    conditions.push({ id: /^[1-9][0-9]{0,11}$/.test(query.search) ? Number(query.search) : 0 });
  }
  if (query.filter === 'signed-in')
    conditions.push({ id: { $in: signedInIds.length ? signedInIds : [0] } });
  if (query.filter === 'not-signed-in' && signedInIds.length) {
    conditions.push({ id: { $notIn: signedInIds } });
  }
  const where = conditions.length ? { $and: conditions } : {};

  const [total, activeAccounts, totalAdmins, pageRows] = await Promise.all([
    users.count({ where }),
    users.count({ where: activeAccountWhere }),
    users.count({}),
    users.findMany({
      where,
      select: ['id', 'firstname', 'lastname', 'username', 'email', 'isActive', 'blocked'],
      populate: { roles: { select: ['id', 'name', 'code'] } },
      orderBy: visibility.identity
        ? [{ firstname: 'asc' }, { lastname: 'asc' }, { email: 'asc' }, { id: 'asc' }]
        : [{ id: 'asc' }],
      offset: (query.page - 1) * query.pageSize,
      limit: query.pageSize,
    }),
  ]);

  const pageIds = (Array.isArray(pageRows) ? pageRows : []).map((row) => Number(row.id));
  const invited = pageIds.length
    ? new Set(
        (
          await users.findMany({
            select: ['id'],
            where: { id: { $in: pageIds }, registrationToken: { $notNull: true } },
          })
        ).map((row) => Number(row.id))
      )
    : new Set();

  const signedIn = new Set(signedInIds.map(String));
  let activeSessions = 0;
  for (const [id, entry] of summary) if (signedIn.has(id)) activeSessions += entry.count;

  const count = Number(total) || 0;
  return {
    data: (Array.isArray(pageRows) ? pageRows : []).map((user) =>
      toAdminRow(
        { ...user, hasRegistrationToken: invited.has(Number(user.id)) },
        summary.get(String(user.id)),
        actor,
        visibility
      )
    ),
    meta: {
      supported: true,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: count,
        pageCount: Math.max(1, Math.ceil(count / query.pageSize)),
      },
      stats: {
        signedInAdmins: signedInIds.length,
        activeSessions,
        activeAccounts: Number(activeAccounts) || 0,
        totalAdmins: Number(totalAdmins) || 0,
      },
      policy,
      truncated,
      recording: await readSignInRecording(strapi),
      identity: identityMeta,
    },
  };
}

/**
 * Live sessions of one admin, one entry per signed-in browser.
 *
 * @param {any} strapi Running Strapi instance.
 * @param {string} adminId Validated admin id.
 * @param {{id: any, roles?: any[], sessionId?: string|null}} actor Caller.
 * @param {AdminVisibility} [visibility] What the caller may see.
 * @returns {Promise<{data: object[], meta: object}|null>} Response body, or null when the admin does not exist.
 */
async function listAdminSessions(strapi, adminId, actor, visibility = FULL_VISIBILITY) {
  const target = await findAdmin(strapi, adminId);
  if (!target) return null;
  const supported = Boolean(getAdminSessionManager(strapi));
  const adminRow = toAdminRow(target, undefined, actor, visibility);
  if (!supported || adminRow.account !== 'active') {
    return {
      data: [],
      meta: { supported, admin: adminRow, policy: readSessionPolicy(strapi) },
    };
  }
  const currentDeviceId = adminRow.self
    ? await findCurrentDeviceId(strapi, { userId: String(actor.id), sessionId: actor.sessionId })
    : null;
  const { rows } = await readLiveRows(strapi, { userId: String(target.id), withMetadata: true });
  const sessions = groupSessionsByDevice(rows, currentDeviceId);
  const blockReason = signOutBlockReason(actor, target);
  return {
    data: sessions,
    meta: {
      supported,
      admin: {
        ...adminRow,
        sessionCount: sessions.length,
        lastActiveAt: sessions[0]?.lastActiveAt || null,
        canSignOut: blockReason === null && sessions.length > 0,
      },
      policy: readSessionPolicy(strapi),
    },
  };
}

/**
 * Runs the same `invalidateRefreshToken` call once more after a delay, off
 * the request. Failures are logged without details.
 *
 * @param {any} strapi Running Strapi instance.
 * @param {any} manager Admin session manager.
 * @param {string[]} args Arguments of the first call.
 * @param {number} delayMs Delay.
 * @returns {void}
 * @sideeffect Deletes `admin::session` rows a racing refresh created.
 */
function repeatSignOut(strapi, manager, args, delayMs) {
  const timer = setTimeout(
    () => {
      Promise.resolve()
        .then(() => manager.invalidateRefreshToken(...args))
        .catch((err) =>
          strapi.log?.warn?.(
            '[magic-sessionmanager] Repeated admin sign-out failed:',
            err?.name || 'Error'
          )
        );
    },
    Math.max(0, delayMs)
  );
  if (typeof timer.unref === 'function') timer.unref();
}

/**
 * Error raised when a sign-out is not allowed or not possible. The
 * controller maps `status` to the response.
 */
class AdminSignOutError extends Error {
  /**
   * @param {403|404|503} status HTTP status to answer.
   * @param {string} message Fixed, caller-safe message.
   * @param {string} [reason] Machine-readable reason for the UI.
   */
  constructor(status, message, reason) {
    super(message);
    this.name = 'AdminSignOutError';
    this.status = status;
    this.reason = reason || null;
  }
}

/**
 * Signs an admin out of one browser or everywhere by deleting Strapi's
 * session rows. The admin's next request is rejected by Strapi's admin auth
 * strategy (no row, `isSessionActive` false) and the panel cannot renew its
 * token, so it shows the login page.
 *
 * Strapi rotates a refresh row by reading the parent and then creating the
 * child; a refresh that read the parent just before the delete could create
 * a new row right after it. The same delete therefore runs once more about a
 * second later (4.17, hardening of an unconfirmed race).
 *
 * @param {any} strapi Running Strapi instance.
 * @param {{actor: {id: any, roles?: any[], sessionId?: string|null}, adminId: string, sessionId?: string}} input
 *   Caller, validated target admin id and, for one browser, a session handle from the list
 *   (or a raw Strapi session id).
 * @param {{repeatDelayMs?: number}} [options] Delay of the second delete (tests).
 * @returns {Promise<{ended: number, signedOutSelf: boolean, scope: 'one'|'all'}>} Number of
 *   browsers signed out and whether the caller's own browser was among them.
 * @throws {AdminSignOutError} 404 unknown admin or session, 403 guard, 503 no session manager.
 * @sideeffect Deletes `admin::session` rows of the target admin (origin admin only),
 *   writes one audit log line with admin ids and counts (no email, session id or token) and
 *   queues an `admin.session.revoked` security event (actor and target).
 */
async function signOutAdmin(
  strapi,
  { actor, adminId, sessionId },
  { repeatDelayMs = REPEAT_SIGN_OUT_DELAY_MS } = {}
) {
  const manager = getAdminSessionManager(strapi);
  if (!manager) {
    throw new AdminSignOutError(
      503,
      'Admin session management is not available on this Strapi version.'
    );
  }
  const target = await findAdmin(strapi, adminId);
  if (!target) throw new AdminSignOutError(404, 'Admin not found');

  const blockReason = signOutBlockReason(actor, target);
  if (blockReason === 'super-admin-protected') {
    throw new AdminSignOutError(
      403,
      'Only a Super Admin can sign out a Super Admin.',
      'super-admin-protected'
    );
  }

  const userId = String(target.id);
  const { rows } = await readLiveRows(strapi, { userId });
  const devices = groupSessionsByDevice(rows, null);
  const self = String(actor.id) === userId;
  const currentDeviceId = self
    ? await findCurrentDeviceId(strapi, { userId, sessionId: actor.sessionId })
    : null;

  let ended;
  let signedOutSelf;
  let endedDeviceId = null;
  if (sessionId) {
    // The session must be a live row of THIS admin; anything else is 404, so
    // ids of other admins cannot be probed. The list returns opaque handles;
    // a raw Strapi session id still matches.
    const row = rows.find(
      (candidate) =>
        typeof candidate.sessionId === 'string' &&
        (sessionHandle(candidate.sessionId) === sessionId || candidate.sessionId === sessionId)
    );
    if (!row || String(row.userId) !== userId) {
      throw new AdminSignOutError(404, 'Session not found');
    }
    if (blockReason === 'account-inactive') throw new AdminSignOutError(404, 'Session not found');
    await manager.invalidateRefreshToken(userId, String(row.deviceId));
    repeatSignOut(strapi, manager, [userId, String(row.deviceId)], repeatDelayMs);
    endedDeviceId = String(row.deviceId);
    ended = 1;
    signedOutSelf = Boolean(currentDeviceId) && String(row.deviceId) === currentDeviceId;
  } else {
    await manager.invalidateRefreshToken(userId);
    repeatSignOut(strapi, manager, [userId], repeatDelayMs);
    ended = blockReason === 'account-inactive' ? 0 : devices.length;
    signedOutSelf = self && Boolean(currentDeviceId);
  }

  const scope = sessionId ? 'one' : 'all';
  const audit = `[magic-sessionmanager] Admin sign-out: actor=${Number(actor.id)} target=${Number(
    target.id
  )} scope=${scope} ended=${ended}`;
  strapi.log.info(audit);
  // Security log: who signed out whom. No IP or user agent: the request came
  // from the actor, not from the browser that was signed out.
  try {
    strapi
      .plugin('magic-sessionmanager')
      ?.service('security-log')
      ?.record({
        event: 'admin.session.revoked',
        actorType: 'admin',
        actorId: Number(actor.id),
        targetType: 'admin',
        targetId: Number(target.id),
        meta: { scope: scope === 'one' ? 'one_browser' : 'everywhere', ended },
        deviceHash: endedDeviceId ? hashDeviceId(endedDeviceId) : null,
      });
  } catch {
    // Recording must not undo or hide a completed sign-out.
  }
  try {
    strapi.eventHub?.emit?.('magic-sessionmanager.admin-sessions.signed-out', {
      actorId: Number(actor.id),
      targetId: Number(target.id),
      scope,
      ended,
    });
  } catch {
    // An event listener failure must not undo or hide a completed sign-out.
  }
  return { ended, signedOutSelf, scope };
}

module.exports = {
  ADMIN_FILTERS,
  ADMIN_ORIGIN,
  AdminSignOutError,
  DEFAULT_POLICY,
  FULL_VISIBILITY,
  MAX_PAGE_SIZE,
  SUPER_ADMIN_CODE,
  accountState,
  adminParamsSchema,
  displayName,
  getAdminSessionManager,
  groupSessionsByDevice,
  isSuperAdmin,
  listAdminSessions,
  listAdmins,
  listQuerySchema,
  parseInput,
  readSessionPolicy,
  sessionHandle,
  sessionParamsSchema,
  signOutAdmin,
  signOutBlockReason,
  summariseByAdmin,
  visibilityOf,
};
