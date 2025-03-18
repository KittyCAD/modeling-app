import { defineConfig, devices } from '@playwright/test'
import { platform } from 'os'

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  timeout: 120_000, // override the default 30s timeout
  testDir: './e2e/playwright',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: true,
  /* Do not retry */
  retries: 0,
  /* Both on CI and local. */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['dot'],
    ['json', { outputFile: './test-results/report.json' }],
    ['html'],
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        contextOptions: {
          /* Chromium is the only one with these permission types */
          permissions: ['clipboard-write', 'clipboard-read'],
        },
        launchOptions: {
          ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
            ? {
                executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
              }
            : {}),
        },
      }, // or 'chrome-beta'
    },
  ],
})
