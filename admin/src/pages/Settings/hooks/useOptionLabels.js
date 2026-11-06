import { useMemo } from 'react';
import { useSettingsTranslate } from './useSettingsTranslate';

/**
 * Readable select values with their unit (IA F, H.7): "15 min", "30 s",
 * "90 days", "Forever", "Off", and "{value} (custom)" for stored values that
 * are not one of the presets.
 *
 * @returns {{
 *   minutes: (count: number) => string,
 *   seconds: (count: number) => string,
 *   days: (count: number) => string,
 *   graceMs: (ms: number) => string,
 *   retentionDays: (days: number) => string,
 *   custom: (value: string) => string,
 * }} Formatters bound to the admin locale.
 */
export function useOptionLabels() {
  const { t } = useSettingsTranslate();
  return useMemo(() => {
    const minutes = (count) => t('settings.config.unit.minutes', '{count} min', { count });
    const seconds = (count) => t('settings.config.unit.seconds', '{count} s', { count });
    const days = (count) => t('settings.config.unit.days', '{count, plural, one {# day} other {# days}}', { count });
    return {
      minutes,
      seconds,
      days,
      graceMs: (ms) => (ms === 0 ? t('settings.config.option.off', 'Off') : seconds(Math.round(ms / 100) / 10)),
      retentionDays: (value) => (value === -1 ? t('settings.config.option.forever', 'Forever') : days(value)),
      custom: (value) => t('settings.config.option.custom', '{value} (custom)', { value }),
    };
  }, [t]);
}

export default useOptionLabels;
