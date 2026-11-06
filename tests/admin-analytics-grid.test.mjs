import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../admin/src/pages/Analytics.jsx', import.meta.url), 'utf8');
const grid = source.match(/const StatsGrid = styled\.div`([\s\S]*?)`;/)?.[1] || '';

test('analytics keeps desktop auto-fit and uses two shrink-safe columns on mobile', () => {
  assert.match(grid, /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*10rem\),\s*1fr\)\)/);
  assert.match(grid, /@media\s*\(max-width:\s*519px\)\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
});
