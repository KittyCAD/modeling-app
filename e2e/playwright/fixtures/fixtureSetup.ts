import type {
  BrowserContext,
  ElectronApplication,
  TestInfo,
  Page,
} from '@playwright/test'

import { getUtils, setup, setupElectron } from '../test-utils'
import fsp from 'fs/promises'
import { join } from 'path'
import { CmdBarFixture } from './cmdBarFixture'
import { EditorFixture } from './editorFixture'
import { ToolbarFixture } from './toolbarFixture'
import { SceneFixture } from './sceneFixture'
import { SaveSettingsPayload } from 'lib/settings/settingsTypes'
import { HomePageFixture } from './homePageFixture'
import { unsafeTypedKeys } from 'lib/utils'

export class AuthenticatedApp {
  public readonly page: Page
  public readonly context: BrowserContext
  public readonly testInfo: TestInfo
  public readonly viewPortSize = { width: 1200, height: 500 }
  public electronApp: undefined | ElectronApplication
  public dir: string = ''

  constructor(context: BrowserContext, page: Page, testInfo: TestInfo) {
    this.context = context
    this.page = page
    this.testInfo = testInfo
  }

  async initialise(code = '') {
    await setup(this.context, this.page, this.testInfo)
    const u = await getUtils(this.page)

    await this.page.addInitScript(async (code) => {
      localStorage.setItem('persistCode', code)
      ;(window as any).playwrightSkipFilePicker = true
    }, code)

    await this.page.setViewportSize(this.viewPortSize)

    await u.waitForAuthSkipAppStart()
  }
  getInputFile = (fileName: string) => {
    return fsp.readFile(
      join('src', 'wasm-lib', 'tests', 'executor', 'inputs', fileName),
      'utf-8'
    )
  }
}

export interface Fixtures {
  cmdBar: CmdBarFixture
  editor: EditorFixture
  toolbar: ToolbarFixture
  scene: SceneFixture
  homePage: HomePageFixture
}
export class AuthenticatedTronApp {
  public originalPage: Page
  public page: Page
  public browserContext: BrowserContext
  public context: BrowserContext
  public readonly testInfo: TestInfo
  public electronApp: ElectronApplication | undefined
  public readonly viewPortSize = { width: 1200, height: 500 }
  public dir: string = ''

  constructor(
    browserContext: BrowserContext,
    originalPage: Page,
    testInfo: TestInfo
  ) {
    this.page = originalPage
    this.originalPage = originalPage
    this.browserContext = browserContext
    // Will be overwritten in the initializer
    this.context = browserContext
    this.testInfo = testInfo
  }
  async initialise(
    arg: {
      fixtures: Partial<Fixtures>
      folderSetupFn?: (projectDirName: string) => Promise<void>
      cleanProjectDir?: boolean
      appSettings?: Partial<SaveSettingsPayload>
    } = { fixtures: {} }
  ) {
    const { electronApp, page, context, dir } = await setupElectron({
      testInfo: this.testInfo,
      folderSetupFn: arg.folderSetupFn,
      cleanProjectDir: arg.cleanProjectDir,
      appSettings: arg.appSettings,
      viewport: this.viewPortSize,
    })
    this.page = page

    // These assignments "fix" some brokenness in the Playwright Workbench when
    // running against electron applications.
    // The timeline is still broken but failure screenshots work again.
    this.context = context
    // TODO: try to get this to work again for screenshots, but it messed with test ends when enabled
    // Object.assign(this.browserContext, this.context)

    this.electronApp = electronApp
    this.dir = dir

    // Easier to access throughout utils
    this.page.dir = dir

    // Setup localStorage, addCookies, reload
    await setup(this.context, this.page, this.testInfo)

    for (const key of unsafeTypedKeys(arg.fixtures)) {
      const fixture = arg.fixtures[key]
      if (
        !fixture ||
        fixture instanceof AuthenticatedApp ||
        fixture instanceof AuthenticatedTronApp
      )
        continue
      fixture.reConstruct(page)
    }
  }

  close = async () => {
    await this.electronApp?.close?.()
  }
  debugPause = () =>
    new Promise(() => {
      console.log('UN-RESOLVING PROMISE')
    })
}

export const fixtures = {
  cmdBar: async ({ page }: { page: Page }, use: any) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(new CmdBarFixture(page))
  },
  editor: async ({ page }: { page: Page }, use: any) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(new EditorFixture(page))
  },
  toolbar: async ({ page }: { page: Page }, use: any) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(new ToolbarFixture(page))
  },
  scene: async ({ page }: { page: Page }, use: any) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(new SceneFixture(page))
  },
  homePage: async ({ page }: { page: Page }, use: any) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(new HomePageFixture(page))
  },
}
