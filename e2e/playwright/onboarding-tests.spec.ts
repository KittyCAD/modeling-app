import { test, expect } from './zoo-test'
import { join } from 'path'
import fsp from 'fs/promises'
import {
  getUtils,
  executorInputPath,
  createProject,
  settingsToToml,
  orRunWhenFullSuiteEnabled,
} from './test-utils'
import { bracket } from 'lib/exampleKcl'
import { onboardingPaths } from 'routes/Onboarding/paths'
import {
  TEST_SETTINGS_KEY,
  TEST_SETTINGS_ONBOARDING_START,
  TEST_SETTINGS_ONBOARDING_EXPORT,
  TEST_SETTINGS_ONBOARDING_USER_MENU,
} from './storageStates'
import { expectPixelColor } from './fixtures/sceneFixture'

// Because our default test settings have the onboardingStatus set to 'dismissed',
// we must set it to empty for the tests where we want to see the onboarding immediately.

test.describe('Onboarding tests', () => {
  test('Onboarding code is shown in the editor', async ({
    page,
    homePage,
    tronApp,
  }) => {
    if (!tronApp) {
      fail()
    }
    await tronApp.cleanProjectDir({
      app: {
        onboarding_status: '',
      },
    })

    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()

    // Test that the onboarding pane loaded
    await expect(page.getByText('Welcome to Modeling App! This')).toBeVisible()

    // Test that the onboarding pane loaded
    await expect(page.getByText('Welcome to Modeling App! This')).toBeVisible()

    // *and* that the code is shown in the editor
    await expect(page.locator('.cm-content')).toContainText('// Shelf Bracket')

    // Make sure the model loaded
    const XYPlanePoint = { x: 774, y: 116 } as const
    const modelColor: [number, number, number] = [45, 45, 45]
    await page.mouse.move(XYPlanePoint.x, XYPlanePoint.y)
    expect(await u.getGreatestPixDiff(XYPlanePoint, modelColor)).toBeLessThan(8)
  })

  test(
    'Desktop: fresh onboarding executes and loads',
    {
      tag: '@electron',
    },
    async ({ page, tronApp }) => {
      if (!tronApp) {
        fail()
      }
      await tronApp.cleanProjectDir({
        app: {
          onboarding_status: '',
        },
      })
      const u = await getUtils(page)

      const viewportSize = { width: 1200, height: 500 }
      await page.setBodyDimensions(viewportSize)

      await test.step(`Create a project and open to the onboarding`, async () => {
        await createProject({ name: 'project-link', page })
        await test.step(`Ensure the engine connection works by testing the sketch button`, async () => {
          await u.waitForPageLoad()
        })
      })

      await test.step(`Ensure we see the onboarding stuff`, async () => {
        // Test that the onboarding pane loaded
        await expect(
          page.getByText('Welcome to Modeling App! This')
        ).toBeVisible()

        // *and* that the code is shown in the editor
        await expect(page.locator('.cm-content')).toContainText(
          '// Shelf Bracket'
        )

        // TODO: jess make less shit
        // Make sure the model loaded
        //const XYPlanePoint = { x: 986, y: 522 } as const
        //const modelColor: [number, number, number] = [76, 76, 76]
        //await page.mouse.move(XYPlanePoint.x, XYPlanePoint.y)

        //await expectPixelColor(page, modelColor, XYPlanePoint, 8)
      })
    }
  )

  test('Code resets after confirmation', async ({
    context,
    page,
    homePage,
    tronApp,
    scene,
    cmdBar,
  }) => {
    if (!tronApp) {
      fail()
    }
    await tronApp.cleanProjectDir()

    const initialCode = `sketch001 = startSketchOn('XZ')`

    // Load the page up with some code so we see the confirmation warning
    // when we go to replay onboarding
    await page.addInitScript((code) => {
      localStorage.setItem('persistCode', code)
    }, initialCode)

    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()
    await scene.connectionEstablished()

    // Replay the onboarding
    await page.getByRole('link', { name: 'Settings' }).last().click()
    const replayButton = page.getByRole('button', {
      name: 'Replay onboarding',
    })
    await expect(replayButton).toBeVisible()
    await replayButton.click()

    // Ensure we see the warning, and that the code has not yet updated
    await expect(page.getByText('Would you like to create')).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(initialCode)

    const nextButton = page.getByTestId('onboarding-next')
    await nextButton.hover()
    await nextButton.click()

    // Ensure we see the introduction and that the code has been reset
    await expect(page.getByText('Welcome to Modeling App!')).toBeVisible()
    await expect(page.locator('.cm-content')).toContainText('// Shelf Bracket')

    // There used to be old code here that checked if we stored the reset
    // code into localStorage but that isn't the case on desktop. It gets
    // saved to the file system, which we have other tests for.
  })

  test('Click through each onboarding step and back', async ({
    context,
    page,
    homePage,
    tronApp,
  }) => {
    if (!tronApp) {
      fail()
    }
    await tronApp.cleanProjectDir({
      app: {
        onboarding_status: '',
      },
    })
    // Override beforeEach test setup
    await context.addInitScript(
      async ({ settingsKey, settings }) => {
        // Give no initial code, so that the onboarding start is shown immediately
        localStorage.setItem('persistCode', '')
        localStorage.setItem(settingsKey, settings)
      },
      {
        settingsKey: TEST_SETTINGS_KEY,
        settings: settingsToToml({
          settings: TEST_SETTINGS_ONBOARDING_START,
        }),
      }
    )

    await page.setBodyDimensions({ width: 1200, height: 1080 })
    await homePage.goToModelingScene()

    // Test that the onboarding pane loaded
    await expect(page.getByText('Welcome to Modeling App! This')).toBeVisible()

    const nextButton = page.getByTestId('onboarding-next')
    const prevButton = page.getByTestId('onboarding-prev')

    while ((await nextButton.innerText()) !== 'Finish') {
      await nextButton.hover()
      await nextButton.click()
    }

    while ((await prevButton.innerText()) !== 'Dismiss') {
      await prevButton.hover()
      await prevButton.click()
    }

    // Dismiss the onboarding
    await prevButton.hover()
    await prevButton.click()

    // Test that the onboarding pane is gone
    await expect(page.getByTestId('onboarding-content')).not.toBeVisible()
    await expect.poll(() => page.url()).not.toContain('/onboarding')
  })

  test('Onboarding redirects and code updating', async ({
    context,
    page,
    homePage,
    tronApp,
  }) => {
    if (!tronApp) {
      fail()
    }
    await tronApp.cleanProjectDir({
      app: {
        onboarding_status: '/export',
      },
    })

    const originalCode = 'sigmaAllow = 15000'

    // Override beforeEach test setup
    await context.addInitScript(
      async ({ settingsKey, settings }) => {
        // Give some initial code, so we can test that it's cleared
        localStorage.setItem('persistCode', originalCode)
        localStorage.setItem(settingsKey, settings)
      },
      {
        settingsKey: TEST_SETTINGS_KEY,
        settings: settingsToToml({
          settings: TEST_SETTINGS_ONBOARDING_EXPORT,
        }),
      }
    )

    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()

    // Test that the redirect happened
    await expect.poll(() => page.url()).toContain('/onboarding/export')

    // Test that you come back to this page when you refresh
    await page.reload()
    await expect.poll(() => page.url()).toContain('/onboarding/export')

    // Test that the code changes when you advance to the next step
    await page.getByTestId('onboarding-next').hover()
    await page.getByTestId('onboarding-next').click()

    // Test that the onboarding pane loaded
    const title = page.locator('[data-testid="onboarding-content"]')
    await expect(title).toBeAttached()

    await expect(page.locator('.cm-content')).not.toHaveText(originalCode)

    // Test that the code is not empty when you click on the next step
    await page.locator('[data-testid="onboarding-next"]').hover()
    await page.locator('[data-testid="onboarding-next"]').click()
    await expect(page.locator('.cm-content')).toHaveText(/.+/)
  })

  test('Onboarding code gets reset to demo on Interactive Numbers step', async ({
    page,
    homePage,
    tronApp,
  }) => {
    if (!tronApp) {
      fail()
    }
    await tronApp.cleanProjectDir({
      app: {
        onboarding_status: '/parametric-modeling',
      },
    })

    const u = await getUtils(page)
    const badCode = `// This is bad code we shouldn't see`

    await page.setBodyDimensions({ width: 1200, height: 1080 })
    await homePage.goToModelingScene()

    await expect
      .poll(() => page.url())
      .toContain(onboardingPaths.PARAMETRIC_MODELING)

    const bracketNoNewLines = bracket.replace(/\n/g, '')

    // Check the code got reset on load
    await expect(page.locator('#code-pane')).toBeVisible()
    await expect(u.codeLocator).toHaveText(bracketNoNewLines, {
      timeout: 10_000,
    })

    // Mess with the code again
    await u.codeLocator.selectText()
    await u.codeLocator.fill(badCode)
    await expect(u.codeLocator).toHaveText(badCode)

    // Click to the next step
    await page.locator('[data-testid="onboarding-next"]').hover()
    await page.locator('[data-testid="onboarding-next"]').click()
    await page.waitForURL('**' + onboardingPaths.INTERACTIVE_NUMBERS, {
      waitUntil: 'domcontentloaded',
    })

    // Check that the code has been reset
    await expect(u.codeLocator).toHaveText(bracketNoNewLines)
  })

  // (lee) The two avatar tests are weird because even on main, we don't have
  // anything to do with the avatar inside the onboarding test. Due to the
  // low impact of an avatar not showing I'm changing this to fixme.
  test('Avatar text updates depending on image load success', async ({
    context,
    page,
    homePage,
    tronApp,
  }) => {
    test.fixme(orRunWhenFullSuiteEnabled())
    if (!tronApp) {
      fail()
    }

    await tronApp.cleanProjectDir({
      app: {
        onboarding_status: '',
      },
    })

    // Override beforeEach test setup
    await context.addInitScript(
      async ({ settingsKey, settings }) => {
        localStorage.setItem(settingsKey, settings)
      },
      {
        settingsKey: TEST_SETTINGS_KEY,
        settings: settingsToToml({
          settings: TEST_SETTINGS_ONBOARDING_USER_MENU,
        }),
      }
    )

    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()

    // Test that the text in this step is correct
    const avatarLocator = page.getByTestId('user-sidebar-toggle').locator('img')
    const onboardingOverlayLocator = page
      .getByTestId('onboarding-content')
      .locator('div')
      .nth(1)

    // Expect the avatar to be visible and for the text to reference it
    await expect(avatarLocator).toBeVisible()
    await expect(onboardingOverlayLocator).toBeVisible()
    await expect(onboardingOverlayLocator).toContainText('your avatar')

    // This is to force the avatar to 404.
    // For our test image (only triggers locally. on CI, it's Kurt's /
    // gravatar image )
    await page.route('/cat.jpg', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'text/plain',
        body: 'Not Found!',
      })
    })

    // 404 the CI avatar image
    await page.route('https://lh3.googleusercontent.com/**', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'text/plain',
        body: 'Not Found!',
      })
    })

    await page.reload({ waitUntil: 'domcontentloaded' })

    // Now expect the text to be different
    await expect(avatarLocator).not.toBeVisible()
    await expect(onboardingOverlayLocator).toBeVisible()
    await expect(onboardingOverlayLocator).toContainText('the menu button')
  })

  test("Avatar text doesn't mention avatar when no avatar", async ({
    context,
    page,
    homePage,
    tronApp,
  }) => {
    test.fixme(orRunWhenFullSuiteEnabled())
    if (!tronApp) {
      fail()
    }

    await tronApp.cleanProjectDir({
      app: {
        onboarding_status: '',
      },
    })
    // Override beforeEach test setup
    await context.addInitScript(
      async ({ settingsKey, settings }) => {
        localStorage.setItem(settingsKey, settings)
        localStorage.setItem('FORCE_NO_IMAGE', 'FORCE_NO_IMAGE')
      },
      {
        settingsKey: TEST_SETTINGS_KEY,
        settings: settingsToToml({
          settings: TEST_SETTINGS_ONBOARDING_USER_MENU,
        }),
      }
    )

    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()

    // Test that the text in this step is correct
    const sidebar = page.getByTestId('user-sidebar-toggle')
    const avatar = sidebar.locator('img')
    const onboardingOverlayLocator = page
      .getByTestId('onboarding-content')
      .locator('div')
      .nth(1)

    // Expect the avatar to be visible and for the text to reference it
    await expect(avatar).not.toBeVisible()
    await expect(onboardingOverlayLocator).toBeVisible()
    await expect(onboardingOverlayLocator).toContainText('the menu button')

    // Test we mention what else is in this menu for https://github.com/KittyCAD/modeling-app/issues/2939
    // which doesn't deserver its own full test spun up
    const userMenuFeatures = [
      'manage your account',
      'report a bug',
      'request a feature',
      'sign out',
    ]
    for (const feature of userMenuFeatures) {
      await expect(onboardingOverlayLocator).toContainText(feature)
    }
  })
})

test('Restarting onboarding on desktop takes one attempt', async ({
  context,
  page,
  tronApp,
}) => {
  test.fixme(orRunWhenFullSuiteEnabled())
  if (!tronApp) {
    fail()
  }

  await tronApp.cleanProjectDir({
    app: {
      onboarding_status: 'dismissed',
    },
  })

  await context.folderSetupFn(async (dir) => {
    const routerTemplateDir = join(dir, 'router-template-slate')
    await fsp.mkdir(routerTemplateDir, { recursive: true })
    await fsp.copyFile(
      executorInputPath('router-template-slate.kcl'),
      join(routerTemplateDir, 'main.kcl')
    )
  })

  // Our constants
  const u = await getUtils(page)
  const projectCard = page.getByText('router-template-slate')
  const helpMenuButton = page.getByRole('button', {
    name: 'Help and resources',
  })
  const restartOnboardingButton = page.getByRole('button', {
    name: 'Reset onboarding',
  })
  const nextButton = page.getByTestId('onboarding-next')

  const tutorialProjectIndicator = page
    .getByTestId('project-sidebar-toggle')
    .filter({ hasText: 'Tutorial Project 00' })
  const tutorialModalText = page.getByText('Welcome to Modeling App!')
  const tutorialDismissButton = page.getByRole('button', { name: 'Dismiss' })
  const userMenuButton = page.getByTestId('user-sidebar-toggle')
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

  await test.step('Navigate into project', async () => {
    await expect(
      page.getByRole('heading', { name: 'Your Projects' })
    ).toBeVisible()
    await expect(projectCard).toBeVisible()
    await projectCard.click()
    await u.waitForPageLoad()
  })

  await test.step('Restart the onboarding from help menu', async () => {
    await helpMenuButton.click()
    await restartOnboardingButton.click()

    await nextButton.hover()
    await nextButton.click()
  })

  await test.step('Confirm that the onboarding has restarted', async () => {
    await expect(tutorialProjectIndicator).toBeVisible()
    await expect(tutorialModalText).toBeVisible()
    // Make sure the model loaded
    const XYPlanePoint = { x: 988, y: 523 } as const
    const modelColor: [number, number, number] = [76, 76, 76]

    await page.mouse.move(XYPlanePoint.x, XYPlanePoint.y)
    await expectPixelColor(page, modelColor, XYPlanePoint, 8)
    await tutorialDismissButton.click()
    // Make sure model still there.
    await expectPixelColor(page, modelColor, XYPlanePoint, 8)
  })

  await test.step('Clear code and restart onboarding from settings', async () => {
    await u.openKclCodePanel()
    await expect(u.codeLocator).toContainText('// Shelf Bracket')
    await u.codeLocator.selectText()
    await u.codeLocator.fill('')

    await test.step('Navigate to settings', async () => {
      await userMenuButton.click()
      await userMenuSettingsButton.click()
      await expect(settingsHeading).toBeVisible()
      await expect(restartOnboardingSettingsButton).toBeVisible()
    })

    await restartOnboardingSettingsButton.click()
    // Since the code is empty, we should not see the confirmation dialog
    await expect(nextButton).not.toBeVisible()
    await expect(tutorialProjectIndicator).toBeVisible()
    await expect(tutorialModalText).toBeVisible()
  })
})
