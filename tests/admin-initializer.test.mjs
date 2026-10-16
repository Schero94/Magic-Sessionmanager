import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const initializerSource = readFileSync(new URL('../admin/src/components/Initializer.jsx', import.meta.url), 'utf8');

test('admin initializer only registers the plugin and does not manage Strapi Admin sessions', () => {
  assert.match(initializerSource, /ref\.current\(pluginId\)/);
  assert.doesNotMatch(initializerSource, /useFetchClient|license\/status|HEARTBEAT_INTERVAL|setInterval|setTimeout/);
});
