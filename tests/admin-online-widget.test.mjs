import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const widgetSource = readFileSync(new URL('../admin/src/components/OnlineUsersWidget.jsx', import.meta.url), 'utf8');

test('Online Users loads aggregate counts through the permission-protected plugin API only', () => {
  assert.match(widgetSource, /get\(['"]\/magic-sessionmanager\/users\/stats['"]\)/);
  assert.doesNotMatch(widgetSource, /content-manager\/collection-types\/plugin::users-permissions\.user/);
});

test('Online Users distinguishes unavailable counts and session-load errors from real zeroes', () => {
  assert.match(widgetSource, /loadError/);
  assert.match(widgetSource, /userCountsUnavailable/);
  assert.match(widgetSource, /role=/);
  assert.match(widgetSource, /common\.retry|widget\.error/);
  assert.match(widgetSource, /common\.unavailable/);
});
