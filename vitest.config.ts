import { defineConfig } from 'vitest/config';

export default defineConfig({
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
