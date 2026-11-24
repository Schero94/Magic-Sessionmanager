import assert from 'node:assert/strict';
import test from 'node:test';
import { readSettingsFile, readSettingsSource } from './helpers/settingsSource.mjs';

const settingsSource = readSettingsSource();
const alerts = readSettingsFile('AlertsTab.jsx');

test('email type checkboxes update the controlled Strapi Design System v2 state', () => {
  const checkboxBlocks = settingsSource.match(/<Checkbox\b[\s\S]*?<\/Checkbox>/g) || [];
  assert.equal(checkboxBlocks.length, 1, 'one Checkbox rendered per email type from a list');
  const [checkbox] = checkboxBlocks;
  assert.match(checkbox, /checked=\{control\.checked\}/);
  assert.match(
    alerts,
    /const control = needsRiskData\s*\?\s*riskDependentControl\(settings\[field\], risk\.state\)\s*:\s*\{ checked: settings\[field\]/,
    'risk-dependent types show their effect, other types the saved value'
  );
  assert.match(
    checkbox,
    /onCheckedChange=\{\(checked\) => handleChange\(field, checked === true\)\}/,
    'stores a boolean from the Radix checked state'
  );
  assert.doesNotMatch(checkbox, /\bonChange=/, 'no native input callback prop');
  assert.match(
    checkbox,
    /aria-describedby=\{hintId\}/,
    'each checkbox is described by its helper text'
  );
  assert.match(checkbox, /disabled=\{disabled\}/);
  assert.match(alerts, /const disabled = emailTypesDisabled \|\| control\.disabled;/);

  const fields = [...alerts.matchAll(/field: '(\w+)'/g)].map((match) => match[1]);
  assert.deepEqual(fields, ['alertOnSuspiciousLogin', 'alertOnNewLocation', 'alertOnVpnProxy']);
});
