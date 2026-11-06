import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('template and webhook textareas do not suppress their native focus indicator', () => {
  const source = readFileSync(new URL('../admin/src/pages/Settings.jsx', import.meta.url), 'utf8');
  const textareas = source.match(/<textarea\b[\s\S]*?\/>/g) || [];
  assert.equal(textareas.length, 4);
  for (const textarea of textareas) assert.doesNotMatch(textarea, /outline:\s*['"]none['"]/);
});
