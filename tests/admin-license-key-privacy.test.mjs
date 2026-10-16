import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const licenseSource = readFileSync(new URL('../admin/src/pages/License.jsx', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../admin/src/pages/Settings.jsx', import.meta.url), 'utf8');

test('license key masking keeps only a short suffix visible', async () => {
  const { maskSensitiveValue } = await import('../admin/src/utils/maskSensitiveValue.mjs');

  assert.equal(maskSensitiveValue('LIC-1234-SECRET-9876'), '••••••••9876');
  assert.equal(maskSensitiveValue('abcd'), '••••••••');
  assert.equal(maskSensitiveValue(''), '••••••••');
  assert.equal(maskSensitiveValue(null), '••••••••');
});

test('activation key is masked by default and has an explicit accessible reveal control', () => {
  assert.match(licenseSource, /useState\(false\).*showLicenseKey/s);
  assert.match(licenseSource, /showLicenseKey\s*\?\s*data\.licenseKey\s*:\s*maskSensitiveValue\(data\.licenseKey\)/);
  assert.match(licenseSource, /aria-label=\{t\(\s*showLicenseKey\s*\?/);

  for (const locale of ['de', 'en', 'es', 'fr', 'pt']) {
    const translations = JSON.parse(
      readFileSync(new URL(`../admin/src/translations/${locale}.json`, import.meta.url), 'utf8')
    );
    assert.equal(typeof translations['license.key.show'], 'string', `${locale} needs a show-key label`);
    assert.equal(typeof translations['license.key.hide'], 'string', `${locale} needs a hide-key label`);
  }
});

test('activation-key download filename does not disclose a key prefix', () => {
  assert.match(licenseSource, /link\.download\s*=\s*['"]session-manager-activation\.txt['"]/);
  assert.doesNotMatch(licenseSource, /licenseKey\.substring\(0,\s*8\)/);
});

test('encryption key remains masked in the .env preview until the show control is enabled', () => {
  assert.match(
    settingsSource,
    /SESSION_ENCRYPTION_KEY=\{showEncryptionKey\s*\?\s*encryptionKey\s*:\s*maskSensitiveValue\(encryptionKey\)\}/
  );
  assert.doesNotMatch(settingsSource, /SESSION_ENCRYPTION_KEY=\{encryptionKey\}/);
});
