import { defineConfig } from '@playwright/test'
import base from '@root/playwright.config'

if (
  process.env.VERCEL_BASE_URL !==
  'https://modeling-3mkyk5tea.vercel.dev.zoo.dev'
) {
  // Refuse to run this diagnostic against an unverified deployment.
  // eslint-disable-next-line suggest-no-throw/suggest-no-throw
  throw new Error(
    'Set VERCEL_BASE_URL to the verified immutable renderer preview before running this diagnostic.'
  )
}

export default defineConfig({
  ...base,
  retries: 0,
  workers: 1,
  globalTimeout: 240_000,
  testMatch: 'cloud-sync-timing-diagnostic.spec.ts',
  outputDir: 'test-results/cloud-timing-diagnostic/results',
  reporter: [
    ['line'],
    [
      'json',
      { outputFile: 'test-results/cloud-timing-diagnostic/report.json' },
    ],
  ],
  use: { ...base.use, headless: false, trace: 'off', screenshot: 'off' },
  projects: [base.projects![0]],
})
