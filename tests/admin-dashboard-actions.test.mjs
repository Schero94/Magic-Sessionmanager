import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../admin/src/pages/HomePage.jsx', import.meta.url), 'utf8');

function getHandler(name) {
  const start = source.indexOf(`const ${name} = async`);
  assert.notEqual(start, -1, `expected ${name} handler`);
  const end = source.indexOf('\n  };', start);
  assert.notEqual(end, -1, `expected ${name} handler end`);
  return source.slice(start, end);
}

test('dashboard termination confirms, locks the row, awaits refresh, and reports success or failure', () => {
  const handler = getHandler('handleTerminateSession');

  assert.ok(handler.indexOf('confirm(') >= 0);
  assert.ok(handler.indexOf('confirm(') < handler.indexOf('post('));
  assert.match(handler, /setTerminatingSessionId\(sessionId\)/);
  assert.match(handler, /await fetchSessions\(\)/);
  assert.match(handler, /notifications\.success\.terminated/);
  assert.match(handler, /notifications\.error\.terminate/);
  assert.match(handler, /finally[\s\S]*setTerminatingSessionId\(null\)/);
});

test('dashboard session-detail removal confirms, prevents duplicate clicks, refreshes and reports both outcomes', () => {
  const handler = getHandler('handleDeleteSession');

  assert.ok(handler.indexOf('confirm(') >= 0);
  assert.ok(handler.indexOf('confirm(') < handler.indexOf('del('));
  assert.match(handler, /setDeletingSessionId\(sessionId\)/);
  assert.match(handler, /await fetchSessions\(\)/);
  assert.match(handler, /notifications\.success\.deleted/);
  assert.match(handler, /notifications\.error\.delete/);
  assert.match(handler, /finally[\s\S]*setDeletingSessionId\(null\)/);
});

test('desktop and mobile dashboard action buttons expose pending state and block duplicate mutations', () => {
  assert.match(source, /loading=\{terminatingSessionId === session\.id\}/);
  assert.match(source, /loading=\{deletingSessionId === session\.id\}/);
  assert.ok((source.match(/disabled=\{[^}]*terminatingSessionId[^}]*\}/g) || []).length >= 2);
  assert.ok((source.match(/disabled=\{[^}]*deletingSessionId[^}]*\}/g) || []).length >= 2);
});
