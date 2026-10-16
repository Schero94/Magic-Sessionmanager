import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const indexSource = readFileSync(new URL('../admin/src/index.js', import.meta.url), 'utf8');
const panelSource = readFileSync(new URL('../admin/src/components/SessionInfoPanel.jsx', import.meta.url), 'utf8');

test('Online Users widget is hidden from admins without the Session Manager permission', () => {
  const registration = indexSource.slice(
    indexSource.indexOf('app.widgets.register({'),
    indexSource.indexOf('\n      });', indexSource.indexOf('app.widgets.register({'))
  );

  assert.match(registration, /permissions:\s*pluginPermissions/);
});

test('Users & Permissions session panel checks the plugin permission before loading user sessions', () => {
  assert.match(panelSource, /useRBAC\(pluginPermissions\.access\)/);
  assert.match(panelSource, /permissionsLoading\s*\|\|\s*!canAccess/);
  assert.match(panelSource, /model !== 'plugin::users-permissions\.user'[\s\S]*?permissionsLoading[\s\S]*?!canAccess/);
});
