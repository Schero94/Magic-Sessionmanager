import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('release step provides npm credentials without dropping OIDC', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/release.yml', import.meta.url),
    'utf8'
  );
  const releaseStep = workflow.split('      - name: Run semantic-release')[1];
  assert.ok(releaseStep, 'semantic-release step must exist');
  assert.match(workflow, /\bid-token:\s*write\b/);
  assert.match(releaseStep, /GITHUB_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
  assert.match(releaseStep, /NPM_TOKEN:\s*\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/);
  assert.match(releaseStep, /NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/);
});
