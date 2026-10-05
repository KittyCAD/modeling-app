import { devices, expect, test as playwrightTest } from '@playwright/test'
import type { Page } from '@playwright/test'

const usePersistentWebKitContext =
  process.env.PLAYWRIGHT_WEBKIT_PERSISTENT_CONTEXT === '1'

const { defaultBrowserType: _defaultBrowserType, ...desktopSafari } =
  devices['Desktop Safari']

const WEBKIT_OPFS_RESET_PATH = '/__playwright_webkit_opfs_reset__'

async function resetPersistentWebKitOpfs(
  page: Page,
  baseURL: string | undefined
) {
  if (!baseURL) {
    throw new Error('A baseURL is required to reset persistent WebKit OPFS')
  }

  const resetUrl = new URL(WEBKIT_OPFS_RESET_PATH, baseURL).toString()
  await page.route(resetUrl, async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Resetting WebKit test OPFS</title>',
    })
  })

  try {
    await page.goto(resetUrl)
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      for await (const [name] of root.entries()) {
        await root.removeEntry(name, { recursive: true })
      }
    })
    await page.goto('about:blank')
  } finally {
    await page.unroute(resetUrl)
  }
}

const persistentWebKitTest = playwrightTest.extend({
  context: async (
    { baseURL, browserName, headless, launchOptions, playwright },
    provide
  ) => {
    if (browserName !== 'webkit') {
      throw new Error(
        'PLAYWRIGHT_WEBKIT_PERSISTENT_CONTEXT may only be used with WebKit'
      )
    }

    // Playwright WebKit only exposes OPFS in a persistent context. The app
    // initializes its project library from OPFS, so a regular isolated context
    // fails before any web test can start.
    const context = await playwright.webkit.launchPersistentContext('', {
      ...desktopSafari,
      ...launchOptions,
      baseURL,
      headless,
    })

    try {
      const page = context.pages()[0] ?? (await context.newPage())
      // Persistent WebKit OPFS is shared by origin across contexts and even
      // user-data directories, so reset it before each serial WebKit test.
      await resetPersistentWebKitOpfs(page, baseURL)
      await provide(context)
    } finally {
      await context.close()
    }
  },
  page: async ({ context }, provide) => {
    const page = context.pages()[0] ?? (await context.newPage())
    await provide(page)
  },
})

const test = usePersistentWebKitContext ? persistentWebKitTest : playwrightTest

export { expect, test }
