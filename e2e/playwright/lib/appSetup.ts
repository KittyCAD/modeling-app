import { isErrorWhitelisted } from '@e2e/playwright/lib/console-error-whitelist'
import { settingsToToml } from '@e2e/playwright/lib/settingsSupport'
import {
  PLAYWRIGHT_PROJECT_DIRECTORY,
  TEST_SETTINGS,
  TEST_SETTINGS_KEY,
  geometryOnlyForTestTags,
  playwrightPluginSettings,
  playwrightProjectLibraries,
} from '@e2e/playwright/storageStates'
import type { Feature } from '@kittycad/lib'
import type { BrowserContext, Page, Request, TestInfo } from '@playwright/test'
import { expect } from '@playwright/test'
import {
  COOKIE_NAME_PREFIX,
  IS_PLAYWRIGHT_KEY,
  TOKEN_PERSIST_KEY,
  VERCEL_PLAYWRIGHT_TOKEN_QUERY_PARAM,
} from '@src/lib/constants'
import { createLayoutWithMetadata } from '@src/lib/layout'
import { playwrightLayoutConfig } from '@src/lib/layout/configs/playwright'
import { isArray } from '@src/lib/utils'
import dotenv from 'dotenv'
import fsp from 'fs/promises'

const NODE_ENV = process.env.NODE_ENV || 'development'

dotenv.config({ path: [`.env.${NODE_ENV}.local`, `.env.${NODE_ENV}`] })

export const token =
  process.env.VITE_ZOO_API_TOKEN || process.env.VITE_KITTYCAD_API_TOKEN || ''

export const PLAYWRIGHT_LAYOUT_CONFIG_NAME = 'test'

export const PLAYWRIGHT_TEST_SCOPE_KEY = 'playwrightTestScope'

export const PLAYWRIGHT_STORAGE_SCOPE_KEY = 'playwrightStorageScope'

export const PLAYWRIGHT_LAYOUT_SETTINGS = {
  layout: {
    configs: {
      [PLAYWRIGHT_LAYOUT_CONFIG_NAME]: JSON.stringify(
        createLayoutWithMetadata(playwrightLayoutConfig)
      ),
    },
  },
} as const

export const PERSIST_MODELING_CONTEXT = 'persistModelingContext'

export async function waitForAuthentication(page: Page) {
  // A document reload can finish while Auth still hides the Home route.
  try {
    await page.waitForFunction(() => {
      const snapshot = window.app?.auth.actor.getSnapshot()
      return snapshot !== undefined && !snapshot.matches('checkIfLoggedIn')
    })
  } catch (error) {
    let diagnosticTimeout: ReturnType<typeof setTimeout> | undefined
    try {
      // Bound this failure-only read so a renderer hang cannot block cleanup.
      const diagnostic = await Promise.race([
        page
          .evaluate(() => {
            const snapshot = window.app?.auth.actor.getSnapshot()
            return {
              readyState: document.readyState,
              visibility: document.visibilityState,
              focused: document.hasFocus(),
              appPresent: window.app !== undefined,
              authStatus: snapshot?.status ?? null,
              authState: snapshot?.value ?? null,
              didAuth:
                performance.getEntriesByName('code/didAuth', 'mark').length > 0,
              online: navigator.onLine,
            }
          })
          .catch(() => ({ diagnosticUnavailable: true })),
        new Promise<{ diagnosticUnavailable: true }>((resolve) => {
          diagnosticTimeout = setTimeout(
            () => resolve({ diagnosticUnavailable: true }),
            2000
          )
        }),
      ])
      throw new Error(
        `Home authentication readiness failed: ${JSON.stringify(diagnostic)}`,
        { cause: error }
      )
    } finally {
      if (diagnosticTimeout) clearTimeout(diagnosticTimeout)
    }
  }
  expect(
    await page.evaluate(() => window.app.auth.actor.getSnapshot().value),
    'Home startup requires loggedIn authentication'
  ).toBe('loggedIn')
}

export async function waitForAppLoad(page: Page) {
  const home = page.getByTestId('home-section')
  const modelingScene = page.getByRole('button', { name: 'Start Sketch' })
  const continueInBrowser = page.getByTestId('continue-to-web-app-button')
  await expect(home.or(modelingScene).or(continueInBrowser)).toBeVisible({
    timeout: 20_000,
  })
  if (await continueInBrowser.isVisible()) await continueInBrowser.click()
  await expect(home.or(modelingScene)).toBeVisible({ timeout: 20_000 })
  // A completed document navigation does not await the deferred app bootstrap
  // or its settings I/O. Fixture callers need the current, loaded actor.
  await page.waitForFunction(
    () => window.app?.settings.actor.getSnapshot().matches('idle'),
    undefined,
    { timeout: 20_000 }
  )
}

export async function waitForWebKitBillingToSettle(page: Page) {
  if (process.env.PLAYWRIGHT_WEBKIT_PERSISTENT_CONTEXT !== '1') {
    return
  }

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const snapshot = window.app?.billing?.actor.getSnapshot()
          return (
            snapshot?.value === 'waiting' &&
            (snapshot.context.lastFetch !== undefined ||
              snapshot.context.error !== undefined)
          )
        }),
      { timeout: 20_000 }
    )
    .toBe(true)
}

export async function waitForAuth(page: Page) {
  if (process.env.VERCEL_BASE_URL) {
    // set bypass secret for the page's requests based on the hostname
    let secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
    if (secret) {
      await page.route('**/*', async (route, request) => {
        const url = request.url()

        // Only apply to Vercel preview domain
        if (new URL(url).hostname.endsWith('vercel.dev.zoo.dev')) {
          const headers = {
            ...request.headers(),
            'X-Vercel-Protection-Bypass': secret,
          }

          await route.continue({ headers })
        } else {
          await route.continue()
        }
      })
    }

    if (token) {
      // Vercel is external to Playwright, so the token is provided in the URL
      await page.goto(`/?${VERCEL_PLAYWRIGHT_TOKEN_QUERY_PARAM}=${token}`)
      await waitForAppLoad(page)
    }
  }

  await page.goto('/')
  await waitForAppLoad(page)
}

export async function mockClientErrorReports(context: BrowserContext) {
  if (process.env.PLAYWRIGHT_WEBKIT_PERSISTENT_CONTEXT === '1') {
    await context.addInitScript(() => {
      const originalFetch = globalThis.fetch.bind(globalThis)
      globalThis.fetch = async (input, init) => {
        const rawUrl =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url
        const url = new URL(rawUrl, globalThis.location.href)

        // WebKit applies CORS before Playwright can fulfill this cross-origin
        // request, so mock the intentionally triggered report in the page.
        if (url.pathname === '/user/client-errors') {
          return new Response('{}', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }

        return originalFetch(input, init)
      }
    })
    return
  }

  await context.unroute('**/user/client-errors')
  await context.route('**/user/client-errors', async (route) => {
    // Keep intentionally simulated failures from polluting real dev telemetry.
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  })
}

// settingsOverrides may need to be augmented to take more generic items,
// but we'll be strict for now
export async function setup(
  context: BrowserContext,
  page: Page,
  testInfo?: TestInfo,
  userFeatures: readonly Feature[] = [],
  {
    cloudSyncEnabled = false,
    reload = true,
    mockApiRoutes = true,
  }: {
    cloudSyncEnabled?: boolean
    mockApiRoutes?: boolean
    reload?: boolean
  } = {}
) {
  const localRendererEnabled = geometryOnlyForTestTags(testInfo?.tags)
  if (!mockApiRoutes && userFeatures.length > 0)
    throw new Error('userFeatures requires mockApiRoutes to be enabled')

  const testProjectSettings =
    TEST_SETTINGS.project &&
    typeof TEST_SETTINGS.project === 'object' &&
    !isArray(TEST_SETTINGS.project)
      ? TEST_SETTINGS.project
      : undefined

  await context.unroute('**/user/features')
  if (mockApiRoutes) {
    await context.route('**/user/features', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          features: userFeatures.map((id) => ({ id })),
        }),
      })
    })
    await installSlowFsForPlaywright(page)
  } else {
    // Electron reuses its context. Remove previous tests' API interceptions
    // before any init script reloads the app for this live test.
    await context.unroute('**/user/client-errors')
    await page.unroute('**/user/features')
    await page.unroute('**/user/client-errors')
  }

  await page.addInitScript(
    async ({
      token,
      settingsKey,
      settings,
      IS_PLAYWRIGHT_KEY,
      TOKEN_PERSIST_KEY,
      PLAYWRIGHT_TEST_SCOPE_KEY,
      PLAYWRIGHT_STORAGE_SCOPE_KEY,
    }) => {
      // Init scripts also run on opaque startup documents, which cannot use
      // web storage. Electron's file documents still need initialization.
      // Firefox throws SecurityError ("The operation is insecure") for storage
      // access on about:blank / mid-navigation even when origin checks pass.
      if (
        location.protocol === 'about:' ||
        (window.origin === 'null' && location.protocol !== 'file:')
      ) {
        return
      }
      try {
        const testScope = sessionStorage.getItem(PLAYWRIGHT_TEST_SCOPE_KEY)
        const initializedScope = sessionStorage.getItem(
          PLAYWRIGHT_STORAGE_SCOPE_KEY
        )
        if (testScope === null || initializedScope !== testScope) {
          localStorage.clear()
          if (testScope !== null) {
            sessionStorage.setItem(PLAYWRIGHT_STORAGE_SCOPE_KEY, testScope)
          }
        }
        localStorage.setItem(TOKEN_PERSIST_KEY, token)
        localStorage.setItem(settingsKey, settings)
        localStorage.setItem(IS_PLAYWRIGHT_KEY, 'true')
        window.addEventListener('beforeunload', () => {
          localStorage.removeItem(IS_PLAYWRIGHT_KEY)
        })
      } catch (error) {
        // Firefox may throw across compartments where instanceof DOMException fails.
        if ((error as { name?: string } | null)?.name !== 'SecurityError') {
          throw error
        }
      }
    },
    {
      token,
      settingsKey: TEST_SETTINGS_KEY,
      settings: settingsToToml({
        settings: {
          ...TEST_SETTINGS,
          ...(localRendererEnabled === undefined
            ? {}
            : {
                modeling: {
                  ...TEST_SETTINGS.modeling,
                  use_local_renderer: localRendererEnabled,
                },
              }),
          plugins: playwrightPluginSettings({
            cloudSyncEnabled,
            zookeeperEnabled: testInfo?.tags.includes('@zookeeper'),
          }),
          ...PLAYWRIGHT_LAYOUT_SETTINGS,
          app: {
            appearance: {
              ...TEST_SETTINGS.app?.appearance,
              theme: 'dark',
            },
            libraries: playwrightProjectLibraries(),
            onboarding_status: 'dismissed',
          },
          project: {
            ...testProjectSettings,
            directory: PLAYWRIGHT_PROJECT_DIRECTORY,
          },
        },
      }),
      IS_PLAYWRIGHT_KEY,
      TOKEN_PERSIST_KEY,
      PLAYWRIGHT_TEST_SCOPE_KEY,
      PLAYWRIGHT_STORAGE_SCOPE_KEY,
    }
  )

  await context.addCookies([
    {
      name: COOKIE_NAME_PREFIX + 'dev.zoo.dev',
      value: token,
      path: '/',
      domain: 'localhost',
      secure: true,
    },
  ])

  failOnConsoleErrors(page, testInfo)
  // kill animations, speeds up tests and reduced flakiness
  await page.emulateMedia({ reducedMotion: 'reduce' })

  // Electron batches scripts and settings before its final startup navigation.
  if (reload) await page.reload()
}

const slowFsMethodNames = [
  'access',
  'cp',
  'getPath',
  'mkdir',
  'readFile',
  'readdir',
  'rename',
  'rm',
  'stat',
  'writeFile',
] as const

function readNonNegativeIntEnv(name: string) {
  const value = process.env[name]
  if (!value) return 0

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0

  return Math.floor(parsed)
}

async function installSlowFsForPlaywright(page: Page) {
  const delayMs = readNonNegativeIntEnv('E2E_SLOW_FS_MS')
  if (delayMs === 0) return

  const jitterMs = readNonNegativeIntEnv('E2E_SLOW_FS_JITTER_MS')

  await page.addInitScript(
    ({ delayMs, jitterMs, slowFsMethodNames }) => {
      const globalObject = window as any
      const installedKey = '__zooPlaywrightSlowFsInstalled'
      if (globalObject[installedKey]) return

      globalObject[installedKey] = true

      const wrappedKey = Symbol.for('zoo.playwrightSlowFsWrapped')
      const methods = new Set(slowFsMethodNames)

      const delay = () => {
        const jitter =
          jitterMs > 0 ? Math.floor(Math.random() * (jitterMs + 1)) : 0
        return new Promise((resolve) => setTimeout(resolve, delayMs + jitter))
      }

      const looksLikeFsZds = (value: unknown) => {
        if (!value || typeof value !== 'object') return false

        return slowFsMethodNames.every(
          (methodName) => typeof (value as any)[methodName] === 'function'
        )
      }

      const wrapFsZds = <T>(value: T): T => {
        if (!looksLikeFsZds(value)) return value
        if ((value as any)[wrappedKey]) return value

        Object.defineProperty(value, wrappedKey, {
          configurable: false,
          enumerable: false,
          value: true,
        })

        for (const methodName of methods) {
          const original = (value as any)[methodName]
          if (typeof original !== 'function') continue
          ;(value as any)[methodName] = async function (...args: unknown[]) {
            await delay()
            return original.apply(this, args)
          }
        }

        return value
      }

      const originalAssign = Object.assign
      Object.assign = function (target: any, ...sources: any[]) {
        const result = originalAssign.call(Object, target, ...sources)

        if (
          looksLikeFsZds(result) ||
          sources.some((source) => looksLikeFsZds(source))
        ) {
          wrapFsZds(result)
        }

        return result
      }

      let currentFsZds = wrapFsZds(globalObject.fsZds)
      const currentDescriptor = Object.getOwnPropertyDescriptor(
        globalObject,
        'fsZds'
      )

      if (!currentDescriptor || currentDescriptor.configurable) {
        Object.defineProperty(globalObject, 'fsZds', {
          configurable: true,
          enumerable: true,
          get() {
            return currentFsZds
          },
          set(value) {
            currentFsZds = wrapFsZds(value)
          },
        })
      }
    },
    { delayMs, jitterMs, slowFsMethodNames }
  )
}

function failOnConsoleErrors(page: Page, testInfo?: TestInfo) {
  let mainFrameNavigationRequest: Request | undefined
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      mainFrameNavigationRequest = request
    }
  })
  page.on('load', () => {
    mainFrameNavigationRequest = undefined
  })
  page.on('requestfailed', (request) => {
    if (request === mainFrameNavigationRequest) {
      mainFrameNavigationRequest = undefined
    }
  })

  page.on('pageerror', (exception: any) => {
    if (isErrorWhitelisted(exception)) {
      return
    }
    if (
      testInfo?.project.name === 'webkit' &&
      mainFrameNavigationRequest !== undefined &&
      exception.name === 'Cannot load blob' &&
      exception.message.includes('due to access control checks') &&
      exception.stack?.includes('/src/lib/fs-zds/opfs.ts')
    ) {
      // WebKit reports interrupted OPFS reads from the old document as page
      // errors while it unloads; the replacement document is unaffected.
      return
    }
    // Only disable this environment variable if you want to collect console errors
    if (process.env.FAIL_ON_CONSOLE_ERRORS !== 'false') {
      // Use expect to prevent page from closing and not cleaning up
      expect(`An error was detected in the console: \r\n message:${exception.message} \r\n name:${exception.name} \r\n stack:${exception.stack}

        *Either fix the console error or add it to the whitelist defined in ./lib/console-error-whitelist.ts (if the error can be safely ignored)
        `).toEqual('Console error detected')
    } else {
      // Add errors to `test-results/exceptions.txt` as a test artifact
      fsp
        .appendFile(
          './test-results/exceptions.txt',
          [
            '~~~',
            `triggered_by_test:${
              testInfo?.file + ' ' + (testInfo?.title || ' ')
            }`,
            `name:${exception.name}`,
            `message:${exception.message}`,
            `stack:${exception.stack}`,
            `project:${testInfo?.project.name}`,
            '~~~',
          ].join('\n')
        )
        .catch((err) => {
          console.error(err)
        })
    }
  })
}

export const closeOnboardingModalIfPresent = async (page: Page) => {
  const onboardingNotRightNow = page.getByTestId('onboarding-not-right-now')
  await expect(page.getByTestId('stream')).toBeVisible({ timeout: 10_000 })
  if (await onboardingNotRightNow.isVisible()) {
    await onboardingNotRightNow.click()
    await expect(onboardingNotRightNow).toBeHidden()
  }
}
