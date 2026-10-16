import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const settingsSource = readFileSync(new URL('../admin/src/pages/Settings.jsx', import.meta.url), 'utf8');
const formFieldSource = readFileSync(new URL('../admin/src/components/FormField.jsx', import.meta.url), 'utf8');

test('raw settings textareas are connected to their visible labels and descriptions', () => {
  const textareas = settingsSource.match(/<textarea\b[\s\S]*?>/g) || [];

  assert.equal(textareas.length, 4);
  for (const [index, textarea] of textareas.entries()) {
    assert.match(textarea, /\bid=/, `textarea ${index + 1} needs a stable id for its label`);
    assert.match(textarea, /\baria-describedby=/, `textarea ${index + 1} needs its description association`);
  }

  assert.match(formFieldSource, /const hintId = `\$\{id\}-hint`/);
  assert.match(formFieldSource, /<FieldHint id=\{hintId\}/);
});
