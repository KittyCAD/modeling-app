import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './browser-tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  outputDir: './test-results/browser',
  use: { baseURL: 'http://127.0.0.1:6010', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm exec -- vite --config browser-tests/vite.config.ts',
    url: 'http://127.0.0.1:6010/browser-tests/fixture.html',
    reuseExistingServer: !process.env.CI,
  },
})
