// @ts-ignore: No types available
import { lezer } from '@lezer/generator/rollup'
import { execFileSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import version from 'vite-plugin-package-version'
import topLevelAwait from 'vite-plugin-top-level-await'
import viteTsconfigPaths from 'vite-tsconfig-paths'
import { configDefaults, defineConfig } from 'vitest/config'
import { createCustomLogger, indexHtmlCsp } from './vite.base.config'

const RELEASE_TAG_PATTERN = /^v(\d+\.\d+\.\d+)$/

function getVercelReleaseTag() {
  if (process.env.VERCEL_ENV !== 'production') {
    return undefined
  }

  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA
  if (!commitSha) {
    throw new Error('Missing VERCEL_GIT_COMMIT_SHA for a production deployment')
  }

  const tags = execFileSync(
    'git',
    ['tag', '--points-at', commitSha, '--list', 'v*'],
    { encoding: 'utf8' }
  )
    .trim()
    .split('\n')
  const releaseTag = tags.find((tag) => RELEASE_TAG_PATTERN.test(tag))
  if (!releaseTag) {
    throw new Error(`No release tag found for production commit ${commitSha}`)
  }

  return releaseTag
}

export default defineConfig(({ command, mode }) => {
  return {
    customLogger: createCustomLogger(),
    define: {
      'import.meta.env.MODELING_APP_RELEASE_TAG': JSON.stringify(
        getVercelReleaseTag()
      ),
      'import.meta.env.VERCEL_GIT_COMMIT_SHA': JSON.stringify(
        process.env.VERCEL_GIT_COMMIT_SHA
      ),
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
      alias: [
        // Force browser-safe LSP protocol/RPC entrypoints; the node entries touch
        // worker_threads, which Vite externalizes in client bundles.
        {
          find: /^vscode-jsonrpc$/,
          replacement: 'vscode-jsonrpc/browser',
        },
        {
          find: /^vscode-languageserver-protocol$/,
          replacement: 'vscode-languageserver-protocol/browser',
        },
        { find: '@kittycad/registry', replacement: '/packages/registry/src' },
        {
          find: '@kittycad/codemirror-lsp-client',
          replacement: '/packages/codemirror-lsp-client/src',
        },
        {
          find: '@kittycad/codemirror-lang-kcl',
          replacement: '/packages/codemirror-lang-kcl/src',
        },
        {
          find: '@kittycad/ui-components',
          replacement: '/packages/ui-components/src',
        },
        { find: '@rust', replacement: '/rust' },
        { find: '@e2e', replacement: '/e2e' },
        { find: '@src', replacement: '/src' },
        { find: '@public', replacement: '/public' },
        { find: '@root', replacement: '/' },
      ],
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
