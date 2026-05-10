import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
// @ts-ignore: No types available
import { lezer } from '@lezer/generator/rollup'

export default defineConfig({
  plugins: [tsconfigPaths(), lezer()],
  test: {
    environment: 'node',
    include: ['src/network/openCascadeCoverage.test.ts'],
    reporters: ['default'],
    testTimeout: 600_000,
    hookTimeout: 30_000,
  },
})
