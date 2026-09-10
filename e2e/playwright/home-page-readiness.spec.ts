import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Appearance startup readiness', { tag: '@desktop' }, () => {
  test('waits for authentication while the project list is hidden', async ({
    context,
    page,
    homePage,
  }) => {
    await homePage.waitForAuthentication()
    await homePage.projectsLoaded()
    const user = await page.evaluate(
      () => window.app.auth.actor.getSnapshot().context.user
    )
    expect(user).toBeTruthy()

    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await context.route('**/user', async (route) => {
      await gate
      await route.fulfill({ json: user })
    })

    try {
      // Like Appearance, installing initial code reloads the Electron page.
      await context.addInitScript(() => {
        localStorage.setItem('persistCode', '')
      })
      await expect(page.getByTestId('initial-load')).toBeVisible()

      let authenticationSettled = false
      const authentication = homePage.waitForAuthentication().then(
        () => {
          authenticationSettled = true
        },
        (error: unknown) => {
          authenticationSettled = true
          return error
        }
      )

      // Reproduce the old assertion at its existing timeout, without sleeping.
      await expect(homePage.projectsLoaded()).rejects.toThrow(
        'element(s) not found'
      )
      expect(authenticationSettled).toBe(false)

      release()
      expect(await authentication).toBeUndefined()
      await homePage.projectsLoaded()
    } finally {
      release()
      await context.unroute('**/user')
    }
  })

  test('reports rejected authentication instead of a missing project list', async ({
    context,
    page,
    homePage,
  }) => {
    await context.route('**/user', (route) =>
      route.fulfill({
        status: 401,
        json: { error_code: 'unauthorized', message: 'Test rejects auth' },
      })
    )

    try {
      await page.reload()
      await expect(homePage.waitForAuthentication()).rejects.toThrow(
        'Home startup requires loggedIn authentication'
      )
      expect(
        await page.evaluate(() => window.app.auth.actor.getSnapshot().value)
      ).toBe('loggedOut')
    } finally {
      await context.unroute('**/user')
    }
  })
})
