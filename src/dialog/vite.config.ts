import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Pull the version from the extension's manifest.json so the About box
// always matches the installed .ablx. Single source of truth.
const manifest = JSON.parse(
  readFileSync(resolve(__dirname, '../../manifest.json'), 'utf-8'),
) as { version: string };

// The dialog runs inside Ableton's webview via a file:// URL, so all asset
// references in the built index.html must be relative.
const base = './';

// SharedArrayBuffer (the streaming engine's audio ring) requires the page
// to be cross-origin-isolated. Ableton's webview enables this for extension
// dialogs; in `npm run dev` (standalone preview) we also need the headers.
const coopCoepHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// Vite's outDir is relative to this config. We emit straight into the
// extension's top-level dist/dialog/ so the host's package.js picks it up
// without an extra copy step.
export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(manifest.version),
  },
  build: {
    outDir: '../../dist/dialog',
    emptyOutDir: true,
  },
  plugins: [react()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@olilarkin/paulstretch-wasm'],
  },
  server: {
    headers: coopCoepHeaders,
  },
  preview: {
    headers: coopCoepHeaders,
  },
});
