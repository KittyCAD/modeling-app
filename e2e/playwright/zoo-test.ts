import {
  test as playwrightTestFn,
  ElectronApplication,
} from '@playwright/test'

import {
  fixturesBasedOnProcessEnvPlatform,
  Fixtures,
  AuthenticatedApp,
  ElectronZoo,
} from './fixtures/fixtureSetup'

import { Settings } from '@rust/kcl-lib/bindings/Settings'
import { DeepPartial } from 'lib/types'
export { expect } from '@playwright/test'

declare module '@playwright/test' {
  interface BrowserContext {
    folderSetupFn: (
      cb: (dir: string) => Promise<void>
    ) => Promise<{ dir: string }>
  }
  interface Page {
    dir: string
    TEST_SETTINGS_FILE_KEY?: string
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

    await use(electronZooInstance)
  },
})

const test = playwrightTestFnWithFixtures_
  .extend<Fixtures>(fixturesBasedOnProcessEnvPlatform)

test.beforeEach(async ({ context, page }, testInfo) => {
  if (process.env.PLATFORM !== 'web') return

  // We do the same thing in ElectronZoo. addInitScript simply doesn't fire
  // at the correct time, so we reload the page and it fires appropriately.
  const oldPageAddInitScript = page.addInitScript
  page.addInitScript = async function (...args) {
    // @ts-expect-error
    await oldPageAddInitScript.apply(this, args)
    await page.reload()
  }

  const oldContextAddInitScript = context.addInitScript
  context.addInitScript = async function (...args) {
    // @ts-expect-error
    await oldContextAddInitScript.apply(this, args)
    await page.reload()
  }

  const webApp = new AuthenticatedApp(context, page, testInfo)
  await webApp.initialise()
})

test.afterEach(async ({ tronApp }) => {
  if (process.env.PLATFORM === 'web') return

  await tronApp?.makeAvailableAgain()
})

export { test }
