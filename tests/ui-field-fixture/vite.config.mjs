import { defineConfig } from 'vite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(fixtureDir, '../..');
export default defineConfig({
  root: fixtureDir,
  esbuild: { jsx: 'automatic' },
  cacheDir: path.join(tmpdir(), `sessionmanager-field-vite-${process.pid}`),
  server: { host: '127.0.0.1', port: 15479, strictPort: true, fs: { allow: [projectDir] } },
});
