import type {
  BrowserContext,
  ElectronApplication,
  Page,
  TestInfo,
} from '@playwright/test'
import { test as base } from '@playwright/test'
import { getUtils, setup, setupElectron, tearDown } from '../test-utils'
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
  public readonly viewPortSize = { width: 1000, height: 500 }

  constructor(context: BrowserContext, page: Page, testInfo: TestInfo) {
    this.page = page
    this.context = context
    this.testInfo = testInfo
  }

  async initialise(code = '', fn: () => Promise<any> = async () => {}) {
    await setup(this.context, this.page, this.testInfo)
    const u = await getUtils(this.page)

    await fn()

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

interface Fixtures {
  app: AuthenticatedApp
  tronApp: AuthenticatedTronApp
  cmdBar: CmdBarFixture
  editor: EditorFixture
  toolbar: ToolbarFixture
  scene: SceneFixture
  homePage: HomePageFixture
}
export class AuthenticatedTronApp {
  public readonly _page: Page
  public page: Page
  public readonly context: BrowserContext
  public readonly testInfo: TestInfo
  public electronApp?: ElectronApplication

  constructor(context: BrowserContext, page: Page, testInfo: TestInfo) {
    this._page = page
    this.page = page
    this.context = context
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
    const { electronApp, page } = await setupElectron({
      testInfo: this.testInfo,
      folderSetupFn: arg.folderSetupFn,
      cleanProjectDir: arg.cleanProjectDir,
      appSettings: arg.appSettings,
    })
    this.page = page
    this.electronApp = electronApp
    await page.setViewportSize({ width: 1200, height: 500 })

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

export const test = base.extend<Fixtures>({
  app: async ({ page, context }, use, testInfo) => {
    await use(new AuthenticatedApp(context, page, testInfo))
  },
  tronApp: async ({ page, context }, use, testInfo) => {
    await use(new AuthenticatedTronApp(context, page, testInfo))
  },
  cmdBar: async ({ page }, use) => {
    await use(new CmdBarFixture(page))
  },
  editor: async ({ page }, use) => {
    await use(new EditorFixture(page))
  },
  toolbar: async ({ page }, use) => {
    await use(new ToolbarFixture(page))
  },
  scene: async ({ page }, use) => {
    await use(new SceneFixture(page))
  },
  homePage: async ({ page }, use) => {
    await use(new HomePageFixture(page))
  },
})

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

export { expect } from '@playwright/test'
