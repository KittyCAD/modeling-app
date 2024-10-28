import { test, expect } from '@playwright/test'
import { join } from 'path'
import fsp from 'fs/promises'
import {
  getUtils,
  setup,
  setupElectron,
  tearDown,
  executorInputPath,
} from './test-utils'
import { bracket } from 'lib/exampleKcl'
import { onboardingPaths } from 'routes/Onboarding/paths'
import {
  TEST_SETTINGS_KEY,
  TEST_SETTINGS_ONBOARDING_START,
  TEST_SETTINGS_ONBOARDING_EXPORT,
  TEST_SETTINGS_ONBOARDING_PARAMETRIC_MODELING,
  TEST_SETTINGS_ONBOARDING_USER_MENU,
} from './storageStates'
import * as TOML from '@iarna/toml'

test.beforeEach(async ({ context, page }, testInfo) => {
  if (testInfo.tags.includes('@electron')) {
    return
  }
  await setup(context, page)
})

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test.describe('Onboarding tests', () => {
  test('Onboarding code is shown in the editor', async ({ page }) => {
    const u = await getUtils(page)

    // Override beforeEach test setup
    await page.addInitScript(
      async ({ settingsKey }) => {
        // Give no initial code, so that the onboarding start is shown immediately
        localStorage.removeItem('persistCode')
        localStorage.removeItem(settingsKey)
      },
      { settingsKey: TEST_SETTINGS_KEY }
    )

    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    // Test that the onboarding pane loaded
    await expect(page.getByText('Welcome to Modeling App! This')).toBeVisible()

    // *and* that the code is shown in the editor
    await expect(page.locator('.cm-content')).toContainText('// Shelf Bracket')
  })

  test(
    'Desktop: fresh onboarding executes and loads',
    { tag: '@electron' },
    async ({ browserName: _ }, testInfo) => {
      const { electronApp, page } = await setupElectron({
        testInfo,
        appSettings: {
          app: {
            onboardingStatus: 'incomplete',
          },
        },
        cleanProjectDir: true,
      })

      const u = await getUtils(page)

      const viewportSize = { width: 1200, height: 500 }
      await page.setViewportSize(viewportSize)

      // Locators and constants
      const newProjectButton = page.getByRole('button', { name: 'New project' })
      const projectLink = page.getByTestId('project-link')

      await test.step(`Create a project and open to the onboarding`, async () => {
        await newProjectButton.click()
        await projectLink.click()
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
      })

      await electronApp.close()
    }
  )

  test('Code resets after confirmation', async ({ page }) => {
    const initialCode = `sketch001 = startSketchOn('XZ')`

    // Load the page up with some code so we see the confirmation warning
    // when we go to replay onboarding
    await page.addInitScript((code) => {
      localStorage.setItem('persistCode', code)
    }, initialCode)

    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    await u.waitForAuthSkipAppStart()

    // Replay the onboarding
    await page.getByRole('link', { name: 'Settings' }).last().click()
    const replayButton = page.getByRole('button', { name: 'Replay onboarding' })
    await expect(replayButton).toBeVisible()
    await replayButton.click()

    // Ensure we see the warning, and that the code has not yet updated
    await expect(
      page.getByText('Replaying onboarding resets your code')
    ).toBeVisible()
    await expect(page.locator('.cm-content')).toHaveText(initialCode)

    const nextButton = page.getByTestId('onboarding-next')
    await expect(nextButton).toBeVisible()
    await nextButton.click()

    // Ensure we see the introduction and that the code has been reset
    await expect(page.getByText('Welcome to Modeling App!')).toBeVisible()
    await expect(page.locator('.cm-content')).toContainText('// Shelf Bracket')

    // Ensure we persisted the code to local storage.
    // Playwright's addInitScript method unfortunately will reset
    // this code if we try reloading the page as a test,
    // so this is our best way to test persistence afaik.
    expect(
      await page.evaluate(() => {
        return localStorage.getItem('persistCode')
      })
    ).toContain('// Shelf Bracket')
  })

  test('Click through each onboarding step', async ({ page }) => {
    const u = await getUtils(page)

    // Override beforeEach test setup
    await page.addInitScript(
      async ({ settingsKey, settings }) => {
        // Give no initial code, so that the onboarding start is shown immediately
        localStorage.setItem('persistCode', '')
        localStorage.setItem(settingsKey, settings)
      },
      {
        settingsKey: TEST_SETTINGS_KEY,
        settings: TOML.stringify({ settings: TEST_SETTINGS_ONBOARDING_START }),
      }
    )

    await page.setViewportSize({ width: 1200, height: 1080 })

    await u.waitForAuthSkipAppStart()

    // Test that the onboarding pane loaded
    await expect(page.getByText('Welcome to Modeling App! This')).toBeVisible()

    const nextButton = page.getByTestId('onboarding-next')

    while ((await nextButton.innerText()) !== 'Finish') {
      await expect(nextButton).toBeVisible()
      await nextButton.click()
    }

    // Finish the onboarding
    await expect(nextButton).toBeVisible()
    await nextButton.click()

    // Test that the onboarding pane is gone
    await expect(page.getByTestId('onboarding-content')).not.toBeVisible()
    await expect(page.url()).not.toContain('onboarding')
  })

  test('Onboarding redirects and code updating', async ({ page }) => {
    const u = await getUtils(page)

    // Override beforeEach test setup
    await page.addInitScript(
      async ({ settingsKey, settings }) => {
        // Give some initial code, so we can test that it's cleared
        localStorage.setItem('persistCode', 'sigmaAllow = 15000')
        localStorage.setItem(settingsKey, settings)
      },
      {
        settingsKey: TEST_SETTINGS_KEY,
        settings: TOML.stringify({ settings: TEST_SETTINGS_ONBOARDING_EXPORT }),
      }
    )

    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    // Test that the redirect happened
    await expect(page.url().split(':3000').slice(-1)[0]).toBe(
      `/file/%2Fbrowser%2Fmain.kcl/onboarding/export`
    )

    // Test that you come back to this page when you refresh
    await page.reload()
    await expect(page.url().split(':3000').slice(-1)[0]).toBe(
      `/file/%2Fbrowser%2Fmain.kcl/onboarding/export`
    )

    // Test that the onboarding pane loaded
    const title = page.locator('[data-testid="onboarding-content"]')
    await expect(title).toBeAttached()

    // Test that the code changes when you advance to the next step
    await page.locator('[data-testid="onboarding-next"]').click()
    await expect(page.locator('.cm-content')).toHaveText('')

    // Test that the code is not empty when you click on the next step
    await page.locator('[data-testid="onboarding-next"]').click()
    await expect(page.locator('.cm-content')).toHaveText(/.+/)
  })

  test('Onboarding code gets reset to demo on Interactive Numbers step', async ({
    page,
  }) => {
    test.skip(
      process.platform === 'darwin',
      "Skip on macOS, because Playwright isn't behaving the same as the actual browser"
    )
    const u = await getUtils(page)
    const badCode = `// This is bad code we shouldn't see`
    // Override beforeEach test setup
    await page.addInitScript(
      async ({ settingsKey, settings, badCode }) => {
        localStorage.setItem('persistCode', badCode)
        localStorage.setItem(settingsKey, settings)
      },
      {
        settingsKey: TEST_SETTINGS_KEY,
        settings: TOML.stringify({
          settings: TEST_SETTINGS_ONBOARDING_PARAMETRIC_MODELING,
        }),
        badCode,
      }
    )

    await page.setViewportSize({ width: 1200, height: 1080 })
    await u.waitForAuthSkipAppStart()

    await page.waitForURL('**' + onboardingPaths.PARAMETRIC_MODELING, {
      waitUntil: 'domcontentloaded',
    })

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
    await page.locator('[data-testid="onboarding-next"]').click()
    await page.waitForURL('**' + onboardingPaths.INTERACTIVE_NUMBERS, {
      waitUntil: 'domcontentloaded',
    })

    // Check that the code has been reset
    await expect(u.codeLocator).toHaveText(bracketNoNewLines)
  })

  test('Avatar text updates depending on image load success', async ({
    page,
  }) => {
    // Override beforeEach test setup
    await page.addInitScript(
      async ({ settingsKey, settings }) => {
        localStorage.setItem(settingsKey, settings)
      },
      {
        settingsKey: TEST_SETTINGS_KEY,
        settings: TOML.stringify({
          settings: TEST_SETTINGS_ONBOARDING_USER_MENU,
        }),
      }
    )

    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    await u.waitForAuthSkipAppStart()

    await page.waitForURL('**/file/**', { waitUntil: 'domcontentloaded' })

    // Test that the text in this step is correct
    const avatarLocator = await page
      .getByTestId('user-sidebar-toggle')
      .locator('img')
    const onboardingOverlayLocator = await page
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
    page,
  }) => {
    // Override beforeEach test setup
    await page.addInitScript(
      async ({ settingsKey, settings }) => {
        localStorage.setItem(settingsKey, settings)
        localStorage.setItem('FORCE_NO_IMAGE', 'FORCE_NO_IMAGE')
      },
      {
        settingsKey: TEST_SETTINGS_KEY,
        settings: TOML.stringify({
          settings: TEST_SETTINGS_ONBOARDING_USER_MENU,
        }),
      }
    )

    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    await u.waitForAuthSkipAppStart()

    await page.waitForURL('**/file/**', { waitUntil: 'domcontentloaded' })

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

test(
  'Restarting onboarding on desktop takes one attempt',
  { tag: '@electron' },
  async ({ browser: _ }, testInfo) => {
    const { electronApp, page } = await setupElectron({
      testInfo,
      folderSetupFn: async (dir) => {
        const routerTemplateDir = join(dir, 'router-template-slate')
        await fsp.mkdir(routerTemplateDir, { recursive: true })
        await fsp.copyFile(
          executorInputPath('router-template-slate.kcl'),
          join(routerTemplateDir, 'main.kcl')
        )
      },
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
    const restartConfirmationButton = page.getByRole('button', {
      name: 'Make a new project',
    })
    const tutorialProjectIndicator = page.getByText('Tutorial Project 00')
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
      await page.setViewportSize({ width: 1200, height: 500 })

      page.on('console', console.log)

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

      await expect(restartConfirmationButton).toBeVisible()
      await restartConfirmationButton.click()
    })

    await test.step('Confirm that the onboarding has restarted', async () => {
      await expect(tutorialProjectIndicator).toBeVisible()
      await expect(tutorialModalText).toBeVisible()
      await tutorialDismissButton.click()
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
      await expect(restartConfirmationButton).not.toBeVisible()
      await expect(tutorialProjectIndicator).toBeVisible()
      await expect(tutorialModalText).toBeVisible()
    })

    await electronApp.close()
  }
)
