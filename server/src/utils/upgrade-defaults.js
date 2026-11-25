'use strict';

// @ts-check

/**
 * Keeps the behaviour of existing installations when a release changes a
 * default. A new setting gets the new default on new installations; on an
 * installation that already ran an earlier version, the old behaviour is
 * written into the stored settings once, so nothing changes until an
 * administrator changes the setting.
 *
 * The plugin store key `defaultsProfile` records which steps an installation
 * has seen. An installation counts as existing when the plugin stored
 * settings or set up its Content API permissions before (every earlier
 * version does that on boot). Runs inside the `settings` store lock, so
 * several processes booting at once apply each step once.
 */

const { withPluginStoreKey } = require('./plugin-store');
const { notifySettingsChanged } = require('./settings-loader');
const { LEGACY_WEBHOOK_EVENTS } = require('./detection-settings');

const PROFILE_KEY = 'defaultsProfile';

/**
 * One step per release that changed a default. `legacy` holds the values
 * that reproduce the old behaviour; they are only written when the key is
 * not stored yet.
 */
const UPGRADE_STEPS = Object.freeze([
  Object.freeze({
    version: 1,
    release: '4.17.0',
    // Before 4.17 a password change kept the user's other sessions.
    legacy: Object.freeze({ endOtherSessionsOnPasswordChange: false }),
  }),
  Object.freeze({
    version: 2,
    release: 'sign-in signals and signed webhook',
    // Before, Discord and Slack received every sign-in (success, new
    // country, suspicious). New installations leave out every sign-in.
    legacy: Object.freeze({ webhookEvents: LEGACY_WEBHOOK_EVENTS }),
  }),
]);

/**
 * Applies the pending upgrade steps.
 *
 * @param {object} strapi Strapi instance.
 * @param {{info: Function, warn: Function}} log Logger.
 * @param {readonly {version: number, legacy: Record<string, unknown>}[]} [steps] Steps (tests).
 * @returns {Promise<{existing: boolean, applied: string[]}>} Whether the installation
 *   existed before and which keys got their old value.
 * @sideeffect Writes the plugin store keys `settings` and `defaultsProfile`.
 */
async function applyUpgradeDefaults(strapi, log, steps = UPGRADE_STEPS) {
  const latest = steps.length ? steps[steps.length - 1].version : 0;
  const outcome = await withPluginStoreKey(strapi, 'settings', async (store) => {
    const profile = Number(await store.get({ key: PROFILE_KEY })) || 0;
    if (profile >= latest) return { existing: profile > 0, applied: [], changed: false };

    const stored = await store.get({ key: 'settings' });
    let existing = profile > 0;
    if (!existing) {
      const permissionsVersion = await store.get({ key: 'contentApiPermissionsVersion' });
      const legacyFlag = await store.get({ key: 'contentApiPermissionsInitialized' });
      existing =
        (stored !== null && stored !== undefined) ||
        (permissionsVersion !== null && permissionsVersion !== undefined) ||
        legacyFlag === true;
    }

    /** @type {string[]} */
    const applied = [];
    if (existing) {
      const settings = stored && typeof stored === 'object' ? { ...stored } : {};
      for (const step of steps) {
        if (step.version <= profile) continue;
        for (const [key, value] of Object.entries(step.legacy)) {
          if (settings[key] !== undefined) continue;
          settings[key] = Array.isArray(value) ? [...value] : value;
          applied.push(key);
        }
      }
      if (applied.length) await store.set({ key: 'settings', value: settings });
    }
    await store.set({ key: PROFILE_KEY, value: latest });
    return { existing, applied, changed: applied.length > 0 };
  });

  if (outcome.changed) {
    await notifySettingsChanged(strapi);
    log.info(
      `[UPGRADE] Kept the previous behaviour of ${outcome.applied.length} setting(s) on this existing installation`
    );
  }
  return { existing: outcome.existing, applied: outcome.applied };
}

module.exports = { PROFILE_KEY, UPGRADE_STEPS, applyUpgradeDefaults };
