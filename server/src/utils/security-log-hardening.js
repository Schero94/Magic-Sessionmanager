'use strict';

// @ts-check

/**
 * Hardening of the plugin's internal content types and the security log
 * (4.17, security review F3, F5, F7, F8).
 *
 * - GraphQL: the plugin's types (`session`, `revoked-token`,
 *   `security-event`) are internal tables. When `@strapi/plugin-graphql` is
 *   installed its Shadow CRUD would list them in the schema; they are
 *   disabled with the documented extension service in `register` (docs:
 *   Plugins > GraphQL > Shadow CRUD; installed 5.63
 *   `dist/server/services/extension/shadow-crud-manager.js`).
 * - Content Manager: `content-manager.visible: false` only hides a type in
 *   the UI. The Content Manager admin API still answers for it, and a Super
 *   Admin can grant `explorer.read` on it to any role, which reads raw rows
 *   past `admin-activity.read`. A server middleware answers 404 for every
 *   Content Manager collection-type, single-type and relations route whose
 *   model is a plugin type, before the router runs.
 * - Proxy: with `server.proxy.koa: true` and no `maxIpsCount`, Koa takes the
 *   left-most `X-Forwarded-For` hop, which the client chooses. Bootstrap
 *   warns once.
 * - Migrations (idempotent, run at bootstrap under a cluster lease and again
 *   by the daily retention job until done): stored retention below 7 days is
 *   raised to 7; `meta.title` is removed from stored Content Manager events.
 */

const {
  legacyRetentionBelowMinimum,
  SECURITY_LOG_RETENTION_RANGE,
} = require('./security-log-settings');
const { withPluginStoreKey } = require('./plugin-store');
const { notifySettingsChanged } = require('./settings-loader');
const { toObject } = require('./security-log-model');

const PLUGIN_ID = 'magic-sessionmanager';
const PLUGIN_UID_PREFIX = `plugin::${PLUGIN_ID}.`;
const EVENT_UID = `plugin::${PLUGIN_ID}.security-event`;
/** The plugin's content types (server/src/content-types). */
const INTERNAL_TYPES = Object.freeze([
  `plugin::${PLUGIN_ID}.session`,
  `plugin::${PLUGIN_ID}.revoked-token`,
  EVENT_UID,
  `plugin::${PLUGIN_ID}.impersonation`,
]);
/** Store key of the one-time migrations. */
const MIGRATIONS_KEY = 'migrations';
/** Rows read per migration step. */
const MIGRATION_BATCH = 500;
/** Steps per run (bounded work per boot or day). */
const MAX_MIGRATION_STEPS = 400;

/**
 * Content Manager admin routes that name a model in the second path segment
 * (`@strapi/content-manager` 5.63 `dist/server/routes/admin.js`). Koa's
 * router matches paths case-insensitively, so this does too.
 */
const CM_MODEL_ROUTE =
  /^\/+content-manager\/+(?:collection-types|single-types|relations)\/+([^/]+)/i;

/**
 * Disables GraphQL Shadow CRUD for every plugin content type when the
 * GraphQL plugin is installed. Without it the call does nothing.
 *
 * @param {any} strapi Strapi instance (register phase).
 * @param {{warn: Function}} log Plugin logger.
 * @returns {string[]} The types that were disabled.
 */
function disableGraphqlShadowCrud(strapi, log) {
  let graphql;
  try {
    graphql = strapi.plugin('graphql');
  } catch {
    graphql = null;
  }
  if (!graphql) return [];
  try {
    const extension = graphql.service('extension');
    for (const uid of INTERNAL_TYPES) extension.shadowCRUD(uid).disable();
    return [...INTERNAL_TYPES];
  } catch (err) {
    log.warn('[security] GraphQL Shadow CRUD could not be disabled:', err?.name || 'Error');
    return [];
  }
}

/**
 * The model a Content Manager admin request names, or null.
 *
 * @param {unknown} path Request path (`ctx.path`).
 * @returns {string|null} Decoded model uid, or null when the path names none.
 */
function contentManagerModelOf(path) {
  if (typeof path !== 'string') return null;
  const match = CM_MODEL_ROUTE.exec(path);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/**
 * Koa middleware: 404 for Content Manager routes on the plugin's own types.
 *
 * @returns {(ctx: any, next: () => Promise<any>) => Promise<any>} Middleware.
 */
function createInternalTypeGuard() {
  return async function internalTypeGuard(ctx, next) {
    const model = contentManagerModelOf(ctx.path);
    if (model && model.toLowerCase().startsWith(PLUGIN_UID_PREFIX)) {
      ctx.status = 404;
      ctx.body = {
        data: null,
        error: { status: 404, name: 'NotFoundError', message: 'Not Found', details: {} },
      };
      return undefined;
    }
    return next();
  };
}

/**
 * Whether Koa trusts proxy headers without a hop limit (`maxIpsCount` unset
 * or 0), which lets a client choose the client IP.
 *
 * @param {any} strapi Strapi instance.
 * @returns {boolean}
 */
function hasUnboundedProxyTrust(strapi) {
  const get = (key) => {
    try {
      return strapi?.config?.get?.(key);
    } catch {
      return undefined;
    }
  };
  const proxy = get('server.proxy');
  const koa = proxy === true || get('server.proxy.koa') === true;
  if (!koa) return false;
  const hops = Number(get('server.proxy.maxIpsCount'));
  return !(Number.isInteger(hops) && hops > 0);
}

/**
 * Logs one warning when the client IP the security log stores can be chosen
 * by the client (F7).
 *
 * @param {any} strapi Strapi instance.
 * @param {{warn: Function}} log Plugin logger.
 * @returns {boolean} Whether the warning was logged.
 */
function warnUnboundedProxyTrust(strapi, log) {
  if (!hasUnboundedProxyTrust(strapi)) return false;
  log.warn(
    '[security-log] server.proxy.koa is true but server.proxy.maxIpsCount is not set: Koa takes the left-most X-Forwarded-For entry, which the client chooses. Set maxIpsCount to the number of proxies in front of Strapi (usually 1) so stored sign-in addresses and IP rate limits cannot be spoofed.'
  );
  return true;
}

/**
 * Raises a stored security-log retention below 7 days (allowed by 4.15 and
 * 4.16) to 7.
 *
 * @param {any} strapi Strapi instance.
 * @param {{info: Function}} log Plugin logger.
 * @returns {Promise<number|null>} The old value when it was raised, else null.
 * @sideeffect Writes the plugin store settings.
 */
async function raiseLegacyRetention(strapi, log) {
  const store = strapi.store({ type: 'plugin', name: PLUGIN_ID });
  if (legacyRetentionBelowMinimum(await store.get({ key: 'settings' })) === null) return null;
  const raised = await withPluginStoreKey(strapi, 'settings', async (scoped) => {
    const stored = await scoped.get({ key: 'settings' });
    const old = legacyRetentionBelowMinimum(stored);
    if (old === null) return null;
    await scoped.set({
      key: 'settings',
      value: { ...stored, securityLogRetentionDays: SECURITY_LOG_RETENTION_RANGE.min },
    });
    return old;
  });
  if (raised !== null) {
    await notifySettingsChanged(strapi);
    log.info(
      `[security-log] Retention raised from ${raised} to ${SECURITY_LOG_RETENTION_RANGE.min} days (the minimum since 4.17).`
    );
  }
  return raised;
}

/**
 * Removes `meta.title` from stored Content Manager events (4.15 and 4.16
 * stored the entry title; it is now resolved when the list is read, with the
 * reader's own Content Manager permissions). Batches by id; idempotent.
 *
 * @param {any} strapi Strapi instance.
 * @returns {Promise<{updated: number, done: boolean}>} Rows changed, and whether every row was seen.
 * @sideeffect Updates rows of the security event table.
 */
async function stripStoredTitles(strapi) {
  const events = () => strapi.db.query(EVENT_UID);
  let cursor = 0;
  let updated = 0;
  for (let step = 0; step < MAX_MIGRATION_STEPS; step += 1) {
    const rows = await events().findMany({
      select: ['id', 'meta'],
      where: { id: { $gt: cursor }, event: { $startsWith: 'admin.content.' } },
      orderBy: { id: 'asc' },
      limit: MIGRATION_BATCH,
    });
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return { updated, done: true };
    for (const row of list) {
      const meta = toObject(row.meta);
      if (Object.prototype.hasOwnProperty.call(meta, 'title')) {
        const { title: _title, ...rest } = meta;
        await events().update({
          where: { id: row.id },
          data: { meta: Object.keys(rest).length ? rest : null },
        });
        updated += 1;
      }
    }
    cursor = Number(list[list.length - 1].id);
    if (list.length < MIGRATION_BATCH) return { updated, done: true };
  }
  return { updated, done: false };
}

/**
 * Runs the one-time security log migrations. Safe to run on every boot and
 * on several processes (each step is idempotent; callers hold a lease).
 *
 * @param {any} strapi Strapi instance.
 * @param {{info: Function, warn: Function}} log Plugin logger.
 * @returns {Promise<{retentionRaisedFrom: number|null, titlesRemoved: number, titlesDone: boolean}>}
 *   What changed.
 * @sideeffect Writes the plugin store and security event rows.
 */
async function migrateSecurityLog(strapi, log) {
  const retentionRaisedFrom = await raiseLegacyRetention(strapi, log);
  const store = strapi.store({ type: 'plugin', name: PLUGIN_ID });
  const state = toObject(await store.get({ key: MIGRATIONS_KEY }));
  if (state.securityEventTitlesRemoved === true) {
    return { retentionRaisedFrom, titlesRemoved: 0, titlesDone: true };
  }
  const result = await stripStoredTitles(strapi);
  if (result.updated > 0) {
    log.info(
      `[security-log] Removed stored entry titles from ${result.updated} Content Manager events.`
    );
  }
  if (result.done) {
    await withPluginStoreKey(strapi, MIGRATIONS_KEY, async (scoped) => {
      const current = toObject(await scoped.get({ key: MIGRATIONS_KEY }));
      await scoped.set({
        key: MIGRATIONS_KEY,
        value: { ...current, securityEventTitlesRemoved: true },
      });
    });
  }
  return { retentionRaisedFrom, titlesRemoved: result.updated, titlesDone: result.done };
}

module.exports = {
  INTERNAL_TYPES,
  MIGRATIONS_KEY,
  contentManagerModelOf,
  createInternalTypeGuard,
  disableGraphqlShadowCrud,
  hasUnboundedProxyTrust,
  migrateSecurityLog,
  raiseLegacyRetention,
  stripStoredTitles,
  warnUnboundedProxyTrust,
};
