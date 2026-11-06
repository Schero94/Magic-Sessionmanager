import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { readSettingsSource } from './helpers/settingsSource.mjs';

const readAdminFile = (relativePath) => (relativePath === 'pages/Settings.jsx'
  ? readSettingsSource()
  : readFileSync(new URL(`../admin/src/${relativePath}`, import.meta.url), 'utf8'));

test('relaxed-mode warning title and body occupy separate full-width rows', () => {
  const settings = readAdminFile('pages/Settings.jsx');

  assert.match(settings, /const RelaxedModeAlert = styled\(DesignSystemAlert\)/);
  assert.match(settings, /\[role=['"]status['"]\]\s*>\s*p/);
  assert.match(settings, /flex:\s*0 0 100%/);
  // No custom breakpoint: the body row wraps under the title at every width.
  assert.doesNotMatch(settings.slice(settings.indexOf('const RelaxedModeAlert')), /^[^`]*@media/);
});

test('relaxed-mode warning close button dismisses the alert and strict-setting changes restore it', () => {
  const settings = readAdminFile('pages/Settings.jsx');
  const alertStart = settings.indexOf('<RelaxedModeAlert');
  const alertEnd = settings.indexOf('</RelaxedModeAlert>', alertStart);
  const alertUsage = settings.slice(settings.lastIndexOf('{!settings.strictSessionEnforcement', alertStart), alertEnd);
  const handlerStart = settings.indexOf('const handleChange = useCallback((key, value) => {');
  const handlerEnd = settings.indexOf('\n  }, []);', handlerStart);
  const handler = settings.slice(handlerStart, handlerEnd);

  assert.ok(alertStart >= 0 && alertEnd > alertStart, 'the warning Alert is rendered');
  assert.match(alertUsage, /!relaxedWarningDismissed/);
  assert.match(alertUsage, /onClose=\{\(\) => setRelaxedWarningDismissed\(true\)\}/);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'the shared setting handler exists');
  assert.match(handler, /key === 'strictSessionEnforcement'[\s\S]*setRelaxedWarningDismissed\(false\)/);
});

test('session detail values use semantic labels and wrap long content safely', () => {
  const modal = readAdminFile('components/SessionDetailModal.jsx');
  const propertyList = readAdminFile('components/ui/PropertyList.jsx');

  // The shared PropertyList renders a dl/dt/dd grid; only IDs and e-mails break anywhere (DUX-18, DASH-07).
  assert.match(propertyList, /styled\.dl/);
  assert.match(propertyList, /<dt>/);
  assert.match(propertyList, /<dd\b/);
  assert.match(propertyList, /dd\[data-wrap='anywhere'\][\s\S]*?overflow-wrap:\s*anywhere/);
  assert.ok((modal.match(/<PropertyList\b/g) || []).length >= 5, 'every section is one PropertyList, no nested grids');
  assert.match(modal, /kind: 'email'/);
  assert.ok((modal.match(/kind: 'id'/g) || []).length >= 2);
  assert.doesNotMatch(modal, /TwoColumnGrid|DetailsList|repeat\(2/);
  // Dates use the admin locale; the device facts (incl. version) come from the shared presentation.
  assert.match(modal, /formatDate\(value\)/);
  assert.match(modal, /getDevicePresentation\(session\)/);
  assert.match(modal, /device\.browserVersion/);
  assert.doesNotMatch(modal, /toLocaleString\(/);
  // No extra body padding on top of the DS modal insets (DASH-08), no custom px sizes.
  assert.doesNotMatch(modal, /<Box padding=\{\{ initial: 3, small: 5 \}\}/);
  assert.doesNotMatch(modal, /\d+px/);
  assert.doesNotMatch(modal, /@media/);
});

test('session termination stays limited to active rows and keeps the existing API path', () => {
  const modal = readAdminFile('components/SessionDetailModal.jsx');

  assert.match(modal, /sessions\/\$\{session\.id\}\/terminate/);
  assert.match(modal, /const canLogOut = session\.isActive === true/);
  assert.match(modal, /<ConfirmAction\b[\s\S]*?onConfirm=\{handleTerminate\}[\s\S]*?disabled=\{!canLogOut\}/);
  assert.doesNotMatch(modal, /\bconfirm\(/);
  // The disabled action explains why, without a dangling reference.
  assert.match(modal, /aria-describedby=\{!canLogOut \? endedReasonId : undefined\}/);
  assert.match(modal, /\{!canLogOut \? \(\s*<Typography id=\{endedReasonId\}/);
  assert.match(modal, /onSessionTerminated\(\)/);
  assert.match(modal, /onClose\(\)/);
});

test('session detail dialog: header status, copyable ID, Yes/No badges, translated risk (DUX-13, DUX-16, DUX-22, DASH-15)', () => {
  const modal = readAdminFile('components/SessionDetailModal.jsx');

  assert.match(modal, /<Modal\.Content[^>]*aria-describedby=\{undefined\}/, 'no dangling Radix description reference');
  assert.match(modal, /<Modal\.Title>[\s\S]*?<\/Modal\.Title>\s*<StatusBadge\b/);
  assert.doesNotMatch(modal, /modal\.id'/, 'the ID moved out of the header');
  assert.match(modal, /const \{ copy \} = useClipboard\(\)/);
  assert.match(modal, /<IconButton label=\{t\('modal\.actions\.copyId'/);
  assert.match(modal, /modal\.copy\.success/);
  assert.match(modal, /modal\.copy\.error/);
  assert.doesNotMatch(modal, /vpnWarning|\[WARNING\]/);
  assert.match(modal, /render: yesNoBadge\(securityData\.isVpn\)/);
  assert.match(modal, /render: yesNoBadge\(securityData\.isProxy\)/);
  assert.match(modal, /t\('common\.yes', 'Yes'\)/);
  assert.match(modal, /RISK_LEVEL_MESSAGES\[securityData\.riskLevel\]/);
  assert.doesNotMatch(modal, /'High' : 'Low'/);
  assert.match(modal, /<Modal\.Close>\s*<Button variant="tertiary">/);
});

test('session logout labels explain the device scope in every admin locale', () => {
  const locales = ['en', 'de', 'es', 'fr', 'pt'];

  for (const locale of locales) {
    const messages = JSON.parse(
      readFileSync(new URL(`../admin/src/translations/${locale}.json`, import.meta.url), 'utf8')
    );
    assert.ok(messages['modal.actions.terminate'], `${locale} has a session logout action`);
    assert.ok(messages['modal.confirm.terminate'], `${locale} has a session logout confirmation`);
  }

  const english = JSON.parse(
    readFileSync(new URL('../admin/src/translations/en.json', import.meta.url), 'utf8')
  );
  assert.match(english['modal.actions.terminate'], /log out/i);
  assert.match(english['modal.confirm.terminate'], /device session/i);
  assert.match(english['modal.confirm.terminate'], /other sessions/i);
});
