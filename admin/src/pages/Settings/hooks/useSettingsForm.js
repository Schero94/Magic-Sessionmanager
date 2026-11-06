import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import pluginId from '../../../pluginId';
import { areSettingsEqual } from '../../../utils/settingsEquality.mjs';
import { requireSuccessfulMutation } from '../../../utils/adminResponse.mjs';
import { logSafeAdminError } from '../../../utils/safeAdminLog.mjs';
import { copyText } from '../../../utils/copyText.mjs';
import { formatSessionDate } from '../../../utils/sessionDates.mjs';
import {
  SETTINGS_DEFAULTS,
  getAdjustedFields,
  normalizeSettings,
  validateSettings,
} from '../../../utils/settingsForm.mjs';
import { fillMissingTemplates } from '../../../utils/emailTemplateDraft.mjs';
import { SETTINGS_FIELD_LABELS, buildSavePayload, getErrorTab } from '../settingsTabs.mjs';
import { useSettingsTranslate } from './useSettingsTranslate';

const INITIAL_SETTINGS = { ...SETTINGS_DEFAULTS, emailTemplates: fillMissingTemplates({}) };
const BUILD_DATE_OPTIONS = Object.freeze({ dateStyle: 'medium' });

/**
 * Reads the message of a Strapi error response (`{ error: { message } }`).
 *
 * @param {unknown} error Error thrown by useFetchClient.
 * @returns {string} Server message, or '' when there is none.
 */
const getServerMessage = (error) => {
  const message = error?.response?.data?.error?.message;
  return typeof message === 'string' ? message.trim() : '';
};

/**
 * Joins translated names as a locale list ("A, B and C").
 *
 * @param {string[]} names Names.
 * @param {string} locale Admin locale.
 * @returns {string} Joined names.
 */
const formatList = (names, locale) => {
  try {
    return new Intl.ListFormat(locale || 'en', { style: 'long', type: 'conjunction' }).format(
      names
    );
  } catch {
    return names.join(', ');
  }
};

/**
 * Configuration form state: load, draft, dirty state, validation, save,
 * discard and the GeoIP database actions. Server routes, methods and payloads
 * are unchanged; the hook only decides what the UI shows (IA D5, E.2).
 *
 * @returns {object} Form state and handlers for the Configuration page and tabs.
 */
export function useSettingsForm() {
  const { t, locale } = useSettingsTranslate();
  const { get, post, put } = useFetchClient();
  const { toggleNotification } = useNotification();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [relaxedWarningDismissed, setRelaxedWarningDismissed] = useState(false);
  // Bumped whenever the draft is replaced (Discard, Save). Inputs that keep
  // their own text, like the DS NumberInput, remount with it as their key.
  const [draftVersion, setDraftVersion] = useState(0);
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
  const errorTab = getErrorTab(errors);
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
  const copyValue = useCallback(
    async (value, successMessage, scope) => {
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
    },
    [t, toggleNotification]
  );

  /**
   * Loads local GeoIP availability without exposing the stored license key.
   * A failure only shows an alert inside the database card (IA G).
   *
   * @returns {Promise<object|null>} The status, or null when it could not be loaded.
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
      return status;
    } catch (err) {
      setGeoIpStatus(null);
      setGeoIpStatusError(true);
      logSafeAdminError('settings.geoIpStatus', err);
      return null;
    }
  }, [get]);

  /**
   * Loads persisted settings, fills missing email templates and records the
   * returned values as the discard and dirty-state baseline. A malformed or
   * failed response shows the retry state instead of an editable default
   * draft (IA G).
   *
   * @returns {Promise<void>}
   */
  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await get(`/${pluginId}/settings`);
      if (
        !response?.data?.settings ||
        typeof response.data.settings !== 'object' ||
        Array.isArray(response.data.settings)
      ) {
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
   * Applies a field change to the local settings draft. Changing the token
   * check shows the relaxed-mode warning again.
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
   * Persists the draft. The hidden rate-limit keys are sent back with their
   * stored values, because PUT /settings replaces the whole object (IA F). On
   * success the form takes the settings from the PUT response as both draft
   * and saved baseline, so it shows exactly what the server stored, and names
   * the edited fields the server changed (IA E.2). Invalid drafts are never
   * sent; on failure the draft stays in the form.
   *
   * @returns {Promise<boolean>} Whether the save succeeded.
   */
  const handleSave = useCallback(async () => {
    const submitted = buildSavePayload(settingsRef.current, savedSettingsRef.current);
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
      const storedPayload =
        response.data.settings ?? (await get(`/${pluginId}/settings`))?.data?.settings;
      const stored = normalizeSettings(storedPayload);
      setSettings(stored);
      setSavedSettings(stored);
      setDraftVersion((version) => version + 1);

      const adjustedNames = [
        ...new Set(
          getAdjustedFields(submitted, stored, previous)
            .map((key) => SETTINGS_FIELD_LABELS[key])
            .filter(Boolean)
            .map(([id, defaultMessage]) => t(id, defaultMessage))
        ),
      ];
      toggleNotification({
        type: adjustedNames.length > 0 ? 'warning' : 'success',
        message:
          adjustedNames.length > 0
            ? t(
                'settings.config.feedback.adjusted',
                'Settings saved. Some values were adjusted to the allowed limits: {fields}.',
                { fields: formatList(adjustedNames, locale) }
              )
            : t('notifications.success.saved', 'Settings saved.'),
      });
      await fetchGeoIpStatus();
      return true;
    } catch (err) {
      logSafeAdminError('settings.save', err);
      toggleNotification({
        type: 'danger',
        message: t(
          'settings.config.feedback.saveError',
          'Settings could not be saved. Your changes are still in the form.'
        ),
      });
      return false;
    } finally {
      setSaving(false);
    }
  }, [get, put, t, locale, toggleNotification, fetchGeoIpStatus]);

  /**
   * Discards the local draft and shows the stored settings again without a
   * network round trip, so the page stays mounted and keeps the open tab and
   * focus (IA E.2 "Discard changes", SET-11). It does not restore defaults.
   *
   * @returns {void}
   */
  const handleReset = useCallback(() => {
    setSettings(savedSettingsRef.current);
    setRelaxedWarningDismissed(false);
    setDraftVersion((version) => version + 1);
  }, []);

  /**
   * Deletes the records of all ended sessions after the admin confirmed it
   * (IA E.1 "Delete ended sessions"). Open and idle sessions are not
   * affected; the tokens of deleted records stay revoked until expiry. Throws
   * on failure so the confirmation dialog stays open.
   *
   * @returns {Promise<void>}
   */
  const handleCleanInactive = useCallback(async () => {
    try {
      const { data } = await post(`/${pluginId}/sessions/clean-inactive`);
      const count = Number(data?.deletedCount) || 0;
      toggleNotification({
        type: 'success',
        message:
          count > 0
            ? t(
                'settings.config.feedback.deletedEnded',
                '{count, plural, one {# ended session deleted.} other {# ended sessions deleted.}}',
                { count }
              )
            : t('settings.config.feedback.deletedNone', 'There were no ended sessions to delete.'),
      });
    } catch (err) {
      logSafeAdminError('settings.cleanInactive', err);
      toggleNotification({
        type: 'danger',
        message: t(
          'settings.config.feedback.deleteEndedError',
          'Ended sessions could not be deleted. Some may already be gone; reload to see the current state.'
        ),
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
        message: t('settings.config.feedback.credentialsSaved', 'Credentials saved.'),
      });
      setGeoIpCredentials((prev) => ({ ...prev, licenseKey: '' }));
      await fetchGeoIpStatus();
    } catch (err) {
      logSafeAdminError('settings.saveGeoIpCredentials', err);
      toggleNotification({
        type: 'danger',
        message: t(
          'settings.config.feedback.credentialsSaveError',
          'The credentials could not be saved. Please try again.'
        ),
      });
    } finally {
      setGeoIpSavingCredentials(false);
    }
  }, [put, geoIpCredentials, t, toggleNotification, fetchGeoIpStatus]);

  /**
   * Removes the stored MaxMind credentials after confirmation (IA E.2).
   * Credentials from environment variables are not affected. Throws on
   * failure so the confirmation dialog stays open.
   *
   * @returns {Promise<void>}
   */
  const handleRemoveGeoIpCredentials = useCallback(async () => {
    try {
      const response = await put(`/${pluginId}/geoip/credentials`, { clear: true });
      requireSuccessfulMutation(response.data);
      toggleNotification({
        type: 'success',
        message: t('settings.config.feedback.credentialsRemoved', 'Credentials removed.'),
      });
      setGeoIpCredentials({ accountId: '', licenseKey: '' });
      await fetchGeoIpStatus();
    } catch (err) {
      logSafeAdminError('settings.removeGeoIpCredentials', err);
      toggleNotification({
        type: 'danger',
        message: t(
          'settings.config.feedback.credentialsRemoveError',
          'The credentials could not be removed. Please try again.'
        ),
      });
      throw err;
    }
  }, [put, t, toggleNotification, fetchGeoIpStatus]);

  /**
   * Requests a GeoIP database update (`force` for "Force download"). The
   * server owns path validation and the external download. Success names
   * the edition and build date; errors show the server's message.
   *
   * @param {boolean} force Bypass the freshness check and download again.
   * @returns {Promise<void>}
   */
  const handleUpdateGeoIpDatabase = useCallback(
    async (force = false) => {
      setGeoIpUpdating(true);
      try {
        const response = await post(`/${pluginId}/geoip/update`, { force });
        requireSuccessfulMutation(response.data);
        const status = await fetchGeoIpStatus();
        const result = response.data.result || {};
        const values = {
          edition: status?.editionId || '—',
          date: formatSessionDate(
            result.lastModified || status?.metadata?.lastModified,
            locale,
            '—',
            BUILD_DATE_OPTIONS
          ),
        };
        toggleNotification({
          type: 'success',
          message:
            result.changed === false
              ? t(
                  'settings.config.feedback.geoipCurrent',
                  'The GeoIP database is already up to date: {edition}, built {date}.',
                  values
                )
              : t(
                  'settings.config.feedback.geoipUpdated',
                  'GeoIP database updated: {edition}, built {date}.',
                  values
                ),
        });
      } catch (err) {
        logSafeAdminError('settings.updateGeoIpDatabase', err);
        toggleNotification({
          type: 'danger',
          message:
            getServerMessage(err) ||
            t(
              'settings.config.feedback.geoipUpdateError',
              'The GeoIP database could not be updated.'
            ),
        });
      } finally {
        setGeoIpUpdating(false);
      }
    },
    [post, t, locale, toggleNotification, fetchGeoIpStatus]
  );

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
    draftVersion,
    copyValue,
    notify: toggleNotification,
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
      removeCredentials: handleRemoveGeoIpCredentials,
      updateDatabase: handleUpdateGeoIpDatabase,
    },
  };
}

export default useSettingsForm;
