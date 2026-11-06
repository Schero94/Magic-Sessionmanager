import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const panel = readFileSync(
  new URL('../admin/src/components/SessionInfoPanel.jsx', import.meta.url),
  'utf8'
);

const between = (start, end) => {
  const from = panel.indexOf(start);
  assert.notEqual(from, -1, `expected ${start}`);
  const to = panel.indexOf(end, from);
  assert.notEqual(to, -1, `expected ${end}`);
  return panel.slice(from, to);
};

/** Escapes a literal for use in a RegExp. */
const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('panel renders nothing for other models and checks the plugin permission', () => {
  const guard = panel.indexOf('if (!isUserPanel) {');
  assert.ok(guard > 0);
  assert.match(panel.slice(guard, guard + 60), /return null;/);
  assert.match(panel, /useRBAC\(pluginPermissions\.access\)/);
});

test('End all sessions and Block user use ConfirmAction; Unblock user has no confirmation (IA E.1, UX-05)', () => {
  assert.doesNotMatch(panel, /\bconfirm\(/);
  assert.equal((panel.match(/<ConfirmAction\b/g) || []).length, 2);
  assert.match(panel, /<ConfirmAction\b[\s\S]*?onConfirm=\{handleEndAll\}/);
  assert.match(panel, /<ConfirmAction\b[\s\S]*?onConfirm=\{handleBlock\}/);
  assert.doesNotMatch(panel, /onClick=\{handleEndAll\}|onClick=\{handleBlock\}/);
  assert.match(panel, /onClick=\{handleUnblock\}/);
  assert.doesNotMatch(panel, /onConfirm=\{handleUnblock\}/);
  assert.equal(
    (panel.match(/fallbackFocusRef=\{panelRef\}/g) || []).length,
    2,
    'focus has a target when the trigger disappears'
  );
});

test('confirmation copy follows IA E.1 and names the user', () => {
  for (const [id, text] of [
    ['panel.confirm.endAllTitle', 'End all sessions of {user}?'],
    [
      'panel.confirm.endAllBody',
      '{count, plural, one {# open session ends} other {# open sessions end}} on all devices. {user} can sign in again unless you also block the account.',
    ],
    ['panel.confirm.blockTitle', 'Block {user}?'],
    [
      'panel.confirm.blockBody',
      '{user} can no longer sign in, and {count, plural, =0 {no open sessions are affected} one {# open session ends now} other {# open sessions end now}}. You can unblock the account later; ended sessions stay ended.',
    ],
    ['panel.actions.endAll', 'End all sessions'],
    ['panel.actions.blockUser', 'Block user'],
    ['panel.actions.unblock', 'Unblock user'],
  ]) {
    assert.match(panel, new RegExp(`'${literal(id)}',\\s*'${literal(text)}'`), id);
  }
  assert.match(panel, /confirmLabel=\{endAllLabel\}/, 'the confirm button repeats the verb');
  assert.match(panel, /confirmLabel=\{blockLabel\}/);
  assert.doesNotMatch(
    panel,
    /Log out all|terminateAll|panel\.status\.offline|current session/i,
    'retired wording is gone'
  );
});

test('feedback follows IA E.1: success, 404 "User not found." and retry errors', () => {
  for (const [id, text] of [
    ['panel.notify.endAllSuccess', 'All sessions of {user} ended.'],
    ['panel.notify.endAllError', 'The sessions could not be ended. Please try again.'],
    ['panel.notify.userNotFound', 'User not found.'],
    ['panel.notify.blockSuccess', '{user} is blocked.'],
    ['panel.notify.blockError', 'The user could not be blocked. Please try again.'],
    ['panel.notify.unblockSuccess', '{user} can sign in again.'],
    ['panel.notify.unblockError', 'The block could not be removed. Please try again.'],
  ]) {
    assert.match(panel, new RegExp(`'${literal(id)}',\\s*'${literal(text)}'`), id);
  }
  assert.equal((panel.match(/isNotFoundError\(error\)/g) || []).length, 3);
});

test('each action shows its own spinner and all are blocked while one runs (UX-13)', () => {
  assert.match(panel, /loading=\{pendingAction === 'endAll'\}/);
  assert.match(panel, /loading=\{pendingAction === 'block'\}/);
  assert.match(panel, /loading=\{pendingAction === 'unblock'\}/);
  assert.match(
    panel,
    /const actionsDisabled = loading \|\| pendingAction !== null;/,
    'buttons are disabled while loading too (IA G)'
  );
  assert.doesNotMatch(panel, /actionLoading/);
  assert.equal(
    (
      panel.match(
        /<Button\s+(?:ref=\{blockToggleRef\}\s+data-block-toggle="(?:block|unblock)"\s+)?fullWidth\s+size="S"/g
      ) || []
    ).length,
    3,
    'equal-height full-width buttons at the 32px height of the native Entry panel buttons'
  );
  assert.doesNotMatch(
    panel,
    /fullWidth\s+size="M"/,
    'no panel button is taller than the native side-panel buttons'
  );
  // In the narrow sidebar (about 12rem wide at 1080px) labels wrap; both
  // buttons sit in one stack whose rows share a height, so they stay equal.
  const stack = between('<ActionStack>', '</ActionStack>');
  assert.match(stack, /panel\.confirm\.endAllTitle/);
  assert.match(stack, /data-block-toggle="unblock"/);
  assert.match(stack, /data-block-toggle="block"/);
  assert.doesNotMatch(
    stack,
    /noOpenSessionsHintId\}/,
    'hints sit below the stack, not between the buttons'
  );
  const stackSource = readFileSync(
    new URL('../admin/src/components/ui/ActionStack.jsx', import.meta.url),
    'utf8'
  );
  assert.match(stackSource, /grid-auto-rows: 1fr;/);
  assert.match(stackSource, /min-height: 3\.2rem;/);
  assert.match(stackSource, /height: auto;/);
});

test('End all sessions is disabled without open sessions and says why (IA D3)', () => {
  assert.match(panel, /disabled=\{actionsDisabled \|\| !hasOpenSessions\}/);
  assert.match(panel, /t\('panel\.actions\.noOpenSessions', 'No open sessions'\)/);
  assert.match(
    panel,
    /aria-describedby=\{!loading && !hasOpenSessions \? noOpenSessionsHintId : undefined\}/
  );
  assert.match(
    panel,
    /'panel\.actions\.hint',\s*'End all sessions lets the user sign in again\. Block user also prevents new sign-ins\.'/
  );
});

test('failed confirmed actions notify and keep the dialog open; unblock notifies without re-throwing', () => {
  for (const handler of ['handleEndAll', 'handleBlock']) {
    const source = between(`const ${handler} = async () => {`, '\n  };');
    assert.match(source, /toggleNotification\(\{\s*type: 'danger'/);
    assert.match(source, /logSafeAdminError\(/);
    assert.match(source, /throw error;/);
    assert.match(source, /setPendingAction\(null\)/);
  }
  const unblock = between('const handleUnblock = async () => {', '\n  };');
  assert.match(unblock, /toggleNotification\(\{\s*type: 'danger'/);
  assert.match(unblock, /logSafeAdminError\(/);
  assert.doesNotMatch(unblock, /throw error;/, 'no unhandled rejection from a click handler');
});

test('block/unblock sends an explicit state and writes it into the open edit form (F1, UX-04)', () => {
  assert.match(panel, /import \{[^}]*\buseForm\b[^}]*\} from '@strapi\/strapi\/admin'/);
  for (const selector of ['initialValues', 'modified', 'onChange', 'resetForm']) {
    assert.match(
      panel,
      new RegExp(`useForm\\(FORM_CONSUMER, \\(state\\) => state\\.${selector}, false\\)`),
      selector
    );
  }
  const handler = between('const changeBlocked = async (blocked) => {', '\n  };');
  assert.match(
    handler,
    /postRequest\(`\/magic-sessionmanager\/user\/\$\{userId\}\/toggle-block`, \{ blocked \}\)/
  );
  assert.match(between('const handleBlock = async () => {', '\n  };'), /changeBlocked\(true\)/);
  assert.match(between('const handleUnblock = async () => {', '\n  };'), /changeBlocked\(false\)/);
  assert.ok(
    handler.indexOf('requireSuccessfulMutation') < handler.indexOf('planBlockedFormSync'),
    'only a confirmed change is synced'
  );
  assert.match(
    handler,
    /applyBlockedFormSync\(plan, \{ resetForm: formResetForm, onChange: formOnChange \}\)/
  );
  assert.match(handler, /setFormOutOfSync\(!synced\)/);
  assert.match(
    panel,
    /\{formOutOfSync \? \(\s*<Alert variant="warning"/,
    'missing form context shows a reload notice'
  );
  assert.match(
    panel,
    /'panel\.form\.reloadNotice', 'Reload this page before saving, or the Blocked field will be overwritten\.'/
  );
});

test('successful actions update the panel in place and keep focus on the swapped button', () => {
  assert.match(
    between('const handleEndAll = async () => {', '\n  };'),
    /setSessions\(\(rows\) => endOpenSessions\(rows, 'manual'\)\)/
  );
  assert.match(
    between('const changeBlocked = async (blocked) => {', '\n  };'),
    /endOpenSessions\(rows, 'blocked'\)/
  );
  assert.equal(
    (panel.match(/ref=\{blockToggleRef\}/g) || []).length,
    2,
    'Block and Unblock share one focus target'
  );
  assert.match(panel, /const button = blockToggleRef\.current;[\s\S]*?button\.focus\(\)/);
  // The Block dialog unmounts with its trigger; Radix then moves focus to <body>
  // in a zero-delay timeout, so the swapped button is focused in a later one.
  // The new button is disabled while the action is pending, so the focus waits
  // until no action runs.
  const focusEffect = between(
    '// Block and Unblock swap the button',
    '}, [isBlocked, pendingAction]);'
  );
  assert.match(
    focusEffect,
    /if \(!focusBlockToggle\.current \|\| pendingAction !== null\) return undefined;/
  );
  // Strapi renders the panel content one commit after the panel hook, so the
  // effect retries until the swapped, enabled button is in the document.
  assert.match(focusEffect, /button\.dataset\.blockToggle === expected/);
  assert.match(focusEffect, /timer = window\.setTimeout\(tryFocus, \d+\)/);
  assert.match(panel, /data-block-toggle="unblock"/);
  assert.match(panel, /data-block-toggle="block"/);
  assert.match(focusEffect, /window\.setTimeout\(/);
  assert.match(focusEffect, /return \(\) => window\.clearTimeout\(timer\);/);
});

test('summary shows Online / Not online, open sessions and the last activity (IA D3, I.1-28)', () => {
  const summary = between('{/* Summary */}', '{isBlocked ?');
  assert.match(summary, /<Badge variant=\{summary\.isOnline \? 'success' : 'neutral'\}/);
  assert.match(summary, /t\('panel\.status\.online', 'Online'\)/);
  assert.match(summary, /t\('panel\.status\.notOnline', 'Not online'\)/);
  assert.match(
    summary,
    /'panel\.summary\.openCount',\s*'\{count, plural, one \{# open session\} other \{# open sessions\}\}'/
  );
  assert.match(summary, /t\('panel\.summary\.openHint', 'Active or idle'\)/);
  assert.match(summary, /formatRelativeTime\(summary\.lastActive\)/);
  assert.match(summary, /title=\{formatDate\(summary\.lastActive\)\}/);
  assert.match(summary, /t\('panel\.summary\.noSessions', 'No sessions recorded'\)/);
  assert.match(summary, /<Loader small>/, 'the summary area shows the loading state');
  assert.match(
    panel,
    /getUserSessionSummary\(sessions\)/,
    'the summary sees all rows, so ended sessions feed "Last active"'
  );
});

test('blocked alert uses the IA copy and the danger variant', () => {
  assert.match(panel, /\{isBlocked \? \(\s*<Alert variant="danger"/);
  assert.match(
    panel,
    /t\('panel\.blocked\.message', 'This account is blocked\. The user cannot sign in\.'\)/
  );
});

test('open-session cards translate the device, use a decorative icon and neutral activity (UX-03, F2, F3)', () => {
  assert.match(panel, /getDevicePresentation\(session\)/);
  assert.match(panel, /translate\(device\.deviceTypeMessage\)/);
  assert.match(panel, /<DeviceIcon icon=\{device\.icon\} \/>/);
  assert.match(panel, /<StatusBadge session=\{session\} size="S" \/>/);
  assert.match(
    panel,
    /const hasSummary = Boolean\(device\.browserLabel \|\| device\.os\);/,
    'no "unavailable" line when nothing is known'
  );
  assert.doesNotMatch(panel, /textColor="success600"/);
  assert.doesNotMatch(panel, /panel\.sessions\.(active|idle|activeAgo|activeNow)'/);
  assert.match(panel, /panel\.sessions\.lastActive/);
  assert.doesNotMatch(panel, /deviceType === 'Mobile'|getDeviceIcon/);
  assert.doesNotMatch(panel, /Unavailable on|unavailableValue/);
});

test('up to five open sessions, newest first, then "+n more" and "Show all sessions" (IA D3)', () => {
  assert.match(panel, /getVisiblePanelSessions\(openSessions\)/);
  assert.match(panel, /const openSessions = getManageableSessions\(sessions\);/);
  assert.match(panel, /t\('panel\.sessions\.openTitle', 'Open sessions'\)/);
  assert.match(
    panel,
    /t\('panel\.sessions\.more', '\{count, plural, other \{\+# more\}\}', \{ count: hiddenCount \}\)/
  );
  assert.match(panel, /<TargetLink tag=\{NavLink\} to=\{buildUserSessionsHref\(document\)\}>/);
  assert.match(
    readFileSync(new URL('../admin/src/components/ui/TargetLink.jsx', import.meta.url), 'utf8'),
    /styled\(Link\)`[^`]*min-height: 3\.2rem;/,
    'the link has a size S button height, not a 2rem text line'
  );
  assert.match(panel, /t\('panel\.sessions\.showAllLink', 'Show all sessions'\)/);
});

test('empty and unsaved states use the IA copy with readable contrast (IA G, F11)', () => {
  assert.match(
    panel,
    /'panel\.empty\.noOpenSessions',\s*'No open sessions\. \{user\} is not signed in on any device\.'/
  );
  assert.match(
    panel,
    /t\('panel\.unsaved\.description', 'Save this user before you can manage sessions\.'\)/
  );
  assert.match(
    panel,
    /<Box padding=\{3\} background="neutral0" borderColor="neutral200" hasRadius>\s*<ReadableText variant="omega" textColor="neutral800" tag="p">\s*\{t\(\s*'panel\.empty\.noOpenSessions'/,
    'no grey-on-grey empty state: dark text on the panel background'
  );
  assert.doesNotMatch(panel, /background="neutral100" hasRadius textAlign="center"/);
});

test('panel uses DS tokens and shared blocks instead of hand-made styled boxes (UX-11, F11)', () => {
  assert.doesNotMatch(panel, /from 'styled-components'/);
  assert.doesNotMatch(panel, /\d+px/);
  assert.doesNotMatch(panel, /textColor="neutral500"/);
  assert.match(panel, /<Loader small>/);
  assert.match(panel, /from '\.\/ui'/);
});

test('error state follows IA G: one message and "Try again" (UX-01, I18N-2)', () => {
  assert.match(panel, /t\('panel\.error\.message', 'Sessions could not be loaded\.'\)/);
  assert.match(panel, /t\('common\.tryAgain', 'Try again'\)/);
});

test('the unregistered SessionInfoCard is removed (UX-15, I18N-13)', () => {
  assert.equal(
    existsSync(new URL('../admin/src/components/SessionInfoCard.jsx', import.meta.url)),
    false
  );
  const barrel = readFileSync(
    new URL('../admin/src/components/index.jsx', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(barrel, /SessionInfoCard/);
});
