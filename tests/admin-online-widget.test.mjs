import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const widgetSource = readFileSync(new URL('../admin/src/components/OnlineUsersWidget.jsx', import.meta.url), 'utf8');

test('Online Users loads sessions through the permission-protected plugin API only', () => {
  assert.match(widgetSource, /get\(['"]\/magic-sessionmanager\/sessions['"]\)/);
  assert.doesNotMatch(widgetSource, /content-manager\/collection-types\/plugin::users-permissions\.user/);
});

test('Online Users distinguishes load errors and empty data from real zeroes', () => {
  assert.match(widgetSource, /loadError/);
  assert.match(widgetSource, /role="alert"/);
  assert.match(widgetSource, /common\.retry/);
  assert.match(widgetSource, /widget\.error\.description/);
  assert.match(widgetSource, /stats\.sessionCount === 0/, 'no session at all shows the NoData state, not four zeroes');
  assert.match(widgetSource, /if \(showLoading\) setLoadError\(true\)/, 'a failed background refresh keeps the last values');
});

test('Online Users uses Strapi widget state helpers when available and falls back otherwise (UX-06)', () => {
  assert.match(widgetSource, /import \* as StrapiAdmin from '@strapi\/strapi\/admin'/);
  assert.doesNotMatch(widgetSource, /import\s*\{[^}]*\bWidget\b[^}]*\}\s*from '@strapi\/strapi\/admin'/, 'Widget must be feature-detected, not statically imported');
  for (const state of ['Loading', 'Error', 'NoData']) {
    assert.match(widgetSource, new RegExp(`hasNativeState\\('${state}'\\)`), `${state} is feature-detected`);
    assert.match(widgetSource, new RegExp(`<NativeWidget\\.${state}>`), `${state} uses the native helper`);
  }
  assert.match(widgetSource, /<Loader small>/, 'local loading fallback uses the DS Loader');
});

test('Online Users shows four equal tiles in a 2 x 2 grid without overflow (F9, F10)', () => {
  for (const key of ['widget.stats.onlineNow', 'widget.stats.last15min', 'widget.stats.lastHour', 'widget.stats.today']) {
    assert.match(widgetSource, new RegExp(key.replace(/\./g, '\\.')), key);
  }
  assert.doesNotMatch(widgetSource, /widget\.stats\.(offline|last30min|totalUsers|blocked)/);
  assert.match(widgetSource, /repeat\(auto-fit, minmax\(min\(100%, max\(14rem, calc\(\(100% - 1px\) \/ 2\)\)\), 1fr\)\)/,
    'at most two columns, one column on narrow widgets, never wider than the widget');
  assert.match(widgetSource, /height="100%"/, 'tiles fill their grid row');
  assert.doesNotMatch(widgetSource, /gridCols=\{2\}/);
});

test('Online Users tiles are stable, decorative-icon-only and use theme colours (UX-10, UX-12, F13, F16)', () => {
  assert.match(widgetSource, /^const StatTile = /m, 'StatTile is declared at module scope');
  assert.doesNotMatch(widgetSource, /^\s{2,}const StatCard = /m, 'no card component is re-created during render');
  assert.match(widgetSource, /<Icon aria-hidden focusable=\{false\} \/>/);
  assert.match(widgetSource, /theme\.colors\.neutral200/);
  assert.doesNotMatch(widgetSource, /rgba?\(|#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(widgetSource, /transition:/);
  const icons = [...widgetSource.matchAll(/key: '\w+', icon: (\w+), tone/g)].map((match) => match[1]);
  assert.equal(icons.length, 4);
  assert.equal(new Set(icons).size, 4, 'every metric has its own icon');
});

test('Online Users formats numbers with the admin locale', () => {
  assert.match(widgetSource, /formatNumber\(stats\[tile\.key\]\)/);
});
