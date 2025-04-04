import { defineConfig, devices } from '@playwright/test'
import os from 'os'

const platform = os.platform() // 'linux' (Ubuntu), 'darwin' (macOS), 'win32' (Windows)

let workers: number | string

if (process.env.E2E_WORKERS) {
  workers = process.env.E2E_WORKERS
} else if (!process.env.CI) {
  workers = 1 // Local dev: keep things simple and deterministic by default
} else {
  // On CI: adjust based on OS
  switch (platform) {
    case 'linux':
      workers = '100%' // CI Linux runners are generally beefier
      break
    case 'darwin':
    case 'win32':
    default:
      workers = '75%' // Slightly conservative for GUI-based OSes
      break
  }
}

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  timeout: 120_000, // override the default 30s timeout
  testDir: './e2e/playwright',
  testIgnore: '*.test.ts', // ignore unit tests
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Do not retry */
  retries: process.env.CI ? 0 : 0,
  /* Use all available CPU cores */
  workers: workers,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    [process.env.CI ? 'dot' : 'list'],
    ['json', { outputFile: './test-results/report.json' }],
    ['html'],
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'retain-on-failure',
    actionTimeout: 15000,
    screenshot: 'only-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'Google Chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
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
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'chromium', // compat issue with encoding atm, so we're using the branded 'Google Chrome' instead
    //   use: { ...devices['Desktop Chrome'] },
    // },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'yarn start',
    // url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
  },
})
