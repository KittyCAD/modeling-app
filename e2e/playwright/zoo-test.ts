import { expect, test as playwrightTestFn } from '@e2e/playwright/base-test'
import type { Fixtures } from '@e2e/playwright/fixtures/fixtureSetup'
import {
  ElectronZoo,
  fixturesBasedOnProcessEnvPlatform,
} from '@e2e/playwright/fixtures/fixtureSetup'
import type { Feature } from '@kittycad/lib'

export { expect }

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
      let timeoutId: NodeJS.Timeout | undefined

      try {
        await Promise.race([
          electronZooInstance.createInstanceIfMissing(
            testInfo,
            userFeatures,
            setupTimeout
          ),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(
                new Error(
                  `tronApp setup timed out after ${setupTimeout}ms${isFirstRun ? ' (first run)' : ' (subsequent run)'}`
                )
              )
            }, setupTimeout)
          }),
        ])
        if (timeoutId) clearTimeout(timeoutId)

        // First run is complete at this point
        isFirstRun = false

        await use(electronZooInstance)
        if (
          testInfo.status === 'timedOut' ||
          electronZooInstance.rendererCrashed
        ) {
          await electronZooInstance.dispose(testInfo)
        } else {
          await electronZooInstance.makeAvailableAgain()
        }
      } catch (error) {
        try {
          await electronZooInstance.dispose(testInfo)
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            'Electron fixture failure and cleanup failed'
          )
        }
        throw error
      } finally {
        if (timeoutId) clearTimeout(timeoutId)
      }
    },
    { timeout: 120_000 }, // Keep the global timeout as fallback
  ],
})

const test = playwrightTestFnWithFixtures_.extend<Fixtures>(
  fixturesBasedOnProcessEnvPlatform
)

export { test }
