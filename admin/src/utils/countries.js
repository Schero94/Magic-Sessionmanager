/**
 * ISO 3166-1 alpha-2 country codes with display names and flag emojis.
 *
 * Kept inline (not an npm dep) because the settings page only needs
 * a lookup for the most-common countries and the admin can type any
 * two-letter code manually for anything not listed.
 *
 * If you need the full ISO list, swap this for `i18n-iso-countries` or
 * similar — but expect ~200 KB of extra admin-bundle size.
 */
export const COUNTRIES = [
  { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  { code: 'AT', name: 'Austria', flag: '🇦🇹' },
  { code: 'CH', name: 'Switzerland', flag: '🇨🇭' },
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦' },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'IE', name: 'Ireland', flag: '🇮🇪' },
  { code: 'FR', name: 'France', flag: '🇫🇷' },
  { code: 'IT', name: 'Italy', flag: '🇮🇹' },
  { code: 'ES', name: 'Spain', flag: '🇪🇸' },
  { code: 'PT', name: 'Portugal', flag: '🇵🇹' },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
  { code: 'BE', name: 'Belgium', flag: '🇧🇪' },
  { code: 'LU', name: 'Luxembourg', flag: '🇱🇺' },
  { code: 'SE', name: 'Sweden', flag: '🇸🇪' },
  { code: 'NO', name: 'Norway', flag: '🇳🇴' },
  { code: 'DK', name: 'Denmark', flag: '🇩🇰' },
  { code: 'FI', name: 'Finland', flag: '🇫🇮' },
  { code: 'PL', name: 'Poland', flag: '🇵🇱' },
  { code: 'CZ', name: 'Czech Republic', flag: '🇨🇿' },
  { code: 'SK', name: 'Slovakia', flag: '🇸🇰' },
  { code: 'HU', name: 'Hungary', flag: '🇭🇺' },
  { code: 'RO', name: 'Romania', flag: '🇷🇴' },
  { code: 'BG', name: 'Bulgaria', flag: '🇧🇬' },
  { code: 'GR', name: 'Greece', flag: '🇬🇷' },
  { code: 'HR', name: 'Croatia', flag: '🇭🇷' },
  { code: 'SI', name: 'Slovenia', flag: '🇸🇮' },
  { code: 'EE', name: 'Estonia', flag: '🇪🇪' },
  { code: 'LV', name: 'Latvia', flag: '🇱🇻' },
  { code: 'LT', name: 'Lithuania', flag: '🇱🇹' },
  { code: 'IS', name: 'Iceland', flag: '🇮🇸' },
  { code: 'TR', name: 'Turkey', flag: '🇹🇷' },
  { code: 'RU', name: 'Russia', flag: '🇷🇺' },
  { code: 'UA', name: 'Ukraine', flag: '🇺🇦' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
  { code: 'AR', name: 'Argentina', flag: '🇦🇷' },
  { code: 'CL', name: 'Chile', flag: '🇨🇱' },
  { code: 'CO', name: 'Colombia', flag: '🇨🇴' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺' },
  { code: 'NZ', name: 'New Zealand', flag: '🇳🇿' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵' },
  { code: 'KR', name: 'South Korea', flag: '🇰🇷' },
  { code: 'CN', name: 'China', flag: '🇨🇳' },
  { code: 'HK', name: 'Hong Kong', flag: '🇭🇰' },
  { code: 'TW', name: 'Taiwan', flag: '🇹🇼' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
  { code: 'IN', name: 'India', flag: '🇮🇳' },
  { code: 'ID', name: 'Indonesia', flag: '🇮🇩' },
  { code: 'TH', name: 'Thailand', flag: '🇹🇭' },
  { code: 'VN', name: 'Vietnam', flag: '🇻🇳' },
  { code: 'PH', name: 'Philippines', flag: '🇵🇭' },
  { code: 'MY', name: 'Malaysia', flag: '🇲🇾' },
  { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪' },
  { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦' },
  { code: 'IL', name: 'Israel', flag: '🇮🇱' },
  { code: 'EG', name: 'Egypt', flag: '🇪🇬' },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦' },
  { code: 'NG', name: 'Nigeria', flag: '🇳🇬' },
  { code: 'KE', name: 'Kenya', flag: '🇰🇪' },
  { code: 'MA', name: 'Morocco', flag: '🇲🇦' },
];

/**
 * Normalizes a candidate country code: trims, uppercases, validates ISO-2.
 * @param {string} raw
 * @returns {string|null}
 */
export const normalizeCountryCode = (raw) => {
  if (typeof raw !== 'string') return null;
  const up = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(up)) return null;
  return up;
};

/**
 * Returns the localized country name for an ISO-2 code, or '' when the code
 * is not in the list.
 *
 * @param {string} code ISO 3166-1 alpha-2 code.
 * @param {string} [locale] Admin locale.
 * @returns {string} Country name.
 */
export const getCountryName = (code, locale = 'en') => {
  const match = COUNTRIES.find((c) => c.code === code);
  if (!match) return '';
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) || match.name;
  } catch {
    // Retain the existing English label when locale data is unavailable.
    return match.name;
  }
};

/**
 * Renders a short label for an ISO-2 code: "Name (CODE)" when known,
 * otherwise just the code. Flags are emoji and stay out of the admin UI and
 * accessible names unless explicitly requested (SET-06 browser).
 *
 * @param {string} code ISO 3166-1 alpha-2 code.
 * @param {string} [locale] Admin locale.
 * @param {{withFlag?: boolean}} [options] Prefix the flag emoji.
 * @returns {string} Display label.
 */
export const formatCountry = (code, locale = 'en', { withFlag = false } = {}) => {
  if (!code) return '';
  const match = COUNTRIES.find((c) => c.code === code);
  if (!match) return code;
  const label = `${getCountryName(code, locale)} (${match.code})`;
  return withFlag ? `${match.flag} ${label}` : label;
};

/**
 * Lists the known countries sorted by their localized name, excluding codes
 * that are already selected. Used for the Combobox typeahead.
 *
 * @param {string} [locale] Admin locale.
 * @param {string[]} [exclude] Codes to leave out.
 * @returns {Array<{code: string, label: string}>} Options.
 */
export const getCountryOptions = (locale = 'en', exclude = []) => {
  let collator;
  try {
    collator = new Intl.Collator(locale);
  } catch {
    collator = new Intl.Collator('en');
  }
  return COUNTRIES
    .filter((country) => !exclude.includes(country.code))
    .map((country) => ({ code: country.code, label: formatCountry(country.code, locale) }))
    .sort((left, right) => collator.compare(left.label, right.label));
};

/**
 * Picks the element to focus after removing the item at `removedIndex` from
 * a list of `remainingCount` items: the next item, else the previous one,
 * else null (the caller then focuses the picker) (SET-06 browser).
 *
 * @param {number} removedIndex Index of the removed item.
 * @param {number} remainingCount Items left after removal.
 * @returns {number|null} Index to focus, or null when the list is empty.
 */
export const getFocusIndexAfterRemoval = (removedIndex, remainingCount) => {
  if (remainingCount <= 0) return null;
  return Math.min(Math.max(removedIndex, 0), remainingCount - 1);
};
