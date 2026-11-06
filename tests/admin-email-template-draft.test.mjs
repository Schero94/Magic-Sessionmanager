import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { areSettingsEqual } from '../admin/src/utils/settingsEquality.mjs';
import { updateEmailTemplate } from '../admin/src/utils/emailTemplateDraft.mjs';

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
  const source = readFileSync(new URL('../admin/src/pages/Settings.jsx', import.meta.url), 'utf8');
  assert.equal((source.match(/updateEmailTemplate\(/g) || []).length, 5);
  assert.doesNotMatch(source, /newTemplates\[templateKey\]\.(?:subject|html|text)\s*=/);
});
