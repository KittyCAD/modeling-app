import { defineConfig, devices } from '@playwright/test'
import type { PerformanceOptions } from '@e2e/performance/test'
import type { ComparisonVariant } from '@e2e/performance/comparison'

const variants: ComparisonVariant[] = ['base', 'candidate']

// The existing app fixtures select their platform when modules are imported.
process.env.TARGET = 'desktop'
// Discovery must not start a competing session in the controlled profile.
process.env.PLAYWRIGHT_INTERACTION_DISCOVERY = '0'

export default defineConfig<PerformanceOptions>({
  testDir: './e2e/performance',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results/interaction-performance',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  repeatEach: 1,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120_000,
  projects: [
    { name: 'comparison', testMatch: 'comparison.spec.ts' },
    ...variants.map((performanceVariant) => ({
      name: `harness-${performanceVariant}`,
      dependencies: ['comparison'],
      testMatch: ['command-palette.spec.ts', 'modeling.spec.ts'],
      use: { performanceVariant },
    })),
  ],
  reporter: [
    ['list'],
    ['./e2e/performance/reporter.ts'],
    ['./e2e/performance/tab-reporter.ts'],
    [
      'json',
      { outputFile: './test-results/interaction-performance/playwright.json' },
    ],
    [
      'html',
      {
        outputFolder: './playwright-report/interaction-performance',
        open: 'never',
      },
    ],
  ],
  use: {
    ...devices['Desktop Chrome'],
    // The existing desktop fixture launches the locked Electron runtime.
    browserName: 'chromium',
    viewport: { width: 1200, height: 800 },
    actionTimeout: 15_000,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    contextOptions: {
      permissions: ['clipboard-write', 'clipboard-read'],
    },
  },
})
