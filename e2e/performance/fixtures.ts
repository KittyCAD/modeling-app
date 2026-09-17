import { token } from '@e2e/playwright/test-utils'
import { expect, test as baseTest } from '@e2e/playwright/zoo-test'
import type { BrowserContext } from '@playwright/test'

const USER_ENDPOINT = 'https://api.dev.zoo.dev/user'

export { expect }

export const test = baseTest.extend<
  { context: BrowserContext },
  { authenticatedUserBody: string }
>({
  authenticatedUserBody: [
    async ({}, provide) => {
      if (!token)
        throw new Error('The performance profile needs a test API token.')
      // Fetch real account data once, before any scored browser is created.
      // Keep it in memory; this fixture attaches no credentials or response bodies.
      const response = await fetch(USER_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      })
      if (
        response.status !== 200 ||
        !response.headers.get('content-type')?.includes('application/json')
      ) {
        throw new Error(
          `Account bootstrap failed with HTTP ${response.status}.`
        )
      }
      await provide(await response.text())
    },
    { scope: 'worker' },
  ],
  context: async ({ context, authenticatedUserBody }, provide, testInfo) => {
    // Reuse the exact successful response, keeping remote authentication latency
    // out of the Home route's feature-gate deadline in each fresh context.
    await context.route(USER_ENDPOINT, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback()
        return
      }
      if (
        (await route.request().headerValue('authorization')) !==
        `Bearer ${token}`
      ) {
        throw new Error('Account request used unexpected credentials.')
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: authenticatedUserBody,
      })
    })
    try {
      await provide(context)
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        const state = await context
          .pages()[0]
          ?.evaluate(() => ({
            route: location.pathname.startsWith('/file/')
              ? 'file'
              : location.pathname === '/home'
                ? 'home'
                : 'other',
            auth: window.app?.auth.actor.getSnapshot().value ?? null,
            features:
              window.app?.userFeatures.actor.getSnapshot().value ?? null,
            authLoading:
              document.querySelector('[data-testid="initial-load"]') !== null,
          }))
          .catch(() => null)
        await testInfo.attach('startup-state', {
          body: JSON.stringify(state ?? null),
          contentType: 'application/json',
        })
      }
      await context.unroute(USER_ENDPOINT)
    }
  },
})
