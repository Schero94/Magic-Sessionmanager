import assert from 'node:assert/strict';
import test from 'node:test';
import { areSettingsEqual } from '../admin/src/utils/settingsEquality.mjs';
import { updateEmailTemplate } from '../admin/src/utils/emailTemplateDraft.mjs';
import { readSettingsFile, readSettingsSource } from './helpers/settingsSource.mjs';

test('template edits do not mutate saved settings and are detected as dirty', () => {
  for (const field of ['subject', 'html', 'text']) {
    const saved = { emailTemplates: { suspiciousLogin: { subject: 's', html: 'h', text: 't' }, newLocation: { subject: 'other' } } };
    const edited = { ...saved, emailTemplates: updateEmailTemplate(saved.emailTemplates, 'suspiciousLogin', field, 'changed') };
    assert.equal(saved.emailTemplates.suspiciousLogin[field], { subject: 's', html: 'h', text: 't' }[field]);
    assert.equal(edited.emailTemplates.suspiciousLogin[field], 'changed');
    assert.equal(edited.emailTemplates.newLocation, saved.emailTemplates.newLocation);
    assert.equal(areSettingsEqual(saved, edited), false);
    const restored = { ...edited, emailTemplates: updateEmailTemplate(edited.emailTemplates, 'suspiciousLogin', field, saved.emailTemplates.suspiciousLogin[field]) };
    assert.equal(areSettingsEqual(saved, restored), true);
  }
});

test('all template edit and default actions use immutable updates', () => {
  const editor = readSettingsFile('EmailTemplatesCard.jsx');
  assert.match(editor, /const setField = \(field, value\) => \{\s*handleChange\('emailTemplates', updateEmailTemplate\(templates, templateKey, field, value\)\)/);
  assert.match(editor, /handleChange\('emailTemplates', updateEmailTemplate\(templates, templateKey, field, defaults\[field\]\)\)/);
  for (const field of ['subject', 'html', 'text']) {
    assert.match(editor, new RegExp(`setField\\('${field}', event\\.target\\.value\\)`), field);
  }
  assert.doesNotMatch(readSettingsSource(), /newTemplates\[templateKey\]\.(?:subject|html|text)\s*=/);
});

test('template editors use DS colours, no emoji, translated variables and a confirmed Load Default (SET-07, SET-11, SET-14)', () => {
  const editor = readSettingsFile('EmailTemplatesCard.jsx');
  assert.match(editor, /const CodeTextarea = styled\(Textarea\)/);
  assert.doesNotMatch(editor, /#1e1e1e|#d4d4d4|#888|#333|rgba\(/i);
  assert.doesNotMatch(editor, /\p{Extended_Pictographic}/u);
  assert.doesNotMatch(editor, /<Badge variant="success"/, 'the main-template badge is neutral');
  assert.match(editor, /t\(definition\.messageId, definition\.defaultMessage\)/, 'variable descriptions are visible and translated');
  assert.match(editor, /<Tag\b[\s\S]*?label=\{t\('settings\.email\.templates\.copyVariable'/);
  assert.match(editor, /aria-label=\{t\('settings\.config\.email\.templates\.field'/, 'tablist name is translated');
  assert.doesNotMatch(editor, /<SectionCard\b|tag="h\d"/, 'the editor lives inside the Advanced accordion, below its h3');
  assert.doesNotMatch(editor, /!'\)|Load Default|Copy Template/, 'sentence case, no exclamation marks (IA H.1, H.3)');
  assert.match(editor, /<ConfirmAction\b[\s\S]*?settings\.email\.templates\.loadDefault\.confirmTitle/);
  assert.match(editor, /placeholder=\{t\('settings\.email\.templates\.html\.placeholder'/);
  assert.match(editor, /placeholder=\{t\('settings\.email\.templates\.text\.placeholder'/);
  assert.match(editor, /sandbox=""/, 'the preview iframe runs without scripts');
});
