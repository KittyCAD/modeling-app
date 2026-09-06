import type { Feature } from '@kittycad/lib'
import { test as playwrightTestFn } from '@playwright/test'

import type { Fixtures } from '@e2e/playwright/fixtures/fixtureSetup'
import { runElectronSetup } from '@e2e/playwright/fixtures/electronLifecycle'
import {
  ElectronZoo,
  fixturesBasedOnProcessEnvPlatform,
} from '@e2e/playwright/fixtures/fixtureSetup'

export { expect } from '@playwright/test'

declare module '@playwright/test' {
  interface Page {
    dir: string
    setBodyDimensions: (dims: {
      width: number
      height: number
    }) => Promise<void>
  }
}

// Each worker spawns a new thread, which will spawn its own ElectronZoo.
// So in some sense there is an implicit pool.
// For example, the variable just beneath this text is reused many times
// *for one worker*.
const electronZooInstance = new ElectronZoo()

// Track whether this is the first run for this worker process
// Mac needs more time for the first window creation
let isFirstRun = true

// Our custom decorated Zoo test object. Makes it easier to add fixtures, and
// switch between web and electron if needed.
const playwrightTestFnWithFixtures_ = playwrightTestFn.extend<{
  tronApp?: ElectronZoo
  userFeatures: Feature[]
}>({
  userFeatures: [[], { option: true }],
  tronApp: [
    async ({ userFeatures }, use, testInfo) => {
      if (process.env.TARGET === 'web') {
        await use(undefined)
        return
      }

      // Create a single timeout for the entire tronApp setup process
      // This will ensure tests fail faster if there's an issue with setup
      // instead of waiting for the full global timeout (120s)
      // First runs need more time especially on Mac for window creation
      const setupTimeout = isFirstRun ? 120_000 : 30_000
      await runElectronSetup(
        () =>
          electronZooInstance.createInstanceIfMissing(
            testInfo,
            userFeatures,
            setupTimeout
          ),
        () => electronZooInstance.dispose(),
        setupTimeout,
        `tronApp setup timed out after ${setupTimeout}ms${isFirstRun ? ' (first run)' : ' (subsequent run)'}`
      )

      isFirstRun = false

      await use(electronZooInstance)
      await electronZooInstance.makeAvailableAgain()
    },
    { timeout: 120_000 }, // Keep the global timeout as fallback
  ],
})

const test = playwrightTestFnWithFixtures_.extend<Fixtures>(
  fixturesBasedOnProcessEnvPlatform
)

export { test }
