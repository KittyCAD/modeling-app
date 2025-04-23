import { expect, test } from '@e2e/playwright/zoo-test'

// test file is for testing auth functionality
test.describe('Authentication tests', () => {
  test(
    `The user can sign out and back in`,
    { tag: ['@electron'] },
    async ({ page, homePage, signInPage, toolbar, tronApp }) => {
      if (!tronApp) {
        fail()
      }

      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.projectSection.waitFor()

      await test.step('Click on sign out and expect sign in page', async () => {
        await toolbar.userSidebarButton.click()
        await toolbar.signOutButton.click()
        await expect(signInPage.signInButton).toBeVisible()
      })

      // TODO: fix this, it's not working yet.
      // But doing this in the app doesn't log the user back in. Likely due to the test setup
      // await test.step("Refresh doesn't log the user back in", async () => {
      //   await page.reload()
      //   await expect(signInPage.signInButton).toBeVisible()
      // })

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
    }
  )
})
