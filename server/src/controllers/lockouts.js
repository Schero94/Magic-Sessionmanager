'use strict';

// @ts-check

/**
 * "Locked now" list and Unlock of the failed sign-in lockout (4.17), plus
 * the Users & Permissions roles the per-role rules can refer to.
 */

const { getCoordinator } = require('../utils/coordination');
const { LOCK_ID_PATTERN, createLoginLockout } = require('../utils/login-lockout');
const { getRequestIp, getRequestUserAgent } = require('../utils/admin-request-info');
const { SECURITY_EVENTS } = require('../utils/security-log-model');
const { sendServerError, sendValidationError } = require('../utils/http-errors');
const { createLogger } = require('../utils/logger');

const USER_UID = 'plugin::users-permissions.user';
const ROLE_UID = 'plugin::users-permissions.role';

module.exports = ({ strapi }) => {
  const log = createLogger(strapi);
  const lockout = () => createLoginLockout(getCoordinator(strapi));

  return {
    /**
     * Lists the active sign-in locks: locked IP addresses (shown as the
     * security log stores IPs) and locked accounts with their user.
     *
     * @route GET /magic-sessionmanager/lockouts
     * @auth admin session or admin API token
     * @access plugin::magic-sessionmanager.access
     * @param {any} ctx Koa context.
     * @returns {Promise<void>} `{ data: Lock[], meta: { total } }`; 500 on store failure.
     */
    async list(ctx) {
      try {
        const locks = await lockout().listLocks();
        const ids = [...new Set(locks.map((lock) => lock.user).filter(Boolean))];
        const users = ids.length
          ? await strapi.db.query(USER_UID).findMany({
              where: { documentId: { $in: ids } },
              select: ['documentId', 'username', 'email'],
            })
          : [];
        const byId = new Map(
          (Array.isArray(users) ? users : []).map((user) => [user.documentId, user])
        );
        const data = locks.map((lock) => {
          const user = lock.user ? byId.get(lock.user) : null;
          return {
            id: lock.id,
            kind: lock.kind,
            ip: lock.kind === 'ip' ? lock.ip : null,
            user: user
              ? { documentId: user.documentId, username: user.username, email: user.email }
              : null,
            failures: lock.failures,
            lockedAt: new Date(lock.lockedAt).toISOString(),
            until: new Date(lock.until).toISOString(),
          };
        });
        ctx.body = { data, meta: { total: data.length } };
      } catch (err) {
        log.error('[lockouts] List failed:', err?.name || 'Error');
        return sendServerError(ctx, 500, 'Locks could not be loaded');
      }
    },

    /**
     * Lifts one lock. The admin who lifted it is recorded in the security log.
     *
     * @route POST /magic-sessionmanager/lockouts/unlock
     * @auth admin session or admin API token
     * @access plugin::magic-sessionmanager.access + plugin::magic-sessionmanager.lockouts.unlock
     * @param {any} ctx Koa context; body `{ id }` from the list.
     * @returns {Promise<void>} `{ data: { unlocked: true, kind } }`; 400 invalid id; 404 not locked.
     * @sideeffect Deletes the shared lock counter and list entry; writes `user.lockout.lifted`.
     */
    async unlock(ctx) {
      const body = ctx.request?.body;
      const id = body && typeof body === 'object' && !Array.isArray(body) ? body.id : undefined;
      const extra =
        body && typeof body === 'object' ? Object.keys(body).filter((key) => key !== 'id') : [];
      if (typeof id !== 'string' || !LOCK_ID_PATTERN.test(id) || extra.length > 0) {
        return sendValidationError(ctx, 'Invalid lock', [
          { path: ['id'], message: 'id must be a lock id from the list' },
        ]);
      }
      try {
        const lifted = await lockout().unlock(id);
        if (!lifted) return ctx.notFound('This lock has already ended');
        try {
          strapi
            .plugin('magic-sessionmanager')
            .service('security-log')
            .record({
              event: SECURITY_EVENTS.USER_LOCKOUT_LIFTED,
              actorType: 'admin',
              actorId: ctx.state?.user?.id ?? null,
              targetType: lifted.kind === 'account' ? 'user' : 'ip',
              targetId: lifted.kind === 'account' ? lifted.user : null,
              ip: getRequestIp(ctx),
              userAgent: getRequestUserAgent(ctx),
              meta: { kind: lifted.kind },
            });
        } catch {
          // Recording never blocks the unlock.
        }
        ctx.body = { data: { unlocked: true, kind: lifted.kind } };
      } catch (err) {
        log.error('[lockouts] Unlock failed:', err?.name || 'Error');
        return sendServerError(ctx, 500, 'The lock could not be lifted');
      }
    },

    /**
     * Users & Permissions roles for the per-role rules (the Public role has
     * no signed-in users and is left out).
     *
     * @route GET /magic-sessionmanager/roles
     * @auth admin session or admin API token
     * @access plugin::magic-sessionmanager.access
     * @param {any} ctx Koa context.
     * @returns {Promise<void>} `{ data: [{ documentId, name, type }] }`.
     */
    async roles(ctx) {
      try {
        const rows = await strapi.db.query(ROLE_UID).findMany({
          select: ['documentId', 'name', 'type'],
          where: { type: { $ne: 'public' } },
          orderBy: { name: 'asc' },
          limit: 200,
        });
        ctx.body = {
          data: (Array.isArray(rows) ? rows : []).map((role) => ({
            documentId: role.documentId,
            name: role.name,
            type: role.type,
          })),
        };
      } catch (err) {
        log.error('[lockouts] Roles could not be listed:', err?.name || 'Error');
        return sendServerError(ctx, 500, 'Roles could not be loaded');
      }
    },
  };
};
