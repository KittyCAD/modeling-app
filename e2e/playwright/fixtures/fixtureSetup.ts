import type {
  BrowserContext,
  ElectronApplication,
  TestInfo,
  Page,
} from '@playwright/test'

import { _electron as electron } from '@playwright/test'

import * as TOML from '@iarna/toml'
import {
  TEST_SETTINGS_KEY,
  TEST_SETTINGS_CORRUPTED,
  TEST_SETTINGS,
  TEST_SETTINGS_DEFAULT_THEME,
} from '../storageStates'
import { SETTINGS_FILE_NAME, PROJECT_SETTINGS_FILE_NAME } from 'lib/constants'
import { getUtils, setup, setupElectron } from '../test-utils'
import fsp from 'fs/promises'
import fs from 'node:fs'
import path from 'path'
import { CmdBarFixture } from './cmdBarFixture'
import { EditorFixture } from './editorFixture'
import { ToolbarFixture } from './toolbarFixture'
import { SceneFixture } from './sceneFixture'
import { HomePageFixture } from './homePageFixture'
import { unsafeTypedKeys } from 'lib/utils'
import { DeepPartial } from 'lib/types'
import { Settings } from '@rust/kcl-lib/bindings/Settings'

export class AuthenticatedApp {
  public readonly page: Page
  public readonly context: BrowserContext
  public readonly testInfo: TestInfo
  public readonly viewPortSize = { width: 1200, height: 500 }
  public electronApp: undefined | ElectronApplication
  public projectDirName: string = ''

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
      path.join('rust', 'kcl-lib', 'e2e', 'executor', 'inputs', fileName),
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

export class ElectronZoo {
  public electron!: ElectronApplication
  public firstUrl = ''
  public viewPortSize = { width: 1200, height: 500 }
  public dir = ''

  constructor() {
  }

  close = async () => {
    // await this.electron?.close?.()
  }

  debugPause = () =>
    new Promise(() => {
      console.log('UN-RESOLVING PROMISE')
    })

  async createInstanceIfMissing(testInfo: TestInfo) {
    if (this.electron) return

    // create or otherwise clear the folder
    this.projectDirName = testInfo.outputPath('electron-test-projects-dir')

    const options = {
      args: ['.', '--no-sandbox'],
      env: {
        ...process.env,
        TEST_SETTINGS_FILE_KEY: this.projectDirName,
        IS_PLAYWRIGHT: 'true',
      },
      ...(process.env.ELECTRON_OVERRIDE_DIST_PATH
        ? { executablePath: process.env.ELECTRON_OVERRIDE_DIST_PATH + 'electron' }
        : {}),
      ...(process.env.PLAYWRIGHT_RECORD_VIDEO
        ? {
            recordVideo: {
              dir: testInfo.snapshotPath(),
              size: this.viewPortSize,
            },
          }
        : {}),
    }

    // Do this once and then reuse window on subsequent calls.
    this.electron = await electron.launch(options)

    this.context = this.electron.context()
    this.page = await this.electron.firstWindow()

    this.context.on('console', console.log)
    this.page.on('console', console.log)

    await setup(this.context, this.page, testInfo)

    await this.cleanProjectDir()

    // Create a consistent way to resize the page across electron and web.
    // (lee) I had to do everything in the book to make electron change its
    // damn window size. I succeeded in making it consistently and reliably
    // do it after a whole afternoon.
    this.page.setBodyDimensions = async function (dims: {
      width: number
      height: number
    }) {
      await this.setViewportSize(dims)

      await this.electron?.evaluateHandle(async ({ app }, dims) => {
        // @ts-ignore sorry jon but see comment in main.ts why this is ignored
        await app.resizeWindow(dims.width, dims.height)
      }, dims)

      return this.evaluate(
        async (dims: { width: number; height: number }) => {
          await window.electron.resizeWindow(dims.width, dims.height)
          window.document.body.style.width = dims.width + 'px'
          window.document.body.style.height = dims.height + 'px'
          window.document.documentElement.style.width = dims.width + 'px'
          window.document.documentElement.style.height = dims.height + 'px'
        },
        dims
      )
    }

    await this.page.setBodyDimensions(this.viewPortSize)

    // We need to expose this in order for some tests that require folder
    // creation.
    const that = this
    this.context.folderSetupFn = async function (fn) {
      return fn(that.projectDirName)
        .then(() => that.page.reload())
        .then(() => ({
          dir: that.projectDirName,
        }))
    }

    if (!this.firstUrl) {
      await this.page.getByText('Your Projects').count()
      this.firstUrl = this.page.url()
    }

    // Due to the app controlling its own window context we need to inject new
    // options and context here.
    // NOTE TO LEE: Seems to destroy page context when calling an electron loadURL.
    // await tronApp.electronApp.evaluate(({ app }) => {
    //   return app.reuseWindowForTest();
    // });

    await this.electron?.evaluate(({ app }, projectDirName) => {
      // @ts-ignore can't declaration merge see main.ts
      app.testProperty['TEST_SETTINGS_FILE_KEY'] = projectDirName
    }, this.projectDirName)

    // Always start at the root view
    await this.page.goto(this.firstUrl)

    // Force a hard reload, destroying the stream and other state
    await this.page.reload()
  }

  async cleanProjectDir(appSettings) {
    try {
      if (fs.existsSync(this.projectDirName)) {
        await fsp.rm(this.projectDirName, { recursive: true })
      }
    } catch (e) {
      console.error(e)
    }

    try {
      await fsp.mkdir(this.projectDirName)
    } catch(e) {
      // Not a problem if it already exists.
    }

    const tempSettingsFilePath = path.join(this.projectDirName, SETTINGS_FILE_NAME)
    const settingsOverrides = TOML.stringify(
      appSettings
        ? {
            settings: {
              ...TEST_SETTINGS,
              ...appSettings,
              app: {
                ...TEST_SETTINGS.app,
                projectDirectory: this.projectDirName,
                ...appSettings.app,
              },
            },
          }
        : {
            settings: {
              ...TEST_SETTINGS,
              app: {
                ...TEST_SETTINGS.app,
                projectDirectory: this.projectDirName,
              },
            },
          }
    )
    await fsp.writeFile(tempSettingsFilePath, settingsOverrides)
  }
}

export const fixtures = {
  page: async ({ tronApp }, use, testInfo) => {
    await tronApp.createInstanceIfMissing(testInfo)
    await use(tronApp.page)
  },
  context: async ({ tronApp }, use, testInfo) => {
    await tronApp.createInstanceIfMissing(testInfo)
    await use(tronApp.context)
  },
  cmdBar: async ({ page }: { page: Page }, use: any) => {
    await use(new CmdBarFixture(page))
  },
  editor: async ({ page }: { page: Page }, use: any) => {
    await use(new EditorFixture(page))
  },
  toolbar: async ({ page }: { page: Page }, use: any) => {
    await use(new ToolbarFixture(page))
  },
  scene: async ({ page }: { page: Page }, use: any) => {
    await use(new SceneFixture(page))
  },
  homePage: async ({ page }: { page: Page }, use: any) => {
    await use(new HomePageFixture(page))
  },
}

