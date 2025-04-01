import react from '@vitejs/plugin-react'
import viteTsconfigPaths from 'vite-tsconfig-paths'
import eslint from '@nabla/vite-plugin-eslint'
import { defineConfig, configDefaults } from 'vitest/config'
import version from 'vite-plugin-package-version'
import topLevelAwait from 'vite-plugin-top-level-await'
// @ts-ignore: No types available
import { lezer } from '@lezer/generator/rollup'

const config = defineConfig({
  server: {
    open: true,
    port: 3000,
    watch: {
      ignored: [
        '**/target/**',
        '**/dist/**',
        '**/build/**',
        '**/test-results/**',
        '**/playwright-report/**',
      ],
    },
  },
  test: {
    globals: true,
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 2,
        minForks: 1,
      },
    },
    setupFiles: ['src/setupTests.ts', '@vitest/web-worker'],
    environment: 'happy-dom',
    coverage: {
      provider: 'istanbul', // or 'v8'
    },
    exclude: [...configDefaults.exclude, '**/e2e/**/*.spec.*', 'rust'],
    deps: {
      optimizer: {
        web: {
          include: ['vitest-canvas-mock'],
        },
      },
    },
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    reporters: process.env.GITHUB_ACTIONS
      ? ['dot', 'github-actions']
      : // Gotcha: 'hanging-process' is very noisey, turn off by default on localhost
        // : ['verbose', 'hanging-process'],
        ['verbose'],
    testTimeout: 1000,
    hookTimeout: 1000,
    teardownTimeout: 1000,
  },
  build: {
    outDir: 'build',
  },
  resolve: {
    alias: {
      '@kittycad/codemirror-lsp-client': '/packages/codemirror-lsp-client/src',
      '@kittycad/codemirror-lang-kcl': '/packages/codemirror-lang-kcl/src',
      '@rust': '/rust',
    },
  },
  plugins: [
    react(),
    viteTsconfigPaths(),
    eslint(),
    version(),
    lezer(),
    topLevelAwait({
      // The export name of top-level await promise for each chunk module
      promiseExportName: '__tla',
      // The function to generate import names of top-level await promise in each chunk module
      promiseImportName: (i) => `__tla_${i}`,
    }),
  ],
  worker: {
    plugins: () => [viteTsconfigPaths()],
  },
})

export default config
