import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const settingsSource = readFileSync(new URL('../admin/src/pages/Settings.jsx', import.meta.url), 'utf8');

test('email alert checkboxes update the controlled Strapi Design System v2 state', () => {
  const checkboxBlocks = settingsSource.match(/<Checkbox\b[\s\S]*?<\/Checkbox>/g) || [];
  const expectedFields = [
    'alertOnSuspiciousLogin',
    'alertOnNewLocation',
    'alertOnVpnProxy',
  ];

  assert.equal(checkboxBlocks.length, expectedFields.length);

  for (const field of expectedFields) {
    const checkbox = checkboxBlocks.find((block) => block.includes(`checked={settings.${field}}`));
    assert.ok(checkbox, `expected a checkbox bound to ${field}`);
    assert.match(
      checkbox,
      new RegExp(`onCheckedChange=\\{\\(checked\\) => handleChange\\('${field}', checked === true\\)\\}`),
      `${field} must receive Radix's checked state and store a boolean`
    );
    assert.doesNotMatch(checkbox, /\bonChange=/, `${field} must not use the native input callback prop`);
  }
});
