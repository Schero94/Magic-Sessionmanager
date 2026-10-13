import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const settingsSource = readFileSync(new URL('../admin/src/pages/Settings.jsx', import.meta.url), 'utf8');

test('Strapi Design System toggles expose accessible names and state labels', () => {
  const toggles = settingsSource.match(/<Toggle\b[\s\S]*?\/>/g) || [];

  assert.ok(toggles.length > 0, 'expected at least one settings toggle');
  for (const [index, toggle] of toggles.entries()) {
    assert.match(toggle, /aria-label=/, `toggle ${index + 1} needs an accessible name`);
    assert.match(toggle, /onLabel=/, `toggle ${index + 1} needs an on-state label`);
    assert.match(toggle, /offLabel=/, `toggle ${index + 1} needs an off-state label`);
  }
});

test('Strapi Design System alerts provide close labels and text inputs use Field labels', () => {
  const alerts = settingsSource.match(/<Alert\b[^>]*>/g) || [];
  const textInputs = settingsSource.match(/<TextInput\b[^>]*>/g) || [];

  assert.ok(alerts.length > 0, 'expected at least one settings alert');
  for (const [index, alert] of alerts.entries()) {
    assert.match(alert, /closeLabel=/, `alert ${index + 1} needs a close label`);
  }
  for (const [index, input] of textInputs.entries()) {
    assert.doesNotMatch(input, /\blabel=/, `text input ${index + 1} must use Field.Label instead of an unsupported label prop`);
  }
});
