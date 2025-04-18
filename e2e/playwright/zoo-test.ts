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

// Our custom decorated Zoo test object. Makes it easier to add fixtures, and
// switch between web and electron if needed.
const playwrightTestFnWithFixtures_ = playwrightTestFn.extend<{
  tronApp?: ElectronZoo
}>({
  tronApp: async ({}, use, testInfo) => {
    if (process.env.PLATFORM === 'web') {
      await use(undefined)
      return
    }

    await electronZooInstance.createInstanceIfMissing(testInfo)
    await use(electronZooInstance)
    await electronZooInstance.makeAvailableAgain()
  },
})

const test = playwrightTestFnWithFixtures_.extend<Fixtures>(
  fixturesBasedOnProcessEnvPlatform
)

export { test }
