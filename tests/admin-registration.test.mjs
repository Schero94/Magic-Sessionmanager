import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../admin/src/${path}`, import.meta.url), 'utf8');
const indexSource = read('index.js');

test('plugin registration does not log to the console in production (UX-14, F18)', () => {
  for (const path of ['index.js', 'components/Initializer.jsx', 'components/PluginIcon.jsx', 'permissions.js']) {
    assert.doesNotMatch(read(path), /console\.(log|info|warn|debug)\(/, path);
  }
  assert.match(indexSource, /logSafeAdminError\('plugin\.bootstrap', error\)/, 'real failures are still reported safely');
});

test('the home widget links to the dashboard and keeps its permission (UX-06)', () => {
  const start = indexSource.indexOf('app.widgets.register({');
  const registration = indexSource.slice(start, indexSource.indexOf('\n      });', start));
  assert.match(registration, /link:\s*\{[\s\S]*?id: `\$\{pluginId\}\.widget\.link`[\s\S]*?href: `\/plugins\/\$\{pluginId\}`/);
  assert.match(registration, /permissions:\s*pluginPermissions/);
  assert.match(indexSource, /typeof app\.widgets\.register === 'function'/, 'older Strapi 5 versions without widgets keep working');
});

test('menu, settings, widget and side panel share one permission definition', () => {
  assert.match(indexSource, /const pluginPermissions = permissions\.access;/);
  assert.match(read('permissions.js'), /import pluginId from '\.\/pluginId'/);
});

test('the side panel is registered once for the Content Manager edit view', () => {
  assert.equal((indexSource.match(/addEditViewSidePanel\(\[SessionInfoPanel\]\)/g) || []).length, 1);
});

test('the plugin icon forwards Strapi icon props and is decorative (F13)', () => {
  const icon = read('components/PluginIcon.jsx');
  assert.match(icon, /import \{ Monitor \} from '@strapi\/icons'/);
  assert.match(icon, /\{\.\.\.props\}/);
  assert.match(icon, /aria-hidden/);
  assert.doesNotMatch(icon, /width="24"|height="24"/);
});
