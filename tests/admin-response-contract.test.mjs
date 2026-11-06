import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { requireSessionList, requireSuccessfulMutation } from '../admin/src/utils/adminResponse.mjs';

test('session list responses require a data array, including a valid empty array', () => {
  const sessions = [{ id: 'synthetic' }];
  assert.equal(requireSessionList({ data: sessions }), sessions);
  assert.deepEqual(requireSessionList({ data: [] }), []);
  for (const value of [null, {}, { data: null }, { data: {} }]) {
    assert.throws(() => requireSessionList(value), /Invalid session response/);
  }
});

test('mutation responses only accept an explicit successful envelope', () => {
  const payload = { success: true, blocked: false };
  assert.equal(requireSuccessfulMutation(payload), payload);
  for (const value of [null, {}, { success: false }, { success: 'true' }]) {
    assert.throws(() => requireSuccessfulMutation(value), /Invalid mutation response/);
  }
});

test('dashboard, analytics, panel and GeoIP handlers validate their response envelopes', () => {
  const read = (path) => readFileSync(new URL(`../admin/src/${path}`, import.meta.url), 'utf8');
  for (const path of ['pages/HomePage.jsx', 'pages/Analytics.jsx', 'components/SessionInfoPanel.jsx']) {
    assert.match(read(path), /requireSessionList\(data\)/, path);
  }
  for (const path of ['pages/Settings.jsx', 'components/SessionInfoPanel.jsx']) {
    assert.equal((read(path).match(/requireSuccessfulMutation\(response\.data\)/g) || []).length, 2, path);
  }
});
