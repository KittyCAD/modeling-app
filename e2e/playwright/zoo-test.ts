/* eslint-disable react-hooks/rules-of-hooks */
import { test as playwrightTestFn } from '@playwright/test'

import type { Fixtures } from '@e2e/playwright/fixtures/fixtureSetup'
import {
  ElectronZoo,
  fixturesBasedOnProcessEnvPlatform,
} from '@e2e/playwright/fixtures/fixtureSetup'

export { expect } from '@playwright/test'

declare module '@playwright/test' {
  interface BrowserContext {
    folderSetupFn: (
      cb: (dir: string) => Promise<void>
    ) => Promise<{ dir: string }>
  }
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
}>({
  tronApp: [
    async ({}, use, testInfo) => {
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

      const setupPromise = new Promise<void>((resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `tronApp setup timed out after ${setupTimeout}ms${isFirstRun ? ' (first run)' : ' (subsequent run)'}`
            )
          )
        }, setupTimeout)

        // Execute the async setup in a separate function
        const doSetup = async () => {
          try {
            await electronZooInstance.createInstanceIfMissing(testInfo)
            resolve()
          } catch (error) {
            reject(error)
          }
        }

        // Start the setup process
        void doSetup()
      })

      try {
        await setupPromise
        if (timeoutId) clearTimeout(timeoutId)

        // First run is complete at this point
        isFirstRun = false

        await use(electronZooInstance)
        await electronZooInstance.makeAvailableAgain()
      } catch (error) {
        if (timeoutId) clearTimeout(timeoutId)
        throw error
      }
    },
    { timeout: 120_000 }, // Keep the global timeout as fallback
  ],
})

const test = playwrightTestFnWithFixtures_.extend<Fixtures>(
  fixturesBasedOnProcessEnvPlatform
)

// interface IFormattedLog {
//   time: number
//   message: string
//   stack?: string
//   label: string
//   metadata: any
// }

// Globally enable printing the entire engine connection trace from the page's global variable.
// test.afterEach(async ({ page }, testInfo) => {
//   if (testInfo.status === 'skipped' || testInfo.status === 'passed') {
//     // NO OP
//     return
//   }

//   const engineLogs: ILog[] = await page.evaluate(
//     // @ts-ignore This value is accessible. If it isn't that is not the end of the world
//     () => window?.engineDebugger?.logs || []
//   )
//   const formattedLogs: IFormattedLog[] = engineLogs.map((log: ILog) => {
//     const newLog: IFormattedLog = {
//       ...log,
//     }
//     delete newLog['stack']
//     newLog.metadata = JSON.stringify(newLog.metadata, null, 1)
//     return newLog
//   })
//   console.log(formattedLogs)
// })

export { test }
