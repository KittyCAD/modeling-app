import { defineConfig } from '@playwright/test'

process.env.TARGET = 'desktop'
process.env.PLAYWRIGHT_INTERACTION_DISCOVERY = '0'

export default defineConfig({
  testDir: './e2e/performance/palette-reduction',
  testMatch: 'capture-home.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  globalTimeout: 240_000,
  reporter: [['list']],
  use: { trace: 'off', screenshot: 'off', video: 'off' },
})
