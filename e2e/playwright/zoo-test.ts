import { test as playwrightTestFn } from '@playwright/test'
import {
  fixtures,
  Fixtures,
  AuthenticatedTronApp,
  AuthenticatedApp,
} from './fixtures/fixtureSetup'
export { expect, Page, BrowserContext, TestInfo } from '@playwright/test'

// Our custom decorated Zoo test object. Makes it easier to add fixtures, and
// switch between web and electron if needed.
const pwTestFnWithFixtures = playwrightTestFn.extend<Fixtures>(fixtures)

// In JavaScript you cannot replace a function's body only (despite functions
// are themselves objects, which you'd expect a body property or something...)
// So we must redefine the function and then re-attach properties.
export function test(desc, objOrFn, fnMaybe) {
  const hasTestConf = typeof objOrFn === 'object'
  const fn = hasTestConf ? fnMaybe : objOrFn

  return pwTestFnWithFixtures(
    desc,
    hasTestConf ? objOrFn : {},
    async (
      { page, context, cmdBar, editor, toolbar, scene, homePage },
      testInfo
    ) => {
      // To switch to web, use PLATFORM=web environment variable.
      // Only use this for debugging, since the playwright tracer is busted
      // for electron.

      let tronApp;

      if (process.env.PLATFORM === 'web')  {
        tronApp = new AuthenticatedApp(context, page, testInfo)
      } else {
        tronApp = new AuthenticatedTronApp(context, page, testInfo)
      }

      const fixtures: Fixtures = { cmdBar, editor, toolbar, scene, homePage }
      const options = {
        fixtures,
        appSettings: objOrFn?.appSettings,
        cleanProjectDir: objOrFn?.cleanProjectDir,
      }
      await tronApp.initialise(options)

      // We need to patch this because addInitScript will bind too late in our
      // electron tests, never running. We need to call reload() after each call
      // to guarantee it runs.
      const oldContextAddInitScript = tronApp.context.addInitScript
      tronApp.context.addInitScript = async function (a, b) {
        await oldContextAddInitScript.apply(this, [a, b])
        await tronApp.page.reload()
      }

      // No idea why we mix and match page and context's addInitScript but we do
      const oldPageAddInitScript = tronApp.page.addInitScript
      tronApp.page.addInitScript = async function (a, b) {
        await oldPageAddInitScript.apply(this, [a, b])
        await tronApp.page.reload()
      }

      if (tronApp instanceof AuthenticatedTronApp) {
        // Create a consistent way to resize the page across electron and web.
        // (lee) I had to do everyhting in the book to make electron change its
        // damn window size. I succeded in making it consistently and reliably
        // do it after a whole afternoon.
        tronApp.page.setBodyDimensions = async function (dims: {
          width: number
          height: number
        }) {
          await tronApp.electronApp.evaluateHandle(async ({ app }, dims) => {
            await app.resizeWindow(dims.width, dims.height)
          }, dims)

          await tronApp.page.setViewportSize(dims)
          return tronApp.page.evaluate(async (dims) => {
            await window.electron.resizeWindow(dims.width, dims.height)
            window.document.body.style.width = dims.width + 'px'
            window.document.body.style.height = dims.height + 'px'
            window.document.documentElement.style.width = dims.width + 'px'
            window.document.documentElement.style.height = dims.height + 'px'
          }, dims)
        }

        // We need to expose this in order for some tests that require folder
        // creation. Before they used to do this by their own electronSetup({...})
        // calls.
        tronApp.context.folderSetupFn = function (fn) {
          return fn(tronApp.dir).then(() => ({ dir: tronApp.dir }))
        }
      }

      await fn(
        {
          context: tronApp.context,
          page: tronApp.page,
          electronApp: tronApp.electronApp,
          ...fixtures,
        },
        testInfo
      )

      testInfo.tronApp = tronApp
    }
  )
}

test.describe = pwTestFnWithFixtures.describe
test.beforeEach = pwTestFnWithFixtures.beforeEach
test.afterEach = pwTestFnWithFixtures.afterEach
test.step = pwTestFnWithFixtures.step
test.skip = pwTestFnWithFixtures.skip
test.setTimeout = pwTestFnWithFixtures.setTimeout
test.fixme = pwTestFnWithFixtures.fixme
