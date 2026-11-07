import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const adminRoot = fileURLToPath(new URL('../../admin/src/', import.meta.url));
const settingsDir = join(adminRoot, 'pages/Settings');

const walk = (directory) =>
  readdirSync(directory)
    .sort()
    .flatMap((entry) => {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) return walk(path);
      return /\.(?:jsx?|mjs)$/.test(entry) ? [path] : [];
    });

/**
 * Files of the Settings page: the re-export in pages/Settings.jsx plus every
 * module under pages/Settings/ (tabs, cards and hooks), in a stable order.
 *
 * @returns {Array<{file: string, source: string}>} Relative path and source.
 */
export function readSettingsFiles() {
  return [join(adminRoot, 'pages/Settings.jsx'), ...walk(settingsDir)].map((path) => ({
    file: relative(adminRoot, path),
    source: readFileSync(path, 'utf8'),
  }));
}

/**
 * @param {string} name File name relative to pages/Settings/ (e.g. 'GeneralTab.jsx').
 * @returns {string} Source of one Settings module.
 */
export function readSettingsFile(name) {
  return readFileSync(join(settingsDir, name), 'utf8');
}

/**
 * Concatenated source of the whole Settings page, for source-contract tests
 * that used to read the single pages/Settings.jsx file.
 *
 * @returns {string} Source text.
 */
export function readSettingsSource() {
  return readSettingsFiles()
    .map(({ file, source }) => `// ---- ${file}\n${source}`)
    .join('\n');
}
