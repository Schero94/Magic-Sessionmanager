import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * SET-17 / DUX-11 regression guard: styles may only target elements the
 * plugin renders itself (or the root element of a DS component it renders),
 * never nested Design System markup, Radix data attributes or positional
 * selectors into DS components. Those break silently on a DS update.
 */

const ADMIN = new URL('../admin/src/', import.meta.url);
const read = (relativePath) => readFileSync(new URL(relativePath, ADMIN), 'utf8');

/** Every styled-components template literal in a source file. */
const styledBlocks = (source) =>
  [...source.matchAll(/styled(?:\.\w+|\([^)]*\))(?:\.attrs\([^)]*\))?`([\s\S]*?)`;/g)].map(
    (m) => m[1]
  );

const FORBIDDEN = [
  [/data-radix/, 'Radix data attribute'],
  [/:(?:first|last)-child/, 'positional selector into DS markup'],
  [/\[role=['"](?:status|alert|tab|tablist|tabpanel)['"]\]/, 'DS layout role used as a style hook'],
  [/>\s*span\b/, 'selector into the DS label span'],
];

const settingsFiles = readdirSync(new URL('pages/Settings/', ADMIN))
  .filter((file) => file.endsWith('.jsx'))
  .map((file) => `pages/Settings/${file}`);
const SHARED = [
  'components/PersistentAlert.jsx',
  'components/ui/ActionStack.jsx',
  'components/FormField.jsx',
  'components/SettingsToggleRow.jsx',
];

test('Settings and the shared blocks it uses do not style DS internals (SET-17)', () => {
  for (const file of [...settingsFiles, ...SHARED]) {
    for (const block of styledBlocks(read(file))) {
      for (const [pattern, label] of FORBIDDEN) {
        assert.doesNotMatch(block, pattern, `${file}: ${label}`);
      }
    }
  }
});

test('the persistent notice is composed from public DS props, not by hiding the DS close button', () => {
  const alert = read('components/PersistentAlert.jsx');
  assert.doesNotMatch(alert, /import \{[^}]*\bAlert\b[^}]*\} from '@strapi\/design-system'/);
  assert.match(alert, /background=\{`\$\{tone\}100`\}/);
  assert.match(alert, /borderColor=\{`\$\{tone\}200`\}/);
  assert.match(alert, /fill=\{`\$\{tone\}700`\}/);
});

test('the legacy static palette module is gone (DUX-11)', () => {
  assert.throws(() => read('utils/theme.js'), /ENOENT/);
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) walk(url);
      else if (/\.(jsx?|mjs)$/.test(entry.name)) files.push(url);
    }
  };
  walk(ADMIN);
  for (const url of files) {
    assert.doesNotMatch(
      readFileSync(url, 'utf8'),
      /from ['"][./]*(?:utils\/)?theme(?:\.js)?['"]/,
      `${url.pathname} imports the removed static theme`
    );
  }
});
