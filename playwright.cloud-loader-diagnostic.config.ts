import { defineConfig } from '@playwright/test'
import base from '@root/playwright.config'

if (process.env.VERCEL_BASE_URL) {
  // eslint-disable-next-line suggest-no-throw/suggest-no-throw
  throw new Error(
    'Unset VERCEL_BASE_URL to diagnose this instrumented checkout.'
  )
}

process.env.PLAYWRIGHT_FILE_LOADER_DIAGNOSTIC = '1'
process.env.TARGET = 'web'
process.env.NODE_ENV = 'development'

export default defineConfig({
  ...base,
  testMatch: 'cloud-sync.spec.ts',
  grep: /^.*syncs an edit queued during first upload with the real development API(?: @web)?$/,
  retries: 0,
  workers: 1,
  globalTimeout: 240_000,
  outputDir: 'test-results/cloud-loader-diagnostic/results',
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
  // Always serve this instrumented checkout, never a previous preview/server.
  webServer: {
    command: 'npm start',
    url: 'http://localhost:3000',
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'development',
      VITE_FILE_LOADER_DIAGNOSTIC: '1',
    },
  },
})
