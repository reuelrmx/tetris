import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    // The app build injects these; tests run the same sources, so they get stable stand-ins.
    __BUILD_VERSION__: JSON.stringify('test'),
    __PRECACHE_MANIFEST__: JSON.stringify(['./']),
  },
  test: {
    include: [
      'src/**/*.test.ts',
      'test/**/*.test.ts',
      'server/test/**/*.test.ts',
    ],
    exclude: ['node_modules/**', 'dist/**', 'e2e/**', 'server/node_modules/**'],
    environment: 'node',
    globals: false,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**', 'server/src/**', 'shared/**'],
      exclude: ['src/**/*.test.ts', 'src/sw/**'],
    },
  },
});
