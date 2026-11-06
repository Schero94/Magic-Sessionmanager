import { useCallback, useMemo } from 'react';
import { useIntl } from 'react-intl';
import { getTranslation } from './getTranslation';
import { formatRelative, formatSessionDate } from './sessionDates.mjs';
import { MISSING_VALUE_GLYPH } from './missingValue.mjs';
import { getDevicePresentation } from './devicePresentation.mjs';
import { getSessionStatusPresentation, getSessionEndReasonPresentation } from './sessionStatus.mjs';

/**
 * Locale-aware formatters bound to the Strapi admin locale (useIntl), so no
 * screen falls back to the browser locale (DASH-05, I18N-10).
 *
 * @returns {{
 *   locale: string,
 *   formatDate: (value: unknown, options?: Intl.DateTimeFormatOptions) => string,
 *   formatRelativeTime: (value: unknown, now?: number|Date) => string,
 *   translate: (descriptor: {messageId: string, defaultMessage: string}, values?: object) => string,
 *   statusLabel: (statusOrSession: string|object) => string,
 *   endReasonLabel: (session: object) => string,
 *   deviceTypeLabel: (session: object) => string,
 *   deviceSummary: (session: object) => string,
 * }} Bound formatters. Missing values return the shared glyph.
 */
export function useSessionFormatters() {
  const { formatMessage, locale } = useIntl();

  const translate = useCallback(
    (descriptor, values) =>
      formatMessage({ id: getTranslation(descriptor.messageId), defaultMessage: descriptor.defaultMessage }, values),
    [formatMessage]
  );

  return useMemo(() => {
    const formatDate = (value, options) =>
      formatSessionDate(value, locale, MISSING_VALUE_GLYPH, options);
    const formatRelativeTime = (value, now) =>
      formatRelative(value, locale, { now: now ?? Date.now(), fallback: MISSING_VALUE_GLYPH });
    const statusLabel = (statusOrSession) => translate(getSessionStatusPresentation(statusOrSession));
    const endReasonLabel = (session) => {
      const reason = getSessionEndReasonPresentation(session);
      return reason ? translate(reason) : '';
    };
    const deviceTypeLabel = (session) => translate(getDevicePresentation(session).deviceTypeMessage);
    const deviceSummary = (session) => {
      const { summary } = getDevicePresentation(session);
      return summary.text ?? translate(summary, summary.values);
    };
    return {
      locale,
      formatDate,
      formatRelativeTime,
      translate,
      statusLabel,
      endReasonLabel,
      deviceTypeLabel,
      deviceSummary,
    };
  }, [locale, translate]);
}

export default useSessionFormatters;
