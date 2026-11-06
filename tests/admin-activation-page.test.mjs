import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../admin/src/pages/License.jsx', import.meta.url), 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('activation uses the shared PageShell, SectionCard and PropertyList blocks', () => {
  assert.match(code, /from '\.\.\/components\/ui'/);
  assert.match(code, /<PageShell\b/);
  assert.doesNotMatch(code, /<PluginPageLayout\b/);
  assert.ok((code.match(/<SectionCard\b/g) || []).length >= 3);
  assert.ok((code.match(/<PropertyList\b/g) || []).length >= 2, 'status and details use PropertyList');
});

test('refresh keeps the page mounted, keeps focus and announces the result (F8)', () => {
  assert.doesNotMatch(code, /setLoading\(true\)/, 'a refresh never switches back to the full-page loader');
  assert.match(code, /setRefreshing\(true\)/);
  assert.match(code, /aria-busy=\{refreshing\}/);
  assert.match(code, /license\.success\.refreshed/);

  assert.match(code, /const handleRefresh = \(\) => fetchLicenseStatus\(\{ announce: true \}\);/);
  const refreshButton = code.match(/<Button\b(?:(?!<\/Button>)[\s\S])*?onClick=\{handleRefresh\}[\s\S]*?<\/Button>/)?.[0] || '';
  assert.ok(refreshButton, 'the header refresh button exists');
  assert.doesNotMatch(refreshButton, /\bloading=|\bdisabled=/, 'a disabled button would drop focus to <body>');

  assert.doesNotMatch(code, /defaultValue="account"/, 'no uncontrolled accordion that resets on refresh');
});

test('activation details, account and key are rendered only when a key is stored (UX-16)', () => {
  const keyBlock = (code.match(/\{hasKey \? \([\s\S]*?\) : null\}/g) || []).join('\n');
  assert.ok(keyBlock, 'details are gated on hasKey');
  for (const id of ['license.key.label', 'license.account.title', 'license.details.title']) {
    assert.match(keyBlock, new RegExp(id.replace(/\./g, '\\.')), `${id} sits inside the hasKey block`);
    assert.equal(code.split(id).length - 1, 1, `${id} is not rendered outside the hasKey block`);
  }
});

test('key field is masked, revealable and copied through Strapi useClipboard', () => {
  assert.match(code, /import \{[^}]*useClipboard[^}]*\} from '@strapi\/strapi\/admin'/);
  assert.match(code, /await copy\(/);
  assert.match(code, /<TextInput\b[\s\S]*?readOnly[\s\S]*?\/>/);
  assert.match(code, /<IconButton\b[\s\S]*?label=\{t\(\s*showLicenseKey\s*\?/);
});

test('download is localized, admin-locale dated and logs failures safely (UX-16, F18)', () => {
  assert.match(code, /buildActivationSummary\(/);
  assert.match(code, /useSessionFormatters\(\)/);
  assert.doesNotMatch(code, /toLocale(?:Date|Time)?String\(/, 'no browser-locale dates');
  assert.doesNotMatch(code, /'N\/A'|'Never'\s*[:}]|'ACTIVE'|'INACTIVE'/);
  const handler = code.match(/const handleDownloadLicenseKey[\s\S]*?\n {2}\};/)?.[0] || '';
  assert.match(handler, /logSafeAdminError\('activation\.download'/);
});

test('activation uses DS tokens only and no console output (UX-11, F18)', () => {
  assert.doesNotMatch(code, /fontFamily:\s*'monospace'/);
  assert.doesNotMatch(code, /\b\d+px\b/);
  assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  assert.doesNotMatch(code, /console\./);
  assert.doesNotMatch(code, /style=\{\{[^}]*(?:margin|padding|gap)/);
});

test('the legacy LicenseGuard never blocks access', () => {
  const guard = readFileSync(new URL('../admin/src/components/LicenseGuard.jsx', import.meta.url), 'utf8');
  assert.match(guard, /const LicenseGuard = \(\{ children \}\) => <>\{children\}<\/>;/);
});
