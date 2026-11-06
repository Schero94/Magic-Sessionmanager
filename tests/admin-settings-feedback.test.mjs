import assert from 'node:assert/strict';
import test from 'node:test';
import { readSettingsFile } from './helpers/settingsSource.mjs';

const hook = readSettingsFile('hooks/useSettingsForm.js');
const handler = (name) => {
  const start = hook.indexOf(`const ${name} = useCallback(`);
  assert.ok(start >= 0, `${name} exists`);
  return hook.slice(start, hook.indexOf('\n  }, [', start));
};

test('Save sends preserved keys, names adjusted fields and keeps the draft on failure (IA E.2, I.1-20)', () => {
  const save = handler('handleSave');
  assert.match(save, /const submitted = buildSavePayload\(settingsRef\.current, savedSettingsRef\.current\)/);
  assert.match(save, /if \(Object\.keys\(validateSettings\(submitted\)\)\.length > 0\) return false;/, 'invalid drafts are never sent');
  assert.match(save, /getAdjustedFields\(submitted, stored, previous\)\s*\.map\(\(key\) => SETTINGS_FIELD_LABELS\[key\]\)/);
  assert.match(save, /'settings\.config\.feedback\.adjusted',\s*'Settings saved\. Some values were adjusted to the allowed limits: \{fields\}\.',\s*\{ fields: formatList\(adjustedNames, locale\) \}/);
  assert.match(save, /t\('notifications\.success\.saved', 'Settings saved\.'\)/);
  assert.match(save, /t\('settings\.config\.feedback\.saveError', 'Settings could not be saved\. Your changes are still in the form\.'\)/);
  const catchBlock = save.slice(save.indexOf('} catch (err) {'));
  assert.doesNotMatch(catchBlock, /setSettings\(/, 'a failed save keeps the draft');
});

test('Discard restores the stored settings, never the defaults (IA E.2)', () => {
  const discard = handler('handleReset');
  assert.match(discard, /setSettings\(savedSettingsRef\.current\)/);
  assert.doesNotMatch(discard, /SETTINGS_DEFAULTS|INITIAL_SETTINGS|get\(/);
});

test('MaxMind credentials: save, confirmed removal and the environment note (IA E.2)', () => {
  assert.match(handler('handleSaveGeoIpCredentials'), /t\('settings\.config\.feedback\.credentialsSaved', 'Credentials saved\.'\)/);
  const remove = handler('handleRemoveGeoIpCredentials');
  assert.match(remove, /put\(`\/\$\{pluginId\}\/geoip\/credentials`, \{ clear: true \}\)/);
  assert.match(remove, /t\('settings\.config\.feedback\.credentialsRemoved', 'Credentials removed\.'\)/);
  assert.match(remove, /throw err;/, 'the confirmation stays open on failure');

  const card = readSettingsFile('GeoIpDatabaseCard.jsx');
  const confirm = card.slice(card.indexOf('<ConfirmAction'), card.indexOf('onConfirm={geoIp.removeCredentials}') + 40);
  assert.match(confirm, /t\('settings\.config\.database\.remove\.title', 'Remove stored MaxMind credentials\?'\)/);
  assert.match(confirm, /'Updates of the GeoIP database stop working unless credentials are set as environment variables\.'/);
  assert.match(confirm, /t\('settings\.config\.database\.remove\.action', 'Remove'\)/);
  assert.match(card, /credentialSource === 'store' \? \(\s*<ConfirmAction/, 'only stored credentials can be removed');
  assert.match(card, /'Environment variables are set and take precedence; stored values are ignored\.'/);
  assert.match(card, /readOnly=\{fromEnvironment\}/);
  assert.match(card, /type="password"/, 'the license key is masked');
  assert.match(card, /maxLength=\{64\}/);
  assert.match(card, /maxLength=\{256\}/);
});

test('GeoIP update names edition and build date, and shows the server message on errors (IA E.2)', () => {
  const update = handler('handleUpdateGeoIpDatabase');
  assert.match(update, /post\(`\/\$\{pluginId\}\/geoip\/update`, \{ force \}\)/);
  assert.match(update, /'GeoIP database updated: \{edition\}, built \{date\}\.'/);
  assert.match(update, /getServerMessage\(err\)\s*\|\| t\('settings\.config\.feedback\.geoipUpdateError'/);
  const card = readSettingsFile('GeoIpDatabaseCard.jsx');
  assert.match(card, /onClick=\{keepFocus\(\(\) => geoIp\.updateDatabase\(false\), updateRef\)\}[\s\S]*?t\('settings\.config\.database\.update', 'Update database'\)/);
  assert.match(card, /onClick=\{keepFocus\(\(\) => geoIp\.updateDatabase\(true\), forceRef\)\}[\s\S]*?t\('settings\.config\.database\.force', 'Force download'\)/);
  assert.match(card, /disabled=\{databaseDisabled \|\| geoIp\.updating \|\| !geoIpStatus\?\.hasCredentials \|\| hasChanges\}/);
});

test('the encryption key copy says what to do next (IA E.2)', () => {
  const card = readSettingsFile('EncryptionKeyCard.jsx');
  assert.match(card, /formatEnvLine\(ENCRYPTION_KEY_ENV_NAME, encryptionKey\),\s*t\('settings\.config\.token\.key\.copied', 'Copied\. Add it to your server environment and restart Strapi\.'\)/);
  assert.match(readSettingsFile('SessionsTab.jsx'), /const encryptionKeyDraft = useEncryptionKeyDraft\(\)/, 'the key survives collapsing the Advanced accordion');
});
