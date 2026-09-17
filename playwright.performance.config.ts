import { defineConfig, devices } from '@playwright/test'

// The existing app fixtures select their platform when modules are imported.
process.env.TARGET = 'web'

export default defineConfig({
  testDir: './e2e/performance',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results/interaction-performance',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  repeatEach: 5,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120_000,
  reporter: [
    ['list'],
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
    // Use the Chromium revision supplied by the locked Playwright package.
    browserName: 'chromium',
    baseURL: 'http://localhost:3000',
    viewport: { width: 1200, height: 800 },
    actionTimeout: 15_000,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    contextOptions: {
      permissions: ['clipboard-write', 'clipboard-read'],
    },
  },
  webServer: {
    command: 'npm run start:prod -- --port 3000 --strictPort --host localhost',
    url: 'http://localhost:3000',
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
