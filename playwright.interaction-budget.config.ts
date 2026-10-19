import { defineConfig, devices } from '@playwright/test'
import type { PerformanceOptions } from '@e2e/performance/test'

process.env.TARGET = 'desktop'
process.env.PLAYWRIGHT_INTERACTION_DISCOVERY = '0'

/** Absolute fail-first checks, separate from the paired regression schedule. */
export default defineConfig<PerformanceOptions>({
  testDir: './e2e/performance',
  testMatch: ['budget.spec.ts', 'core-budget.spec.ts', 'error-profile.spec.ts'],
  outputDir: './test-results/interaction-budget',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  repeatEach: 1,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120_000,
  reporter: [
    ['list'],
    [
      'json',
      { outputFile: './test-results/interaction-budget/playwright.json' },
    ],
    [
      'html',
      { outputFolder: './playwright-report/interaction-budget', open: 'never' },
    ],
  ],
  use: {
    ...devices['Desktop Chrome'],
    browserName: 'chromium',
    performanceVariant: 'candidate',
    viewport: { width: 1200, height: 800 },
    actionTimeout: 15_000,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    contextOptions: { permissions: ['clipboard-write', 'clipboard-read'] },
  },
})
