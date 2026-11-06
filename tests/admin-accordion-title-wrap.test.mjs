import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('all settings accordion titles wrap using the native trigger', () => {
  const source = readFileSync(new URL('../admin/src/pages/Settings.jsx', import.meta.url), 'utf8');
  assert.match(source, /const SettingsAccordionTrigger = styled\(Accordion\.Trigger\)/);
  assert.match(source, /white-space:\s*normal/);
  assert.match(source, /overflow-wrap:\s*anywhere/);
  assert.equal((source.match(/<SettingsAccordionTrigger\b/g) || []).length, 5);
  assert.doesNotMatch(source, /<Accordion\.Trigger\b/);
});
