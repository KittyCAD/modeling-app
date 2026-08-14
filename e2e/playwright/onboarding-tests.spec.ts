import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Onboarding tests', { tag: ['@desktop'] }, () => {
  test('Desktop onboarding flow works', async ({
    page,
    homePage,
    toolbar,
    tronApp,
  }) => {
    if (!tronApp) throw new Error('tronApp is missing.')

    // Because our default test settings have the onboardingStatus set to 'dismissed',
    // we must set it to empty for the tests where we want to see the onboarding UI.
    await tronApp.cleanProjectDir({
      app: {
        onboarding_status: '',
      },
    })

    const tutorialWelcomeHeading = page.getByText(
      'Welcome to Zoo Design Studio'
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
    await test.step('Test initial home page view, showing a tutorial button', async () => {
      await expect(homePage.tutorialBtn).toBeVisible()
      await homePage.tutorialBtn.click()
    })

    await test.step('Ensure we see the welcome screen in a new project', async () => {
      await expect(toolbar.projectName).toContainText('tutorial-project')
      await expect(tutorialWelcomeHeading).toBeVisible()
    })

    await test.step('Test the clicking through the onboarding flow', async () => {
      await test.step('Going forward', async () => {
        while ((await nextButton.innerText()) !== 'Finish') {
          await nextButton.hover()
          await nextButton.click()
          // Clicking too fast fucks everything.
          await new Promise((r) => setTimeout(r, 1000))
        }
      })

      await test.step('Going backward', async () => {
        while ((await prevButton.innerText()) !== 'Dismiss') {
          await prevButton.hover()
          await prevButton.click()
          // Clicking too fast fucks everything.
          await new Promise((r) => setTimeout(r, 1000))
        }
      })

      // Dismiss the onboarding
      await test.step('Dismiss the onboarding', async () => {
        await prevButton.hover()
        await prevButton.click()
        await homePage.expectIsCurrentPage()
        await page.goBack()
        await expect(page).not.toHaveURL(/\/onboarding\//)
        await page.goForward()
        await homePage.expectIsCurrentPage()
      })
    })

    await test.step('Replaying onboarding from settings creates a uniquely named project', async () => {
      await test.step('Replay onboarding from settings', async () => {
        await userMenuButton.click()
        await userMenuSettingsButton.click()
        await expect(settingsHeading).toBeVisible()

        // Resetting too fast is a race and will break the flow.
        await page.waitForTimeout(3000)
        await expect(restartOnboardingSettingsButton).toBeVisible()
        await restartOnboardingSettingsButton.click()
      })

      await test.step('Gets to the onboarding start', async () => {
        await expect(toolbar.projectName).toHaveText('tutorial-project-1')
        await expect(tutorialWelcomeHeading).toBeVisible()
      })

      await test.step('Dismiss the onboarding', async () => {
        await page.keyboard.press('Escape')
        await homePage.expectIsCurrentPage()
      })

      await test.step('Verify the replay project was created', async () => {
        await expect(homePage.tutorialBtn).not.toBeVisible()
        await homePage.expectState({
          projectCards: [
            { title: 'tutorial-project', fileCount: 2 },
            { title: 'tutorial-project-1', fileCount: 1 },
          ],
          sortBy: 'last-modified-desc',
        })
      })
    })

    await test.step('Replaying onboarding from Help creates another uniquely named project', async () => {
      await helpMenuButton.click()
      await helpMenuRestartOnboardingButton.click()

      await test.step('Gets to the onboarding start', async () => {
        await expect(toolbar.projectName).toHaveText('tutorial-project-2')
        await expect(tutorialWelcomeHeading).toBeVisible()
      })

      await test.step('Dismiss the onboarding', async () => {
        await page.keyboard.press('Escape')
        await homePage.expectIsCurrentPage()
      })

      await test.step('Verify another replay project was created', async () => {
        await expect(homePage.tutorialBtn).not.toBeVisible()
        await homePage.expectState({
          projectCards: [
            { title: 'tutorial-project', fileCount: 2 },
            { title: 'tutorial-project-1', fileCount: 1 },
            { title: 'tutorial-project-2', fileCount: 1 },
          ],
          sortBy: 'last-modified-desc',
        })
      })
    })
  })
})
