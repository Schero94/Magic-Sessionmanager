import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../admin/src/${path}`, import.meta.url), 'utf8');
const source = read('pages/HomePage.jsx');
const actions = read('pages/Dashboard/SessionActions.jsx');
const table = read('pages/Dashboard/SessionTable.jsx');
const cards = read('pages/Dashboard/SessionCardList.jsx');

function getHandler(name) {
  const start = source.indexOf(`const ${name} = async`);
  assert.notEqual(start, -1, `expected ${name} handler`);
  const end = source.indexOf('\n  };', start);
  assert.notEqual(end, -1, `expected ${name} handler end`);
  return source.slice(start, end);
}

test('dashboard termination runs only after ConfirmAction, locks the row, awaits refresh, and reports success or failure', () => {
  const handler = getHandler('handleTerminateSession');

  // Confirmation happens in ConfirmAction before the handler runs; never window.confirm.
  assert.doesNotMatch(source, /\bconfirm\(/);
  assert.match(actions, /onConfirm: \(\) => onLogOut\(session\.id\)/);
  assert.match(handler, /setTerminatingSessionId\(sessionId\)/);
  assert.ok(handler.indexOf('setTerminatingSessionId(sessionId)') < handler.indexOf('post('));
  assert.match(handler, /await fetchSessions\(\)/);
  assert.match(handler, /notifications\.success\.terminated/);
  assert.match(handler, /notifications\.error\.terminate/);
  assert.match(handler, /throw err;/, 'a failure keeps the confirmation open for a retry');
  assert.match(handler, /finally[\s\S]*setTerminatingSessionId\(null\)/);
});

test('dashboard session-detail removal confirms, prevents duplicate clicks, refreshes and reports both outcomes', () => {
  const handler = getHandler('handleDeleteSession');

  assert.match(actions, /onConfirm: \(\) => onRemove\(session\.id\)/);
  assert.match(handler, /if \(terminatingSessionId \|\| deletingSessionId\) return;/);
  assert.match(handler, /setDeletingSessionId\(sessionId\)/);
  assert.ok(handler.indexOf('setDeletingSessionId(sessionId)') < handler.indexOf('del('));
  assert.match(handler, /await fetchSessions\(\)/);
  assert.match(handler, /notifications\.success\.deleted/);
  assert.match(handler, /notifications\.error\.delete/);
  assert.match(handler, /throw err;/);
  assert.match(handler, /finally[\s\S]*setDeletingSessionId\(null\)/);
});

test('desktop and mobile dashboard action buttons expose pending state and block duplicate mutations', () => {
  assert.match(source, /const mutationPending = Boolean\(terminatingSessionId \|\| deletingSessionId\)/);
  // ConfirmAction shows the pending spinner on its confirm button; every
  // destructive trigger in both layouts is disabled while a mutation runs.
  assert.ok((actions.match(/disabled=\{!canLogOut \|\| mutationPending\}/g) || []).length >= 4);
  assert.ok((actions.match(/disabled=\{mutationPending\}/g) || []).length >= 4);
  assert.ok((actions.match(/<ConfirmAction\b/g) || []).length >= 4, 'both layouts confirm both destructive actions');
  assert.match(table, /<SessionActions[\s\S]*?layout="table"/);
  assert.match(cards, /<SessionActions[\s\S]*?layout="card"/);
});

test('every row action names the session user (DUX-06, DUX-07, DASH-09)', () => {
  for (const key of ['homepage.actions.viewFor', 'homepage.actions.logOutFor', 'homepage.actions.alreadyEndedFor', 'homepage.actions.removeFor']) {
    assert.match(actions, new RegExp(`t\\('${key.replace(/\./g, '\\.')}', '[^']*\\{user\\}[^']*', \\{ user \\}\\)`), key);
  }
  assert.match(actions, /const user = getSessionUserLabels\(session\)\.accessible/);
  // Table: DS IconButton (no icon-only Button) inside an IconButtonGroup.
  assert.match(actions, /<IconButtonGroup\b/);
  assert.ok((actions.match(/<IconButton\b[\s\S]*?label=\{/g) || []).length >= 3);
  // Cards: visible text plus the user-qualified name (label in name).
  assert.ok((actions.match(/aria-label=\{(?:viewLabel|logOutLabel|removeLabel)\}/g) || []).length >= 3);
  // Remove is danger-light in both layouts (DASH-13).
  assert.equal((actions.match(/variant="danger-light"/g) || []).length, 4);
});

test('DS grid cell keys: row buttons keep Enter/Space and dialog keys never move the grid (DASH-01)', () => {
  assert.match(actions, /onKeyDown=\{isolateActionKeys\}/);
  assert.match(actions, /shouldIsolateActionKey\(event\.key, fromInsideGroup\)/);
  assert.match(actions, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/, 'dialog clicks do not open the row');
  assert.match(table, /colCount=\{DASHBOARD_TABLE_COLUMNS\}/);
  assert.match(table, /rowCount=\{sessions\.length \+ 1\}/);
});

test('rows are not extra tab stops and have no overriding aria-label (DUX-08)', () => {
  const rowStart = table.indexOf('<Tr\n              key={session.id}');
  assert.ok(rowStart > 0, 'body row exists');
  const row = table.slice(rowStart, table.indexOf('<Td>', rowStart));
  assert.doesNotMatch(row, /tabIndex/);
  assert.doesNotMatch(row, /aria-label/);
  assert.doesNotMatch(row, /onKeyDown/);
  assert.match(row, /querySelector\('\[data-session-view\]'\)/, 'a row click returns focus to the View button');
});

test('the table has no fixed minimum width and lets user/device cells shrink (DUX-01, DASH-02)', () => {
  assert.doesNotMatch(table, /minWidth:\s*\d/);
  assert.match(table, /maxWidth: 0, width: '40%'/);
  assert.match(table, /ellipsis/);
});

test('below the large breakpoint the list renders as semantic cards (DUX-14, DASH-18)', () => {
  assert.match(source, /const \{ isBelowLarge \} = useBreakpoint\(\)/);
  assert.match(source, /isBelowLarge \? <SessionCardList \{\.\.\.listProps\} \/> : <SessionTable \{\.\.\.listProps\} \/>/);
  assert.match(cards, /styled\.ul`/);
  assert.match(cards, /tag="li"/);
  assert.match(cards, /<PropertyList\b/);
  assert.doesNotMatch(source + table + cards, /@media|max-width: 768px/);
});

test('refresh keeps the list mounted and focus is restored after a mutation (DUX-02, DASH-17)', () => {
  const fetchHandler = getHandler('fetchSessions');
  assert.match(fetchHandler, /if \(hasLoadedRef\.current\) setRefreshing\(true\);\s*else setLoading\(true\);/);
  assert.match(source, /busy: refreshing/);
  assert.match(source, /pickFocusSessionId\(mutationSnapshotRef\.current, visibleIdsRef\.current, sessionId\)/);
  assert.match(actions, /fallbackFocusRef=\{focusFallback\}/);
  assert.match(actions, /key=\{logOutKey\}/, 'the ended trigger remounts so focus moves to the fallback');
});

test('query state lives in the URL with native search, status filter and pagination', () => {
  assert.match(source, /const \[\{ query \}, setQuery\] = useQueryParams\(\)/);
  assert.match(source, /parseDashboardQuery\(query\)/);
  assert.match(source, /<SearchInput\b/);
  assert.match(source, /<Pagination\.PageSize\b/);
  assert.match(source, /<Pagination\.Links\b/);
  assert.match(source, /setQuery\(\{ status: value === 'all' \? undefined : value, page: '1' \}\)/);
  assert.match(source, /<SimpleMenu\b[\s\S]*?<MenuItem onSelect=\{handleExportCSV\}>[\s\S]*?<MenuItem onSelect=\{handleExportJSON\}>/);
});

test('empty and no-results states use plain strings and offer Clear filters (DUX-17)', () => {
  const states = source.match(/<EmptyStateLayout\b[\s\S]*?\n\s*\/>/g) || [];
  assert.equal(states.length, 2);
  for (const state of states) {
    assert.match(state, /content=\{t\('homepage\.(?:noResults|empty)\.description'/);
  }
  assert.match(source, /homepage\.noResults\.reset/);
  assert.match(source, /setSearchResetKey/);
});

test('dates, devices and status use the shared admin-locale helpers (DASH-05, DASH-06, I18N-4, I18N-10)', () => {
  const all = source + table + cards;
  assert.doesNotMatch(all, /toLocaleString\(/);
  assert.doesNotMatch(all, /\} on \{/);
  assert.match(table, /formatRelativeTime\(date\)/);
  assert.match(table, /formatDate\(date\)/);
  assert.match(table, /deviceSummary\(session\)/);
  assert.match(table, /<StatusBadge session=\{session\}/);
  assert.match(cards, /<StatusBadge session=\{session\}/);
  assert.doesNotMatch(all, /homepage\.time\.minAgo|minutesSinceActive/);
});

test('the dashboard has an h2 for the list and four KPI cards (DUX-09, DUX-20)', () => {
  assert.match(source, /variant="delta"\s+tag="h2"/);
  assert.equal((source.match(/<StatCard\b/g) || []).length, 4);
  const cardsWithTone = [...source.matchAll(/<StatCard\s+icon=\{(\w+)\}\s+tone="(\w+)"/g)];
  assert.equal(cardsWithTone.length, 4);
  assert.equal(new Set(cardsWithTone.map((match) => match[1])).size, 4, 'distinct icons');
  assert.equal(new Set(cardsWithTone.map((match) => match[2])).size, 4, 'distinct tones');
  assert.match(source, /homepage\.stats\.endedBreakdown/);
});
