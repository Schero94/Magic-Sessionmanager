/**
 * Infers the persisted Geofencing mode from its country lists.
 * Empty lists have no restriction and use Allowlist as the initial UI mode.
 *
 * @param {{ allowedCountries?: unknown, blockedCountries?: unknown }} settings Stored settings.
 * @returns {'allowlist' | 'blocklist'} The mode represented by the stored country lists.
 */
export const inferGeofencingMode = (settings) => {
  if (Array.isArray(settings?.allowedCountries) && settings.allowedCountries.length > 0) {
    return 'allowlist';
  }

  if (Array.isArray(settings?.blockedCountries) && settings.blockedCountries.length > 0) {
    return 'blocklist';
  }

  return 'allowlist';
};

/**
 * Returns the settings field associated with the selected Geofencing mode.
 *
 * @param {'allowlist' | 'blocklist'} mode Current UI mode.
 * @returns {'allowedCountries' | 'blockedCountries'} The active list field.
 */
export const getGeofencingField = (mode) =>
  mode === 'blocklist' ? 'blockedCountries' : 'allowedCountries';

/**
 * Keeps the user's selected mode in draft UI state and identifies the opposite
 * list that must be cleared to preserve the server's mutual-exclusion rule.
 *
 * @param {'allowlist' | 'blocklist'} currentMode Current form mode.
 * @param {'allowlist' | 'blocklist'} requestedMode Mode chosen by the user.
 * @returns {{ mode: 'allowlist' | 'blocklist', clearField: 'allowedCountries' | 'blockedCountries' | null }}
 *   The next UI mode and any country list that must be emptied.
 */
export const selectGeofencingMode = (currentMode, requestedMode) => {
  if (requestedMode !== 'allowlist' && requestedMode !== 'blocklist') {
    return { mode: currentMode, clearField: null };
  }

  if (requestedMode === currentMode) {
    return { mode: currentMode, clearField: null };
  }

  return {
    mode: requestedMode,
    clearField: requestedMode === 'allowlist' ? 'blockedCountries' : 'allowedCountries',
  };
};
