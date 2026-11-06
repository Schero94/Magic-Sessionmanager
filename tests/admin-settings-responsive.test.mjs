import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { readSettingsFile, readSettingsSource } from './helpers/settingsSource.mjs';

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
  const settings = readSettingsSource();
  const row = readAdminFile('components/SettingsToggleRow.jsx');
  const instances = settings.match(/<SettingsToggleRow\b/g) || [];

  assert.equal(instances.length, 8, 'all eight settings switches use the shared row');
  assert.ok(!/<ToggleCard\b|<GreenToggle\b|<Toggle\b/.test(settings), 'no standalone vertical toggle cards remain');
  assert.match(row, /import\s+\{[^}]*\bSwitch\b[^}]*\}\s+from\s+'@strapi\/design-system'/s, 'the row uses Strapi Design System Switch');
  assert.match(row, /<Switch\b/, 'the control uses the horizontal Switch primitive with its native colours (SET-17)');
  assert.doesNotMatch(row, /data-state='(?:un)?checked'/, 'the row does not restyle DS Switch internals');
  assert.doesNotMatch(row, /<Toggle\b/, 'the vertical Off/On Toggle primitive is not used');
  assert.match(row, /onCheckedChange=\{onChange\}/, 'switch changes pass the new controlled value to the caller');
  assert.match(row, /visibleLabels=\{false\}/, 'the switch does not render stacked Off/On labels');
  assert.ok(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/.test(row), 'copy and horizontal switch share a responsive row');
  assert.ok(/min-width:\s*0/.test(row), 'long copy may shrink and wrap inside the row');
  assert.ok(/aria-label=\{title\}/.test(row), 'each switch has an accessible name');
  assert.ok(/aria-describedby=\{description\s*\?\s*descriptionId\s*:\s*undefined\}/.test(row), 'each switch is associated with its description');
  assert.doesNotMatch(row, /tag="h3"/, 'row titles are labels, not headings (SET-06)');
  assert.doesNotMatch(row, /@media/, 'no custom breakpoints');
});

test('settings field pairs share an equal-height two-column grid that stacks below the medium breakpoint', () => {
  const settings = readSettingsSource();
  const grids = settings.match(/<EqualGrid\b[^>]*>/g) || [];
  assert.ok(grids.length >= 6, 'field pairs use the shared EqualGrid');
  for (const grid of grids) assert.match(grid, /stackBelow="medium"/);
  assert.doesNotMatch(settings, /<Grid\.Item\b/, 'no hand-made grid items with centred alignment (SET-09 browser)');
  assert.doesNotMatch(settings, /@media\s*\(/, 'no custom media queries');
});

test('unpaired temporary IP lockout field uses the full card width', () => {
  const security = readSettingsFile('LoginProtectionTab.jsx');
  const fieldPosition = security.indexOf('id="max-failed-logins"');
  const before = security.slice(security.lastIndexOf('<SectionCard', fieldPosition), fieldPosition);
  assert.ok(fieldPosition >= 0);
  assert.doesNotMatch(before.slice(before.lastIndexOf('/>')), /<EqualGrid\b/, 'a single field is not squeezed into a half column');
});

test('encryption key actions wrap on mobile and the preview uses DS tokens', () => {
  const card = readSettingsFile('EncryptionKeyCard.jsx');
  const actionStart = card.indexOf('<Flex gap={2} wrap="wrap">');
  assert.ok(actionStart >= 0, 'key buttons wrap instead of pushing past the mobile viewport');
  assert.match(card.slice(actionStart, card.indexOf('</Flex>', actionStart)), /settings\.config\.token\.key\.generate/);
  assert.doesNotMatch(card, /fontSize:\s*'12px'|rgba\(|fontFamily:\s*'monospace'/);
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

test('email template tabs keep equal widths and heights instead of clipping on narrow screens', () => {
  const templates = readSettingsFile('EmailTemplatesCard.jsx');

  assert.match(
    templates,
    /const TemplateTabsList = styled\(Tabs\.List\)`[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);[\s\S]*?align-items:\s*stretch;/
  );
});

test('the danger card stacks its button under the text below the small breakpoint (SET-09, SET-03 browser, IA D5 mobile)', () => {
  const general = readSettingsFile('DataRetentionTab.jsx');
  const danger = general.slice(general.indexOf("settings.config.deleteEnded.title"));
  assert.match(danger, /tone="danger"/);
  assert.match(danger, /direction=\{\{ initial: 'column', small: 'row' \}\}/);
  assert.match(danger, /<ConfirmAction\b/);
  assert.doesNotMatch(danger, /flexShrink:\s*0|rgba\(/);
});

test('mobile acceptance: narrow tab panels stack field pairs, the open tab is revealed, targets reach 32 px', () => {
  const page = readSettingsFile('index.jsx');
  assert.match(page, /container-type:\s*inline-size/, 'the tab panel is a size container');
  assert.match(page, /@container \(max-width:[^)]*rem\)\s*\{\s*\[data-equal-grid='2'\] > \*\s*\{\s*grid-column:\s*span 12;/,
    'field pairs stack when the panel is too narrow for two readable columns (768 px with sub-navigation)');
  assert.match(page, /getRevealScrollDelta\(list\.getBoundingClientRect\(\), tab\.getBoundingClientRect\(\)\)/,
    'the selected tab scrolls into the tab list, not the page');

  const row = readAdminFile('components/SettingsToggleRow.jsx');
  assert.match(row, /\[role='switch'\][\s\S]*?height:\s*\$\{\(\{ theme \}\) => theme\.spaces\[7\]\}[\s\S]*?background-clip:\s*padding-box[\s\S]*?margin-block:/,
    'switch hit area grows to 32 px without moving the track');

  const field = readAdminFile('components/FormField.jsx');
  assert.match(field, /input\[role='combobox'\]\s*\{[\s\S]*?min-height:\s*\$\{\(\{ theme \}\) => theme\.spaces\[7\]\}/);
  assert.match(field, /text-overflow:\s*ellipsis/, 'long placeholders end in an ellipsis');

  const retention = readSettingsFile('DataRetentionTab.jsx');
  assert.match(retention, /const DangerButton = styled\(Button\)`[\s\S]*?white-space:\s*nowrap;/, 'danger label stays on one line');
});

test('reference lists cap the term column so descriptions stay readable on tablets', () => {
  const blocks = readSettingsFile('SettingsBlocks.jsx');
  assert.match(blocks, /grid-template-columns:\s*fit-content\(45%\) minmax\(0, 1fr\);/);
});

test('email template tabs never break inside a word and stack in narrow editors', () => {
  const templates = readSettingsFile('EmailTemplatesCard.jsx');
  const list = templates.slice(templates.indexOf('const TemplateTabsList'), templates.indexOf('const VariableGridFrame'));
  assert.doesNotMatch(list, /overflow-wrap:\s*anywhere/);
  assert.match(list, /@container \(max-width: [\d.]+rem\)\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);[\s\S]*?padding-block:/);
  assert.match(templates, /<TemplateTabsFrame>\s*<Tabs\.Root/);
  assert.match(templates, /const VariableGrid = styled\.div`[\s\S]*?& button \{\s*min-width: \$\{\(\{ theme \}\) => theme\.spaces\[7\]\};\s*min-height: \$\{\(\{ theme \}\) => theme\.spaces\[7\]\};/);
});

test('GeoIP actions give keyboard focus back after their button was disabled while running', () => {
  const card = readSettingsFile('GeoIpDatabaseCard.jsx');
  assert.match(card, /refocusIfLost\(buttonRef\.current, accountIdRef\.current\)/);
  assert.match(card, /onClick=\{keepFocus\(geoIp\.saveCredentials, saveCredentialsRef\)\}/);
  assert.match(card, /onClick=\{keepFocus\(\(\) => geoIp\.updateDatabase\(false\), updateRef\)\}/);
  assert.match(card, /onClick=\{keepFocus\(\(\) => geoIp\.updateDatabase\(true\), forceRef\)\}/);
});
