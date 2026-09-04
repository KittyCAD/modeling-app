import { devices, expect, test as playwrightTest } from '@playwright/test'

const usePersistentWebKitContext =
  process.env.PLAYWRIGHT_WEBKIT_PERSISTENT_CONTEXT === '1'

const { defaultBrowserType: _defaultBrowserType, ...desktopSafari } =
  devices['Desktop Safari']

const persistentWebKitTest = playwrightTest.extend({
  context: async (
    { baseURL, browserName, headless, launchOptions, playwright },
    use
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
      await use(context)
    } finally {
      await context.close()
    }
  },
  page: async ({ context }, use) => {
    const page = context.pages()[0] ?? (await context.newPage())
    await use(page)
  },
})

const test = usePersistentWebKitContext ? persistentWebKitTest : playwrightTest

export { expect, test }
