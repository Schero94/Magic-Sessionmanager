import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const settingsSource = readFileSync(new URL('../admin/src/pages/Settings.jsx', import.meta.url), 'utf8');

test('session settings use Strapi Design System single-value accordion API', () => {
  const root = settingsSource.match(/<Accordion\.Root\b([^>]*)>/)?.[1];

  assert.ok(root, 'settings accordion root exists');
  assert.match(root, /defaultValue="general"/);
  assert.doesNotMatch(root, /\btype=/);
  assert.doesNotMatch(root, /defaultValue=\{\[/);
});
