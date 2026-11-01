import { defineConfig } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// After each build, write the list of built app files into dist/sw.js so the service worker can
// save them on first visit (then NAVMAP opens without internet). The version changes whenever
// the files change, which tells phones to update.
function precacheServiceWorker() {
  let outDir = 'dist';
  return {
    name: 'navmap-precache-sw',
    apply: 'build',
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
    writeBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => /\.(js|css)$/.test(f)).map((f) => `/${f}`).sort();
      files.push('/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png');
      const version = createHash('sha256').update(files.join('|') + readFileSync(resolve(outDir, 'index.html'))).digest('hex').slice(0, 10);
      const swPath = resolve(outDir, 'sw.js');
      const src = readFileSync(swPath, 'utf8');
      const line = `const PRECACHE = ${JSON.stringify({ version, files })};`;
      if (!src.includes("const PRECACHE = { version: 'dev', files: [] };")) throw new Error('sw.js PRECACHE placeholder not found');
      writeFileSync(swPath, src.replace("const PRECACHE = { version: 'dev', files: [] };", line));
    },
  };
}

export default defineConfig({
  plugins: [precacheServiceWorker()],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: { output: { manualChunks: { maplibre: ['maplibre-gl'] } } },
  },
});
