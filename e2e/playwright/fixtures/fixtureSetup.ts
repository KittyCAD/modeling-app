/* eslint-disable react-hooks/rules-of-hooks */
import type {
  BrowserContext,
  ElectronApplication,
  Page,
  TestInfo,
} from '@playwright/test'
import { _electron as electron } from '@playwright/test'

import { SETTINGS_FILE_NAME } from '@src/lib/constants'
import type { DeepPartial } from '@src/lib/types'
import fsp from 'fs/promises'
import fs from 'node:fs'
import path from 'path'

import type { Settings } from '@rust/kcl-lib/bindings/Settings'

import { CmdBarFixture } from '@e2e/playwright/fixtures/cmdBarFixture'
import { EditorFixture } from '@e2e/playwright/fixtures/editorFixture'
import { HomePageFixture } from '@e2e/playwright/fixtures/homePageFixture'
import { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'
import { ToolbarFixture } from '@e2e/playwright/fixtures/toolbarFixture'

import { TEST_SETTINGS } from '@e2e/playwright/storageStates'
import { getUtils, settingsToToml, setup } from '@e2e/playwright/test-utils'

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
  public available: boolean = true
  public electron!: ElectronApplication
  public firstUrl = ''
  public viewPortSize = { width: 1200, height: 500 }
  public projectDirName = ''

  public page!: Page
  public context!: BrowserContext

  constructor() {}

  // Help remote end by signaling we're done with the connection.
  // If it takes longer than 10s to stop, just resolve.
  async makeAvailableAgain() {
    await this.page.evaluate(async () => {
      return new Promise((resolve) => {
        if (!window.engineCommandManager.engineConnection?.state?.type) {
          return resolve(undefined)
        }

        window.engineCommandManager.tearDown()

        // Keep polling (per js event tick) until state is Disconnected.
        const timeA = Date.now()
        const checkDisconnected = () => {
          // It's possible we never even created an engineConnection
          // e.g. never left Projects view.
          if (
            window.engineCommandManager?.engineConnection?.state.type ===
            'disconnected'
          ) {
            return resolve(undefined)
          }

          if (Date.now() - timeA > 10000) {
            return resolve(undefined)
          }

          setTimeout(checkDisconnected, 0)
        }
        checkDisconnected()
      })
    })

    await this.context.tracing.stopChunk({ path: 'trace.zip' })

    // Only after cleanup we're ready.
    this.available = true
  }

  async createInstanceIfMissing(testInfo: TestInfo) {
    // Create or otherwise clear the folder.
    this.projectDirName = testInfo.outputPath('electron-test-projects-dir')

    // We need to expose this in order for some tests that require folder
    // creation and some code below.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const that = this

    const options = {
      args: ['.', '--no-sandbox'],
      env: {
        ...process.env,
        TEST_SETTINGS_FILE_KEY: this.projectDirName,
        IS_PLAYWRIGHT: 'true',
      },
      ...(process.env.ELECTRON_OVERRIDE_DIST_PATH
        ? {
            executablePath:
              process.env.ELECTRON_OVERRIDE_DIST_PATH + 'electron',
          }
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
    if (!this.electron) {
      this.electron = await electron.launch(options)

      this.page = await this.electron.firstWindow()
      this.context = this.electron.context()
      await this.context.tracing.start({ screenshots: true, snapshots: true })

      // We need to patch this because addInitScript will bind too late in our
      // electron tests, never running. We need to call reload() after each call
      // to guarantee it runs.
      const oldContextAddInitScript = this.context.addInitScript
      this.context.addInitScript = async function (a, b) {
        // @ts-ignore pretty sure way out of tsc's type checking capabilities.
        // This code works perfectly fine.
        await oldContextAddInitScript.apply(this, [a, b])
        await that.page.reload()
      }

      const oldPageAddInitScript = this.page.addInitScript
      this.page.addInitScript = async function (a: any, b: any) {
        // @ts-ignore pretty sure way out of tsc's type checking capabilities.
        // This code works perfectly fine.
        await oldPageAddInitScript.apply(this, [a, b])
        await that.page.reload()
      }
    }

    await this.context.tracing.startChunk()

    await setup(this.context, this.page, this.projectDirName, testInfo)

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

      await that.electron?.evaluateHandle(async ({ app }, dims) => {
        // @ts-ignore sorry jon but see comment in main.ts why this is ignored
        await app.resizeWindow(dims.width, dims.height)
      }, dims)

      return this.evaluate(async (dims: { width: number; height: number }) => {
        await window.electron.resizeWindow(dims.width, dims.height)
        window.document.body.style.width = dims.width + 'px'
        window.document.body.style.height = dims.height + 'px'
        window.document.documentElement.style.width = dims.width + 'px'
        window.document.documentElement.style.height = dims.height + 'px'
      }, dims)
    }

    await this.page.setBodyDimensions(this.viewPortSize)

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

    // This should not be necessary because we set this in the env when launching
    // await this.electron?.evaluate(({ app }, projectDirName) => {
    //   // @ts-ignore can't declaration merge see main.ts
    //   app.testProperty['TEST_SETTINGS_FILE_KEY'] = projectDirName
    // }, this.projectDirName)

    // Always start at the root view
    await this.page.goto(this.firstUrl)

    // Force a hard reload, destroying the stream and other state
    await this.page.reload()
  }

  async cleanProjectDir(appSettings?: DeepPartial<Settings>) {
    try {
      if (fs.existsSync(this.projectDirName)) {
        await fsp.rm(this.projectDirName, { recursive: true })
      }
    } catch (_e) {
      console.error(_e)
    }

    try {
      await fsp.mkdir(this.projectDirName)
    } catch (error: unknown) {
      void error
      // Not a problem if it already exists.
    }

    const tempSettingsFilePath = path.join(
      this.projectDirName,
      SETTINGS_FILE_NAME
    )

    let settingsOverridesToml = ''

    if (appSettings) {
      settingsOverridesToml = settingsToToml({
        settings: {
          ...TEST_SETTINGS,
          ...appSettings,
          app: {
            ...TEST_SETTINGS.app,
            ...appSettings.app,
          },
          project: {
            ...TEST_SETTINGS.project,
            directory: this.projectDirName,
          },
        },
      })
    } else {
      settingsOverridesToml = settingsToToml({
        settings: {
          ...TEST_SETTINGS,
          app: {
            ...TEST_SETTINGS.app,
          },
          project: {
            ...TEST_SETTINGS.project,
            directory: this.projectDirName,
          },
        },
      })
    }
    await fsp.writeFile(tempSettingsFilePath, settingsOverridesToml)
  }
}

// If yee encounter this, please try to type it.
type FnUse = any

const fixturesForElectron = {
  page: async (
    { tronApp }: { tronApp: ElectronZoo },
    use: FnUse,
    testInfo: TestInfo
  ) => {
    await use(tronApp.page)
  },
  context: async (
    { tronApp }: { tronApp: ElectronZoo },
    use: FnUse,
    testInfo: TestInfo
  ) => {
    await use(tronApp.context)
  },
}

const fixturesForWeb = {
  page: async (
    { page, context }: { page: Page; context: BrowserContext },
    use: FnUse,
    testInfo: TestInfo
  ) => {
    page.setBodyDimensions = page.setViewportSize

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

    await use(page)
  },
}

const fixturesBasedOnProcessEnvPlatform = {
  cmdBar: async ({ page }: { page: Page }, use: FnUse) => {
    await use(new CmdBarFixture(page))
  },
  editor: async ({ page }: { page: Page }, use: FnUse) => {
    await use(new EditorFixture(page))
  },
  toolbar: async ({ page }: { page: Page }, use: FnUse) => {
    await use(new ToolbarFixture(page))
  },
  scene: async ({ page }: { page: Page }, use: FnUse) => {
    await use(new SceneFixture(page))
  },
  homePage: async ({ page }: { page: Page }, use: FnUse) => {
    await use(new HomePageFixture(page))
  },
}

if (process.env.PLATFORM === 'web') {
  Object.assign(fixturesBasedOnProcessEnvPlatform, fixturesForWeb)
} else {
  Object.assign(fixturesBasedOnProcessEnvPlatform, fixturesForElectron)
}

export { fixturesBasedOnProcessEnvPlatform }
