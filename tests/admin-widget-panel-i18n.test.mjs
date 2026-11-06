import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * Every literal message id in the user panel, the home widget and the widget
 * registration must exist in all five locales, and the code defaultMessage must
 * equal the English catalogue value (UX-01, I18N-2, I18N-9, UX-07).
 */
const read = (path) => readFileSync(new URL(`../admin/src/${path}`, import.meta.url), 'utf8');
const locales = ['en', 'de', 'es', 'fr', 'pt'];
const catalogues = Object.fromEntries(locales.map((locale) => [locale, JSON.parse(read(`translations/${locale}.json`))]));

/**
 * @param {string} source JSX source.
 * @returns {Array<{id: string, defaultMessage: string}>} Literal t('id', 'default') calls.
 */
const literalMessages = (source) =>
  [...source.matchAll(/\bt\(\s*'([^']+)',\s*'((?:[^'\\]|\\.)*)'/g)].map((match) => ({
    id: match[1],
    defaultMessage: match[2].replace(/\\'/g, "'"),
  }));

const messages = [
  ...literalMessages(read('components/SessionInfoPanel.jsx')),
  ...literalMessages(read('components/OnlineUsersWidget.jsx')),
  ...[...read('index.js').matchAll(/id: `\$\{pluginId\}\.(widget\.[^`]+)`,\s*defaultMessage: '([^']+)'/g)]
    .map((match) => ({ id: match[1], defaultMessage: match[2] })),
];

test('the scan finds the panel, widget and registration messages', () => {
  const ids = new Set(messages.map(({ id }) => id));
  for (const id of [
    'panel.error.message',
    'panel.confirm.blockBody',
    'panel.sessions.showAllLink',
    'widget.stats.onlineUsers',
    'widget.stats.registeredUsers',
    'widget.link',
    'widget.online-users.title',
  ]) {
    assert.ok(ids.has(id), id);
  }
});

test('panel and widget messages exist in every locale', () => {
  const missing = [];
  for (const { id } of messages) {
    for (const locale of locales) {
      if (typeof catalogues[locale][id] !== 'string') missing.push(`${locale}:${id}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('panel and widget defaultMessages equal the English catalogue', () => {
  const drift = messages
    .filter(({ id, defaultMessage }) => catalogues.en[id] !== undefined && catalogues.en[id] !== defaultMessage)
    .map(({ id }) => id);
  assert.deepEqual(drift, []);
});

test('German panel and widget copy uses the IA glossary: "sperren", "Sitzung", formal "Sie"', () => {
  const de = catalogues.de;
  const ids = [...new Set(messages.map(({ id }) => id))].filter((id) => /^(panel|widget)\./.test(id));
  for (const id of ids) {
    assert.doesNotMatch(de[id], /blockier|\bSession(s)?\b(?! Manager)|\bInaktiv\b|\b(du|dein|deine|dich|dir)\b/i, id);
  }
  for (const id of ['panel.actions.blockUser', 'panel.confirm.blockTitle', 'panel.blocked.message', 'panel.notify.blockSuccess', 'widget.stats.blockedUsers']) {
    assert.match(de[id], /sperr/i, id);
  }
  assert.equal(de['panel.actions.unblock'], 'Sperre aufheben');
  assert.equal(de['panel.status.notOnline'], 'Nicht online');
  assert.equal(de['widget.stats.idleSessions'], 'Sitzungen im Leerlauf');
});
