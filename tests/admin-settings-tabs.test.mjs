import assert from 'node:assert/strict';
import test from 'node:test';
import { readSettingsFile, readSettingsSource } from './helpers/settingsSource.mjs';
import { SETTINGS_TABS } from '../admin/src/utils/settingsForm.mjs';

const page = readSettingsFile('index.jsx');
const source = readSettingsSource();

test('settings are split into a page, one module per tab and the useSettingsForm hook', () => {
  for (const file of ['index.jsx', 'GeneralTab.jsx', 'SecurityTab.jsx', 'GeofencingTab.jsx', 'NotificationsTab.jsx', 'hooks/useSettingsForm.js']) {
    assert.ok(readSettingsFile(file).length > 0, file);
  }
  assert.match(readSettingsFile('../Settings.jsx'), /export \{ default \} from '\.\/Settings\/index'/);
});

test('settings sections are native DS Tabs: General, Security, Geofencing, Notifications', () => {
  assert.deepEqual([...SETTINGS_TABS], ['general', 'security', 'geofencing', 'notifications']);
  assert.match(page, /<Tabs\.Root\b[\s\S]*?value=\{activeTab\}[\s\S]*?onValueChange=\{setActiveTab\}/);
  assert.match(page, /hasError=\{form\.errorTab\}/, 'a tab with invalid fields is marked');
  assert.match(page, /aria-label=\{t\('settings\.tabs\.label'/);
  for (const tab of SETTINGS_TABS) {
    assert.match(page, new RegExp(`<Tabs\\.Content value="${tab}" forceMount hidden=\\{activeTab !== '${tab}'\\}>`), tab);
  }
  assert.doesNotMatch(source, /<Accordion\b/, 'the accordion layout is gone');
});

test('section tab labels wrap on narrow screens instead of overflowing', () => {
  assert.match(page, /const SettingsTabsList = styled\(Tabs\.List\)`[\s\S]*?flex-wrap:\s*wrap/);
});

test('header holds Save (disabled when clean or invalid) and a confirmed Reset', () => {
  assert.match(page, /primaryAction=\{/);
  assert.match(page, /disabled=\{!form\.canSave\}/);
  assert.match(page, /loading=\{form\.saving\}/);
  assert.match(page, /<ConfirmAction\b[\s\S]*?disabled=\{!form\.hasChanges \|\| form\.saving\}[\s\S]*?settings\.reset\.confirmTitle[\s\S]*?form\.handleReset\(\)/);
});

test('unsaved changes are guarded by the native Strapi Blocker (SET-04)', () => {
  assert.match(page, /import \{ Blocker, Form, useForm \} from '@strapi\/strapi\/admin'/);
  assert.match(page, /<Form method="PUT" initialValues=\{form\.savedSettings\}>\s*<DraftSync/);
  // The Form must not wrap the fields: DS Tag buttons have no type and would submit on Enter.
  assert.ok(page.indexOf("<Form method") > page.lastIndexOf("</Tabs.Content>"), "the Blocker form holds no fields");
  assert.match(page, /<DraftSync values=\{form\.settings\} \/>/);
  assert.match(page, /<Blocker \/>/);
  assert.match(page, /useForm\('DraftSync', \(state\) => state\.setValues\)/);
});

test('settings content relies on the page shell gutters and uses one heading hierarchy (SET-06, SET-10 browser)', () => {
  assert.match(page, /<PageShell\b/);
  assert.doesNotMatch(source, /paddingLeft=\{\{\s*initial:\s*3/, 'no extra horizontal inset inside Layouts.Content');
  assert.doesNotMatch(source, /tag="h4"|tag="h5"/);
  const headings = source.match(/<Typography\b[^>]*tag="(h\d)"/g) || [];
  assert.ok(headings.every((tag) => /tag="h3"/.test(tag)), 'sub-headings inside SectionCards (h2) are h3');
});
