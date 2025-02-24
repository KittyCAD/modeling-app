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
  AuthenticatedTronApp,
  AuthenticatedApp,
} from './fixtures/fixtureSetup'

import { SaveSettingsPayload } from 'lib/settings/settingsTypes'
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
  appSettings?: Partial<SaveSettingsPayload>
}

// Our custom decorated Zoo test object. Makes it easier to add fixtures, and
// switch between web and electron if needed.
const pwTestFnWithFixtures = playwrightTestFn.extend<Fixtures>(fixtures)

// In JavaScript you cannot replace a function's body only (despite functions
// are themselves objects, which you'd expect a body property or something...)
// So we must redefine the function and then re-attach properties.
type PWFunction = (
  args: PlaywrightTestArgs &
    Fixtures &
    PlaywrightWorkerArgs &
    PlaywrightTestOptions &
    PlaywrightWorkerOptions & {
      electronApp?: ElectronApplication
    },
  testInfo: TestInfo
) => void | Promise<void>

let firstUrl = ''

export const test = (
  desc: string,
  objOrFn: PWFunction | TestDetails,
  fnMaybe?: PWFunction
) => {
  const hasTestConf = typeof objOrFn === 'object'
  const fn = hasTestConf ? fnMaybe : objOrFn

  return pwTestFnWithFixtures(
    desc,
    hasTestConf ? objOrFn : {},
    async (
      {
        page,
        context,
        cmdBar,
        editor,
        toolbar,
        scene,
        homePage,
        request,
        playwright,
        browser,
        acceptDownloads,
        bypassCSP,
        colorScheme,
        clientCertificates,
        deviceScaleFactor,
        extraHTTPHeaders,
        geolocation,
        hasTouch,
        httpCredentials,
        ignoreHTTPSErrors,
        isMobile,
        javaScriptEnabled,
        locale,
        offline,
        permissions,
        proxy,
        storageState,
        timezoneId,
        userAgent,
        viewport,
        baseURL,
        contextOptions,
        actionTimeout,
        navigationTimeout,
        serviceWorkers,
        testIdAttribute,
        browserName,
        defaultBrowserType,
        headless,
        channel,
        launchOptions,
        connectOptions,
        screenshot,
        trace,
        video,
      },
      testInfo
    ) => {
      // To switch to web, use PLATFORM=web environment variable.
      // Only use this for debugging, since the playwright tracer is busted
      // for electron.

      let tronApp

      if (process.env.PLATFORM === 'web') {
        tronApp = new AuthenticatedApp(context, page, testInfo)
      } else {
        tronApp = new AuthenticatedTronApp(context, page, testInfo)
      }

      const fixtures: Fixtures = { cmdBar, editor, toolbar, scene, homePage }
      if (tronApp instanceof AuthenticatedTronApp) {
        const options = {
          fixtures,
        }
        if (hasTestConf) {
          Object.assign(options, {
            appSettings: objOrFn?.appSettings,
            cleanProjectDir: objOrFn?.cleanProjectDir,
          })
        }
        await tronApp.initialise(options)
      } else {
        await tronApp.initialise('')
      }

      // We need to patch this because addInitScript will bind too late in our
      // electron tests, never running. We need to call reload() after each call
      // to guarantee it runs.
      const oldContextAddInitScript = tronApp.context.addInitScript
      tronApp.context.addInitScript = async function (a, b) {
        // @ts-ignore pretty sure way out of tsc's type checking capabilities.
        // This code works perfectly fine.
        await oldContextAddInitScript.apply(this, [a, b])
        await tronApp.page.reload()
      }

      // No idea why we mix and match page and context's addInitScript but we do
      const oldPageAddInitScript = tronApp.page.addInitScript
      tronApp.page.addInitScript = async function (a: any, b: any) {
        // @ts-ignore pretty sure way out of tsc's type checking capabilities.
        // This code works perfectly fine.
        await oldPageAddInitScript.apply(this, [a, b])
        await tronApp.page.reload()
      }

      // Create a consistent way to resize the page across electron and web.
      // (lee) I had to do everything in the book to make electron change its
      // damn window size. I succeeded in making it consistently and reliably
      // do it after a whole afternoon.
      tronApp.page.setBodyDimensions = async function (dims: {
        width: number
        height: number
      }) {
        await tronApp.page.setViewportSize(dims)

        if (!(tronApp instanceof AuthenticatedTronApp)) {
          return
        }

        await tronApp.electronApp?.evaluateHandle(async ({ app }, dims) => {
          // @ts-ignore sorry jon but see comment in main.ts why this is ignored
          await app.resizeWindow(dims.width, dims.height)
        }, dims)

        return tronApp.page.evaluate(
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

      await tronApp.page.setBodyDimensions(tronApp.viewPortSize)

      // We need to expose this in order for some tests that require folder
      // creation. Before they used to do this by their own electronSetup({...})
      // calls.
      if (tronApp instanceof AuthenticatedTronApp) {
        tronApp.context.folderSetupFn = async function (fn) {
          return fn(tronApp.dir)
            .then(() => tronApp.page.reload())
            .then(() => ({
              dir: tronApp.dir,
            }))
        }
      }

      if (!firstUrl) {
        await tronApp.page.getByText('Your Projects').count()
        firstUrl = tronApp.page.url()
      }

      // Due to the app controlling its own window context we need to inject new
      // options and context here.
      // NOTE TO LEE: Seems to destroy page context when calling an electron loadURL.
      // await tronApp.electronApp.evaluate(({ app }) => {
      //   return app.reuseWindowForTest();
      // });

      await tronApp.electronApp?.evaluate(({ app }, projectDirName) => {
        // @ts-ignore can't declaration merge see main.ts
        app.testProperty['TEST_SETTINGS_FILE_KEY'] = projectDirName
      }, tronApp.dir)

      // Always start at the root view
      await tronApp.page.goto(firstUrl)

      // Force a hard reload, destroying the stream and other state
      await tronApp.page.reload()

      // tsc aint smart enough to know this'll never be undefined
      // but I dont blame it, the logic to know is complex
      if (fn) {
        await fn(
          {
            context: tronApp.context,
            page: tronApp.page,
            electronApp:
              tronApp instanceof AuthenticatedTronApp
                ? tronApp.electronApp
                : undefined,
            ...fixtures,
            request,
            playwright,
            browser,
            acceptDownloads,
            bypassCSP,
            colorScheme,
            clientCertificates,
            deviceScaleFactor,
            extraHTTPHeaders,
            geolocation,
            hasTouch,
            httpCredentials,
            ignoreHTTPSErrors,
            isMobile,
            javaScriptEnabled,
            locale,
            offline,
            permissions,
            proxy,
            storageState,
            timezoneId,
            userAgent,
            viewport,
            baseURL,
            contextOptions,
            actionTimeout,
            navigationTimeout,
            serviceWorkers,
            testIdAttribute,
            browserName,
            defaultBrowserType,
            headless,
            channel,
            launchOptions,
            connectOptions,
            screenshot,
            trace,
            video,
          },
          testInfo
        )
      }

      testInfo.tronApp =
        tronApp instanceof AuthenticatedTronApp ? tronApp : undefined
    }
  )
}

type ZooTest = typeof test

test.describe = pwTestFnWithFixtures.describe
test.beforeEach = pwTestFnWithFixtures.beforeEach
test.afterEach = pwTestFnWithFixtures.afterEach
test.step = pwTestFnWithFixtures.step
test.skip = pwTestFnWithFixtures.skip
test.setTimeout = pwTestFnWithFixtures.setTimeout
test.fixme = pwTestFnWithFixtures.fixme as unknown as ZooTest
test.only = pwTestFnWithFixtures.only
test.fail = pwTestFnWithFixtures.fail
test.slow = pwTestFnWithFixtures.slow
test.beforeAll = pwTestFnWithFixtures.beforeAll
test.afterAll = pwTestFnWithFixtures.afterAll
test.use = pwTestFnWithFixtures.use
test.expect = pwTestFnWithFixtures.expect
test.extend = pwTestFnWithFixtures.extend
test.info = pwTestFnWithFixtures.info
