import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const licenseSource = readFileSync(
  new URL('../admin/src/pages/License.jsx', import.meta.url),
  'utf8'
);
import { readSettingsFile } from './helpers/settingsSource.mjs';
import { unwrapSource } from './helpers/unwrapSource.mjs';

const settingsSource = readSettingsFile('EncryptionKeyCard.jsx');

test('license key masking keeps only a short suffix visible', async () => {
  const { maskSensitiveValue } = await import('../admin/src/utils/maskSensitiveValue.mjs');

  assert.equal(maskSensitiveValue('LIC-1234-SECRET-9876'), '••••••••9876');
  assert.equal(maskSensitiveValue('abcd'), '••••••••');
  assert.equal(maskSensitiveValue(''), '••••••••');
  assert.equal(maskSensitiveValue(null), '••••••••');
});

test('license key is masked by default and has an explicit accessible reveal control', () => {
  assert.match(licenseSource, /useState\(false\).*showLicenseKey/s);
  assert.match(
    licenseSource,
    /showLicenseKey\s*\?\s*data\.licenseKey\s*:\s*maskSensitiveValue\(data\.licenseKey\)/
  );
  // DS IconButton turns `label` into its accessible name (aria-label).
  assert.match(licenseSource, /<IconButton\b[^>]*?\b(?:aria-)?label=\{t\(\s*showLicenseKey\s*\?/s);

  for (const locale of ['de', 'en', 'es', 'fr', 'pt']) {
    const translations = JSON.parse(
      readFileSync(new URL(`../admin/src/translations/${locale}.json`, import.meta.url), 'utf8')
    );
    assert.equal(
      typeof translations['license.key.show'],
      'string',
      `${locale} needs a show-key label`
    );
    assert.equal(
      typeof translations['license.key.hide'],
      'string',
      `${locale} needs a hide-key label`
    );
  }
});

test('license download filename does not disclose a key prefix', () => {
  assert.match(licenseSource, /link\.download\s*=\s*['"]session-manager-license\.txt['"]/);
  assert.doesNotMatch(licenseSource, /licenseKey\.substring\(0,\s*8\)/);
});

test('encryption key remains masked in the .env preview until the show control is enabled', () => {
  assert.match(
    unwrapSource(settingsSource),
    /formatEnvLine\(ENCRYPTION_KEY_ENV_NAME, showEncryptionKey\s*\?\s*encryptionKey\s*:\s*maskSensitiveValue\(encryptionKey\)\)/
  );
  assert.doesNotMatch(settingsSource, /SESSION_ENCRYPTION_KEY=\{encryptionKey\}/);
});

test('a generated encryption key stays hidden until revealed and the reveal toggle reports its state (SET-10)', () => {
  const generate = settingsSource.slice(
    settingsSource.indexOf('const handleGenerate'),
    settingsSource.indexOf('return (', settingsSource.indexOf('const handleGenerate'))
  );
  assert.match(generate, /setEncryptionKey\(generateEncryptionKey\(\)\)/);
  assert.match(generate, /setShowEncryptionKey\(false\)/);
  assert.doesNotMatch(generate, /setShowEncryptionKey\(true\)/);
  assert.match(settingsSource, /revealed=\{showEncryptionKey\}/);
  const secretInput = readFileSync(
    new URL('../admin/src/pages/Settings/SecretTextInput.jsx', import.meta.url),
    'utf8'
  );
  assert.match(secretInput, /aria-pressed=\{revealed\}/);
  assert.match(secretInput, /type=\{revealed \? revealedType : 'password'\}/);
});

test('the copied .env line is quoted so dotenv keeps every character (SET-01)', () => {
  assert.match(settingsSource, /formatEnvLine\(ENCRYPTION_KEY_ENV_NAME, encryptionKey\)/);
  assert.doesNotMatch(settingsSource, /`SESSION_ENCRYPTION_KEY=\$\{/);
});
