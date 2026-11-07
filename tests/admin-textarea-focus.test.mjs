import assert from 'node:assert/strict';
import test from 'node:test';
import { readSettingsSource } from './helpers/settingsSource.mjs';

test('settings inputs and template editors do not suppress their native focus indicator', () => {
  const source = readSettingsSource();
  assert.doesNotMatch(source, /outline:\s*['"]?none/);
  assert.match(
    source,
    /const CodeTextarea = styled\(Textarea\)/,
    'template editors keep the DS Textarea focus ring'
  );
});
