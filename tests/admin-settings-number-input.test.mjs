import assert from 'node:assert/strict';
import test from 'node:test';
import { readSettingsFile } from './helpers/settingsSource.mjs';

const security = readSettingsFile('SecurityTab.jsx');

test('maximum failed-login attempts follows the server range and reports errors instead of clamping (SET-03)', () => {
  const valueIndex = security.indexOf('value={settings.maxFailedLogins}');
  const inputStart = security.lastIndexOf('<NumberInput', valueIndex);
  const inputEnd = security.indexOf('/>', valueIndex) + 2;
  const numberInput = inputStart >= 0 && inputEnd > inputStart ? security.slice(inputStart, inputEnd) : '';

  assert.match(numberInput, /min=\{MAX_FAILED_LOGINS_RANGE\.min\}/);
  assert.match(numberInput, /max=\{MAX_FAILED_LOGINS_RANGE\.max\}/);
  assert.match(numberInput, /onValueChange=\{\(value\) => handleChange\('maxFailedLogins', value\)\}/);
  assert.doesNotMatch(security, /Math\.max\(0, Math\.min\(value, 100\)\)/, 'no silent clamping');
  assert.doesNotMatch(security, /maxFailedLoginInputRevision/);

  const field = security.slice(security.lastIndexOf('<FormField', valueIndex), valueIndex);
  assert.match(field, /error=\{maxFailedError\}/);
  assert.match(field, /required/);
  assert.match(security, /const maxFailedError = tError\(errors\.maxFailedLogins\)/);
});

test('the field hint and the count preview use separate messages (I18N-1, SET-02)', () => {
  const field = security.slice(security.indexOf('id="max-failed-logins"'), security.indexOf('<NumberInput'));
  assert.match(field, /description=\{t\('settings\.security\.maxFailed\.fieldHint'/);
  assert.doesNotMatch(field, /settings\.security\.maxFailed\.hint'/);
  assert.match(security, /t\('settings\.security\.maxFailed\.hint', 'User will be blocked after \{count\} failed attempts', \{ count: maxFailedValue \}\)/);
  assert.doesNotMatch(security, /background="warning50"/, 'warning50 is not a DS token');
});
