import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../admin/src/pages/License.jsx', import.meta.url), 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('license uses the shared PageShell, SectionCard and PropertyList blocks', () => {
  assert.match(code, /from '\.\.\/components\/ui'/);
  assert.match(code, /<PageShell\b/);
  assert.doesNotMatch(code, /<PluginPageLayout\b/);
  assert.ok((code.match(/<SectionCard\b/g) || []).length >= 3, 'status, details and key');
  assert.ok((code.match(/<PropertyList\b/g) || []).length >= 1, 'details use PropertyList');
});

test('page and actions use the License vocabulary (IA C, D7, I.1-3)', () => {
  assert.match(code, /t\('license\.title', 'License'\)/);
  assert.match(code, /t\('license\.refresh', 'Check again'\)/);
  assert.match(code, /t\('license\.key\.download', 'Download as text'\)/);
  assert.match(code, /t\('license\.status\.title', 'License status'\)/);
  assert.doesNotMatch(
    code,
    /'[^']*\b(?:Activation|activation)\b[^']*'\)/,
    'no retired "Activation" copy'
  );
  assert.doesNotMatch(
    code,
    /'(?:Active|Inactive|Online|Offline)'/,
    'no Active/Inactive or Online/Offline wording'
  );
  assert.doesNotMatch(
    code,
    /license\.features\.(?:geolocation|security|analytics|alerts|title)/,
    'no feature marketing list'
  );
});

test('the status card shows one state sentence plus the fixed feature sentence (IA D7)', () => {
  assert.match(code, /getLicenseState\(licenseData\)/);
  assert.match(code, /describeLicenseState\(licenseState, formatDate\)/);
  assert.match(code, /translate\(LICENSE_FEATURES_MESSAGE\)/);
  const statusCard =
    code.match(/<SectionCard title=\{t\('license\.status\.title'[\s\S]*?<\/SectionCard>/)?.[0] ||
    '';
  assert.match(statusCard, /translate\(statusMessage, statusMessage\.values\)/);
  assert.match(statusCard, /LICENSE_FEATURES_MESSAGE/);
  assert.match(statusCard, /aria-live="polite"/);
});

test('Check again keeps the page mounted and keeps focus (F8)', () => {
  assert.doesNotMatch(code, /setLoading\(true\)/, 'a check never switches back to the page loader');
  assert.match(code, /setRefreshing\(true\)/);
  assert.match(code, /aria-busy=\{refreshing\}/);
  assert.match(code, /license\.success\.refreshed/);

  assert.match(code, /const handleRefresh = \(\) => checkLicenseStatus\(\{ announce: true \}\);/);
  const refreshButton =
    code.match(
      /<Button\b(?:(?!<\/Button>)[\s\S])*?onClick=\{handleRefresh\}[\s\S]*?<\/Button>/
    )?.[0] || '';
  assert.ok(refreshButton, 'the header check button exists');
  assert.doesNotMatch(
    refreshButton,
    /\bloading=|\bdisabled=/,
    'a disabled button would drop focus to <body>'
  );

  assert.doesNotMatch(code, /<Accordion\b/, 'no accordion trigger that truncates at 320px (F17)');
});

test('details, key and download are rendered only when a key is stored (UX-16, IA D7)', () => {
  const keyBlocks = (code.match(/\{hasKey \? \([\s\S]*?\) : null\}/g) || []).join('\n');
  assert.ok(keyBlocks, 'details are gated on hasKey');
  for (const id of ['license.key.label', 'license.details.title', 'license.key.download']) {
    assert.match(
      keyBlocks,
      new RegExp(id.replace(/\./g, '\\.')),
      `${id} sits inside a hasKey block`
    );
    assert.equal(
      code.split(`'${id}'`).length - 1,
      1,
      `${id} is not rendered outside the hasKey block`
    );
  }
});

test('details list holder, email, expiry, device, IP, last check, device limit and server reachability', () => {
  const ids = [...code.matchAll(/\{ id: '([\w-]+)'|id: '([\w-]+)',/g)].map(
    (match) => match[1] || match[2]
  );
  for (const id of [
    'holder',
    'email',
    'expires',
    'device-name',
    'ip',
    'last-check',
    'device-limit',
    'server-reachable',
  ]) {
    assert.ok(ids.includes(id), `details include ${id}`);
  }
  assert.match(code, /'license\.details\.serverReachable', 'License server reachable'/);
  assert.match(code, /t\('common\.yes', 'Yes'\)/);
  assert.match(code, /t\('common\.no', 'No'\)/);
});

test('key field is masked, revealable and copied through Strapi useClipboard', () => {
  assert.match(code, /import \{[^}]*useClipboard[^}]*\} from '@strapi\/strapi\/admin'/);
  assert.match(code, /await copy\(/);
  assert.match(code, /<TextInput\b[\s\S]*?readOnly[\s\S]*?\/>/);
  assert.match(code, /<IconButton\b[\s\S]*?label=\{t\(\s*showLicenseKey\s*\?/);
  assert.match(code, /t\('license\.success\.copied', 'Copied\.'\)/);
});

test('download is localized, admin-locale dated and logs failures safely (F18, I18N-10)', () => {
  assert.match(code, /buildLicenseSummary\(/);
  assert.match(code, /useSessionFormatters\(\)/);
  assert.doesNotMatch(
    code,
    /toLocale(?:Date|Time)?String\(|new Intl\.DateTimeFormat/,
    'dates only through the shared formatter'
  );
  assert.doesNotMatch(code, /'N\/A'|'Never'\s*[:}]|'ACTIVE'|'INACTIVE'/);
  const handler = code.match(/const handleDownloadLicenseKey[\s\S]*?\n {2}\};/)?.[0] || '';
  assert.match(handler, /logSafeAdminError\('license\.download'/);
});

test('loading, error and no-permission states follow IA G', () => {
  assert.match(code, /<Page\.Loading\b/);
  assert.match(code, /<Page\.NoPermissions\b/);
  assert.match(code, /'license\.error\.load', 'The license status could not be checked\.'/);
});

test('license uses DS tokens only and no console output (UX-11, F18)', () => {
  assert.doesNotMatch(code, /fontFamily:\s*'monospace'/);
  assert.doesNotMatch(code, /\b\d+px\b/);
  assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  assert.doesNotMatch(code, /console\./);
  assert.doesNotMatch(code, /style=\{\{[^}]*(?:margin|padding|gap)/);
});

test('the legacy LicenseGuard never blocks access', () => {
  const guard = readFileSync(
    new URL('../admin/src/components/LicenseGuard.jsx', import.meta.url),
    'utf8'
  );
  assert.match(guard, /const LicenseGuard = \(\{ children \}\) => <>\{children\}<\/>;/);
});

test('the state sentence is body text under the card heading, never a second heading (desktop acceptance)', () => {
  const statusCard =
    code.match(/<SectionCard title=\{t\('license\.status\.title'[\s\S]*?<\/SectionCard>/)?.[0] ||
    '';
  const state = statusCard.match(/<Typography[^>]*data-license-state=""[^>]*>/)?.[0] || '';
  assert.match(state, /variant="omega"/);
  assert.match(state, /fontWeight="semiBold"/);
  assert.doesNotMatch(
    statusCard,
    /variant="(?:alpha|beta|gamma|delta)" tag="p"/,
    'no heading-sized paragraph next to the h2'
  );
});
