import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const settingsSource = readFileSync(new URL('../admin/src/pages/Settings.jsx', import.meta.url), 'utf8');

test('maximum failed-login attempts follows the server range and clamps typed values', () => {
  const valueIndex = settingsSource.indexOf('value={settings.maxFailedLogins}');
  const inputStart = settingsSource.lastIndexOf('<NumberInput', valueIndex);
  const inputEnd = settingsSource.indexOf('/>', valueIndex) + 2;
  const numberInput = inputStart >= 0 && inputEnd > inputStart
    ? settingsSource.slice(inputStart, inputEnd)
    : '';

  assert.match(numberInput, /max=\{100\}/);
  assert.match(numberInput, /onValueChange=\{\(value\) => \{/);
  assert.match(numberInput, /Math\.max\(0, Math\.min\(value, 100\)\)/);
  assert.match(numberInput, /handleChange\('maxFailedLogins', normalizedValue\)/);
  assert.match(settingsSource, /maxFailedLoginInputRevision/);
  assert.match(numberInput, /key=\{maxFailedLoginInputRevision\}/);
});
