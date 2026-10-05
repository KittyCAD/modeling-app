import { setup } from '@e2e/playwright/test-utils'
import { expect, test } from '@playwright/test'

test(
  'initializes web fixture storage after an opaque startup document',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('data:text/html,<title>Opaque startup</title>')

    await setup(context, page, testInfo)
    expect(errors).toEqual([])

    const fixtureUrl = 'http://localhost:3000/fixture-storage-regression'
    await context.route(fixtureUrl, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>Storage fixture</title>',
      })
    )
    await page.goto(fixtureUrl)
    expect(await page.evaluate(() => localStorage.getItem('playwright'))).toBe(
      'true'
    )
    expect(errors).toEqual([])
  }
)
