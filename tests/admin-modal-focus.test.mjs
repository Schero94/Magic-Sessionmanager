import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { restoreDialogFocus } from '../admin/src/utils/restoreDialogFocus.mjs';

test('dialog focus returns to the connected opener or an available fallback', () => {
  let focused = '';
  let prevented = false;
  const event = { preventDefault: () => { prevented = true; } };
  const opener = { isConnected: true, focus: () => { focused = 'opener'; } };
  const fallback = { isConnected: true, focus: () => { focused = 'fallback'; } };
  restoreDialogFocus(event, opener, fallback);
  assert.equal(focused, 'opener');
  assert.equal(prevented, true);
  opener.isConnected = false;
  restoreDialogFocus(event, opener, fallback);
  assert.equal(focused, 'fallback');
  prevented = false;
  fallback.isConnected = false;
  restoreDialogFocus(event, opener, fallback);
  assert.equal(prevented, false);
});

test('dashboard retains the actual row or button opener and does not refetch merely on modal toggles', () => {
  const home = readFileSync(new URL('../admin/src/pages/HomePage.jsx', import.meta.url), 'utf8');
  const modal = readFileSync(new URL('../admin/src/components/SessionDetailModal.jsx', import.meta.url), 'utf8');
  assert.match(home, /const openerRef = useRef\(null\)/);
  assert.match(home, /openerRef\.current = opener/);
  assert.ok((home.match(/handleSessionClick\(session, (?:event|e)\.currentTarget\)/g) || []).length >= 4);
  assert.match(home, /restoreDialogFocus\(event, openerRef\.current, dashboardRef\.current\)/);
  assert.match(home, /ref=\{dashboardRef\}[^>]*tabIndex=\{-1\}/);
  assert.match(home, /onCloseAutoFocus=\{handleCloseAutoFocus\}/);
  assert.match(modal, /onCloseAutoFocus=\{onCloseAutoFocus\}/);
  assert.match(home, /useEffect\(\(\) => \{\s*fetchSessions\(\);\s*\}, \[\]\)/);
});
