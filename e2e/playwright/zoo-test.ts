import {
  test as playwrightTestFn,
  TestInfo as TestInfoPlaywright,
  BrowserContext as BrowserContextPlaywright,
  Page as PagePlaywright,
  TestDetails as TestDetailsPlaywright,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  ElectronApplication,
} from '@playwright/test'

import {
  fixturesForElectron,
  fixturesForWeb,
  fixturesForAll,
  Fixtures,
  AuthenticatedApp,
  ElectronZoo,
  ElectronZooPool,
} from './fixtures/fixtureSetup'

import { Settings } from '@rust/kcl-lib/bindings/Settings'
import { DeepPartial } from 'lib/types'
export { expect } from '@playwright/test'

declare module '@playwright/test' {
  interface TestInfo {
    tronApp?: AuthenticatedTronApp
  }
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

export type TestInfo = TestInfoPlaywright
export type BrowserContext = BrowserContextPlaywright
export type Page = PagePlaywright
export type TestDetails = TestDetailsPlaywright & {
  cleanProjectDir?: boolean
  appSettings?: DeepPartial<Settings>
}

// Each worker spawns a new thread, which will spawn its own ElectronZoo.
// So in some sense there is an implicit pool.
// For example, the variable just beneath this text is reused many times
// *for one worker*.
const electronZooInstance = new ElectronZoo()

// Our custom decorated Zoo test object. Makes it easier to add fixtures, and
// switch between web and electron if needed.
const pwTestFnWithFixtures_ = playwrightTestFn.extend<Fixtures>({
  tronApp: async ({}, use, testInfo) => {
    await use(electronZooInstance)
  },
})

const test =
  process.env.PLATFORM !== 'web'
    ? pwTestFnWithFixtures_.extend(fixturesForElectron).extend(fixturesForAll)
    : playwrightTestFn
        .extend({ tronApp: undefined })
        .extend(fixturesForWeb)
        .extend(fixturesForAll)

if (process.env.PLATFORM === 'web') {
  test.beforeEach(async ({ context, page }, testInfo) => {

    // We do the same thing in ElectronZoo. addInitScript simply doesn't fire
    // at the correct time, so we reload the page and it fires appropriately.
    const oldPageAddInitScript = page.addInitScript
    page.addInitScript = async function (...args) {
      await oldPageAddInitScript.apply(this, args)
      await page.reload()
    }

    const oldContextAddInitScript = context.addInitScript
    context.addInitScript = async function (...args) {
      await oldContextAddInitScript.apply(this, args)
      await page.reload()
    }

    const webApp = new AuthenticatedApp(context, page, testInfo)
    await webApp.initialise()
  })
} else {
  test.afterEach(async ({ tronApp }) => {
    await tronApp.makeAvailableAgain()
  })
}

export { test }
