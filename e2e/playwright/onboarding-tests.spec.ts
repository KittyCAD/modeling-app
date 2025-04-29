import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Onboarding tests', () => {
  test('Desktop onboarding flow works', async ({
    page,
    homePage,
    toolbar,
    editor,
    scene,
    tronApp,
  }) => {
    if (!tronApp) {
      fail()
    }

    // Because our default test settings have the onboardingStatus set to 'dismissed',
    // we must set it to empty for the tests where we want to see the onboarding UI.
    await tronApp.cleanProjectDir({
      app: {
        onboarding_status: '',
      },
    })

    const bracketComment = '// Shelf Bracket'
    const tutorialWelcomHeading = page.getByText(
      'Welcome to Design Studio! This'
    )
    const nextButton = page.getByTestId('onboarding-next')
    const prevButton = page.getByTestId('onboarding-prev')
    const userMenuButton = toolbar.userSidebarButton
    const userMenuSettingsButton = page.getByRole('button', {
      name: 'User settings',
    })
    const settingsHeading = page.getByRole('heading', {
      name: 'Settings',
      exact: true,
    })
    const restartOnboardingSettingsButton = page.getByRole('button', {
      name: 'Replay onboarding',
    })
    const helpMenuButton = page.getByRole('button', {
      name: 'Help and resources',
    })
    const helpMenuRestartOnboardingButton = page.getByRole('button', {
      name: 'Replay onboarding tutorial',
    })
    const postDismissToast = page.getByText(
      'Click the question mark in the lower-right corner if you ever want to redo the tutorial!'
    )

    await test.step('Test initial home page view, showing a tutorial button', async () => {
      await expect(homePage.tutorialBtn).toBeVisible()
      await homePage.expectState({
        projectCards: [],
        sortBy: 'last-modified-desc',
      })
    })

    await test.step('Create a blank project and verify no onboarding chrome is shown', async () => {
      await homePage.goToModelingScene()
      await expect(toolbar.projectName).toContainText('testDefault')
      await expect(tutorialWelcomHeading).not.toBeVisible()
      await editor.expectEditor.toContain('@settings(defaultLengthUnit = in)', {
        shouldNormalise: true,
      })
      await scene.connectionEstablished()
      await expect(toolbar.startSketchBtn).toBeEnabled({ timeout: 15_000 })
    })

    await test.step('Go home and verify we still see the tutorial button, then begin it.', async () => {
      await toolbar.logoLink.click()
      await expect(homePage.tutorialBtn).toBeVisible()
      await homePage.expectState({
        projectCards: [
          {
            title: 'testDefault',
            fileCount: 1,
          },
        ],
        sortBy: 'last-modified-desc',
      })
      await homePage.tutorialBtn.click()
    })

    // This is web-only.
    // TODO: write a new test just for the onboarding in browser
    // await test.step('Ensure the onboarding request toast appears', async () => {
    //   await expect(page.getByTestId('onboarding-toast')).toBeVisible()
    //   await page.getByTestId('onboarding-next').click()
    // })

    await test.step('Ensure we see the welcome screen in a new project', async () => {
      await expect(toolbar.projectName).toContainText('Tutorial Project 00')
      await expect(tutorialWelcomHeading).toBeVisible()
      await editor.expectEditor.toContain(bracketComment)
      await scene.connectionEstablished()
      await expect(toolbar.startSketchBtn).toBeEnabled({ timeout: 15_000 })
    })

    await test.step('Test the clicking through the onboarding flow', async () => {
      await test.step('Going forward', async () => {
        while ((await nextButton.innerText()) !== 'Finish') {
          await nextButton.hover()
          await nextButton.click()
        }
      })

      await test.step('Going backward', async () => {
        while ((await prevButton.innerText()) !== 'Dismiss') {
          await prevButton.hover()
          await prevButton.click()
        }
      })

      // Dismiss the onboarding
      await test.step('Dismiss the onboarding', async () => {
        await prevButton.hover()
        await prevButton.click()
        await expect(page.getByTestId('onboarding-content')).not.toBeVisible()
        await expect(postDismissToast).toBeVisible()
        await expect.poll(() => page.url()).not.toContain('/onboarding')
      })
    })

    await test.step('Resetting onboarding from inside project should always make a new one', async () => {
      await test.step('Reset onboarding from settings', async () => {
        await userMenuButton.click()
        await userMenuSettingsButton.click()
        await expect(settingsHeading).toBeVisible()
        await expect(restartOnboardingSettingsButton).toBeVisible()
        await restartOnboardingSettingsButton.click()
      })

      await test.step('Makes a new project', async () => {
        await expect(toolbar.projectName).toContainText('Tutorial Project 01')
        await expect(tutorialWelcomHeading).toBeVisible()
        await editor.expectEditor.toContain(bracketComment)
        await scene.connectionEstablished()
        await expect(toolbar.startSketchBtn).toBeEnabled({ timeout: 15_000 })
      })

      await test.step('Dismiss the onboarding', async () => {
        await postDismissToast.waitFor({ state: 'detached' })
        await page.keyboard.press('Escape')
        await expect(postDismissToast).toBeVisible()
        await expect(page.getByTestId('onboarding-content')).not.toBeVisible()
        await expect.poll(() => page.url()).not.toContain('/onboarding')
      })
    })

    await test.step('Resetting onboarding from home help menu makes a new project', async () => {
      await test.step('Go home and reset onboarding from lower-right help menu', async () => {
        await toolbar.logoLink.click()
        await expect(homePage.tutorialBtn).not.toBeVisible()
        await homePage.expectState({
          projectCards: [
            { title: 'Tutorial Project 01', fileCount: 1 },
            { title: 'Tutorial Project 00', fileCount: 1 },
            { title: 'testDefault', fileCount: 1 },
          ],
          sortBy: 'last-modified-desc',
        })

        await helpMenuButton.click()
        await helpMenuRestartOnboardingButton.click()
      })

      await test.step('Makes a new project', async () => {
        await expect(toolbar.projectName).toContainText('Tutorial Project 02')
        await expect(tutorialWelcomHeading).toBeVisible()
        await editor.expectEditor.toContain(bracketComment)
        await scene.connectionEstablished()
        await expect(toolbar.startSketchBtn).toBeEnabled({ timeout: 15_000 })
      })
    })
  })
})
