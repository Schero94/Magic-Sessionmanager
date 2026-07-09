import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '..');
const adminPagesDir = path.join(pluginRoot, 'admin', 'src', 'pages');

function getPageFiles(dir) {
  return fs.readdirSync(dir)
    .filter((entry) => /\.(jsx|js)$/.test(entry))
    .map((entry) => path.join(dir, entry));
}

test('admin page styled animations reference defined keyframes', () => {
  for (const filePath of getPageFiles(adminPagesDir)) {
    const source = fs.readFileSync(filePath, 'utf8');
    const definedKeyframes = new Set(
      [...source.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*keyframes`/g)]
        .map((match) => match[1])
    );
    const animationReferences = [
      ...source.matchAll(/animation:\s*\$\{([A-Za-z_$][\w$]*)\}/g),
    ].map((match) => match[1]);

    for (const animationName of animationReferences) {
      assert.equal(
        definedKeyframes.has(animationName),
        true,
        `${path.relative(pluginRoot, filePath)} references undefined keyframes "${animationName}"`
      );
    }
  }
});
