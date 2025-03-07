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
  fixtures,
  Fixtures,
  AuthenticatedApp,
  ElectronZoo,
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

// Our custom decorated Zoo test object. Makes it easier to add fixtures, and
// switch between web and electron if needed.
const pwTestFnWithFixtures_ = playwrightTestFn.extend<Fixtures>({
  tronApp: async ({}, use) => {
    await use(new ElectronZoo())
  },
})

export const test = pwTestFnWithFixtures_.extend<Fixtures>(fixtures)
