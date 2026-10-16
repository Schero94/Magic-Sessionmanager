import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const settingsSource = readFileSync(new URL('../admin/src/pages/Settings.jsx', import.meta.url), 'utf8');
const settingsToggleSource = readFileSync(new URL('../admin/src/components/SettingsToggleRow.jsx', import.meta.url), 'utf8');
const homePageSource = readFileSync(new URL('../admin/src/pages/HomePage.jsx', import.meta.url), 'utf8');
const alertSources = [
  ['HomePage', homePageSource],
  ['Settings', settingsSource],
  ['Analytics', readFileSync(new URL('../admin/src/pages/Analytics.jsx', import.meta.url), 'utf8')],
  ['Activation', readFileSync(new URL('../admin/src/pages/License.jsx', import.meta.url), 'utf8')],
  ['Session details', readFileSync(new URL('../admin/src/components/SessionDetailModal.jsx', import.meta.url), 'utf8')],
  ['User session panel', readFileSync(new URL('../admin/src/components/SessionInfoPanel.jsx', import.meta.url), 'utf8')],
];

test('Strapi Design System Switch exposes an accessible name, description, and controlled state', () => {
  const switches = settingsToggleSource.match(/<SettingsSwitch\b[\s\S]*?\/>/g) || [];

  assert.equal(switches.length, 1, 'Settings uses one shared switch component');
  assert.match(settingsToggleSource, /const SettingsSwitch = styled\(Switch\)/, 'the row uses Strapi Design System Switch');
  assert.match(switches[0], /aria-label=/, 'the switch needs an accessible name');
  assert.match(switches[0], /aria-describedby=/, 'the switch should be associated with its description');
  assert.match(switches[0], /checked=\{checked\}/, 'the checked state stays controlled by settings');
  assert.match(switches[0], /onCheckedChange=\{onChange\}/, 'switch changes return the next boolean state');
  assert.match(switches[0], /visibleLabels=\{false\}/, 'the control does not render stacked Off/On labels');
});

test('Strapi Design System alerts provide close labels and text inputs use Field labels', () => {
  const alerts = settingsSource.match(/<Alert\b[^>]*>/g) || [];
  const textInputs = settingsSource.match(/<TextInput\b[^>]*>/g) || [];

  assert.ok(alerts.length > 0, 'expected at least one settings alert');
  for (const [index, alert] of alerts.entries()) {
    assert.match(alert, /closeLabel=/, `alert ${index + 1} needs a close label`);
  }
  for (const [index, input] of textInputs.entries()) {
    assert.doesNotMatch(input, /\blabel=/, `text input ${index + 1} must use Field.Label instead of an unsupported label prop`);
  }
});

test('GeoIP download filename uses a labeled Strapi field', () => {
  const field = settingsSource.match(/<FormField[^>]*id="geoip-database-filename"([\s\S]*?)<\/FormField>/)?.[1];

  assert.ok(field, 'GeoIP filename field exists');
  assert.match(field, /label=/);
  assert.match(field, /description=/);
  assert.match(field, /<TextInput/);
});

test('EmptyStateLayout descriptions do not nest paragraph elements', () => {
  for (const messageId of ['homepage.noResults.description', 'homepage.empty.description']) {
    const messagePosition = homePageSource.indexOf(messageId);
    assert.notEqual(messagePosition, -1, `${messageId} is present`);
    const componentStart = homePageSource.lastIndexOf('<ReadableText', messagePosition);
    const componentOpeningEnd = homePageSource.indexOf('>', componentStart);
    const componentOpeningTag = homePageSource.slice(componentStart, componentOpeningEnd + 1);
    assert.match(componentOpeningTag, /tag="span"/, `${messageId} must not create a <p> inside Strapi's paragraph`);
  }
});

test('Strapi Alert descriptions do not nest paragraph elements', () => {
  for (const [surface, source] of alertSources) {
    const alerts = source.match(/<Alert\b[\s\S]*?<\/Alert>/g) || [];
    for (const [index, alert] of alerts.entries()) {
      assert.doesNotMatch(
        alert,
        /<(?:ReadableText|ReadableParagraphs)[^>]*tag="p"/,
        `${surface} alert ${index + 1} must not nest a paragraph inside Strapi Alert text`
      );
    }
  }
});
