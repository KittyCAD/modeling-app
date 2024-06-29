import react from '@vitejs/plugin-react'
import viteTsconfigPaths from 'vite-tsconfig-paths'
import eslint from 'vite-plugin-eslint'
import { defineConfig, configDefaults } from 'vitest/config'
import version from 'vite-plugin-package-version'

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
    outDir: 'build',
  },
  plugins: [react(), viteTsconfigPaths(), eslint(), version()],
  worker: {
    plugins: () => [viteTsconfigPaths()],
  },
})

export default config
