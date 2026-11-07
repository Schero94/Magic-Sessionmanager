'use strict';

/**
 * Race-free writes to the plugin's Core Store entries.
 *
 * Strapi's core store `set()` (@strapi/core 5.61 `services/core-store.js`)
 * runs `findOne` and then `update` or `create`. The `strapi_core_store_settings`
 * table has no unique constraint on `key`, so two processes writing a key
 * that does not exist yet both create a row. Later `get()` calls return an
 * arbitrary one of them.
 *
 * Every plugin write therefore runs inside a cluster-wide critical section
 * (see `coordination.js`), removes duplicate rows for the key first (keeping
 * the newest id) and only then calls the regular store API. Reads keep using
 * `strapi.store().get()`.
 */

const { getCoordinator } = require('./coordination');

const PLUGIN_ID = 'magic-sessionmanager';
const CORE_STORE_UID = 'strapi::core-store';

/**
 * Returns the Core Store row key Strapi uses for a plugin store key.
 *
 * @param {string} key
 * @returns {string}
 */
function coreStoreKey(key) {
  return `plugin_${PLUGIN_ID}_${key}`;
}

/**
 * Deletes duplicate Core Store rows for one plugin key, keeping the row with
 * the highest id (the most recently created one).
 *
 * @param {object} strapi
 * @param {string} key Plugin store key, e.g. "settings"
 * @returns {Promise<number>} Number of rows removed
 */
async function collapseDuplicateStoreRows(strapi, key) {
  const query = strapi?.db?.query?.(CORE_STORE_UID);
  if (!query || typeof query.findMany !== 'function') return 0;

  const rows = await query.findMany({
    where: { key: coreStoreKey(key), environment: null, tag: null },
    select: ['id'],
    orderBy: { id: 'desc' },
  });
  if (!Array.isArray(rows) || rows.length < 2) return 0;

  const extraIds = rows.slice(1).map((row) => row.id);
  const result = await query.deleteMany({ where: { id: { $in: extraIds } } });
  return Number(result?.count) || 0;
}

/**
 * Runs `fn` while no other process writes the plugin store key `key`.
 * Duplicate rows for the key are removed before `fn` runs.
 *
 * @template T
 * @param {object} strapi
 * @param {string} key
 * @param {(store: object) => Promise<T>} fn Receives the scoped plugin store
 * @returns {Promise<T>}
 * @throws {import('./coordination').LockTimeoutError} When the lock is busy for too long
 */
async function withPluginStoreKey(strapi, key, fn) {
  const store = strapi.store({ type: 'plugin', name: PLUGIN_ID });
  return getCoordinator(strapi).withLock(`store:${key}`, async () => {
    try {
      const removed = await collapseDuplicateStoreRows(strapi, key);
      if (removed > 0) {
        strapi.log?.warn?.(
          `[magic-sessionmanager] [STORE] Removed ${removed} duplicate store row(s) for "${key}"`
        );
      }
    } catch (err) {
      strapi.log?.debug?.(
        '[magic-sessionmanager] [STORE] Duplicate check failed:',
        err?.name || 'Error'
      );
    }
    return fn(store);
  });
}

/**
 * Writes a plugin store value under the key's critical section.
 *
 * @param {object} strapi
 * @param {string} key
 * @param {unknown} value
 * @returns {Promise<void>}
 */
async function setPluginStoreValue(strapi, key, value) {
  await withPluginStoreKey(strapi, key, (store) => store.set({ key, value }));
}

/**
 * Plugin store keys written by the license feature that versions before
 * 4.11 shipped. The feature is gone; these rows are removed at startup.
 */
const LEGACY_LICENSE_STORE_KEYS = Object.freeze(['licenseKey', 'lastValidated', 'deviceId']);

/**
 * Deletes the Core Store rows left behind by the removed license feature
 * (license key, last validation time, device hash).
 *
 * One `deleteMany` statement removes every row for these keys, duplicates
 * included. It is idempotent: once the rows are gone it deletes nothing, so
 * every boot and every instance can run it in parallel without a lock.
 *
 * @param {object} strapi
 * @returns {Promise<number>} Number of rows removed
 * @sideeffect Deletes rows from `strapi_core_store_settings`.
 */
async function removeLegacyLicenseData(strapi) {
  const query = strapi?.db?.query?.(CORE_STORE_UID);
  if (!query || typeof query.deleteMany !== 'function') return 0;

  const result = await query.deleteMany({
    where: { key: { $in: LEGACY_LICENSE_STORE_KEYS.map(coreStoreKey) } },
  });
  return Number(result?.count) || 0;
}

module.exports = {
  LEGACY_LICENSE_STORE_KEYS,
  PLUGIN_ID,
  collapseDuplicateStoreRows,
  coreStoreKey,
  removeLegacyLicenseData,
  setPluginStoreValue,
  withPluginStoreKey,
};
