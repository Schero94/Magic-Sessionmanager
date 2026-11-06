import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const licenseSource = readFileSync(
  new URL('../admin/src/pages/License.jsx', import.meta.url),
  'utf8'
);

test('license status errors appear in the status card with an explicit Try again action (IA E.2, G)', () => {
  const statusCard =
    licenseSource.match(
      /<SectionCard title=\{t\('license\.status\.title'[\s\S]*?<\/SectionCard>/
    )?.[0] || '';
  const errorBranch = statusCard.match(/\{error \? \([\s\S]*?\) : null\}/)?.[0] || '';

  assert.match(errorBranch, /<Alert\b/);
  assert.match(errorBranch, /action=\{/);
  assert.match(errorBranch, /fetchLicenseStatus/);
  assert.match(errorBranch, /license\.error\.retry', 'Try again'/);
  assert.match(errorBranch, /license\.error\.load/);
});

test('a failed check keeps the last known status and key visible', () => {
  const fetcher =
    licenseSource.match(/const fetchLicenseStatus = async[\s\S]*?\n {2}\};/)?.[0] || '';
  const catchBlock = fetcher.match(/catch \(err\) \{[\s\S]*?\}\s*finally/)?.[0] || '';
  assert.ok(catchBlock, 'the fetcher has a catch block');
  assert.doesNotMatch(catchBlock, /setLicenseData\(/, 'the last status is not cleared on error');
  assert.doesNotMatch(
    licenseSource,
    /if \(error\) \{\s*return/,
    'an error does not replace the page'
  );
});
