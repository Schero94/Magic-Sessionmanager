import { useCallback } from 'react';
import { useIntl } from 'react-intl';
import { getTranslation } from '../../../utils/getTranslation';

/**
 * Settings translation helpers bound to the admin locale.
 *
 * `t(id, defaultMessage, values)` formats a plugin message. The default must
 * equal the en.json value. `tError(descriptor)` formats a validation
 * descriptor from utils/settingsForm.mjs.
 *
 * @returns {{
 *   t: (id: string, defaultMessage: string, values?: object) => string,
 *   tError: (descriptor?: {messageId: string, defaultMessage: string, values?: object}|null) => string|undefined,
 *   locale: string,
 * }} Bound helpers.
 */
export function useSettingsTranslate() {
  const { formatMessage, locale } = useIntl();
  const t = useCallback(
    (id, defaultMessage, values) =>
      formatMessage({ id: getTranslation(id), defaultMessage }, values),
    [formatMessage]
  );
  const tError = useCallback(
    (descriptor) =>
      descriptor
        ? t(descriptor.messageId, descriptor.defaultMessage, descriptor.values)
        : undefined,
    [t]
  );
  return { t, tError, locale };
}

export default useSettingsTranslate;
