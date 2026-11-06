import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * Symmetry contract for the admin UI (docs/plans/2026-11-06-ui-redesign-design.md):
 * DS tokens only, no emoji, no browser dialogs, no custom breakpoints.
 */

const adminRoot = fileURLToPath(new URL('../admin/src/', import.meta.url));

const listJsx = (directory) =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return listJsx(path);
    return entry.endsWith('.jsx') ? [path] : [];
  });

const sources = listJsx(adminRoot).map((path) => ({
  file: relative(adminRoot, path),
  source: readFileSync(path, 'utf8'),
}));

const lineOf = (source, index) => source.slice(0, index).split('\n').length;

/** Removes comments so documentation does not trip the scan. */
const stripComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (match, prefix) => prefix + ' '.repeat(match.length - prefix.length));

/**
 * @param {(source: string) => Array<{index: number, match: string}>} finder Violation finder.
 * @returns {Record<string, string[]>} Violations per file.
 */
const scan = (finder) => {
  const violations = {};
  for (const { file, source } of sources) {
    const code = stripComments(source);
    const found = finder(code).map(({ index, match }) => `L${lineOf(code, index)}: ${match.trim().slice(0, 80)}`);
    if (found.length) violations[file] = found;
  }
  return violations;
};

const matchAll = (pattern) => (code) =>
  [...code.matchAll(pattern)].map((match) => ({ index: match.index, match: match[0] }));

const report = (t, title, violations) => {
  for (const [file, lines] of Object.entries(violations)) {
    t.diagnostic(`${title} in ${file}: ${lines.join(' | ')}`);
  }
  const summary = Object.entries(violations).map(([file, lines]) => `${file} (${lines.length})`).join(', ');
  assert.deepEqual(violations, {}, `${title}: ${summary}`);
};

test('the scan covers the admin JSX sources', () => {
  assert.ok(sources.length > 5, 'admin/src contains JSX files to scan');
  assert.ok(sources.some(({ file }) => file.startsWith('components/ui/')), 'shared ui blocks are scanned');
});

test('no window.confirm: destructive actions use ConfirmAction', (t) => {
  report(t, 'window.confirm', scan(matchAll(/\bwindow\.confirm\s*\(/g)));
});

test('no emoji characters in admin JSX', (t) => {
  const emoji = /(?![©®™])\p{Extended_Pictographic}|️/gu;
  report(t, 'emoji', scan(matchAll(emoji)));
});

test('no hex, rgb or rgba colour literals', (t) => {
  const colours = /(?<=['"`:\s(,])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\brgba?\s*\(/g;
  report(t, 'colour literal', scan(matchAll(colours)));
});

test('no px font sizes', (t) => {
  const fontSizes = /font-?size\s*[:=]\s*[{'"`]*\s*\d+(?:\.\d+)?px/gi;
  report(t, 'px font size', scan(matchAll(fontSizes)));
});

test('no hard-coded px margin, padding or gap in style props', (t) => {
  const finder = (code) => {
    const found = [];
    for (const block of code.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
      const body = block[1];
      for (const declaration of body.matchAll(/\b(?:margin|padding|gap|rowGap|columnGap)\w*\s*:\s*['"`]?[^,}]*?\b\d+(?:\.\d+)?px/g)) {
        found.push({ index: block.index + 'style={{'.length + declaration.index, match: declaration[0] });
      }
    }
    return found;
  };
  report(t, 'px spacing in style prop', scan(finder));
});

test('no custom @media widths: use DS theme breakpoints', (t) => {
  // Literal widths, interpolated custom constants (`max-width: ${breakpoints.mobile}`)
  // and hand-written matchMedia queries all bypass theme.breakpoints.
  const media = /@media[^{`]*\(\s*(?:max|min)-width\s*:\s*(?:\d+(?:\.\d+)?(?:px|em|rem)|\$\{)|matchMedia\(\s*['"`][^'"`]*\d+px/g;
  report(t, 'custom breakpoint', scan(matchAll(media)));
});
