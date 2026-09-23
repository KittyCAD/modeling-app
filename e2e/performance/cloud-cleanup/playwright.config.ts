import { defineConfig } from '@playwright/test'
import base from '@root/playwright.config'

if (process.env.VERCEL_BASE_URL) {
  // eslint-disable-next-line suggest-no-throw/suggest-no-throw
  throw new Error('Unset VERCEL_BASE_URL to probe this checkout.')
}

process.env.TARGET = 'web'
process.env.NODE_ENV = 'development'

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'cleanup.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  repeatEach: 1,
  globalTimeout: 240_000,
  outputDir: '../../../test-results/cloud-cleanup/results',
  reporter: [['./reporter.ts']],
  use: {
    ...base.use,
    baseURL: 'http://localhost:3000',
    headless: false,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: base.projects?.filter(
    (project) => project.name === 'Google Chrome'
  ),
  webServer: {
    command: 'npm start',
    url: 'http://localhost:3000',
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'ignore',
    env: { NODE_ENV: 'development', VITE_CLOUD_SYNC_DIAGNOSTIC: '0' },
  },
})
