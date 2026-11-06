import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readSettingsFile, readSettingsSource } from './helpers/settingsSource.mjs';

const settingsSource = readSettingsSource();
const formFieldSource = readFileSync(
  new URL('../admin/src/components/FormField.jsx', import.meta.url),
  'utf8'
);

test('template editors are DS Textareas connected to their labels, hints and errors through Field context', () => {
  const templates = readSettingsFile('EmailTemplatesCard.jsx');
  assert.doesNotMatch(settingsSource, /<textarea\b/, 'no raw textarea elements remain');
  const editors =
    templates
      .match(/<FormField\b[\s\S]*?<\/FormField>/g)
      ?.filter((field) => /<CodeTextarea\b/.test(field)) || [];
  assert.equal(editors.length, 2, 'HTML and text template editors');
  for (const editor of editors) {
    assert.match(editor, /id=\{`email-template-(?:html|text)-\$\{templateKey\}`\}/);
    assert.match(editor, /description=\{t\(/);
    assert.match(editor, /error=\{tError\(/);
  }

  assert.match(
    formFieldSource,
    /<Field\.Root[^>]*id=\{id\}[^>]*hint=\{description\}[^>]*error=\{error \|\| undefined\}/
  );
  assert.match(formFieldSource, /<FieldHint><Field\.Hint \/><Field\.Error \/><\/FieldHint>/);
});

test('webhook URLs are masked single-line inputs with a reveal toggle and inline validation (SET-15, IA I.1-22)', () => {
  const notifications = readSettingsFile('AlertsTab.jsx');
  for (const id of ['discord-webhook-url', 'slack-webhook-url']) {
    const field =
      notifications.match(new RegExp(`<FormField\\s+id="${id}"[\\s\\S]*?<\\/FormField>`))?.[0] ||
      '';
    assert.match(field, /<SecretTextInput\b/, id);
    assert.match(field, /revealedType="url"/, id);
    assert.match(field, /error=\{tError\(errors\.(?:discord|slack)WebhookUrl\)\}/, id);
  }
  assert.doesNotMatch(notifications, /settings\.webhooks\.characters/, 'no character counter');
  assert.doesNotMatch(notifications, /<Textarea\b/, 'single-line inputs only');
  assert.doesNotMatch(
    notifications,
    /custom endpoints/i,
    'the server accepts Discord and Slack only'
  );
});
