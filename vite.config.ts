import { createHash } from 'node:crypto';
import { defineConfig } from 'vite';

/**
 * Application build configuration.
 *
 * The app is a plain DOM + Canvas 2D project: no framework plugin is required.
 * Two things are worth calling out here:
 *
 *  1. `base: './'` keeps the build relocatable, which matters for static hosting
 *     and for the service worker scope (`./sw.js`).
 *  2. In development the client talks to the multiplayer server through a
 *     same-origin proxy. That means the browser only ever sees relative URLs,
 *     which keeps the live-preview host and production deployments equivalent.
 */
const buildVersion = createHash('sha256')
  .update(`${Date.now()}`)
  .digest('hex')
  .slice(0, 8);

export default defineConfig({
  base: './',
  define: {
    // Shown in the status bar so a player can tell which build they are on.
    __BUILD_VERSION__: JSON.stringify(buildVersion),
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    cssCodeSplit: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 600,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:8787',
        ws: true,
        changeOrigin: true,
      },
      '/healthz': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
});
