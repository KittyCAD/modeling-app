// Overrides the test options from the modeling-app config.

import viteTsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig, configDefaults } from 'vitest/config'
// @ts-ignore: No types available
import { lezer } from '@lezer/generator/rollup'

const config = defineConfig({
  test: {
    globals: true,
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 2,
        minForks: 1,
      },
    },
    environment: 'node',
    reporters: process.env.GITHUB_ACTIONS
      ? ['dot', 'github-actions']
      : // Gotcha: 'hanging-process' is very noisey, turn off by default on localhost
        // : ['verbose', 'hanging-process'],
        ['verbose'],
    testTimeout: 1000,
    hookTimeout: 1000,
    teardownTimeout: 1000,
  },
  plugins: [viteTsconfigPaths(), lezer()],
})

export default config
