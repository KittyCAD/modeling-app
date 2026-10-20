import { defineConfig, devices } from '@playwright/test'

process.env.TARGET = 'web'
// The spec owns strict scoped assertions for the intentional native panic and
// every unexpected page error. Keep the ordinary suite's error policy intact.
process.env.FAIL_ON_CONSOLE_ERRORS = 'false'

// Build first: bash scripts/build-wasm-fault-injection.sh
// Run: npx playwright test --config=playwright.wasm-recovery.config.ts --headed
// This config serves only the isolated, compile-time-opt-in fault build.
export default defineConfig({
  testDir: './e2e/playwright',
  testMatch: 'wasm-recovery.spec.ts',
  grep: /recovers from a genuine Rust\/Wasm panic/,
  outputDir: './test-results/wasm-recovery',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [
    ['list'],
    ['json', { outputFile: './test-results/wasm-recovery/report.json' }],
  ],
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    baseURL: 'http://localhost:3000',
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    contextOptions: { permissions: ['clipboard-write', 'clipboard-read'] },
  },
  projects: [
    { name: 'wasm-fault-injection', metadata: { wasmFaultInjection: true } },
  ],
  webServer: {
    command:
      'npx vite preview --config=vite.wasm-recovery.config.ts --port=3000 --strictPort',
    url: 'http://localhost:3000',
    reuseExistingServer: false,
  },
})
