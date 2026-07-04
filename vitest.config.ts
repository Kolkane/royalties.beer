import { defineConfig } from 'vitest/config';

// We import with explicit `.js` extensions (required for Node ESM output). This
// tiny resolver lets Vitest load the corresponding `.ts` source during tests.
export default defineConfig({
  plugins: [
    {
      name: 'resolve-js-as-ts',
      enforce: 'pre',
      async resolveId(source, importer) {
        if (importer && source.startsWith('.') && source.endsWith('.js')) {
          const resolved = await this.resolve(source.slice(0, -3) + '.ts', importer, {
            skipSelf: true,
          });
          if (resolved) return resolved;
        }
        return null;
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
  },
});
