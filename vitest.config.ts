import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      { find: '@kittycad/registry', replacement: '/packages/registry/src' },
      { find: '@kittycad/ui-kit', replacement: '/packages/ui-kit/src' },
      // Generated kcl-lib bindings. Every other `@rust` import in the app is
      // type-only and so never had to resolve at runtime; the stdlib shapes are
      // the first that do.
      { find: '@rust', replacement: '/rust' },
      { find: '@src', replacement: '/src' },
      { find: '@root', replacement: '/' },
    ],
    // The registry imports @preact/signals-core while the app imports
    // @preact/signals; two copies would make a signal created in one invisible
    // to the other.
    dedupe: ['preact', '@preact/signals', '@preact/signals-core'],
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    globals: false,
    clearMocks: true,
    restoreMocks: true,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.vite/**',
      // React-based, with its own runner and setup: `npm run test:ui-components`.
      'packages/ui-components/**',
    ],
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: [
            'src/**/*.test.{ts,tsx}',
            'packages/registry/src/**/*.test.{ts,tsx}',
            'packages/ui-kit/src/**/*.test.{ts,tsx}',
            'packages/codemirror-*/src/**/*.test.{ts,tsx}',
          ],
        },
      },
      {
        extends: true,
        // Slower tests that build a whole registry and render into the DOM.
        test: {
          name: 'integration',
          include: [
            'src/**/*.spec.{ts,tsx}',
            'packages/registry/src/**/*.spec.{ts,tsx}',
            'packages/ui-kit/src/**/*.spec.{ts,tsx}',
          ],
          hookTimeout: 20_000,
        },
      },
    ],
  },
})
