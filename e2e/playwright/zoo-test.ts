import { interactionDiscoveryFixtures } from '@e2e/playwright/fixtures/interactionDiscoveryFixture'
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
let electronZooInstance: ElectronZoo | undefined

// Track whether this is the first run for this worker process
// Mac needs more time for the first window creation
let isFirstRun = true

// Our custom decorated Zoo test object. Makes it easier to add fixtures, and
// switch between web and electron if needed.
const playwrightTestFnWithFixtures_ = playwrightTestFn.extend<{
  tronApp?: ElectronZoo
  userFeatures: Feature[]
  mockApiRoutes: boolean
}>({
  userFeatures: [[], { option: true }],
  mockApiRoutes: [true, { option: true }],
  tronApp: [
    async ({ userFeatures, mockApiRoutes, launchOptions }, use, testInfo) => {
      if (process.env.TARGET === 'web') {
        await use(undefined)
        return
      }

      const instance = (electronZooInstance ??= new ElectronZoo({
        args: launchOptions.args,
      }))

      // Create a single timeout for the entire tronApp setup process
      // This will ensure tests fail faster if there's an issue with setup
      // instead of waiting for the full global timeout (120s)
      // First runs need more time especially on Mac for window creation
      const setupTimeout = isFirstRun ? 120_000 : 30_000
      let timeoutId: NodeJS.Timeout | undefined

      try {
        await Promise.race([
          instance.createInstanceIfMissing(
            testInfo,
            userFeatures,
            setupTimeout,
            mockApiRoutes
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

        await use(instance)
        if (testInfo.status === 'timedOut' || instance.rendererCrashed) {
          await instance.dispose(testInfo)
        } else {
          await instance.makeAvailableAgain()
        }
      } catch (error) {
        try {
          await instance.dispose(testInfo)
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            'Electron fixture failure and cleanup failed'
          )
        }
        throw error
      } finally {
        if (timeoutId) clearTimeout(timeoutId)
        // Expected failures can keep this worker alive after disposal.
        if (!instance.available) {
          electronZooInstance = undefined
          isFirstRun = true
        }
      }
    },
    { timeout: 120_000 }, // Keep the global timeout as fallback
  ],
})

const appTest = playwrightTestFnWithFixtures_.extend<Fixtures>(
  fixturesBasedOnProcessEnvPlatform
)

const test =
  process.env.PLAYWRIGHT_INTERACTION_DISCOVERY === '1'
    ? appTest.extend(interactionDiscoveryFixtures)
    : appTest

export { test }
