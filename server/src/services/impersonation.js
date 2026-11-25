'use strict';

/**
 * Impersonation of app users (4.20).
 *
 * An admin with `impersonate.users` starts a time-limited impersonation of a
 * Users & Permissions user with a reason. The credential is short-lived and
 * minted only for this purpose:
 * - refresh mode (`jwtManagement: 'refresh'`): a Strapi session created with
 *   `strapi.sessionManager('users-permissions').generateRefreshToken` on its
 *   own device id, marked in the session metadata (Strapi keeps metadata
 *   across rotation); ended with `invalidateRefreshToken(userId, deviceId)`.
 * - legacy mode: a JWT whose `exp` is the end of the impersonation, with an
 *   `msmImp` claim; ended through the plugin's revocation list.
 * Either way a Magic session row tracks it, so the user's session list shows
 * it and the plugin's session checks apply.
 *
 * Hand-off: with `impersonation.frontendUrl` configured the admin gets a
 * one-time code (60 seconds, stored as a SHA-256 hash, single use through an
 * atomic update) that the frontend exchanges at
 * `POST /api/magic-sessionmanager/impersonation/exchange`; the credential is
 * minted only then. Without it, the credential is returned once to the admin.
 *
 * Docs and installed code checked 2026-11-25 (Strapi 5.63.0):
 * - https://docs.strapi.io/cms/features/users-permissions (jwtManagement,
 *   sessions, `/auth/refresh`).
 * - `@strapi/core/dist/services/session-manager.js` (generateRefreshToken with
 *   deviceId and metadata, metadata kept on rotation, invalidateRefreshToken
 *   by user and device, isSessionActive).
 * - `@strapi/plugin-users-permissions/server/src/services/jwt.js` (legacy
 *   `issue(payload, { expiresIn })` keeps custom claims).
 */

const crypto = require('node:crypto');
const { createLogger } = require('../utils/logger');
const { hashToken } = require('../utils/encryption');
const getClientIp = require('../utils/getClientIp');
const { getPluginSettings } = require('../utils/settings-loader');
const { getNativeSessionManager } = require('../utils/native-session-manager');
const { REVOCATION_UID } = require('../utils/session-revocation');
const {
  CODE_PATTERN,
  CODE_TTL_MS,
  DOCUMENT_ID_PATTERN,
  USER_DURATIONS,
  decodeJwtPayload,
  resolveFrontendHandoff,
  validateStartBody,
} = require('../utils/impersonation-rules');

const UID = 'plugin::magic-sessionmanager.impersonation';
const USER_UID = 'plugin::users-permissions.user';
const NATIVE_SESSION_UID = 'admin::session';
const NATIVE_ORIGIN = 'users-permissions';
const DEVICE_PREFIX = 'msm-impersonation-';
const MAX_CACHE = 10000;
const RECORD_CACHE_MS = 5000;
const REFUSAL_DEDUP_MS = 60 * 1000;
const ENDED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SWEEP_BATCH = 100;

/**
 * An expected refusal with an HTTP status. The controller answers it with
 * Strapi's `ctx` helpers: errors of the plugin's own `@strapi/utils` copy
 * are not recognised by the host's error middleware when npm installs two
 * copies.
 */
class ImpersonationError extends Error {
  /**
   * @param {400|403|404} status HTTP status.
   * @param {string} message Fixed message.
   * @param {Record<string, unknown>} [details] Safe details.
   */
  constructor(status, message, details = {}) {
    super(message);
    this.name = 'ImpersonationError';
    this.status = status;
    this.details = details;
  }
}

const EVENTS = Object.freeze({
  STARTED: 'impersonation.started',
  ENDED: 'impersonation.ended',
  EXPIRED: 'impersonation.expired',
  REFUSED: 'impersonation.refused',
});

/**
 * Sets one entry in a bounded insertion-ordered cache.
 *
 * @param {Map<string, any>} map Cache.
 * @param {string} key Key.
 * @param {any} value Value.
 * @returns {void}
 */
function remember(map, key, value) {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_CACHE) map.delete(map.keys().next().value);
}

/**
 * Admin display name without the email when a name exists.
 *
 * @param {any} admin Admin user row.
 * @returns {string} Name.
 */
function adminLabel(admin) {
  if (!admin) return '';
  const name = [admin.firstname, admin.lastname].filter(Boolean).join(' ').trim();
  return (name || admin.username || admin.email || '').slice(0, 120);
}

module.exports = ({ strapi }) => {
  const log = createLogger(strapi);
  /** sessionId -> impersonation documentId or null (immutable per session). */
  const nativeSessionCache = new Map();
  /** documentId -> { value, at } */
  const recordCache = new Map();
  /** `${id}|${reason}` -> time of the last refused-call event. */
  const refusals = new Map();

  const query = () => strapi.db.query(UID);
  const securityLog = () => strapi.plugin('magic-sessionmanager').service('security-log');

  /**
   * Queues one security event; recording never fails the caller.
   *
   * @param {object} input Event.
   * @returns {void}
   */
  const record = (input) => {
    try {
      securityLog()?.record(input);
    } catch {
      // The security log must not undo an impersonation step.
    }
  };

  const isProduction = () => process.env.NODE_ENV === 'production';

  const service = {
    EVENTS,

    /**
     * Whether the feature switch is on.
     *
     * @returns {Promise<boolean>}
     */
    async isEnabled() {
      try {
        const settings = await getPluginSettings(strapi);
        return settings?.impersonationEnabled === true;
      } catch {
        return false;
      }
    },

    /**
     * The configured frontend hand-off, or null for the token fallback.
     *
     * @returns {{url: string, origin: string}|null}
     */
    frontendHandoff() {
      return resolveFrontendHandoff(
        strapi.config.get('plugin::magic-sessionmanager.impersonation'),
        {
          production: isProduction(),
        }
      );
    },

    /**
     * Warns once at start-up when the frontend hand-off cannot work: the
     * admin panel posts the one-time code to `impersonation.frontendUrl`, and
     * Strapi's default Content-Security-Policy (`form-action 'self'`, from
     * `strapi::security`) blocks that unless the frontend origin is listed.
     *
     * @returns {boolean} Whether the setup looks complete (true without a frontend URL).
     */
    checkHandoffSetup() {
      const frontend = service.frontendHandoff();
      if (!frontend) return true;
      let directives;
      try {
        const entry = (strapi.config.get('middlewares') || []).find(
          (item) => item === 'strapi::security' || item?.name === 'strapi::security'
        );
        directives =
          typeof entry === 'object' ? entry?.config?.contentSecurityPolicy?.directives : null;
      } catch {
        directives = null;
      }
      const formAction = directives?.['form-action'] ?? directives?.formAction;
      const list = Array.isArray(formAction) ? formAction.map(String) : [];
      if (list.includes(frontend.origin)) return true;
      log.warn(
        '[IMPERSONATION] impersonation.frontendUrl is set, but the Content-Security-Policy form-action of strapi::security does not list its origin; the admin panel cannot send the sign-in until it does (see README > Impersonation)'
      );
      return false;
    },

    /**
     * What the admin UI needs to know before it offers impersonation.
     *
     * @returns {Promise<{enabled: boolean, handoff: 'frontend'|'token', frontendOrigin: string|null,
     *   durations: number[], mode: 'refresh'|'legacy'}>}
     */
    async status() {
      const frontend = service.frontendHandoff();
      return {
        enabled: await service.isEnabled(),
        handoff: frontend ? 'frontend' : 'token',
        frontendOrigin: frontend ? frontend.origin : null,
        durations: [...USER_DURATIONS],
        mode: getNativeSessionManager(strapi) ? 'refresh' : 'legacy',
      };
    },

    /**
     * Records a refused start.
     *
     * @param {{actorId: unknown, targetType: 'user'|'admin', targetId: unknown, reason: string,
     *   via?: string}} input Who tried what and why it was refused.
     * @returns {void}
     */
    recordRefused({ actorId, targetType, targetId, reason, via }) {
      record({
        event: EVENTS.REFUSED,
        actorType: 'admin',
        actorId: actorId == null ? null : String(actorId),
        targetType,
        targetId: targetId == null ? null : String(targetId).slice(0, 64),
        meta: { refusal: reason, ...(via ? { via } : {}) },
      });
    },

    /**
     * Starts an impersonation of an app user.
     *
     * @param {{actor: any, userDocumentId: unknown, body: unknown, ctx: any}} input Caller,
     *   target and request body.
     * @returns {Promise<object>} Impersonation DTO plus the hand-off.
     * @throws {ImpersonationError} 400 invalid body, id or blocked user; 403 feature off or
     *   already active; 404 unknown user.
     * @sideeffect Creates an impersonation row; with the token hand-off also a session; queues
     *   `impersonation.started`; may send an email to the user.
     */
    async startForUser({ actor, userDocumentId, body, ctx }) {
      const actorId = String(actor.id);
      const refuse = (reason, status, message) => {
        service.recordRefused({ actorId, targetType: 'user', targetId: userDocumentId, reason });
        return new ImpersonationError(status, message, { reason });
      };

      if (!(await service.isEnabled())) {
        throw refuse('disabled', 403, 'Impersonation is turned off');
      }
      if (typeof userDocumentId !== 'string' || !DOCUMENT_ID_PATTERN.test(userDocumentId)) {
        throw new ImpersonationError(400, 'Invalid user id');
      }
      const { value, errors: fieldErrors } = validateStartBody(body, {
        durations: USER_DURATIONS,
        notify: true,
      });
      if (!value) {
        throw new ImpersonationError(400, 'Invalid impersonation request', {
          errors: fieldErrors.map((error) => ({ ...error, name: 'ValidationError' })),
        });
      }

      const user = await strapi.db.query(USER_UID).findOne({
        where: { documentId: userDocumentId },
        select: ['id', 'documentId', 'username', 'email', 'blocked'],
      });
      if (!user) throw new ImpersonationError(404, 'User not found');
      if (user.blocked === true) {
        throw refuse('blocked', 400, 'Blocked accounts cannot be impersonated');
      }

      await service.sweep();
      const running = await query().findOne({
        where: { targetType: 'user', targetId: user.documentId, state: 'active' },
        select: ['id'],
      });
      if (running) {
        throw refuse('already-active', 403, 'An impersonation of this user is active');
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + value.durationMinutes * 60 * 1000);
      const frontend = service.frontendHandoff();
      const code = frontend ? crypto.randomBytes(32).toString('base64url') : null;

      const row = await query().create({
        data: {
          targetType: 'user',
          targetId: user.documentId,
          actorId,
          state: 'active',
          reason: value.reason,
          durationMinutes: value.durationMinutes,
          handoff: frontend ? 'frontend' : 'token',
          notifyUser: value.notifyUser,
          startedAt: now,
          expiresAt,
          ...(code
            ? { codeHash: hashToken(code), codeExpiresAt: new Date(now.getTime() + CODE_TTL_MS) }
            : {}),
        },
      });

      let handoff;
      try {
        if (frontend) {
          handoff = {
            type: 'frontend',
            url: frontend.url,
            field: 'code',
            code,
            codeExpiresAt: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
          };
        } else {
          const credential = await service.issueCredential(row, user, ctx);
          handoff = { type: 'token', ...credential };
        }
      } catch (err) {
        // No half-started impersonation: end it and revoke what was minted.
        await service.end(row.documentId, { reason: 'failed', endedBy: actorId, silent: true });
        throw err;
      }

      record({
        event: EVENTS.STARTED,
        actorType: 'admin',
        actorId,
        targetType: 'user',
        targetId: user.documentId,
        meta: {
          reason: value.reason,
          durationMinutes: value.durationMinutes,
          handoff: frontend ? 'frontend' : 'token',
          notifyUser: value.notifyUser,
        },
      });
      log.info(`[IMPERSONATION] Started (${value.durationMinutes} min, ${handoff.type})`);

      if (value.notifyUser) service.notifyUser(user, value, expiresAt);

      return {
        impersonation: service.toDto(row, { users: new Map([[user.documentId, user]]), actor }),
        handoff,
      };
    },

    /**
     * Mints the short-lived credential of an impersonation and links its
     * Magic session row.
     *
     * @param {any} row Impersonation row.
     * @param {{id: number, documentId: string}} user Target user.
     * @param {any} ctx Request context (IP and user agent of the session row).
     * @returns {Promise<{jwt: string, refreshToken?: string, expiresAt: string}>}
     * @throws {Error} When the credential cannot be minted.
     * @sideeffect Creates a Strapi session (refresh mode) and a Magic session row.
     */
    async issueCredential(row, user, ctx) {
      const now = Date.now();
      const expiresAt = new Date(row.expiresAt);
      const remainingSeconds = Math.floor((expiresAt.getTime() - now) / 1000);
      if (remainingSeconds < 5) throw new ImpersonationError(403, 'Impersonation ended');

      const native = getNativeSessionManager(strapi);
      const sessionService = strapi.plugin('magic-sessionmanager').service('session');
      const headers = ctx?.request?.headers || {};
      /** @type {Record<string, unknown>} */
      const refs = { credentialIssuedAt: new Date(now) };
      let jwt;
      let refreshToken;
      let nativeSessionId;

      if (native) {
        const deviceId = `${DEVICE_PREFIX}${crypto.randomBytes(12).toString('hex')}`;
        const manager = strapi.sessionManager(NATIVE_ORIGIN);
        // Recorded before the session exists, so a failure below still revokes it.
        await query().update({
          where: { id: row.id },
          data: { nativeUserId: String(user.id), nativeDeviceId: deviceId },
        });
        const refresh = await manager.generateRefreshToken(String(user.id), deviceId, {
          type: 'session',
          metadata: {
            loginAt: new Date(now).toISOString(),
            deviceName: 'Impersonation',
            msmImpersonation: row.documentId,
          },
        });
        const access = await manager.generateAccessToken(refresh.token);
        if (!access || 'error' in access) throw new Error('Access token could not be minted');
        jwt = access.token;
        refreshToken = refresh.token;
        nativeSessionId = refresh.sessionId;
        remember(nativeSessionCache, refresh.sessionId, row.documentId);
      } else {
        jwt = strapi
          .plugin('users-permissions')
          .service('jwt')
          .issue({ id: user.id, msmImp: row.documentId }, { expiresIn: remainingSeconds });
        refs.tokenHash = hashToken(jwt);
        refs.tokenExpiresAt = expiresAt;
      }

      const session = await sessionService.createSession({
        userId: user.documentId,
        ip: getClientIp(ctx),
        userAgent: headers['user-agent'] || 'unknown',
        token: jwt,
        ...(nativeSessionId ? { nativeSessionId } : {}),
      });
      if (session?.documentId) refs.sessionDocumentId = session.documentId;

      await query().update({ where: { id: row.id }, data: refs });
      recordCache.delete(row.documentId);
      return {
        jwt,
        ...(refreshToken ? { refreshToken } : {}),
        expiresAt: expiresAt.toISOString(),
      };
    },

    /**
     * Exchanges a one-time hand-off code for the credential. The code is
     * single use (atomic update) and valid for 60 seconds; every failure
     * answers the same.
     *
     * @param {unknown} code Code from the request body.
     * @param {any} ctx Request context.
     * @returns {Promise<object|null>} Credential response, or null for any invalid code.
     * @sideeffect Consumes the code; creates the credential and its session.
     */
    async exchange(code, ctx) {
      if (typeof code !== 'string' || !CODE_PATTERN.test(code)) return null;
      if (!(await service.isEnabled())) return null;
      const codeHash = hashToken(code);
      const now = new Date();
      const row = await query().findOne({
        where: { codeHash, state: 'active' },
      });
      if (!row) return null;
      const claimed = await query().updateMany({
        where: {
          id: row.id,
          codeHash,
          state: 'active',
          credentialIssuedAt: { $null: true },
          codeExpiresAt: { $gt: now },
          expiresAt: { $gt: now },
        },
        data: { codeHash: null, codeExpiresAt: null, credentialIssuedAt: now },
      });
      if (Number(claimed?.count) !== 1) return null;

      const user = await strapi.db.query(USER_UID).findOne({
        where: { documentId: row.targetId },
        select: ['id', 'documentId', 'username', 'email', 'blocked'],
      });
      if (!user || user.blocked === true) {
        await service.end(row.documentId, { reason: 'failed', silent: true });
        return null;
      }
      try {
        const credential = await service.issueCredential(row, user, ctx);
        return {
          ...credential,
          user: { id: user.id, documentId: user.documentId, username: user.username },
          impersonation: { id: row.documentId, expiresAt: new Date(row.expiresAt).toISOString() },
        };
      } catch (err) {
        await service.end(row.documentId, { reason: 'failed', silent: true });
        throw err;
      }
    },

    /**
     * Ends an impersonation: revokes its credential first (idempotent), then
     * marks the row ended once (atomic), so one event is recorded.
     *
     * @param {string} documentId Impersonation id.
     * @param {{reason?: 'ended'|'expired'|'disabled'|'failed', endedBy?: string|null,
     *   silent?: boolean}} [options] Why and by whom.
     * @returns {Promise<boolean>} Whether this call ended it.
     * @sideeffect Revokes sessions and tokens; updates the row; queues an event.
     */
    async end(documentId, { reason = 'ended', endedBy = null, silent = false } = {}) {
      const row = await query().findOne({ where: { documentId } });
      if (!row) return false;
      await service.revoke(row, reason === 'expired' ? 'expired' : 'manual');
      const claimed = await query().updateMany({
        where: { id: row.id, state: 'active' },
        data: {
          state: reason === 'expired' ? 'expired' : 'ended',
          endedAt: new Date(),
          endReason: reason,
          endedBy: endedBy == null ? null : String(endedBy),
          codeHash: null,
          codeExpiresAt: null,
        },
      });
      recordCache.delete(documentId);
      if (Number(claimed?.count) !== 1) return false;
      if (!silent) {
        record({
          event: reason === 'expired' ? EVENTS.EXPIRED : EVENTS.ENDED,
          actorType: endedBy ? 'admin' : 'system',
          actorId: endedBy ? String(endedBy) : null,
          targetType: row.targetType,
          targetId: row.targetId,
          meta: {
            startedBy: row.actorId,
            durationMinutes: row.durationMinutes,
            ...(reason === 'expired' ? {} : { endReason: reason }),
          },
        });
      }
      log.info(`[IMPERSONATION] Ended (${reason})`);
      return true;
    },

    /**
     * Revokes everything minted for an impersonation. Safe to repeat.
     *
     * @param {any} row Impersonation row.
     * @param {'manual'|'expired'} sessionReason Termination reason of the Magic session row.
     * @returns {Promise<void>}
     * @sideeffect Deletes Strapi session rows, writes a revocation record, ends the Magic session.
     */
    async revoke(row, sessionReason) {
      if (row.nativeUserId && row.nativeDeviceId) {
        try {
          await strapi
            .sessionManager(NATIVE_ORIGIN)
            .invalidateRefreshToken(String(row.nativeUserId), String(row.nativeDeviceId));
        } catch (err) {
          log.error('[IMPERSONATION] Session revocation failed:', err?.name || 'Error');
        }
      }
      if (row.tokenHash) {
        try {
          const documents = strapi.documents(REVOCATION_UID);
          const existing = await documents.findFirst({
            filters: { tokenHash: row.tokenHash },
            fields: ['documentId'],
          });
          if (!existing) {
            await documents.create({
              data: {
                tokenHash: row.tokenHash,
                expiresAt: row.tokenExpiresAt || row.expiresAt,
                revokedAt: new Date(),
              },
            });
          }
        } catch (err) {
          log.error('[IMPERSONATION] Token revocation failed:', err?.name || 'Error');
        }
      }
      if (row.sessionDocumentId) {
        try {
          await strapi
            .plugin('magic-sessionmanager')
            .service('session')
            .terminateSession({ sessionId: row.sessionDocumentId, reason: sessionReason });
        } catch (err) {
          log.warn('[IMPERSONATION] Session row could not be ended:', err?.name || 'Error');
        }
      }
    },

    /**
     * Ends expired impersonations, and all of them while the feature is off;
     * deletes rows that ended more than 7 days ago (the security log keeps
     * the record). Bounded per run; safe on several processes.
     *
     * @returns {Promise<number>} Number ended by this run.
     * @sideeffect Ends impersonations; deletes old rows.
     */
    async sweep() {
      const now = new Date();
      const enabled = await service.isEnabled();
      const due = await query().findMany({
        where: enabled ? { state: 'active', expiresAt: { $lte: now } } : { state: 'active' },
        select: ['documentId', 'expiresAt'],
        limit: SWEEP_BATCH,
      });
      let ended = 0;
      for (const row of due) {
        const expired = new Date(row.expiresAt).getTime() <= now.getTime();
        try {
          if (await service.end(row.documentId, { reason: expired ? 'expired' : 'disabled' })) {
            ended += 1;
          }
        } catch (err) {
          log.warn('[IMPERSONATION] Ending failed:', err?.name || 'Error');
        }
      }
      try {
        await query().deleteMany({
          where: {
            state: { $ne: 'active' },
            endedAt: { $lt: new Date(now.getTime() - ENDED_RETENTION_MS) },
          },
        });
      } catch (err) {
        log.debug('[IMPERSONATION] Old rows were not deleted:', err?.name || 'Error');
      }
      return ended;
    },

    /**
     * Active impersonations of the given target types, newest first.
     *
     * @param {{targetTypes: Array<'user'|'admin'>, viewer: any}} input Kinds the caller may see.
     * @returns {Promise<object[]>} DTOs.
     */
    async listActive({ targetTypes, viewer }) {
      if (!targetTypes.length) return [];
      await service.sweep();
      const rows = await query().findMany({
        where: { state: 'active', targetType: { $in: targetTypes } },
        orderBy: { startedAt: 'desc' },
        limit: 100,
      });
      const userIds = rows.filter((row) => row.targetType === 'user').map((row) => row.targetId);
      const adminIds = [
        ...new Set(
          rows
            .flatMap((row) => [row.actorId, row.targetType === 'admin' ? row.targetId : null])
            .filter(Boolean)
            .map(Number)
            .filter(Number.isInteger)
        ),
      ];
      const users = userIds.length
        ? await strapi.db.query(USER_UID).findMany({
            where: { documentId: { $in: userIds } },
            select: ['documentId', 'username', 'email'],
          })
        : [];
      const admins = adminIds.length
        ? await strapi.db.query('admin::user').findMany({
            where: { id: { $in: adminIds } },
            select: ['id', 'firstname', 'lastname', 'username', 'email'],
          })
        : [];
      const context = {
        users: new Map(users.map((user) => [user.documentId, user])),
        admins: new Map(admins.map((admin) => [String(admin.id), admin])),
        viewer,
      };
      return rows.map((row) => service.toDto(row, context));
    },

    /**
     * One impersonation row as the admin API returns it (no codes, hashes,
     * session or device references).
     *
     * @param {any} row Row.
     * @param {{users?: Map<string, any>, admins?: Map<string, any>, actor?: any, viewer?: any}}
     *   context Lookups for labels.
     * @returns {object} DTO.
     */
    toDto(row, context = {}) {
      const actor = context.actor || context.admins?.get(String(row.actorId));
      const user = row.targetType === 'user' ? context.users?.get(row.targetId) : null;
      const targetAdmin =
        row.targetType === 'admin' ? context.admins?.get(String(row.targetId)) : null;
      const viewerId = context.viewer?.id ?? context.actor?.id;
      return {
        id: row.documentId,
        targetType: row.targetType,
        targetId: row.targetId,
        targetLabel: user
          ? String(user.username || user.email || '').slice(0, 120)
          : adminLabel(targetAdmin),
        actorId: row.actorId,
        actorLabel: adminLabel(actor),
        startedByYou: viewerId != null && String(viewerId) === String(row.actorId),
        reason: row.reason,
        durationMinutes: row.durationMinutes,
        handoff: row.handoff,
        credentialIssued: Boolean(row.credentialIssuedAt),
        startedAt: new Date(row.startedAt).toISOString(),
        expiresAt: new Date(row.expiresAt).toISOString(),
        state: row.state,
      };
    },

    /**
     * Loads one impersonation for the request guard (5-second cache).
     *
     * @param {string} documentId Impersonation id.
     * @returns {Promise<{id: string, actorId: string, state: string, expiresAt: number}|null>}
     */
    async loadForGuard(documentId) {
      const cached = recordCache.get(documentId);
      if (cached && Date.now() - cached.at < RECORD_CACHE_MS) return cached.value;
      const row = await query().findOne({
        where: { documentId, targetType: 'user' },
        select: ['documentId', 'actorId', 'state', 'expiresAt'],
      });
      const value = row
        ? {
            id: row.documentId,
            actorId: row.actorId,
            state: row.state,
            expiresAt: new Date(row.expiresAt).getTime(),
          }
        : null;
      remember(recordCache, documentId, { value, at: Date.now() });
      return value;
    },

    /**
     * The impersonation a Users & Permissions token belongs to, or null. A
     * legacy token carries the `msmImp` claim; a refresh-mode token names
     * its session, whose metadata carries the mark. The signature is checked
     * by Strapi afterwards.
     *
     * @param {string} token Access or refresh token.
     * @returns {Promise<string|null>} Impersonation id.
     */
    async impersonationOfToken(token) {
      const payload = decodeJwtPayload(token);
      if (!payload) return null;
      if (typeof payload.msmImp === 'string' && DOCUMENT_ID_PATTERN.test(payload.msmImp)) {
        return payload.msmImp;
      }
      const sessionId = payload.sessionId;
      if (typeof sessionId !== 'string' || !/^[a-f0-9]{16,64}$/i.test(sessionId)) return null;
      if (nativeSessionCache.has(sessionId)) return nativeSessionCache.get(sessionId);
      let id = null;
      try {
        const session = await strapi.db.query(NATIVE_SESSION_UID).findOne({
          where: { sessionId, origin: NATIVE_ORIGIN },
          select: ['metadata', 'deviceId'],
        });
        const mark = session?.metadata?.msmImpersonation;
        if (typeof mark === 'string' && DOCUMENT_ID_PATTERN.test(mark)) id = mark;
        else if (
          typeof session?.deviceId === 'string' &&
          session.deviceId.startsWith(DEVICE_PREFIX)
        ) {
          // Marked device without readable metadata: treat as impersonation, fail closed.
          id = 'unknown';
        }
        if (session) remember(nativeSessionCache, sessionId, id);
      } catch (err) {
        log.warn('[IMPERSONATION] Session lookup failed:', err?.name || 'Error');
        throw err;
      }
      return id;
    },

    /**
     * Records a refused Content API call made while impersonating (one event
     * per impersonation and reason per minute).
     *
     * @param {{id: string, actorId: string}} impersonation Impersonation.
     * @param {string} reason Refusal reason.
     * @returns {void}
     */
    recordRefusedCall(impersonation, reason) {
      const key = `${impersonation.id}|${reason}`;
      const now = Date.now();
      const last = refusals.get(key);
      if (last !== undefined && now - last < REFUSAL_DEDUP_MS) return;
      remember(refusals, key, now);
      record({
        event: EVENTS.REFUSED,
        actorType: 'admin',
        actorId: impersonation.actorId,
        targetType: 'user',
        targetId: null,
        meta: { refusal: `call-${reason}`, impersonation: impersonation.id },
      });
    },

    /**
     * Emails the user that their account was opened (best effort, no
     * admin names; the reason is escaped).
     *
     * @param {{email?: string, username?: string}} user Target user.
     * @param {{reason: string, durationMinutes: number}} value Start values.
     * @param {Date} expiresAt End time.
     * @returns {void}
     * @sideeffect Sends one email through Strapi's email plugin when it is installed.
     */
    notifyUser(user, value, expiresAt) {
      const emailPlugin = strapi.plugin('email');
      if (!emailPlugin || typeof user?.email !== 'string' || !user.email) return;
      const notifications = strapi.plugin('magic-sessionmanager').service('notifications');
      const escapeText = (text) =>
        typeof notifications?.escapeHtml === 'function'
          ? notifications.escapeHtml(text)
          : String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
      const minutes = value.durationMinutes;
      const until = expiresAt.toISOString().replace('T', ' ').slice(0, 16);
      const text = [
        'An administrator opened your account for support.',
        `Reason: ${value.reason}`,
        `Duration: up to ${minutes} minutes (until ${until} UTC).`,
        'They act as you while this lasts but cannot change your password, email address or sessions.',
        'If you did not expect this, please contact support.',
      ].join('\n');
      const html = `<p>An administrator opened your account for support.</p><p><strong>Reason:</strong> ${escapeText(
        value.reason
      )}<br><strong>Duration:</strong> up to ${minutes} minutes (until ${escapeText(until)} UTC).</p><p>They act as you while this lasts but cannot change your password, email address or sessions.</p><p>If you did not expect this, please contact support.</p>`;
      Promise.resolve()
        .then(() =>
          emailPlugin
            .service('email')
            .send({ to: user.email, subject: 'Your account was opened by support', text, html })
        )
        .catch((err) => {
          log.warn('[IMPERSONATION] Notification email failed:', err?.name || 'Error');
        });
    },
  };

  return service;
};

module.exports.UID = UID;
module.exports.ImpersonationError = ImpersonationError;
module.exports.DEVICE_PREFIX = DEVICE_PREFIX;
