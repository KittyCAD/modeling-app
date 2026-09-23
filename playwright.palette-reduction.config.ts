import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/performance/palette-reduction',
  testMatch: 'reduction.spec.ts',
  workers: 1,
  retries: 0,
  repeatEach: 5,
  timeout: 40_000,
  globalTimeout: 240_000,
  outputDir: 'test-results/palette-reduction',
  reporter: [
    ['./e2e/performance/palette-reduction/repetition-reporter.ts'],
    ['list'],
    ['json', { outputFile: 'test-results/palette-reduction/playwright.json' }],
  ],
  use: { trace: 'off', screenshot: 'off', video: 'off' },
})
