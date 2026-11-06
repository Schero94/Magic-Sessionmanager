import assert from 'node:assert/strict';
import test from 'node:test';
import { readSettingsFile } from './helpers/settingsSource.mjs';

const login = readSettingsFile('LoginProtectionTab.jsx');

test('temporary IP lockout follows the server range and reports errors instead of clamping (SET-03)', () => {
  const valueIndex = login.indexOf('value={settings.maxFailedLogins}');
  const inputStart = login.lastIndexOf('<NumberInput', valueIndex);
  const inputEnd = login.indexOf('/>', valueIndex) + 2;
  const numberInput =
    inputStart >= 0 && inputEnd > inputStart ? login.slice(inputStart, inputEnd) : '';

  assert.match(numberInput, /min=\{MAX_FAILED_LOGINS_RANGE\.min\}/);
  assert.match(numberInput, /max=\{MAX_FAILED_LOGINS_RANGE\.max\}/);
  assert.match(
    numberInput,
    /onValueChange=\{\(value\) => handleChange\('maxFailedLogins', value\)\}/
  );
  assert.doesNotMatch(login, /Math\.max\(0, Math\.min\(value, 100\)\)/, 'no silent clamping');

  const field = login.slice(login.lastIndexOf('<FormField', valueIndex), valueIndex);
  assert.match(field, /error=\{maxFailedError\}/);
  assert.match(field, /required/);
  assert.match(
    field,
    /suffix=\{t\('settings\.config\.failed\.lockout\.suffix', 'failed sign-ins'\)\}/,
    'the unit is an input suffix (IA F)'
  );
  assert.match(login, /const maxFailedError = tError\(errors\.maxFailedLogins\)/);
});

test('the field hint and the {count} lockout sentence use separate messages (I18N-1, SET-02, IA I.1-29)', () => {
  const field = login.slice(login.indexOf('id="max-failed-logins"'), login.indexOf('<NumberInput'));
  assert.match(
    field,
    /label=\{t\('settings\.config\.failed\.lockout\.label', 'Temporary IP lockout after'\)\}/
  );
  assert.match(field, /description=\{t\('settings\.config\.failed\.lockout\.hint'/);
  assert.doesNotMatch(field, /settings\.config\.failed\.lockout\.preview'/);
  assert.match(
    login,
    /'settings\.config\.failed\.lockout\.preview',\s*'After \{count, plural, one \{# failed sign-in\} other \{# failed sign-ins\}\} from one IP address within 15 minutes, that address is refused for 15 minutes\. User accounts are not blocked\. Counted per server process\.',\s*\{ count: maxFailedValue \}/
  );
  assert.doesNotMatch(
    login,
    /will be blocked after/i,
    'the lockout targets IP addresses, not accounts (IA A.1)'
  );
  assert.doesNotMatch(login, /background="warning50"/, 'warning50 is not a DS token');
});

test('the lockout input shows the stored value again after Discard changes and after Save (DS NumberInput keeps its own text)', () => {
  // DS NumberInput prefers its internal text over a changed `value` prop, so
  // a reset draft would still show the discarded number. The form bumps a
  // draft version whenever it replaces the draft, and the input remounts.
  const hook = readSettingsFile('hooks/useSettingsForm.js');
  assert.match(hook, /const \[draftVersion, setDraftVersion\] = useState\(0\)/);
  const reset = hook.slice(
    hook.indexOf('const handleReset = useCallback'),
    hook.indexOf('}, []);', hook.indexOf('const handleReset = useCallback'))
  );
  assert.match(reset, /setDraftVersion\(\(version\) => version \+ 1\)/);
  const save = hook.slice(
    hook.indexOf('const handleSave = useCallback'),
    hook.indexOf('const handleReset = useCallback')
  );
  assert.match(
    save,
    /setSavedSettings\(stored\);\s*setDraftVersion\(\(version\) => version \+ 1\)/
  );
  assert.match(hook, /\n    draftVersion,\n/);

  const valueIndex = login.indexOf('value={settings.maxFailedLogins}');
  const numberInput = login.slice(login.lastIndexOf('<NumberInput', valueIndex), valueIndex);
  assert.match(numberInput, /key=\{form\.draftVersion\}/);
});
