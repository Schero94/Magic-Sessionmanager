import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../admin/src/components/SessionDetailModal.jsx', import.meta.url), 'utf8');

test('session details header has a localized close label', () => {
  assert.match(source, /<Modal\.Header\s+closeLabel=\{t\('common\.close', 'Close'\)\}/);
});

test('session details uses the native dialog title', () => {
  assert.match(source, /<Modal\.Title\b[^>]*>\s*\{t\('modal\.title', 'Session Details'\)\}\s*<\/Modal\.Title>/);
});

test('the close label is available in every supported locale', () => {
  for (const locale of ['en', 'de', 'es', 'fr', 'pt']) {
    const messages = JSON.parse(readFileSync(new URL(`../admin/src/translations/${locale}.json`, import.meta.url)));
    assert.ok(messages['common.close'], locale);
  }
});
