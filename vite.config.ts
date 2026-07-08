// @ts-ignore: No types available
import { lezer } from '@lezer/generator/rollup'
import eslint from '@nabla/vite-plugin-eslint'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import version from 'vite-plugin-package-version'
import topLevelAwait from 'vite-plugin-top-level-await'
import viteTsconfigPaths from 'vite-tsconfig-paths'
import { configDefaults, defineConfig } from 'vitest/config'
import { createCustomLogger, indexHtmlCsp } from './vite.base.config'

export default defineConfig(({ command, mode }) => {
  return {
    customLogger: createCustomLogger(),
    define: {
      'import.meta.env.VERCEL_ENV': JSON.stringify(process.env.VERCEL_ENV),
    },
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
        : // Gotcha: 'hanging-process' is very noisy, turn off by default on localhost
          // : ['verbose', 'hanging-process'],
          ['verbose'],
      testTimeout: 2_000,
      hookTimeout: 1_000,
      teardownTimeout: 1_000,
      retry: 5,
    },
    build: {
      outDir: 'build',
      target: 'es2022',
    },
    // Three 0.184 uses class static blocks that esbuild can minify into
    // anonymous class expressions which crash during startup.
    esbuild: {
      supported: {
        'class-static-blocks': false,
      },
    },
    resolve: {
      alias: {
        '@kittycad/registry': '/packages/registry/src',
        '@kittycad/codemirror-lsp-client':
          '/packages/codemirror-lsp-client/src',
        '@kittycad/codemirror-lang-kcl': '/packages/codemirror-lang-kcl/src',
        '@kittycad/ui-components': '/packages/ui-components/src',
        '@rust': '/rust',
        '@e2e': '/e2e',
        '@src': '/src',
        '@public': '/public',
        '@root': '/',
      },
    },
    plugins: [
      nodePolyfills({
        include: ['path'],
      }),
      react({
        babel: {
          plugins: [['module:@preact/signals-react-transform']],
        },
      }),
      indexHtmlCsp(!process.env.VERCEL && mode !== 'development'),
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
  }
})
