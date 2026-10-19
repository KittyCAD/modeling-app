import { defineConfig, devices } from '@playwright/test'

process.env.TARGET = 'web'
process.env.PLAYWRIGHT_INTERACTION_DISCOVERY = '0'
process.env.VITE_ZOO_BASE_DOMAIN = 'dev.zoo.dev'
process.env.VITE_ZOO_API_BASE_URL = 'https://api.dev.zoo.dev'

export default defineConfig({
  testDir: './e2e/performance',
  testMatch: 'browser-budget.spec.ts',
  outputDir: './test-results/interaction-browser-budget',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  repeatEach: 1,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: './test-results/interaction-browser-budget/playwright.json',
      },
    ],
    [
      'html',
      {
        outputFolder: './playwright-report/interaction-browser-budget',
        open: 'never',
      },
    ],
  ],
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    headless: false,
    baseURL: 'http://127.0.0.1:4174',
    viewport: { width: 1200, height: 800 },
    actionTimeout: 15_000,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  webServer: {
    command:
      'node ./node_modules/vite/bin/vite.js preview --config vite.config.ts --outDir .vite/renderer/main_window --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      VITE_ZOO_BASE_DOMAIN: 'dev.zoo.dev',
      VITE_ZOO_API_BASE_URL: 'https://api.dev.zoo.dev',
    },
  },
})
