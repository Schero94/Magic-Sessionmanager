import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readAdminFile = (relativePath) =>
  readFileSync(new URL(`../admin/src/${relativePath}`, import.meta.url), 'utf8');

test('relaxed-mode warning title and body occupy separate full-width rows', () => {
  const settings = readAdminFile('pages/Settings.jsx');

  assert.match(settings, /const RelaxedModeAlert = styled\(Alert\)/);
  assert.match(settings, /\[role=['"]status['"]\]\s*>\s*p/);
  assert.match(settings, /flex:\s*0 0 100%/);
  assert.match(settings, /@media \(max-width: 519px\)[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(settings, /grid-column: 1 \/ -1;\s*grid-row: 2;/);
});

test('relaxed-mode warning close button dismisses the alert and strict-setting changes restore it', () => {
  const settings = readAdminFile('pages/Settings.jsx');
  const alertStart = settings.indexOf('<RelaxedModeAlert');
  const alertEnd = settings.indexOf('</RelaxedModeAlert>', alertStart);
  const alertUsage = settings.slice(settings.lastIndexOf('{!settings.strictSessionEnforcement', alertStart), alertEnd);
  const handlerStart = settings.indexOf('const handleChange = (key, value) => {');
  const handlerEnd = settings.indexOf('\n  };', handlerStart);
  const handler = settings.slice(handlerStart, handlerEnd);

  assert.ok(alertStart >= 0 && alertEnd > alertStart, 'the warning Alert is rendered');
  assert.match(alertUsage, /!relaxedWarningDismissed/);
  assert.match(alertUsage, /onClose=\{\(\) => setRelaxedWarningDismissed\(true\)\}/);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'the shared setting handler exists');
  assert.match(handler, /key === 'strictSessionEnforcement'[\s\S]*setRelaxedWarningDismissed\(false\)/);
});

test('session detail values use semantic labels and wrap long content safely', () => {
  const modal = readAdminFile('components/SessionDetailModal.jsx');

  assert.match(modal, /const DetailsList = styled\.dl/);
  assert.match(modal, /tag="dt"/);
  assert.match(modal, /tag="dd"/);
  assert.match(modal, /overflow-wrap:\s*anywhere/);
  assert.match(modal, /formatSessionDateTime\(/);
  assert.match(modal, /getBrowserVersionFromUserAgent\(/);
  assert.doesNotMatch(modal, /toLocaleString\(['"]de-DE['"]\)/);
});

test('session termination stays limited to active rows and keeps the existing API path', () => {
  const modal = readAdminFile('components/SessionDetailModal.jsx');

  assert.match(modal, /sessions\/\$\{session\.id\}\/terminate/);
  assert.match(modal, /disabled=\{!session\.isActive\s*\|\|\s*terminating\}/);
  assert.match(modal, /onSessionTerminated\(\)/);
  assert.match(modal, /onClose\(\)/);
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
