import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import pluginId from '../../../pluginId';
import { areSettingsEqual } from '../../../utils/settingsEquality.mjs';
import { requireSuccessfulMutation } from '../../../utils/adminResponse.mjs';
import { logSafeAdminError } from '../../../utils/safeAdminLog.mjs';
import { copyText } from '../../../utils/copyText.mjs';
import {
  SETTINGS_DEFAULTS,
  SETTINGS_TABS,
  getAdjustedFields,
  normalizeSettings,
  tabHasErrors,
  validateSettings,
} from '../../../utils/settingsForm.mjs';
import { fillMissingTemplates } from '../../../utils/emailTemplateDraft.mjs';
import { useSettingsTranslate } from './useSettingsTranslate';

const INITIAL_SETTINGS = { ...SETTINGS_DEFAULTS, emailTemplates: fillMissingTemplates({}) };

/**
 * Settings form state: load, draft, dirty state, validation, save and reset.
 * Server routes, methods and payloads are unchanged; the hook only decides
 * what the UI shows (spec section 3).
 *
 * @returns {object} Form state and handlers for the Settings page and tabs.
 */
export function useSettingsForm() {
  const { t } = useSettingsTranslate();
  const { get, post, put } = useFetchClient();
  const { toggleNotification } = useNotification();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [relaxedWarningDismissed, setRelaxedWarningDismissed] = useState(false);
  const [geoIpStatus, setGeoIpStatus] = useState(null);
  const [geoIpStatusError, setGeoIpStatusError] = useState(false);
  const [geoIpCredentials, setGeoIpCredentials] = useState({ accountId: '', licenseKey: '' });
  const [geoIpUpdating, setGeoIpUpdating] = useState(false);
  const [geoIpSavingCredentials, setGeoIpSavingCredentials] = useState(false);

  const [settings, setSettings] = useState(INITIAL_SETTINGS);
  const [savedSettings, setSavedSettings] = useState(settings);
  const hasChanges = !areSettingsEqual(settings, savedSettings);
  const errors = useMemo(() => validateSettings(settings), [settings]);
  const errorCount = Object.keys(errors).length;
  const errorTab = SETTINGS_TABS.find((tab) => tabHasErrors(errors, tab));
  const canSave = hasChanges && errorCount === 0 && !saving;

  // Read inside async handlers so a save always sends the latest draft.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const savedSettingsRef = useRef(savedSettings);
  savedSettingsRef.current = savedSettings;

  /**
   * Copies text after a user action and reports the result.
   *
   * @param {string} value Text to copy.
   * @param {string} successMessage Translated success notification.
   * @param {string} scope Log scope for failures.
   * @returns {Promise<void>}
   */
  const copyValue = useCallback(async (value, successMessage, scope) => {
    try {
      await copyText(value);
      toggleNotification({ type: 'success', message: successMessage });
    } catch (error) {
      logSafeAdminError(scope, error);
      toggleNotification({
        type: 'danger',
        message: t('notifications.error.clipboard', 'Could not copy to clipboard.'),
      });
    }
  }, [t, toggleNotification]);

  /**
   * Loads local GeoIP availability without exposing the stored license key.
   *
   * @returns {Promise<void>}
   */
  const fetchGeoIpStatus = useCallback(async () => {
    setGeoIpStatus(null);
    setGeoIpStatusError(false);
    try {
      const response = await get(`/${pluginId}/geoip/status`);
      const status = response?.data?.status;
      if (typeof status?.exists !== 'boolean' || typeof status?.hasCredentials !== 'boolean') {
        throw new Error('Invalid GeoIP status response');
      }
      setGeoIpStatus(status);
      setGeoIpCredentials((prev) => ({
        accountId: prev.accountId || status.accountId || '',
        licenseKey: '',
      }));
    } catch (err) {
      setGeoIpStatus(null);
      setGeoIpStatusError(true);
      logSafeAdminError('settings.geoIpStatus', err);
    }
  }, [get]);

  /**
   * Loads persisted settings, fills missing email templates and records the
   * returned values as the reset and dirty-state baseline. A malformed or
   * failed response shows the retry state instead of an editable default
   * draft.
   *
   * @returns {Promise<void>}
   */
  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await get(`/${pluginId}/settings`);
      if (!response?.data?.settings || typeof response.data.settings !== 'object' || Array.isArray(response.data.settings)) {
        throw new Error('Invalid settings response');
      }
      const nextSettings = normalizeSettings(response.data.settings);
      setSettings(nextSettings);
      setSavedSettings(nextSettings);
      await fetchGeoIpStatus();
    } catch (err) {
      logSafeAdminError('settings.load', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [get, fetchGeoIpStatus]);

  // Load once on mount. The ref keeps this independent of whether the host's
  // useFetchClient returns stable functions (older 5.x releases may not).
  const fetchSettingsRef = useRef(fetchSettings);
  fetchSettingsRef.current = fetchSettings;
  useEffect(() => {
    fetchSettingsRef.current();
  }, []);

  /**
   * Applies a field change to the local settings draft. Changing strict
   * enforcement shows the relaxed-mode warning again.
   *
   * @param {string} key Settings field name.
   * @param {unknown} value New draft value.
   * @returns {void}
   */
  const handleChange = useCallback((key, value) => {
    if (key === 'strictSessionEnforcement') {
      setRelaxedWarningDismissed(false);
    }
    setSettings((previousSettings) => ({ ...previousSettings, [key]: value }));
  }, []);

  /**
   * Persists the draft. On success the form takes the settings from the PUT
   * response as both draft and saved baseline, so it shows exactly what the
   * server stored, and warns when the server changed an edited value (for
   * example a rejected webhook URL). Invalid drafts are never sent.
   *
   * @returns {Promise<boolean>} Whether the save succeeded.
   */
  const handleSave = useCallback(async () => {
    const submitted = settingsRef.current;
    const previous = savedSettingsRef.current;
    if (Object.keys(validateSettings(submitted)).length > 0) return false;

    setSaving(true);
    try {
      const response = await put(`/${pluginId}/settings`, submitted);
      if (!response?.data?.success) {
        throw new Error('Save failed');
      }
      // Prefer the stored settings from the PUT response; re-read them when
      // the response does not include them.
      const storedPayload = response.data.settings ?? (await get(`/${pluginId}/settings`))?.data?.settings;
      const stored = normalizeSettings(storedPayload);
      setSettings(stored);
      setSavedSettings(stored);

      const adjusted = getAdjustedFields(submitted, stored, previous);
      toggleNotification({
        type: adjusted.length > 0 ? 'warning' : 'success',
        message: adjusted.length > 0
          ? t(
            'notifications.warning.adjusted',
            'Settings saved. The server changed {count, plural, one {# value} other {# values}}; the form now shows the stored settings.',
            { count: adjusted.length }
          )
          : t('notifications.success.saved', 'Settings saved.'),
      });
      await fetchGeoIpStatus();
      return true;
    } catch (err) {
      logSafeAdminError('settings.save', err);
      toggleNotification({
        type: 'danger',
        message: t('notifications.error.save', 'Failed to save settings to server'),
      });
      return false;
    } finally {
      setSaving(false);
    }
  }, [get, put, t, toggleNotification, fetchGeoIpStatus]);

  /**
   * Discards the local draft and restores the saved baseline without a
   * network round trip, so the page stays mounted and keeps the open tab
   * (SET-11 browser).
   *
   * @returns {void}
   */
  const handleReset = useCallback(() => {
    setSettings(savedSettingsRef.current);
    setRelaxedWarningDismissed(false);
  }, []);

  /**
   * Removes inactive session details after the admin confirmed it in the
   * dialog. The server keeps deny hashes for access tokens that have not yet
   * expired. Throws on failure so the confirmation dialog stays open.
   *
   * @returns {Promise<void>}
   */
  const handleCleanInactive = useCallback(async () => {
    try {
      const { data } = await post(`/${pluginId}/sessions/clean-inactive`);
      toggleNotification({
        type: 'success',
        message: t(
          'notifications.success.cleaned',
          'Removed {count} inactive session records. Unexpired access tokens remain revoked until expiry.',
          { count: data?.deletedCount ?? 0 }
        ),
      });
    } catch (err) {
      logSafeAdminError('settings.cleanInactive', err);
      toggleNotification({
        type: 'danger',
        message: t('notifications.error.clean', 'Failed to delete inactive sessions'),
      });
      throw err;
    }
  }, [post, t, toggleNotification]);

  /**
   * Stores MaxMind credentials through the protected GeoIP endpoint and then
   * clears the in-memory license key before refreshing status.
   *
   * @returns {Promise<void>}
   */
  const handleSaveGeoIpCredentials = useCallback(async () => {
    setGeoIpSavingCredentials(true);
    try {
      const response = await put(`/${pluginId}/geoip/credentials`, geoIpCredentials);
      requireSuccessfulMutation(response.data);
      toggleNotification({
        type: 'success',
        message: t('notifications.success.geoipCredentialsSaved', 'MaxMind credentials saved.'),
      });
      setGeoIpCredentials((prev) => ({ ...prev, licenseKey: '' }));
      await fetchGeoIpStatus();
    } catch (err) {
      logSafeAdminError('settings.saveGeoIpCredentials', err);
      toggleNotification({
        type: 'danger',
        message: t('notifications.error.geoipCredentials', 'Failed to save MaxMind credentials.'),
      });
    } finally {
      setGeoIpSavingCredentials(false);
    }
  }, [put, geoIpCredentials, t, toggleNotification, fetchGeoIpStatus]);

  /**
   * Requests a local GeoIP database update. The server owns path validation
   * and the external download.
   *
   * @param {boolean} force Bypass freshness checks and request a refresh.
   * @returns {Promise<void>}
   */
  const handleUpdateGeoIpDatabase = useCallback(async (force = false) => {
    setGeoIpUpdating(true);
    try {
      const response = await post(`/${pluginId}/geoip/update`, { force });
      requireSuccessfulMutation(response.data);
      toggleNotification({
        type: 'success',
        message: response.data.result?.changed
          ? t('notifications.success.geoipUpdated', 'GeoIP database updated.')
          : t('notifications.success.geoipCurrent', 'GeoIP database is already current.'),
      });
      await fetchGeoIpStatus();
    } catch (err) {
      logSafeAdminError('settings.updateGeoIpDatabase', err);
      toggleNotification({
        type: 'danger',
        message: t('notifications.error.geoipUpdate', 'Failed to update GeoIP database.'),
      });
    } finally {
      setGeoIpUpdating(false);
    }
  }, [post, t, toggleNotification, fetchGeoIpStatus]);

  return {
    loading,
    loadError,
    saving,
    settings,
    savedSettings,
    hasChanges,
    errors,
    errorCount,
    errorTab,
    canSave,
    relaxedWarningDismissed,
    setRelaxedWarningDismissed,
    copyValue,
    fetchSettings,
    handleChange,
    handleSave,
    handleReset,
    handleCleanInactive,
    geoIp: {
      status: geoIpStatus,
      statusError: geoIpStatusError,
      credentials: geoIpCredentials,
      setCredentials: setGeoIpCredentials,
      updating: geoIpUpdating,
      savingCredentials: geoIpSavingCredentials,
      fetchStatus: fetchGeoIpStatus,
      saveCredentials: handleSaveGeoIpCredentials,
      updateDatabase: handleUpdateGeoIpDatabase,
    },
  };
}

export default useSettingsForm;
