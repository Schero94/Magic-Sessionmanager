import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const licenseSource = readFileSync(new URL('../admin/src/pages/License.jsx', import.meta.url), 'utf8');

test('activation loading errors offer an explicit retry action', () => {
  const errorBranch = licenseSource.match(/if \(error\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(errorBranch, /action=\{/);
  assert.match(errorBranch, /fetchLicenseStatus/);
  assert.match(errorBranch, /common\.retry/);
});
