import { defineConfig } from '@playwright/test'
import base from '@root/playwright.config'

if (process.env.VERCEL_BASE_URL) {
  // eslint-disable-next-line suggest-no-throw/suggest-no-throw
  throw new Error(
    'Unset VERCEL_BASE_URL to diagnose this instrumented checkout.'
  )
}

process.env.PLAYWRIGHT_CLOUD_SYNC_DIAGNOSTIC = '1'
process.env.TARGET = 'web'
process.env.NODE_ENV = 'development'

export default defineConfig({
  ...base,
  // Keep the normal Windows web selection and worker count to retain contention.
  grep: /@web/,
  testIgnore: ['*.test.ts', '**/cloud-sync-timing-diagnostic.spec.ts'],
  workers: '75%',
  retries: 0,
  globalTimeout: 240_000,
  outputDir: 'test-results/cloud-sync-stages-diagnostic/results',
  reporter: [['line']],
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
    env: { NODE_ENV: 'development', VITE_CLOUD_SYNC_DIAGNOSTIC: '1' },
  },
})
