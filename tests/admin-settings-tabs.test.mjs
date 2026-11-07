import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readSettingsFile, readSettingsSource } from './helpers/settingsSource.mjs';
import { unwrapSource } from './helpers/unwrapSource.mjs';
import {
  SETTINGS_TAB_IDS,
  SETTINGS_TAB_LABELS,
} from '../admin/src/pages/Settings/settingsTabs.mjs';

const page = readSettingsFile('index.jsx');
const source = readSettingsSource();
const adminIndex = readFileSync(new URL('../admin/src/index.js', import.meta.url), 'utf8');

const TAB_FILES = {
  sessions: 'SessionsTab.jsx',
  'login-protection': 'LoginProtectionTab.jsx',
  'location-data': 'LocationDataTab.jsx',
  alerts: 'AlertsTab.jsx',
  'data-retention': 'DataRetentionTab.jsx',
};

/** Positions of quoted message ids in a source, for order checks. */
const positions = (text, ids) =>
  ids.map((id) => {
    const index = text.indexOf(`'${id}'`);
    assert.ok(index >= 0, `${id} is rendered`);
    return index;
  });
const assertOrdered = (text, ids, message) => {
  const found = positions(text, ids);
  assert.deepEqual(
    found,
    [...found].sort((a, b) => a - b),
    message
  );
};

test('settings links read Configuration and Analytics on unchanged routes (IA I.1-3, C)', () => {
  assert.match(
    adminIndex,
    /id: `\$\{pluginId\}\.settings\.link\.configuration`,\s*defaultMessage: 'Configuration'/
  );
  assert.match(
    adminIndex,
    /id: `\$\{pluginId\}\.settings\.link\.analytics`,\s*defaultMessage: 'Analytics'/
  );
  assert.doesNotMatch(adminIndex, /defaultMessage: '(?:General|Activation|License)'/);
  assert.doesNotMatch(adminIndex, /settings\.link\.license|pages\/License/);
  for (const id of ['general', 'analytics']) {
    assert.match(
      adminIndex,
      new RegExp(`id: '${id}',\\s*to: \`\\$\\{pluginId\\}/${id}\``),
      `${id} link id and route stay`
    );
  }
  const links = adminIndex.match(/to: `\$\{pluginId\}\/\w+`/g) || [];
  assert.equal(links.length, 2, 'exactly two settings links');
});

test('settings are split into a page, one module per tab and the useSettingsForm hook', () => {
  for (const file of [
    'index.jsx',
    ...Object.values(TAB_FILES),
    'hooks/useSettingsForm.js',
    'settingsTabs.mjs',
  ]) {
    assert.ok(readSettingsFile(file).length > 0, file);
  }
  assert.match(
    readSettingsFile('../Settings.jsx'),
    /export \{ default \} from '\.\/Settings\/index'/
  );
  for (const retired of [
    'GeneralTab.jsx',
    'SecurityTab.jsx',
    'GeofencingTab.jsx',
    'NotificationsTab.jsx',
  ]) {
    assert.throws(
      () => readSettingsFile(retired),
      /ENOENT/,
      `${retired} is replaced by the IA tabs`
    );
  }
});

test('five DS tabs in IA order with sentence-case labels (IA I.1-16, F)', () => {
  assert.deepEqual(
    [...SETTINGS_TAB_IDS],
    ['sessions', 'login-protection', 'location-data', 'alerts', 'data-retention']
  );
  assert.deepEqual(
    SETTINGS_TAB_IDS.map((tab) => SETTINGS_TAB_LABELS[tab][1]),
    ['Sessions', 'Login protection', 'Location data', 'Alerts', 'Data and retention']
  );
  assert.match(
    page,
    /<Tabs\.Root\b[\s\S]*?variant="simple"[\s\S]*?value=\{activeTab\}[\s\S]*?onValueChange=\{changeTab\}/
  );
  assert.match(page, /hasError=\{form\.errorTab\}/, 'a tab with invalid fields is marked');
  assert.match(page, /aria-label=\{t\('settings\.config\.tabs\.label'/);
  assert.match(
    page,
    /<Tabs\.Content key=\{tab\} value=\{tab\} forceMount hidden=\{activeTab !== tab\}>/,
    'panels stay mounted'
  );
  for (const tab of Object.keys(TAB_FILES)) {
    assert.match(page, new RegExp(`'?${tab}'?: \\w+Tab,`), `${tab} has a panel`);
  }
});

test('tab labels are not rendered uppercase and scroll inside the tab list (IA H.3, D5 mobile)', () => {
  const list = page.match(/const SettingsTabsList = styled\(Tabs\.List\)`([\s\S]*?)`;/)?.[1] || '';
  const trigger =
    page.match(/const SettingsTabTrigger = styled\(Tabs\.Trigger\)`([\s\S]*?)`;/)?.[1] || '';
  const label = page.match(/const SettingsTabLabel = styled\.span`([\s\S]*?)`;/)?.[1] || '';
  assert.match(list, /overflow-x:\s*auto/);
  assert.match(trigger, /white-space:\s*nowrap/);
  assert.match(
    label,
    /text-transform:\s*none/,
    'the DS sigma uppercase is reset on the own label element'
  );
  assert.match(
    label,
    /font-size:\s*\$\{\(\{ theme \}\) => theme\.fontSizes\[2\]\}/,
    'theme token, no px'
  );
  assert.match(page, /<SettingsTabTrigger key=\{tab\} value=\{tab\}>\s*<SettingsTabLabel>/);
  assert.doesNotMatch(list, /\[role=|span:first-child/, 'no selector into DS markup (SET-17)');
  assert.doesNotMatch(list, /flex-wrap:\s*wrap/);
});

test('tabs are deep-linkable with ?tab= without triggering the unsaved-changes Blocker (IA C)', () => {
  assert.match(
    page,
    /import \{ Blocker, Form, Page, useForm, useQueryParams \} from '@strapi\/strapi\/admin'/
  );
  assert.match(page, /const \[\{ query \}\] = useQueryParams\(\)/);
  assert.match(page, /const requestedTab = resolveSettingsTab\(query\?\.tab\)/);
  assert.match(
    page,
    /window\.history\.replaceState\(window\.history\.state, '', `\$\{pathname\}\$\{nextSearch\}\$\{hash\}`\)/
  );
  assert.match(page, /<SettingsNavigationProvider value=\{navigation\}>/);
  const links = readSettingsFile('SettingsNavigation.jsx');
  assert.match(links, /href=\{buildTabSearch\(search, tab\)\}/);
  assert.match(links, /event\.preventDefault\(\);\s*selectTab\(tab\)/);
});

test('header: title, subtitle, Save and a confirmed Discard changes (IA D5.1, E.2, I.1-17)', () => {
  assert.match(page, /t\('settings\.config\.title', 'Session Manager configuration'\)/);
  assert.match(
    unwrapSource(page),
    /t\('settings\.config\.subtitle', 'Applies to all end-user sessions of this Strapi instance\.'\)/
  );
  assert.match(page, /primaryAction=\{/);
  assert.match(page, /disabled=\{!form\.canSave\}/);
  assert.match(page, /loading=\{form\.saving\}/);
  assert.match(page, /t\('settings\.config\.save', 'Save'\)/);
  const discard = page.slice(
    page.indexOf('<ConfirmAction'),
    page.indexOf('<Button\n            onClick={handleSaveClick}')
  );
  assert.ok(discard.length > 0);
  assert.match(discard, /disabled=\{!form\.hasChanges \|\| form\.saving\}/);
  assert.match(discard, /t\('settings\.config\.discard', 'Discard changes'\)/);
  assert.match(
    discard,
    /t\('settings\.config\.discard\.confirmTitle', 'Discard unsaved changes\?'\)/
  );
  assert.match(
    discard,
    /t\('settings\.config\.discard\.confirmBody', 'Your changes on all tabs are lost\.'\)/
  );
  assert.match(discard, /t\('settings\.config\.discard\.confirmAction', 'Discard'\)/);
  assert.match(
    discard,
    /form\.handleReset\(\);\s*focusActiveTab\(\)/,
    'discard keeps the open tab and focus'
  );
  // After a successful save the Save button is disabled; focus moves to the open tab instead of <body>.
  assert.match(
    page,
    /const handleSaveClick = useCallback\(async \(\) => \{\s*if \(await handleSave\(\)\) focusActiveTab\(\);/
  );
  assert.doesNotMatch(source, /settings\.reset'|'Reset'/);
});

test('unsaved changes are guarded by the native Strapi Blocker (SET-04)', () => {
  assert.match(page, /<Form method="PUT" initialValues=\{form\.savedSettings\}>\s*<DraftSync/);
  // The Form must not wrap the fields: DS Tag buttons have no type and would submit on Enter.
  assert.ok(
    page.indexOf('<Form method') > page.lastIndexOf('</Tabs.Content>'),
    'the Blocker form holds no fields'
  );
  assert.match(page, /<DraftSync values=\{form\.settings\} \/>/);
  assert.match(page, /<Blocker \/>/);
  assert.match(page, /useForm\('DraftSync', \(state\) => state\.setValues\)/);
});

test('loading uses Page.Loading and a load failure hides the form (IA G, I.1-20)', () => {
  assert.match(page, /if \(form\.loading\) \{\s*return <Page\.Loading \/>;/);
  const errorStart = page.indexOf('if (form.loadError)');
  const errorView = page.slice(errorStart, page.indexOf('\n  }', errorStart));
  assert.ok(
    errorStart >= 0 && errorStart < page.indexOf('<Tabs.Root'),
    'the form is not rendered after a failed load'
  );
  assert.match(
    unwrapSource(errorView),
    /settings\.config\.load\.error', 'Settings could not be loaded\. Nothing can be saved until they load\.'/
  );
  assert.match(errorView, /onClick=\{form\.fetchSettings\}/);
  assert.match(errorView, /settings\.config\.load\.retry', 'Try again'/);
});

test('footer note states where settings live and when other processes apply them (IA D5.5, I.1-23)', () => {
  assert.match(
    unwrapSource(page),
    /t\('settings\.config\.footer', 'Saved in the database\. Other server processes apply changes within 30 seconds\.'\)/
  );
  assert.ok(
    page.indexOf("'settings.config.footer'") > page.indexOf('</Tabs.Root>'),
    'the note follows the tabs'
  );
  assert.doesNotMatch(source, /immediately/i);
});

test('every tab starts with its IA intro sentence', () => {
  const intros = {
    sessions: [
      'settings.config.sessions.intro',
      "These rules decide when an end user's session ends. They are checked on every request the user makes.",
    ],
    'login-protection': [
      'settings.config.loginProtection.intro',
      'These rules check new sign-ins before they succeed. Existing sessions are not affected, and refused sign-ins are not recorded.',
    ],
    'location-data': [
      'settings.config.locationData.intro',
      'Location and risk data power country rules, suspicious-sign-in checks and alerts. Turn the lookup off to stop all location processing.',
    ],
    alerts: [
      'settings.config.alerts.intro',
      'Alerts are sent only when location data is available for the sign-in.',
    ],
    'data-retention': [
      'settings.config.retention.intro',
      'Ended sessions stay in the history until they are deleted. The tokens of deleted sessions stay revoked.',
    ],
  };
  for (const [tab, [id, text]] of Object.entries(intros)) {
    const file = readSettingsFile(TAB_FILES[tab]);
    assert.ok(file.includes(`'${id}'`) && file.includes(text), `${tab} intro`);
    const firstCard = file.search(/<SectionCard\b|<GeoIpDatabaseCard\b/);
    assert.ok(file.indexOf(`'${id}'`) < firstCard, `${tab} intro comes before the first card`);
  }
});

test('cards follow the IA order on every tab (IA F)', () => {
  assertOrdered(
    readSettingsFile('SessionsTab.jsx'),
    [
      'settings.config.sessions.lifetime.title',
      'settings.config.token.title',
      'settings.config.rejected.title',
    ],
    'Sessions cards'
  );
  assertOrdered(
    readSettingsFile('LoginProtectionTab.jsx'),
    [
      'settings.config.failed.title',
      'settings.config.clientIp.title',
      'settings.config.suspicious.title',
      'settings.config.countries.title',
      'settings.config.refused.title',
    ],
    'Login protection cards'
  );
  const location = readSettingsFile('LocationDataTab.jsx');
  assert.ok(
    location.indexOf('<GeoIpDatabaseCard') > location.indexOf("'settings.config.lookup.title'"),
    'Location data cards'
  );
  assertOrdered(
    readSettingsFile('AlertsTab.jsx'),
    ['settings.config.email.title', 'settings.config.webhooks.title'],
    'Alerts cards'
  );
  assertOrdered(
    readSettingsFile('DataRetentionTab.jsx'),
    ['settings.config.retention.title', 'settings.config.deleteEnded.title'],
    'Data and retention cards'
  );
});

test('field order and advanced accordions follow IA F', () => {
  const sessions = readSettingsFile('SessionsTab.jsx');
  assertOrdered(
    sessions,
    [
      'settings.config.sessions.inactivity.label',
      'settings.config.sessions.maxAge.label',
      'settings.config.sessions.lastSeen.label',
      'settings.config.sessions.idleCheck.label',
      'settings.config.sessions.idleMethod.label',
      'settings.config.token.check.label',
      'settings.config.token.grace.label',
    ],
    'Sessions fields'
  );
  const lifetime = sessions.slice(
    sessions.indexOf("'settings.config.sessions.lifetime.title'"),
    sessions.indexOf("'settings.config.token.title'")
  );
  assert.ok(
    lifetime.indexOf('<AdvancedSection>') >
      lifetime.indexOf("'settings.config.sessions.maxAge.label'"),
    'everyday fields come before Advanced'
  );
  assert.ok(
    lifetime.indexOf('<AdvancedSection>') <
      lifetime.indexOf("'settings.config.sessions.lastSeen.label'"),
    'last-active rate is advanced'
  );
  const token = sessions.slice(
    sessions.indexOf("'settings.config.token.title'"),
    sessions.indexOf("'settings.config.rejected.title'")
  );
  assert.ok(
    token.indexOf('<AdvancedSection>') < token.indexOf("'settings.config.token.grace.label'"),
    'grace period is advanced'
  );
  assert.ok(
    token.indexOf('<AdvancedSection>') < token.indexOf('<EncryptionKeyCard'),
    'key generator is advanced'
  );

  const login = readSettingsFile('LoginProtectionTab.jsx');
  const suspicious = login.slice(
    login.indexOf("'settings.config.suspicious.title'"),
    login.indexOf("'settings.config.countries.title'")
  );
  assert.ok(
    suspicious.indexOf('<AdvancedSection') < suspicious.indexOf('id="geoip-lookup-failure-mode"'),
    'lookup failure mode is advanced'
  );

  const database = readSettingsFile('GeoIpDatabaseCard.jsx');
  assert.ok(
    database.indexOf('<AdvancedSection') < database.indexOf('id="geoip-database-filename"'),
    'database file name is advanced'
  );
  assertOrdered(
    database,
    [
      'settings.config.provider.label',
      'settings.config.database.statusLabel',
      'settings.config.database.accountId',
      'settings.config.database.update',
      'settings.config.database.fileName.label',
    ],
    'Provider and database fields'
  );

  const alerts = readSettingsFile('AlertsTab.jsx');
  assert.ok(
    alerts.indexOf('id="enable-email-alerts"') < alerts.indexOf('emailTypes.map('),
    'the switch comes before the email types'
  );
  assertOrdered(
    alerts,
    [
      'settings.config.email.suspicious.label',
      'settings.config.email.newCountry.label',
      'settings.config.email.vpnProxy.label',
      'settings.config.email.templates.label',
      'settings.config.webhooks.enable.label',
      'settings.config.webhooks.discord.label',
      'settings.config.webhooks.slack.label',
    ],
    'Alerts fields'
  );
  assert.match(
    alerts,
    /<AdvancedSection\s+label=\{t\('settings\.config\.email\.templates\.label', 'Edit email templates'\)\}/
  );

  const blocks = readSettingsFile('SettingsBlocks.jsx');
  assert.match(blocks, /<Accordion\.Root value=\{open\} onValueChange=\{setOpen\}/);
  assert.match(blocks, /useState\(''\)/, 'Advanced starts collapsed');
  assert.match(
    blocks,
    /if \(hasError\) setOpen\(itemValue\)/,
    'an invalid advanced field is never hidden'
  );
  assert.match(blocks, /t\('settings\.config\.advanced', 'Advanced'\)/);
});

test('dependent fields stay visible, are disabled and say what they require (IA D5.4, F)', () => {
  const blocks = readSettingsFile('SettingsBlocks.jsx');
  assert.match(
    blocks,
    /<RequiresNotice tab="location-data">\s*\{t\('settings\.config\.requires\.geolocation', 'Requires IP location lookup'\)\}/
  );

  const login = readSettingsFile('LoginProtectionTab.jsx');
  assert.match(login, /const lookupOff = !settings\.enableGeolocation/);
  for (const id of ['block-suspicious-sessions', 'enable-geofencing']) {
    const row =
      login.match(
        new RegExp(`<SettingsToggleRow\\s+id="${id}"[\\s\\S]*?(?:\\/>|<\\/SettingsToggleRow>)`)
      )?.[0] || '';
    assert.match(row, /disabled=\{lookupOff\}/, id);
  }
  assert.equal(
    (login.match(/\{lookupOff \? <RequiresGeolocation \/> : null\}/g) || []).length,
    2,
    'suspicious and country cards explain the requirement'
  );

  const alerts = readSettingsFile('AlertsTab.jsx');
  assert.match(
    alerts,
    /\{lookupOff \? \(\s*<Alert variant="warning"[\s\S]*?<SettingsTabLink tab="location-data">/,
    'the Alerts tab warns and links to Location data'
  );
  assert.match(alerts, /id="enable-email-alerts"[\s\S]*?disabled=\{lookupOff\}/);
  assert.match(alerts, /id="enable-webhooks"[\s\S]*?disabled=\{lookupOff\}/);
  assert.match(alerts, /disabled=\{emailTypesDisabled\}/);
  assert.match(alerts, /settings\.config\.requires\.emailAlerts', 'Requires Send security emails'/);
  assert.match(alerts, /settings\.config\.requires\.webhooks', 'Requires Send team notifications'/);

  const location = readSettingsFile('LocationDataTab.jsx');
  assert.match(
    location,
    /id="enable-security-scoring"[\s\S]*?disabled=\{!settings\.enableGeolocation\}/
  );
  assert.match(
    location,
    /<RequiresNotice tab="login-protection">/,
    'cross-link to Login protection › Client IP address'
  );

  const database = readSettingsFile('GeoIpDatabaseCard.jsx');
  assert.match(database, /const databaseDisabled = lookupOff \|\| !localDatabase/);
  assert.match(
    database,
    /settings\.config\.requires\.credentials', 'Add MaxMind credentials first\.'/
  );
});

test('read-only cards explain rejected sessions and refused sign-ins (IA I.1-21)', () => {
  const sessions = readSettingsFile('SessionsTab.jsx');
  assert.match(sessions, /t\('settings\.config\.rejected\.title', 'When a session is rejected'\)/);
  assert.match(sessions, /header: 'X-Session-Terminated-Reason'/);
  for (const code of ['logout', 'manual', 'idle', 'expired', 'blocked']) {
    assert.match(
      unwrapSource(sessions),
      new RegExp(`\\['${code}', 'settings\\.config\\.rejected\\.reason\\.${code}'`),
      code
    );
  }
  const login = readSettingsFile('LoginProtectionTab.jsx');
  const refused = login.slice(login.indexOf("'settings.config.refused.title'"));
  for (const id of ['lockout', 'rule', 'unavailable']) {
    assert.match(refused, new RegExp(`settings\\.config\\.refused\\.${id}\\.response`), id);
    assert.match(refused, new RegExp(`settings\\.config\\.refused\\.${id}\\.cause`), id);
  }
  assert.match(refused, /'Session Manager keeps no log of refused sign-ins\.'/);
  assert.doesNotMatch(refused, /onChange=|handleChange/, 'read-only');
});

test('selects show units and keep unknown stored values as "{value} (custom)" (IA F)', () => {
  const blocks = readSettingsFile('SettingsBlocks.jsx');
  assert.match(blocks, /const options = buildSelectOptions\(presets, value\)/);
  assert.match(
    blocks,
    /option\.custom \? custom\(format\(option\.value\)\) : format\(option\.value\)/
  );
  const labels = readSettingsFile('hooks/useOptionLabels.js');
  assert.match(
    labels,
    /t\('settings\.config\.option\.custom', '\{value\} \(custom\)', \{ value \}\)/
  );
  assert.match(labels, /t\('settings\.config\.unit\.minutes', '\{count\} min', \{ count \}\)/);
  assert.match(labels, /t\('settings\.config\.unit\.seconds', '\{count\} s', \{ count \}\)/);
  assert.match(
    labels,
    /'settings\.config\.unit\.days', '\{count, plural, one \{# day\} other \{# days\}\}'/
  );
  assert.match(
    labels,
    /ms === 0 \? t\('settings\.config\.option\.off', 'Off'\)/,
    'the grace period shows seconds, never milliseconds'
  );
  assert.match(labels, /value === -1 \? t\('settings\.config\.option\.forever', 'Forever'\)/);
  assert.doesNotMatch(source, /\(Recommended\)|\(Very Strict\)/);
});

test('settings content relies on the page shell gutters and uses one heading hierarchy (SET-06, SET-10 browser)', () => {
  assert.match(page, /<PageShell\b/);
  assert.doesNotMatch(
    source,
    /paddingLeft=\{\{\s*initial:\s*3/,
    'no extra horizontal inset inside Layouts.Content'
  );
  assert.doesNotMatch(source, /tag="h4"|tag="h5"/);
  const headings = source.match(/<Typography\b[^>]*tag="(h\d)"/g) || [];
  assert.ok(
    headings.every((tag) => /tag="h3"/.test(tag)),
    'sub-headings inside SectionCards (h2) are h3'
  );
});

test('settings source carries no internal process notes', () => {
  assert.doesNotMatch(source, /scratch[p]ad|i18n[ ]merge/i);
});

test('removing stored MaxMind credentials moves focus to the account ID field, because the Remove trigger disappears', () => {
  const database = readSettingsFile('GeoIpDatabaseCard.jsx');
  assert.match(database, /const accountIdRef = useRef\(null\)/);
  assert.match(database, /<TextInput\s+ref=\{accountIdRef\}\s+name="maxmindAccountId"/);
  assert.match(
    database,
    /onConfirm=\{geoIp\.removeCredentials\}\s+fallbackFocusRef=\{accountIdRef\}/
  );
});
