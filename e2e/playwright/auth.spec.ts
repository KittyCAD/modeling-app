import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Authentication tests', { tag: '@desktop' }, () => {
  test(`The user can sign out and back in`, async ({
    page,
    homePage,
    signInPage,
    toolbar,
    tronApp,
  }) => {
    if (!tronApp) throw new Error('tronApp is missing.')

    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.projectSection.waitFor()

    await test.step('Click on sign out and expect sign in page', async () => {
      await toolbar.userSidebarButton.click()
      await toolbar.signOutButton.click()
      await expect(signInPage.signInButton).toBeVisible()
    })

    await test.step('Click on sign in and cancel, click again and expect different code', async () => {
      await signInPage.signInButton.click()
      await expect(signInPage.userCode).toBeVisible()
      const firstUserCode = await signInPage.userCode.textContent()
      await signInPage.cancelSignInButton.click()
      await expect(signInPage.signInButton).toBeVisible()

      await signInPage.signInButton.click()
      await expect(signInPage.userCode).toBeVisible()
      const secondUserCode = await signInPage.userCode.textContent()
      expect(secondUserCode).not.toEqual(firstUserCode)
      await signInPage.cancelSignInButton.click()
    })

    await test.step('Press back button and remain on home page', async () => {
      await page.goBack()
      await expect(homePage.projectSection).not.toBeVisible()
      await expect(signInPage.signInButton).toBeVisible()
    })

    await test.step('Sign in, activate, and expect home page', async () => {
      await signInPage.signInButton.click()
      await expect(signInPage.userCode).toBeVisible()
      const userCode = await signInPage.userCode.textContent()
      expect(userCode).not.toBeNull()
      await signInPage.verifyAndConfirmAuth(userCode!)

      // Longer timeout than usual here for the wait on home page
      await expect(homePage.projectSection).toBeVisible({ timeout: 10000 })
    })

    await test.step('Click on sign out and expect sign in page', async () => {
      await toolbar.userSidebarButton.click()
      await toolbar.signOutButton.click()
      await expect(signInPage.signInButton).toBeVisible()
    })
  })

  test('waits for authentication while the project list is hidden', async ({
    context,
    page,
    homePage,
  }) => {
    await homePage.waitForAuthentication()
    const user = await page.evaluate(
      () => window.app.auth.actor.getSnapshot().context.user
    )

    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await context.route('**/user', async (route) => {
      await gate
      await route.fulfill({ json: user })
    })

    try {
      await context.addInitScript(() => {
        localStorage.setItem('persistCode', '')
      })
      await expect(page.getByTestId('initial-load')).toBeVisible()

      let authenticationSettled = false
      const authentication = homePage
        .waitForAuthentication()
        .catch((error: unknown) => error)
        .finally(() => {
          authenticationSettled = true
        })

      // Hold auth beyond the project-list timeout to reproduce the race.
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
    } finally {
      await context.unroute('**/user')
    }
  })
})
