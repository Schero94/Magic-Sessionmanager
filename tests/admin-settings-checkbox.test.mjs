import assert from 'node:assert/strict';
import test from 'node:test';
import { readSettingsFile, readSettingsSource } from './helpers/settingsSource.mjs';

const settingsSource = readSettingsSource();
const alerts = readSettingsFile('AlertsTab.jsx');

test('email type checkboxes update the controlled Strapi Design System v2 state', () => {
  const checkboxBlocks = settingsSource.match(/<Checkbox\b[\s\S]*?<\/Checkbox>/g) || [];
  assert.equal(checkboxBlocks.length, 1, 'one Checkbox rendered per email type from a list');
  const [checkbox] = checkboxBlocks;
  assert.match(checkbox, /checked=\{settings\[field\]\}/);
  assert.match(checkbox, /onCheckedChange=\{\(checked\) => handleChange\(field, checked === true\)\}/, 'stores a boolean from the Radix checked state');
  assert.doesNotMatch(checkbox, /\bonChange=/, 'no native input callback prop');
  assert.match(checkbox, /aria-describedby=\{hintId\}/, 'each checkbox is described by its helper text');
  assert.match(checkbox, /disabled=\{emailTypesDisabled\}/);

  const fields = [...alerts.matchAll(/field: '(\w+)'/g)].map((match) => match[1]);
  assert.deepEqual(fields, ['alertOnSuspiciousLogin', 'alertOnNewLocation', 'alertOnVpnProxy']);
});
