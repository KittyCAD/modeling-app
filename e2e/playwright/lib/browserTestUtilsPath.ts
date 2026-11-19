export const browserTestUtilsPath =
  process.env.E2E_USE_PREBUILT_APP === '1'
    ? '/assets/playwright-test-utils.js'
    : '/e2e/playwright/lib/browserTestUtils.ts'
