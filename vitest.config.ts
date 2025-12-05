import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
// @ts-ignore: No types available
import { lezer } from '@lezer/generator/rollup'

export default defineConfig({
  plugins: [tsconfigPaths(), lezer()],
  test: {
    globalSetup: './src/test-setup/global-setup.ts',
    environment: 'happy-dom',
    setupFiles: ['./src/setupTests.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
    ],
    deps: {
      external: [/playwright/],
      inline: [/e2e/, /packages/],
    },
    reporters: ['default', 'junit'],
    outputFile: {
      junit: 'test-results/junit.xml',
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['src/**/*.spec.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
          hookTimeout: 60_000,
        },
      },
    ],
  },
})
