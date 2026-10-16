import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readAdminFile = (relativePath) =>
  readFileSync(new URL(`../admin/src/${relativePath}`, import.meta.url), 'utf8');

test('Session Manager settings use the current Strapi API and keep the existing URLs', () => {
  const source = readAdminFile('index.js');

  assert.ok(/app\.addSettingsLink\(/.test(source), 'settings are registered through the current Strapi method');
  assert.ok(!/createSettingSection/.test(source), 'the deprecated method is not used');
  assert.ok(/defaultMessage:\s*'Session Manager'/.test(source), 'the section label is recognizable');

  const section = source.match(/app\.addSettingsLink\(\s*\{([\s\S]*?)\},\s*\[/)?.[1] || '';
  assert.ok(/id:\s*pluginId/.test(section), 'the existing section id is preserved');
  assert.ok(!/\bto\s*:/.test(section), 'section metadata contains only supported fields');

  for (const route of ['general', 'analytics', 'license']) {
    assert.ok(source.includes(`to: \`${'${pluginId}'}/${route}\``), `${route} route stays stable`);
  }
  assert.ok(/permissions:\s*pluginPermissions/.test(source), 'settings link permissions remain enforced');
});

test('every Settings switch uses a shared horizontal title-copy-control row', () => {
  const settings = readAdminFile('pages/Settings.jsx');
  const row = readAdminFile('components/SettingsToggleRow.jsx');
  const instances = settings.match(/<SettingsToggleRow\b/g) || [];

  assert.equal(instances.length, 8, 'all eight settings switches use the shared row');
  assert.ok(!/<ToggleCard\b|<GreenToggle\b|<Toggle\b/.test(settings), 'no standalone vertical toggle cards remain');
  assert.match(row, /import\s+\{[^}]*\bSwitch\b[^}]*\}\s+from\s+'@strapi\/design-system'/s, 'the row uses Strapi Design System Switch');
  assert.match(row, /const SettingsSwitch = styled\(Switch\)/, 'the row styles Strapi\'s horizontal Switch primitive');
  assert.match(row, /<SettingsSwitch\b/, 'the control uses the horizontal Switch primitive');
  assert.doesNotMatch(row, /<Toggle\b/, 'the vertical Off/On Toggle primitive is not used');
  assert.match(row, /onCheckedChange=\{onChange\}/, 'switch changes pass the new controlled value to the caller');
  assert.match(row, /visibleLabels=\{false\}/, 'the switch does not render stacked Off/On labels');
  assert.ok(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/.test(row), 'copy and horizontal switch share a responsive row');
  assert.ok(/min-width:\s*0/.test(row), 'long copy may shrink and wrap inside the row');
  assert.ok(/aria-label=\{title\}/.test(row), 'each switch has an accessible name');
  assert.ok(/aria-describedby=\{description\s*\?\s*descriptionId\s*:\s*undefined\}/.test(row), 'each switch is associated with its description');
});

test('security feature switches use consistent full-width rows', () => {
  const settings = readAdminFile('pages/Settings.jsx');
  const start = settings.indexOf('{/* Feature Toggles */}');
  const end = settings.indexOf('{/* Max Failed Logins */}', start);
  const featureGroup = settings.slice(start, end);
  const items = featureGroup.match(/<Grid\.Item col=\{\d+\}[^>]*>/g) || [];

  assert.equal(items.length, 3, 'all three security feature switches remain in the group');
  assert.ok(items.every((item) => /col=\{12\}/.test(item)), 'all three descriptions get the same readable row width');
});

test('unpaired max failed login field uses the full settings width', () => {
  const settings = readAdminFile('pages/Settings.jsx');
  const fieldPosition = settings.indexOf('id="max-failed-logins"');
  const itemStart = settings.lastIndexOf('<Grid.Item', fieldPosition);
  const itemEnd = settings.indexOf('>', itemStart);
  const item = settings.slice(itemStart, itemEnd + 1);

  assert.ok(fieldPosition >= 0 && itemStart >= 0 && itemEnd > itemStart, 'max failed login field is inside a grid item');
  assert.match(item, /col=\{12\}/, 'a single field should not leave an empty desktop column');
});

test('encryption key label stays readable and actions wrap on mobile', () => {
  const settings = readAdminFile('pages/Settings.jsx');
  const fieldPosition = settings.indexOf('id="session-encryption-key"');
  const responsiveRowStyle = settings.match(/const EncryptionKeyControls = styled\(Flex\)`([\s\S]*?)`;/)?.[1] || '';
  const rowStart = settings.lastIndexOf('<EncryptionKeyControls', fieldPosition);
  const rowEnd = settings.indexOf('</EncryptionKeyControls>', fieldPosition);
  const fieldRow = settings.slice(rowStart, rowEnd);
  const actionStart = settings.indexOf('<Flex gap={3}', rowEnd);
  const actionEnd = settings.indexOf('</Flex>', actionStart);
  const actions = settings.slice(actionStart, actionEnd);

  assert.ok(fieldPosition >= 0 && rowStart >= 0 && rowEnd > fieldPosition, 'encryption input row exists');
  assert.match(responsiveRowStyle, /width:\s*100%/, 'the input row uses all available width');
  assert.match(responsiveRowStyle, /@media\s*\(max-width:\s*519px\)[\s\S]*?flex-direction:\s*column/, 'the label gets a full-width row on narrow screens');
  assert.match(fieldRow, /flex:\s*'1 1 0',\s*minWidth:\s*0/, 'the field can shrink safely on desktop');
  assert.match(fieldRow, /minWidth:\s*0/, 'the input row can shrink around the Show button');
  assert.ok(actionStart >= 0 && actionEnd > actionStart, 'key actions group exists');
  assert.match(actions, /wrap="wrap"/, 'key buttons wrap instead of pushing past the mobile viewport');
});

test('readable text and field hints fill, but never exceed, their responsive column', () => {
  const readableText = readAdminFile('components/ReadableText.jsx');
  const formField = readAdminFile('components/FormField.jsx');

  assert.ok(/width:\s*100%/.test(readableText), 'readable copy fills its flex column');
  assert.ok(/min-width:\s*0/.test(readableText), 'readable copy can shrink below its intrinsic text size');
  assert.ok(/max-width:\s*72ch/.test(readableText), 'long-form copy remains comfortably measured');
  assert.ok(/FieldHint[\s\S]*?width:\s*100%/.test(formField), 'field hints fill their field column');
  assert.ok(/FieldHint[\s\S]*?min-width:\s*0/.test(formField), 'field hints wrap without widening the page');
});

test('email template tabs wrap instead of clipping on narrow screens', () => {
  const settings = readAdminFile('pages/Settings.jsx');

  assert.match(
    settings,
    /<Tabs\.List[^>]*style=\{\{[^}]*width:\s*'100%'[^}]*minWidth:\s*0[^}]*flexWrap:\s*'wrap'[^}]*\}\}/s
  );
});
