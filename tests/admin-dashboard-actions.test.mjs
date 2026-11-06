import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../admin/src/${path}`, import.meta.url), 'utf8');
const source = read('pages/HomePage.jsx');
const actions = read('pages/Dashboard/SessionActions.jsx');
const table = read('pages/Dashboard/SessionTable.jsx');
const cards = read('pages/Dashboard/SessionCardList.jsx');
const search = read('pages/Dashboard/SessionSearch.jsx');
const howItWorks = read('pages/Dashboard/HowSessionsWork.jsx');
const badge = read('components/ui/StatusBadge.jsx');

function getHandler(name) {
  const start = source.indexOf(`const ${name} = async`);
  assert.notEqual(start, -1, `expected ${name} handler`);
  const end = source.indexOf('\n  };', start);
  assert.notEqual(end, -1, `expected ${name} handler end`);
  return source.slice(start, end);
}

test('End session runs only after ConfirmAction, locks the row, awaits refresh, and reports all outcomes (IA E.1)', () => {
  const handler = getHandler('handleTerminateSession');

  // Confirmation happens in ConfirmAction before the handler runs; never window.confirm.
  assert.doesNotMatch(source + actions, /\bconfirm\(/);
  assert.match(actions, /onConfirm: \(\) => onEnd\(session\)/);
  assert.match(handler, /setTerminatingSessionId\(sessionId\)/);
  assert.ok(handler.indexOf('setTerminatingSessionId(sessionId)') < handler.indexOf('post('));
  assert.match(handler, /sessions\/\$\{sessionId\}\/terminate/);
  assert.match(handler, /await fetchSessions\(\)/);
  assert.match(handler, /notifications\.success\.sessionEnded', 'Session ended\.'/);
  assert.match(handler, /getErrorStatus\(err\) === 404[\s\S]*notifications\.error\.sessionGone', 'This session no longer exists\. The list was refreshed\.'/);
  assert.match(handler, /notifications\.error\.endSession', 'The session could not be ended\. Please try again\.'/);
  assert.match(handler, /throw err;/, 'a failure keeps the confirmation open for a retry');
  assert.match(handler, /finally[\s\S]*setTerminatingSessionId\(null\)/);
});

test('Delete record confirms, prevents duplicate clicks, refreshes and reports both outcomes (IA E.1)', () => {
  const handler = getHandler('handleDeleteSession');

  assert.match(actions, /onConfirm=\{\(\) => onDelete\(session\)\}/);
  assert.match(handler, /if \(terminatingSessionId \|\| deletingSessionId\) return;/);
  assert.match(handler, /setDeletingSessionId\(sessionId\)/);
  assert.ok(handler.indexOf('setDeletingSessionId(sessionId)') < handler.indexOf('del('));
  assert.match(handler, /await fetchSessions\(\)/);
  assert.match(handler, /notifications\.success\.recordDeleted', 'Session record deleted\. Its token stays revoked\.'/);
  assert.match(handler, /notifications\.error\.deleteRecord', 'The record could not be deleted\. Please try again\.'/);
  assert.match(handler, /throw err;/);
  assert.match(handler, /finally[\s\S]*setDeletingSessionId\(null\)/);
});

test('Delete record has two confirmation variants: ended row and open row (I.1 item 9)', () => {
  assert.match(actions, /homepage\.confirm\.deleteEnded\.title', 'Delete this session record\?'/);
  assert.match(actions, /homepage\.confirm\.deleteEnded\.body',\s*'The record is removed permanently from history, statistics and exports\. This cannot be undone\.'/);
  assert.match(actions, /homepage\.actions\.deleteRecord', 'Delete record'/);
  assert.match(actions, /homepage\.confirm\.deleteOpen\.title', 'Delete record and end session\?'/);
  assert.match(actions, /homepage\.confirm\.deleteOpen\.body',\s*'This session is still open\. \{user\} will be signed out on \{device\}, and the record is removed from history, statistics and exports\. This cannot be undone\.'/);
  assert.match(actions, /homepage\.actions\.deleteAndEnd', 'Delete and end'/);
  assert.match(actions, /homepage\.confirm\.end\.title', 'End this session\?'/);
  assert.match(actions, /homepage\.confirm\.end\.body',\s*'\{user\} will be signed out on \{device\}\. Their other sessions stay open\. The record stays in the history\. This cannot be undone\.'/);
});

test('table actions are View details, End session (disabled when ended) and More actions → Delete record', () => {
  assert.match(actions, /<IconButtonGroup\b/);
  assert.match(actions, /label=\{canEnd \? endLabel : endedLabel\}/);
  assert.match(actions, /<SimpleMenu\b[\s\S]*?tag=\{IconButton\}[\s\S]*?label=\{moreLabel\}/);
  assert.match(actions, /<MenuItem startIcon=\{<Trash \/>\} variant="danger" onSelect=\{\(\) => setDeleteOpen\(true\)\}>/);
  // The confirmation for the menu item is controlled and returns focus to the More button.
  assert.match(actions, /isOpen=\{deleteOpen\}/);
  assert.match(actions, /returnFocusRef=\{moreRef\}/);
  assert.doesNotMatch(actions, /SignOut|logOut|Log out|onRemove/);
});

test('both layouts block duplicate mutations', () => {
  assert.ok((actions.match(/disabled=\{!canEnd \|\| mutationPending\}/g) || []).length >= 4);
  assert.ok((actions.match(/disabled=\{mutationPending\}/g) || []).length >= 2);
  assert.match(table, /<SessionActions[\s\S]*?layout="table"/);
  assert.match(cards, /<SessionActions[\s\S]*?layout="card"/);
});

test('every row action names the session user (DUX-06, DUX-07, DASH-09)', () => {
  for (const key of ['homepage.actions.viewFor', 'homepage.actions.endFor', 'homepage.actions.alreadyEndedFor', 'homepage.actions.moreFor']) {
    assert.match(actions, new RegExp(`t\\('${key.replace(/\./g, '\\.')}', '[^']*\\{user\\}[^']*', \\{ user \\}\\)`), key);
  }
  assert.match(actions, /const user = getSessionUserLabels\(session\)\.accessible/);
  assert.ok((actions.match(/<IconButton\b[\s\S]*?label=\{/g) || []).length >= 2);
  // Cards: visible text plus the user-qualified name (label in name).
  assert.ok((actions.match(/aria-label=\{(?:viewLabel|endLabel|moreLabel)\}/g) || []).length >= 3);
  // Card buttons: Details, End session (open rows only), More; equal widths.
  assert.match(actions, /homepage\.actions\.details', 'Details'/);
  assert.match(actions, /homepage\.actions\.more', 'More'/);
  assert.match(actions, /\{canEnd \? \(\s*<Grid\.Item/);
  assert.match(actions, /const span = canEnd \? 4 : 6;/);
});

test('DS grid cell keys: row buttons keep Enter/Space and dialog keys never move the grid (DASH-01)', () => {
  assert.match(actions, /onKeyDown=\{isolateActionKeys\}/);
  assert.match(actions, /shouldIsolateActionKey\(event\.key, fromInsideGroup\)/);
  assert.match(actions, /if \(shouldRedispatchEscape\(event\.key, fromInsideGroup\)\)[\s\S]*?ownerDocument\.dispatchEvent\(new KeyboardEvent\('keydown'/, 'Escape still closes the confirmation and the More menu');
  assert.match(actions, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/, 'dialog clicks do not open the row');
  assert.match(table, /colCount=\{compact \? DASHBOARD_COMPACT_TABLE_COLUMNS : DASHBOARD_TABLE_COLUMNS\}/);
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
  assert.match(table, /maxWidth: 0, width: '30%'/);
  assert.match(table, /ellipsis/);
});

test('responsive tiers: full table when the list is wide enough, table without IP and Signed in from 768, cards below (I.1 item 10)', () => {
  assert.match(source, /const \{ isBelowMedium, isBelowLarge \} = useBreakpoint\(\)/);
  assert.match(source, /isBelowMedium\s*\?\s*<SessionCardList \{\.\.\.listProps\} \/>\s*:\s*<SessionTable \{\.\.\.listProps\} compact=\{shouldUseCompactTable\(listWidth, isBelowLarge\)\} \/>/);
  assert.match(source, /<Flex ref=\{listWidthRef\}/, 'the compact decision uses the measured list width');
  assert.match(table, /\{compact \? null : <Th>\{header\('homepage\.table\.ipAddress', 'IP address'\)\}<\/Th>\}/);
  assert.match(table, /\{compact \? null : <Th>\{header\('homepage\.table\.signedIn', 'Signed in'\)\}<\/Th>\}/);
  assert.match(cards, /styled\.ul`/);
  assert.match(cards, /tag="li"/);
  assert.doesNotMatch(source + table + cards, /@media|max-width: 768px/);
});

test('refresh keeps the list mounted, keeps data on a refresh error, and restores focus (DUX-02, DASH-17, IA G)', () => {
  const fetchHandler = getHandler('fetchSessions');
  assert.match(fetchHandler, /if \(hasLoadedRef\.current\) setRefreshing\(true\);\s*else setLoading\(true\);/);
  assert.match(fetchHandler, /setTruncated\(data\?\.meta\?\.truncated === true\)/);
  assert.match(fetchHandler, /setLastUpdated\(Date\.now\(\)\)/);
  assert.doesNotMatch(fetchHandler.slice(fetchHandler.indexOf('catch')), /setSessions\(/, 'a failed refresh keeps the last data');
  assert.match(source, /busy: refreshing/);
  assert.match(source, /pickFocusSessionId\(mutationSnapshotRef\.current, visibleIdsRef\.current, sessionId\)/);
  assert.match(actions, /fallbackFocusRef=\{focusFallback\}/);
  assert.match(actions, /key=\{endKey\}/, 'the ended trigger remounts so focus moves to the fallback');
});

test('query state lives in the URL: search, status, end reason, page and page size (IA C, D1.5)', () => {
  assert.match(source, /const \[\{ query \}, setQuery\] = useQueryParams\(\)/);
  assert.match(source, /parseDashboardQuery\(query\)/);
  assert.match(source, /<Pagination\.PageSize options=\{\[\.\.\.PAGE_SIZE_OPTIONS\]\} \/>/);
  assert.match(source, /<Pagination\.Links \/>/);
  assert.match(source, /setQuery\(\{ status: status === 'all' \? undefined : status, reason: undefined, page: '1' \}\)/);
  assert.match(source, /setQuery\(\{ reason: reason === 'all' \? undefined : reason, page: '1' \}\)/);
  assert.match(source, /search: encodeSearchQuery\(value\)/);
  assert.match(source, /\{dashboard\.status === 'ended' \? \(\s*<SingleSelect\b[\s\S]*?homepage\.filter\.reasonLabel', 'End reason'/);
  assert.match(source, /<SimpleMenu\b[\s\S]*?<MenuItem onSelect=\{handleExportCSV\}>[\s\S]*?<MenuItem onSelect=\{handleExportJSON\}>/);
});

test('the search is always visible with a placeholder, never an icon-only button (IA D1.5)', () => {
  assert.match(source, /<SessionSearch value=\{dashboard\.search\} onSearch=\{handleSearch\} \/>/);
  assert.doesNotMatch(source, /<SearchInput\b/, 'Strapi SearchInput collapses to an icon while empty');
  assert.match(search, /<SearchForm\b/);
  assert.match(search, /<Searchbar\b[\s\S]*?placeholder=\{t\('homepage\.search\.placeholder', 'Search user, email, IP or device'\)\}/);
  assert.match(search, /\{t\('homepage\.search\.label', 'Search sessions'\)\}\s*<\/Searchbar>/, 'the search has a label');
});

test('header: Sessions title, end-user subtitle, Export menu and Analytics/Settings links (IA D1.1, I.1 items 4-5)', () => {
  assert.match(source, /title=\{t\('homepage\.title', 'Sessions'\)\}/);
  assert.match(source, /'homepage\.subtitle',\s*'Sign-ins of your app’s users \(Users & Permissions\)\. Strapi administrators are not listed\.'/);
  assert.match(source, /<LinkButton tag=\{Link\} to=\{ANALYTICS_PATH\}/);
  assert.match(source, /<LinkButton tag=\{Link\} to=\{CONFIGURATION_PATH\}/);
  assert.match(source, /const ANALYTICS_PATH = `\/settings\/\$\{pluginId\}\/analytics`/);
  assert.match(source, /homepage\.export\.csv', '\{count, plural, one \{Export # session as CSV\} other \{Export # sessions as CSV\}\}'/);
  assert.match(source, /homepage\.export\.csvTruncated'/);
  assert.match(source, /homepage\.export\.disabledHint', 'No sessions match the current filter\.'/);
});

test('truncation alert, Last updated line and polite caption (IA D1.2, D1.5, D1.6, I.1 item 11)', () => {
  assert.match(source, /\{showSessionData && truncated \? \(\s*<Alert variant="default"/);
  assert.match(source, /'Only the latest \{limit, number\} sessions are loaded\. Counts, filters and exports cover these sessions only\.'/);
  assert.match(source, /homepage\.lastUpdated', 'Last updated \{time\}'/);
  assert.match(source, /aria-live="polite"\s+data-session-caption=""/);
  assert.match(source, /homepage\.caption', '\{from, number\}–\{to, number\} of \{total, plural, one \{# session\} other \{# sessions\}\}'/);
});

test('"How sessions work" is a collapsed disclosure with the three-state legend (IA D1.3)', () => {
  assert.match(source, /<HowSessionsWork \/>/);
  assert.match(howItWorks, /aria-expanded=\{open\}/);
  assert.match(howItWorks, /aria-controls=\{contentId\}/);
  assert.match(howItWorks, /useState\(\(\) => readDisclosureOpen\(getBrowserStorage\(\)\)\)/);
  assert.match(howItWorks, /writeDisclosureOpen\(getBrowserStorage\(\), next\)/);
  assert.match(howItWorks, /SESSION_STATES\.map/);
  assert.match(howItWorks, /'Ended sessions stay in the history until they are deleted\.'/);
});

test('empty, no-results and error states follow IA G and use plain strings (DUX-17)', () => {
  const states = source.match(/<EmptyStateLayout\b[\s\S]*?\n\s*\/>/g) || [];
  assert.equal(states.length, 2);
  for (const state of states) {
    assert.match(state, /content=\{t\('homepage\.(?:noResults|empty)\.description'/);
  }
  assert.match(source, /'No sessions match your search or filter\.'/);
  assert.match(source, /'No sessions yet\. Sessions appear here when users of your app sign in\.'/);
  assert.match(source, /homepage\.noResults\.reset', 'Clear filters'/);
  assert.match(source, /homepage\.error\.load', 'Sessions could not be loaded\.'/);
  assert.match(source, /common\.tryAgain', 'Try again'/);
});

test('dates, devices and status use the shared admin-locale helpers (DASH-05, DASH-06, I18N-4, I18N-10)', () => {
  const all = source + table + cards;
  assert.doesNotMatch(all, /toLocaleString\(/);
  assert.doesNotMatch(all, /\} on \{/);
  assert.match(table, /formatRelativeTime\(date\)/);
  assert.match(table, /formatDate\(date\)/);
  assert.match(table, /deviceSummary\(session\)/);
  assert.match(table, /<StatusBadge session=\{session\} size="S" detail \/>/);
  assert.match(cards, /<StatusBadge session=\{session\} size="S" detail \/>/);
  // Device: "{browser} · {os}", "Unknown device" when not parsed, "—" for Strapi sessions (IA D1.7).
  assert.match(table, /if \(isNativeOnlySession\(session\)\) return <MissingValue variant="omega" \/>/);
  assert.match(table, /const summary = device\.hasSummary \? deviceSummary\(session\) : typeLabel/);
});

test('status badge second line: Last active, Not used for, reason with end time (IA B.3)', () => {
  assert.match(badge, /'common\.status\.active\.detail', 'Last active \{time\}'/);
  assert.match(badge, /'common\.status\.idle\.detail', 'Not used for \{minutes\} min'/);
  assert.match(badge, /'common\.status\.ended\.detail', '\{reason\} · \{endedAt\}'/);
  assert.match(badge, /<MissingValue variant="pi"/, 'a missing end time shows the accessible dash');
  assert.match(badge, /textColor="neutral600" data-status-detail=""/, 'the second line is neutral, never green');
  assert.match(badge, /getTranslation\('common\.status\.nativeSession'\), defaultMessage: 'Strapi session'/);
});

test('four clickable KPI cards set the status filter (IA D1.4, I.1 item 6)', () => {
  assert.equal((source.match(/<StatCard\b/g) || []).length, 4);
  const cardsWithTone = [...source.matchAll(/<StatCard\s+icon=\{(\w+)\}\s+tone="(\w+)"/g)];
  assert.equal(cardsWithTone.length, 4);
  assert.equal(new Set(cardsWithTone.map((match) => match[1])).size, 4, 'distinct icons');
  assert.equal(new Set(cardsWithTone.map((match) => match[2])).size, 4, 'distinct tones');
  assert.ok(!cardsWithTone.some((match) => match[2] === 'danger'), 'ended is neutral, not danger');
  for (const status of ['active', 'idle', 'ended', 'all']) {
    assert.match(source, new RegExp(`\\{\\.\\.\\.statusCard\\('${status}'\\)\\}`));
  }
  assert.match(source, /homepage\.stats\.usersOnline', '\{count, plural, one \{# user online\} other \{# users online\}\}'/);
  assert.match(source, /'\{loggedOut, number\} logged out · \{timedOut, number\} timed out · \{other, number\} other reasons'/);
  assert.match(source, /<Typography tag="h2">\{t\('homepage\.stats\.label'/);
  assert.match(source, /<Typography variant="delta" tag="h2">\s*\{t\('homepage\.list\.heading'/);
});

test('exports cover the filtered list, add the truncation flag and report failures (IA E.1)', () => {
  const exportHandlers = source.slice(source.indexOf('const handleExportCSV'), source.indexOf('const handleSessionClick'));
  assert.match(exportHandlers, /buildSessionCsv\(filteredSessions/);
  assert.match(exportHandlers, /buildSessionJson\(filteredSessions/);
  assert.match(exportHandlers, /truncated,/);
  assert.equal((exportHandlers.match(/notifications\.error\.exportFailed', 'The export could not be created\.'/g) || []).length, 2);
  assert.doesNotMatch(exportHandlers, /notifications\.success/, 'the download itself is the feedback');
});
