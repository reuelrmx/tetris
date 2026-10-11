import { readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const distDir = join(rootDir, 'dist');

/**
 * Walks an already-built `dist/` directory and returns every file that should be
 * precached, as a sorted list of URL paths relative to the app root.
 *
 * Files that must stay network-only (the service worker itself, source maps and
 * the manifest) are excluded, because caching them adds no offline value and can
 * trap users on a stale worker.
 */
function collectPrecacheEntries(dir: string): string[] {
  if (!existsSync(dir)) {
    throw new Error(
      'vite.sw.config.ts: dist/ is missing. Run the application build before the service worker build ' +
        '(npm run build does this in order).',
    );
  }
  const skip = (name: string): boolean =>
    name === 'sw.js' || name === 'sw.js.map' || name.endsWith('.map') || name === '.vite' || name.startsWith('.');

  const out: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      if (skip(name)) continue;
      const full = join(current, name);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        walk(full);
      } else if (stats.isFile()) {
        out.push('./' + relative(dir, full).split(sep).join('/'));
      }
    }
  };
  walk(dir);
  return out.sort();
}

const precache = collectPrecacheEntries(distDir);
const buildVersion = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12);

export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
    // The app build already populated dist/ - never wipe it here.
    emptyOutDir: false,
    minify: true,
    // A classic script keeps the worker working on browsers without module
    // service-worker support (Firefox at the time of writing).
    lib: {
      entry: join(rootDir, 'src/sw/service-worker.ts'),
      formats: ['iife'],
      name: 'strataServiceWorker',
      fileName: () => 'sw.js',
    },
  },
  define: {
    __PRECACHE_MANIFEST__: JSON.stringify(precache),
    __BUILD_VERSION__: JSON.stringify(buildVersion),
  },
});
