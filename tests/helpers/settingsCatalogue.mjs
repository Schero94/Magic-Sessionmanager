import { readFileSync } from 'node:fs';

export const LOCALES = ['en', 'de', 'es', 'fr', 'pt'];

/**
 * @param {string} locale Locale code.
 * @returns {Record<string, string>} The admin translation catalogue.
 */
export function readCatalogue(locale) {
  return JSON.parse(
    readFileSync(new URL(`../../admin/src/translations/${locale}.json`, import.meta.url), 'utf8')
  );
}
