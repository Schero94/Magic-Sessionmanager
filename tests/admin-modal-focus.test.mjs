import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { pickFocusTarget, refocusIfLost, restoreDialogFocus } from '../admin/src/utils/restoreDialogFocus.mjs';

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

test('a disabled opener is skipped, so focus lands on the fallback instead of <body>', () => {
  const opener = { isConnected: true, disabled: true, focus() {} };
  const fallback = { isConnected: true, focus() {} };
  assert.equal(pickFocusTarget(opener, fallback), fallback);
  const ariaDisabled = { isConnected: true, getAttribute: (name) => (name === 'aria-disabled' ? 'true' : null), focus() {} };
  assert.equal(pickFocusTarget(ariaDisabled, fallback), fallback);
  assert.equal(pickFocusTarget({ isConnected: true, focus() {} }, fallback).disabled, undefined);
  assert.equal(pickFocusTarget(null, null), null);
  assert.equal(pickFocusTarget(opener, { isConnected: false, focus() {} }), null);
});

test('dashboard retains the actual row or button opener and does not refetch merely on modal toggles', () => {
  const home = readFileSync(new URL('../admin/src/pages/HomePage.jsx', import.meta.url), 'utf8');
  const modal = readFileSync(new URL('../admin/src/components/SessionDetailModal.jsx', import.meta.url), 'utf8');
  const actions = readFileSync(new URL('../admin/src/pages/Dashboard/SessionActions.jsx', import.meta.url), 'utf8');
  const table = readFileSync(new URL('../admin/src/pages/Dashboard/SessionTable.jsx', import.meta.url), 'utf8');
  assert.match(home, /const openerRef = useRef\(null\)/);
  assert.match(home, /openerRef\.current = opener/);
  assert.match(home, /onView: handleSessionClick/);
  // Table and card View buttons pass themselves as the opener.
  assert.ok((actions.match(/onView\(session, (?:event|e)\.currentTarget\)/g) || []).length >= 2);
  // A row click hands over the row's View button, so focus returns to a real control.
  assert.match(table, /onView\(session, opener \|\| event\.currentTarget\)/);
  assert.match(home, /restoreDialogFocus\(event, openerRef\.current, listHeadingRef\.current \|\| dashboardRef\.current\)/);
  assert.match(home, /ref=\{dashboardRef\}[^>]*tabIndex=\{-1\}/);
  assert.match(home, /onCloseAutoFocus=\{handleCloseAutoFocus\}/);
  assert.match(modal, /onCloseAutoFocus=\{onCloseAutoFocus\}/);
  assert.match(home, /useEffect\(\(\) => \{\s*fetchSessions\(\);\s*\}, \[\]\)/);
});

test('refocusIfLost puts focus back on the button that ran a slow action, only when focus fell to <body>', () => {
  const focused = [];
  const body = { tagName: 'BODY' };
  const make = (name, disabled = false) => ({ name, disabled, isConnected: true, focus() { focused.push(name); }, getAttribute: () => null });
  const button = make('update');
  const fallback = make('fallback');

  refocusIfLost(button, fallback, { activeElement: body, body });
  assert.deepEqual(focused, ['update']);

  refocusIfLost(make('disabled', true), fallback, { activeElement: null, body });
  assert.deepEqual(focused, ['update', 'fallback']);

  // The admin moved on (for example into a field): focus is left alone.
  refocusIfLost(button, fallback, { activeElement: make('field'), body });
  assert.deepEqual(focused, ['update', 'fallback']);
});
