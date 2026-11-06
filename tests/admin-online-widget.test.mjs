import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const widgetSource = readFileSync(new URL('../admin/src/components/OnlineUsersWidget.jsx', import.meta.url), 'utf8');

test('Online Users loads sessions and count-only user totals through the permission-protected plugin API only', () => {
  assert.match(widgetSource, /get\(['"]\/magic-sessionmanager\/sessions['"]\)/);
  assert.match(widgetSource, /get\(['"]\/magic-sessionmanager\/users\/stats['"]\)/);
  assert.match(widgetSource, /Promise\.allSettled\(/, 'a failing user-totals request does not hide the session tiles');
  assert.match(widgetSource, /normalizeUserCounts\(/);
  assert.match(widgetSource, /requireSessionList\(/);
  assert.doesNotMatch(widgetSource, /content-manager\/collection-types\/plugin::users-permissions\.user/);
});

test('Online Users distinguishes load errors and empty data from real zeroes (IA G)', () => {
  assert.match(widgetSource, /loadError/);
  assert.match(widgetSource, /role="alert"/);
  assert.match(widgetSource, /t\('widget\.error\.message', 'Online users could not be loaded\.'\)/);
  assert.match(widgetSource, /t\('common\.tryAgain', 'Try again'\)/);
  assert.match(widgetSource, /stats\.sessionCount === 0/, 'no session at all shows the NoData state, not four zeroes');
  assert.match(widgetSource, /t\('widget\.empty\.noSignIns', 'No users have signed in yet\.'\)/);
  assert.match(widgetSource, /if \(showLoading\) setLoadError\(true\)/, 'a failed background refresh keeps the last values');
  assert.match(widgetSource, /if \(showLoading\) setUserCounts\(null\)/, 'a failed background totals refresh keeps the last totals');
  // Widget.Error fills the widget height; inside an auto-height box it keeps its
  // natural height, so "Try again" sits under the message instead of at the bottom edge.
  assert.match(widgetSource, /<Box>\s*<NativeWidget\.Error>\{message\}<\/NativeWidget\.Error>\s*<\/Box>/);
});

test('when only the user totals fail, the tiles say so and Blocked users shows the missing marker', () => {
  assert.match(widgetSource, /t\('widget\.stats\.userTotalsError', 'User totals could not be loaded\.'\)/);
  assert.match(widgetSource, /value: userCounts \? formatNumber\(userCounts\.blockedUsers\) : null/);
  assert.match(widgetSource, /<MissingValue\b/);
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

test('Online Users shows the IA D4 tiles in a 2 x 2 grid without overflow (I.1-27, I.2-2, F9, F10)', () => {
  const keys = [...widgetSource.matchAll(/key: '(\w+)',\s*icon:/g)].map((match) => match[1]);
  assert.deepEqual(keys, ['onlineUsers', 'activeSessions', 'idleSessions', 'blockedUsers']);
  for (const [id, label] of [
    ['widget.stats.onlineUsers', 'Online users'],
    ['widget.stats.activeSessions', 'Active sessions'],
    ['widget.stats.idleSessions', 'Idle sessions'],
    ['widget.stats.blockedUsers', 'Blocked users'],
  ]) {
    assert.match(widgetSource, new RegExp(`t\\('${id.replace(/\./g, '\\.')}', '${label}'\\)`), id);
  }
  assert.match(widgetSource, /'\{total, plural, one \{of # registered user\} other \{of # registered users\}\}'/);
  assert.doesNotMatch(widgetSource, /widget\.stats\.(onlineNow|last15min|last30min|lastHour|today|offline)/, 'retired tiles are gone');
  assert.doesNotMatch(widgetSource, /15 \* 60|FIFTEEN_MINUTES|ONE_HOUR|startOfLocalDay/, 'no hard-coded activity windows');
  assert.match(widgetSource, /repeat\(auto-fit, minmax\(min\(100%, max\(14rem, 50%\)\), 1fr\)\)/,
    'at most two columns, one column on narrow widgets, never wider than the widget');
  assert.match(widgetSource, /height="100%"/, 'tiles fill their grid row, so a row has equal heights');
  assert.match(widgetSource, /grid-auto-rows: 1fr;/, 'both rows share one height, so the 2 x 2 tiles are equal');
  assert.doesNotMatch(widgetSource, /gap: 1px/, 'cell lines are tile borders, not an off-scale 1px grid gap');
  assert.match(widgetSource, /border-right: 1px solid/);
  assert.match(widgetSource, /border-bottom: 1px solid/);
  assert.doesNotMatch(widgetSource, /gridCols=\{2\}/);
});

test('Online Users tiles are stable, decorative-icon-only and use theme colours (UX-10, UX-12, F13, F16)', () => {
  assert.match(widgetSource, /^const StatTile = /m, 'StatTile is declared at module scope');
  assert.doesNotMatch(widgetSource, /^\s{2,}const StatCard = /m, 'no card component is re-created during render');
  assert.match(widgetSource, /<Icon aria-hidden focusable=\{false\} \/>/);
  assert.match(widgetSource, /theme\.colors\.neutral200/);
  assert.doesNotMatch(widgetSource, /rgba?\(|#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(widgetSource, /transition:/);
  const icons = [...widgetSource.matchAll(/key: '\w+',\s*icon: (\w+),\s*tone/g)].map((match) => match[1]);
  assert.equal(icons.length, 4);
  assert.equal(new Set(icons).size, 4, 'every metric has its own icon');
});

test('Online Users formats numbers with the admin locale', () => {
  for (const key of ['onlineUsers', 'activeSessions', 'idleSessions']) {
    assert.match(widgetSource, new RegExp(`formatNumber\\(stats\\.${key}\\)`), key);
  }
});
