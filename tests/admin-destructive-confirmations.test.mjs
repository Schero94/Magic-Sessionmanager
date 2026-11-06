import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const homeSource = readFileSync(
  new URL('../admin/src/pages/HomePage.jsx', import.meta.url),
  'utf8'
);
const panelSource = readFileSync(
  new URL('../admin/src/components/SessionInfoPanel.jsx', import.meta.url),
  'utf8'
);
import { readSettingsSource } from './helpers/settingsSource.mjs';

const settingsSource = readSettingsSource();
const translations = Object.fromEntries(
  ['en', 'de', 'es', 'fr', 'pt'].map((locale) => [
    locale,
    JSON.parse(
      readFileSync(new URL(`../admin/src/translations/${locale}.json`, import.meta.url), 'utf8')
    ),
  ])
);

function handlerSource(source, name) {
  const start = source.indexOf(`const ${name} = async () => {`);
  assert.notEqual(start, -1, `expected handler ${name}`);
  const end = source.indexOf('\n  };', start);
  assert.notEqual(end, -1, `expected end of handler ${name}`);
  return source.slice(start, end);
}

test('Delete record says it is permanent, and the result says the token stays revoked (IA E.1)', () => {
  const handler = homeSource.slice(
    homeSource.indexOf('const handleDeleteSession'),
    homeSource.indexOf('const handleExportCSV')
  );
  const actionsSource = readFileSync(
    new URL('../admin/src/pages/Dashboard/SessionActions.jsx', import.meta.url),
    'utf8'
  );
  const removeConfirm = actionsSource.slice(
    actionsSource.indexOf('remove: isOpen'),
    actionsSource.indexOf('const SessionActions')
  );

  // ConfirmAction (Strapi ConfirmDialog) confirms before the handler runs; never window.confirm.
  assert.ok(removeConfirm.length > 0, 'the delete action has its own confirmation');
  assert.equal(
    (
      removeConfirm.match(
        /removed (?:permanently )?from history, statistics and exports\. This cannot be undone\./g
      ) || []
    ).length,
    2
  );
  assert.match(
    removeConfirm,
    /This session is still open\. \{user\} will be signed out on \{device\}/
  );
  assert.match(
    actionsSource,
    /<ConfirmAction\b[\s\S]*?\{\.\.\.copy\.remove\}[\s\S]*?onConfirm=\{\(\) => onDelete\(session\)\}/
  );
  assert.doesNotMatch(homeSource + actionsSource, /\bconfirm\(/);
  assert.match(handler, /'Session record deleted\. Its token stays revoked\.'/);
});

test('End all sessions confirms before sending its mutation request', () => {
  const handler = handlerSource(panelSource, 'handleEndAll');

  // The request only runs from the ConfirmAction dialog's confirm button.
  assert.ok(handler.indexOf('postRequest(') >= 0);
  assert.match(panelSource, /<ConfirmAction\b[\s\S]*?onConfirm=\{handleEndAll\}/);
  assert.doesNotMatch(panelSource, /onClick=\{handleEndAll\}/);
  assert.doesNotMatch(panelSource, /\bconfirm\(/, 'no browser confirm dialog');
});

test('Block user confirms before changing user access; Unblock user is not destructive (IA E.1)', () => {
  const block = handlerSource(panelSource, 'handleBlock');
  const unblock = handlerSource(panelSource, 'handleUnblock');

  assert.match(panelSource, /<ConfirmAction\b[\s\S]*?onConfirm=\{handleBlock\}/);
  assert.doesNotMatch(panelSource, /onClick=\{handleBlock\}/);
  assert.match(block, /changeBlocked\(true\)/);
  assert.match(unblock, /changeBlocked\(false\)/);
  assert.match(panelSource, /onClick=\{handleUnblock\}/);
  assert.match(
    panelSource,
    /postRequest\([^\n]+toggle-block`, \{ blocked \}\)/,
    'an explicit state, never a blind toggle'
  );
});

test('Delete ended sessions confirms with the IA copy and states that open sessions stay (IA E.1, I.1-18)', () => {
  // The deletion runs only from the onConfirm of a DS ConfirmAction dialog (no window.confirm).
  const tab = readFileSync(
    new URL('../admin/src/pages/Settings/DataRetentionTab.jsx', import.meta.url),
    'utf8'
  );
  const confirm = tab.slice(
    tab.indexOf('<ConfirmAction'),
    tab.indexOf('onConfirm={handleCleanInactive}') + 40
  );
  assert.match(confirm, /t\('settings\.config\.deleteEnded\.action', 'Delete ended sessions'\)/);
  assert.match(
    confirm,
    /title=\{t\('settings\.config\.deleteEnded\.confirmTitle', 'Delete all ended sessions\?'\)\}/
  );
  assert.match(
    confirm,
    /'settings\.config\.deleteEnded\.confirmBody',\s*'The records of every ended session of every user are removed permanently from history, statistics and exports\. Open sessions, including idle ones, are not affected\. This cannot be undone\.'/
  );
  assert.match(
    confirm,
    /confirmLabel=\{t\('settings\.config\.deleteEnded\.action', 'Delete ended sessions'\)\}/
  );
  assert.doesNotMatch(
    settingsSource,
    /Clean Now|Clean All Inactive|settings\.general\.danger/,
    'retired wording (IA A.1)'
  );
  const handlerStart = settingsSource.indexOf(
    'const handleCleanInactive = useCallback(async () => {'
  );
  const handler = settingsSource.slice(
    handlerStart,
    settingsSource.indexOf('\n  }, [', handlerStart)
  );
  assert.ok(handlerStart >= 0, 'cleanup handler exists');
  assert.doesNotMatch(handler, /\bconfirm\(/, 'no browser dialog');
  assert.match(
    handler,
    /'settings\.config\.feedback\.deletedEnded',\s*'\{count, plural, one \{# ended session deleted\.\} other \{# ended sessions deleted\.\}\}'/
  );
  assert.match(
    handler,
    /'settings\.config\.feedback\.deletedNone', 'There were no ended sessions to delete\.'/
  );
  assert.match(
    handler,
    /'Ended sessions could not be deleted\. Some may already be gone; reload to see the current state\.'/
  );
  assert.match(handler, /logSafeAdminError\('settings\.cleanInactive', err\)/);
  assert.match(handler, /throw err;/, 'the dialog stays open on failure');
});

test('every locale carries both Delete record confirmations without the retired "blocked" token wording', () => {
  for (const [locale, messages] of Object.entries(translations)) {
    if (!('homepage.confirm.deleteEnded.body' in messages)) continue;
    assert.ok(
      messages['homepage.confirm.deleteOpen.body'],
      `${locale} open-row delete confirmation exists`
    );
    assert.ok(messages['notifications.success.recordDeleted'], `${locale} delete result exists`);
    for (const key of ['homepage.confirm.deleteEnded.body', 'homepage.confirm.deleteOpen.body']) {
      assert.doesNotMatch(
        messages[key],
        /\bblocked\b|gesperrt/i,
        `${locale} ${key} uses the revoke vocabulary`
      );
    }
  }
});
