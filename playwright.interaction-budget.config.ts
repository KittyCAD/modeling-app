import { defineConfig, devices } from '@playwright/test'
import type { PerformanceOptions } from '@e2e/performance/test'

process.env.TARGET = 'desktop'
process.env.PLAYWRIGHT_INTERACTION_DISCOVERY = '0'

/** Strict absolute checks, separate from the paired regression schedule. */
export default defineConfig<PerformanceOptions>({
  testDir: './e2e/performance',
  // New performance specs enter the absolute gate by default. Only the known
  // paired workload/probes and browser-only cases run in their own configs.
  testMatch: '**/*.spec.ts',
  testIgnore: [
    '**/comparison.spec.ts',
    '**/command-palette.spec.ts',
    '**/modeling.spec.ts',
    '**/*browser-budget.spec.ts',
  ],
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
    mockApiRoutes: false,
    viewport: { width: 1200, height: 800 },
    actionTimeout: 15_000,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    contextOptions: { permissions: ['clipboard-write', 'clipboard-read'] },
  },
})
