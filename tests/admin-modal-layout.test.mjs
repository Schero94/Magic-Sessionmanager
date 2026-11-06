import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { readSettingsSource } from './helpers/settingsSource.mjs';

const readAdminFile = (relativePath) =>
  relativePath === 'pages/Settings.jsx'
    ? readSettingsSource()
    : readFileSync(new URL(`../admin/src/${relativePath}`, import.meta.url), 'utf8');

test('relaxed-mode warning is the unmodified DS Alert (SET-17)', () => {
  const settings = readAdminFile('pages/Settings.jsx');

  // Layout overrides that selected into the DS Alert markup were removed;
  // title and body wrap the way every Strapi alert does.
  assert.doesNotMatch(settings, /RelaxedModeAlert/);
  assert.doesNotMatch(settings, /\[role=['"]status['"]\]\s*>\s*p/);
  assert.match(settings, /<DesignSystemAlert\s+variant="warning"/);
});

test('relaxed-mode warning close button dismisses the alert and strict-setting changes restore it', () => {
  const settings = readAdminFile('pages/Settings.jsx');
  const alertStart = settings.indexOf('<DesignSystemAlert');
  const alertEnd = settings.indexOf('</DesignSystemAlert>', alertStart);
  const alertUsage = settings.slice(
    settings.lastIndexOf('{!settings.strictSessionEnforcement', alertStart),
    alertEnd
  );
  const handlerStart = settings.indexOf('const handleChange = useCallback((key, value) => {');
  const handlerEnd = settings.indexOf('\n  }, []);', handlerStart);
  const handler = settings.slice(handlerStart, handlerEnd);

  assert.ok(alertStart >= 0 && alertEnd > alertStart, 'the warning Alert is rendered');
  assert.match(alertUsage, /!relaxedWarningDismissed/);
  assert.match(alertUsage, /onClose=\{\(\) => setRelaxedWarningDismissed\(true\)\}/);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'the shared setting handler exists');
  assert.match(
    handler,
    /key === 'strictSessionEnforcement'[\s\S]*setRelaxedWarningDismissed\(false\)/
  );
});

test('session detail values use semantic labels and wrap long content safely', () => {
  const modal = readAdminFile('components/SessionDetailModal.jsx');
  const propertyList = readAdminFile('components/ui/PropertyList.jsx');

  // The shared PropertyList renders a dl/dt/dd grid; only IDs and e-mails break anywhere (DUX-18, DASH-07).
  assert.match(propertyList, /styled\.dl/);
  assert.match(propertyList, /<dt>/);
  assert.match(propertyList, /<dd\b/);
  assert.match(propertyList, /dd\[data-wrap='anywhere'\][\s\S]*?overflow-wrap:\s*anywhere/);
  assert.ok(
    (modal.match(/<PropertyList\b/g) || []).length >= 5,
    'every section is one PropertyList, no nested grids'
  );
  assert.match(modal, /kind: 'email'/);
  assert.ok((modal.match(/kind: 'id'/g) || []).length >= 2);
  assert.doesNotMatch(modal, /TwoColumnGrid|DetailsList|repeat\(2/);
  // Dates use the admin locale; device facts come from the shared presentation, names only (I.1 item 8).
  assert.match(modal, /formatDate\(value\)/);
  assert.match(modal, /getDevicePresentation\(session\)/);
  assert.match(modal, /value: device\.browser \}/);
  assert.doesNotMatch(modal, /device\.browserVersion/);
  assert.doesNotMatch(modal, /toLocaleString\(/);
  // No extra body padding on top of the DS modal insets (DASH-08), no custom px sizes.
  assert.doesNotMatch(modal, /<Box padding=\{\{ initial: 3, small: 5 \}\}/);
  assert.doesNotMatch(modal, /\d+px/);
  assert.doesNotMatch(modal, /@media/);
});

test('End session is offered for open rows only and keeps the existing API path (IA D2.8)', () => {
  const modal = readAdminFile('components/SessionDetailModal.jsx');
  const home = readAdminFile('pages/HomePage.jsx');

  assert.match(home, /sessions\/\$\{sessionId\}\/terminate/);
  assert.match(modal, /const canEnd = session\.isActive === true/);
  assert.match(modal, /\{canEnd \? \(\s*<ConfirmAction\b[\s\S]*?onConfirm=\{handleTerminate\}/);
  assert.doesNotMatch(modal, /\bconfirm\(/);
  // Ended rows say so instead of showing a disabled button.
  assert.match(
    modal,
    /\) : \(\s*<Typography id=\{endedReasonId\}[\s\S]*?modal\.actions\.alreadyEnded', 'This session has already ended\.'/
  );
  assert.match(modal, /await onEndSession\(session\);\s*onClose\(\);/);
  // At most one destructive action: Delete record is not offered in the dialog.
  assert.doesNotMatch(modal, /deleteRecord|del\(/);
});

test('session detail dialog: state sentence, header status, copyable record ID, Yes/No badges, translated live risk (IA D2)', () => {
  const modal = readAdminFile('components/SessionDetailModal.jsx');

  assert.match(
    modal,
    /<Modal\.Content[^>]*aria-describedby=\{undefined\}/,
    'no dangling Radix description reference'
  );
  assert.match(modal, /<Modal\.Title>[\s\S]*?<\/Modal\.Title>\s*<StatusBadge\b/);
  assert.match(modal, /'modal\.state\.active', 'Active\. Last request \{time\}\.'/);
  assert.match(
    modal,
    /<Alert variant="warning"[\s\S]*?'modal\.state\.idle', 'Not used for \{minutes\} min\. It ends on its next request or at the next idle check\.'/
  );
  assert.match(modal, /'modal\.state\.ended', 'Ended \{endedAt\} · \{reason\}\.'/);
  assert.match(
    modal,
    /translate\(reason\.description\)/,
    'the reason definition follows the sentence'
  );
  assert.match(
    modal,
    /'modal\.state\.maxAgeNote', 'Sessions older than the maximum session age end on their next request\.'/
  );
  assert.match(modal, /const \{ copy \} = useClipboard\(\)/);
  assert.match(modal, /<IconButton label=\{t\('modal\.actions\.copyId'/);
  assert.match(modal, /modal\.copy\.success/);
  assert.match(modal, /modal\.copy\.error/);
  assert.doesNotMatch(modal, /vpnWarning|\[WARNING\]/);
  assert.match(modal, /yesNoText\(liveGeo\.isVpn\)/);
  assert.match(modal, /yesNoText\(liveGeo\.isProxy\)/);
  assert.doesNotMatch(
    modal,
    /variant=\{value \? 'danger'/,
    'Yes/No is plain text, not a danger badge (IA B.3)'
  );
  assert.match(
    modal,
    /\{hasLocationData \? <PropertyList items=\{locationItems\} \/> : null\}/,
    'no wall of dashes before a lookup'
  );
  assert.doesNotMatch(modal, /modal\.timeline\.notUsedFor/, 'Session section per IA D2.4');
  assert.match(modal, /t\('common\.yes', 'Yes'\)/);
  assert.match(
    modal,
    /'modal\.security\.scoreNote',\s*'Higher is safer\. Below 70 can trigger a suspicious-sign-in email and below 50 a rejection, if those settings are on\. Local database results are always 100\.'/
  );
  assert.doesNotMatch(modal, /'High' : 'Low'/);
  assert.match(modal, /<Modal\.Close>\s*<Button variant="tertiary">/);
  // Technical details are collapsed in a DS Accordion.
  assert.match(modal, /<Accordion\.Root collapsible/);
  assert.match(modal, /'modal\.technical\.recordId', 'Record ID'/);
});

test('"Open user" links to the Content Manager only when the row has the user documentId (decision I.2-6)', () => {
  const modal = readAdminFile('components/SessionDetailModal.jsx');
  assert.match(modal, /const userEditPath = getUserEditPath\(session\)/);
  assert.match(modal, /presentText\(session\.user\?\.username\) && userEditPath \?/);
  assert.match(modal, /<TargetLink\s+tag=\{NavLink\}\s+to=\{userEditPath\}/);
  assert.match(
    modal,
    /const TargetLink = styled\(Link\)`\s*min-height: 3\.2rem;/,
    'the inline link has a 32 px touch target below medium'
  );
  assert.match(
    modal,
    /theme\.breakpoints\.medium\} \{\s*min-height: 2\.4rem;/,
    'and the 24 px desktop target from medium'
  );
  assert.match(modal, /'modal\.user\.openFor', 'Open user \{user\}'/);
});

test('session end labels exist in every admin locale', () => {
  const locales = ['en', 'de', 'es', 'fr', 'pt'];

  for (const locale of locales) {
    const messages = JSON.parse(
      readFileSync(new URL(`../admin/src/translations/${locale}.json`, import.meta.url), 'utf8')
    );
    if (!('homepage.actions.end' in messages)) continue;
    assert.ok(messages['homepage.actions.end'], `${locale} has an End session action`);
    assert.ok(messages['homepage.confirm.end.body'], `${locale} has an End session confirmation`);
  }
});
