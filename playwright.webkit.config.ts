import { defineConfig } from '@playwright/test'
import config from '@root/playwright.config'

const remote = Boolean(process.env.VERCEL_BASE_URL)
if (!remote) {
  process.env.PLAYWRIGHT_WEBKIT_WORKER_ORIGINS ??=
    'http://localhost:3000,http://localhost:5173'
}

export default defineConfig({
  ...config,
  workers: remote ? 1 : 2,
  retries: 1,
  webServer: remote
    ? undefined
    : [
        {
          command:
            process.env.E2E_USE_PREBUILT_APP === '1'
              ? 'npm run start:prod -- --strictPort'
              : 'npm start -- --strictPort',
          env: { BROWSER: 'none' },
          url: 'http://localhost:3000',
          reuseExistingServer: !process.env.CI,
        },
        {
          command:
            process.env.E2E_USE_PREBUILT_APP === '1'
              ? 'npm run start:prod -- --port=5173 --strictPort'
              : 'node scripts/playwright-webkit-proxy.mjs',
          env: { BROWSER: 'none' },
          url: 'http://localhost:5173',
          reuseExistingServer: false,
        },
      ],
})
