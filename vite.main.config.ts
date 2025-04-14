// @ts-ignore: No types available
import { lezer } from '@lezer/generator/rollup'
import vitePluginEslint from '@nabla/vite-plugin-eslint'
import viteJsPluginReact from '@vitejs/plugin-react'
import type { ConfigEnv, UserConfig } from 'vite'
import { defineConfig, mergeConfig } from 'vite'
import vitePluginPackageVersion from 'vite-plugin-package-version'
import viteTsconfigPaths from 'vite-tsconfig-paths'
import { configDefaults } from 'vitest/config'

import {
  external,
  getBuildConfig,
  getBuildDefine,
  pluginHotRestart,
} from './vite.base.config'

// https://vitejs.dev/config
export default defineConfig((env) => {
  const forgeEnv = env as ConfigEnv<'build'>
  const { forgeConfigSelf } = forgeEnv
  const define = getBuildDefine(forgeEnv)
  const config: UserConfig = {
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
        provider: 'v8',
      },
      exclude: [...configDefaults.exclude, '**/e2e/**/*'],
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
        : ['verbose', 'hanging-process'],
      testTimeout: 1000,
      hookTimeout: 1000,
      teardownTimeout: 1000,
    },
    build: {
      lib: {
        entry: forgeConfigSelf?.entry ?? 'src/main.ts',
        fileName: () => '[name].js',
        formats: ['cjs'],
      },
      rollupOptions: {
        external,
      },
    },
    resolve: {
      // Load the Node.js entry.
      mainFields: ['module', 'jsnext:main', 'jsnext'],
      alias: {
        '@kittycad/codemirror-lsp-client':
          '/packages/codemirror-lsp-client/src',
      },
    },
    plugins: [
      pluginHotRestart('restart'),
      viteJsPluginReact(),
      viteTsconfigPaths(),
      vitePluginEslint(),
      vitePluginPackageVersion(),
      lezer(),
    ],
    worker: {
      plugins: () => [viteTsconfigPaths()],
    },
    define,
  }

  return mergeConfig(getBuildConfig(forgeEnv), config)
})
