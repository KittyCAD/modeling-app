import { test, expect } from '@playwright/test'
import * as fsp from 'fs/promises'
import { join } from 'path'
import {
  getUtils,
  setup,
  setupElectron,
  tearDown,
  executorInputPath,
} from './test-utils'
import { SaveSettingsPayload } from 'lib/settings/settingsTypes'
import { TEST_SETTINGS_KEY, TEST_SETTINGS_CORRUPTED } from './storageStates'
import * as TOML from '@iarna/toml'

test.beforeEach(async ({ context, page }) => {
  await setup(context, page)
})

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test.describe('Testing settings', () => {
  test('Stored settings are validated and fall back to defaults', async ({
    page,
  }) => {
    const u = await getUtils(page)

    // Override beforeEach test setup
    // with corrupted settings
    await page.addInitScript(
      async ({ settingsKey, settings }) => {
        localStorage.setItem(settingsKey, settings)
      },
      {
        settingsKey: TEST_SETTINGS_KEY,
        settings: TOML.stringify({ settings: TEST_SETTINGS_CORRUPTED }),
      }
    )

    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    // Check the settings were reset
    const storedSettings = TOML.parse(
      await page.evaluate(
        ({ settingsKey }) => localStorage.getItem(settingsKey) || '',
        { settingsKey: TEST_SETTINGS_KEY }
      )
    ) as { settings: SaveSettingsPayload }

    expect(storedSettings.settings?.app?.theme).toBe(undefined)

    // Check that the invalid settings were removed
    expect(storedSettings.settings?.modeling?.defaultUnit).toBe(undefined)
    expect(storedSettings.settings?.modeling?.mouseControls).toBe(undefined)
    expect(storedSettings.settings?.app?.projectDirectory).toBe(undefined)
    expect(storedSettings.settings?.projects?.defaultProjectName).toBe(
      undefined
    )
  })

  test('Project settings can be set and override user settings', async ({
    page,
  }) => {
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    await u.waitForAuthSkipAppStart()
    await page
      .getByRole('button', { name: 'Start Sketch' })
      .waitFor({ state: 'visible' })

    const paneButtonLocator = page.getByTestId('debug-pane-button')
    const headingLocator = page.getByRole('heading', {
      name: 'Settings',
      exact: true,
    })
    const inputLocator = page.locator('input[name="modeling-showDebugPanel"]')

    // Open the settings modal with the browser keyboard shortcut
    await page.keyboard.press('ControlOrMeta+Shift+,')

    await expect(headingLocator).toBeVisible()
    await page.locator('#showDebugPanel').getByText('OffOn').click()

    // Close it and open again with keyboard shortcut, while KCL editor is focused
    // Put the cursor in the editor
    await test.step('Open settings with keyboard shortcut', async () => {
      await page.getByTestId('settings-close-button').click()
      await page.locator('.cm-content').click()
      await page.keyboard.press('ControlOrMeta+Shift+,')
      await expect(headingLocator).toBeVisible()
    })

    // Verify the toast appeared
    await expect(
      page.getByText(`Set show debug panel to "false" for this project`)
    ).toBeVisible()
    // Check that the theme changed
    await expect(paneButtonLocator).not.toBeVisible()

    // Check that the user setting was not changed
    await page.getByRole('radio', { name: 'User' }).click()
    await expect(inputLocator).toBeChecked()

    // Roll back to default of "off"
    await await page
      .getByText('show debug panelRoll back show debug panelRoll back to match')
      .hover()
    await page
      .getByRole('button', {
        name: 'Roll back show debug panel',
      })
      .click()
    await expect(inputLocator).not.toBeChecked()

    // Check that the project setting did not change
    await page.getByRole('radio', { name: 'Project' }).click()
    await expect(
      page.locator('input[name="modeling-showDebugPanel"]')
    ).not.toBeChecked()
  })

  test('Project and user settings can be reset', async ({ page }) => {
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    await u.waitForAuthSkipAppStart()
    await page
      .getByRole('button', { name: 'Start Sketch' })
      .waitFor({ state: 'visible' })

    const projectSettingsTab = page.getByRole('radio', { name: 'Project' })
    const userSettingsTab = page.getByRole('radio', { name: 'User' })
    const resetButton = page.getByRole('button', {
      name: 'Restore default settings',
    })
    const themeColorSetting = page.locator('#themeColor').getByRole('slider')
    const settingValues = {
      default: '259',
      user: '120',
      project: '50',
    }

    // Open the settings modal with lower-right button
    await page.getByRole('link', { name: 'Settings' }).last().click()
    await expect(
      page.getByRole('heading', { name: 'Settings', exact: true })
    ).toBeVisible()

    await test.step('Set up theme color', async () => {
      // Verify we're looking at the project-level settings,
      // and it's set to default value
      await expect(projectSettingsTab).toBeChecked()
      await expect(themeColorSetting).toHaveValue(settingValues.default)

      // Set project-level value to 50
      await themeColorSetting.fill(settingValues.project)

      // Set user-level value to 120
      await userSettingsTab.click()
      await themeColorSetting.fill(settingValues.user)
      await projectSettingsTab.click()
    })

    await test.step('Reset project settings', async () => {
      // Click the reset settings button.
      await resetButton.click()

      await expect(page.getByText('Settings restored to default')).toBeVisible()
      await expect(
        page.getByText('Settings restored to default')
      ).not.toBeVisible()

      // Verify it is now set to the inherited user value
      await expect(themeColorSetting).toHaveValue(settingValues.default)

      // Check that the user setting also rolled back
      await userSettingsTab.click()
      await expect(themeColorSetting).toHaveValue(settingValues.default)
      await projectSettingsTab.click()

      // Set project-level value to 50 again to test the user-level reset
      await themeColorSetting.fill(settingValues.project)
      await userSettingsTab.click()
    })

    await test.step('Reset user settings', async () => {
      // Change the setting and click the reset settings button.
      await themeColorSetting.fill(settingValues.user)
      await resetButton.click()

      // Verify it is now set to the default value
      await expect(themeColorSetting).toHaveValue(settingValues.default)

      // Check that the project setting also changed
      await projectSettingsTab.click()
      await expect(themeColorSetting).toHaveValue(settingValues.default)
    })
  })

  test(
    `Project settings override user settings on desktop`,
    { tag: '@electron' },
    async ({ browser: _ }, testInfo) => {
      const { electronApp, page } = await setupElectron({
        testInfo,
        folderSetupFn: async (dir) => {
          const bracketDir = join(dir, 'bracket')
          await fsp.mkdir(bracketDir, { recursive: true })
          await fsp.copyFile(
            executorInputPath('focusrite_scarlett_mounting_braket.kcl'),
            join(bracketDir, 'main.kcl')
          )
        },
      })

      await page.setViewportSize({ width: 1200, height: 500 })

      page.on('console', console.log)

      // Selectors and constants
      const userThemeColor = '120'
      const projectThemeColor = '50'
      const settingsOpenButton = page.getByRole('link', {
        name: 'settings Settings',
      })
      const themeColorSetting = page.locator('#themeColor').getByRole('slider')
      const projectSettingsTab = page.getByRole('radio', { name: 'Project' })
      const userSettingsTab = page.getByRole('radio', { name: 'User' })
      const settingsCloseButton = page.getByTestId('settings-close-button')
      const projectLink = page.getByText('bracket')
      const logoLink = page.getByTestId('app-logo')

      // Open the app and set the user theme color
      await test.step('Set user theme color on home', async () => {
        await expect(settingsOpenButton).toBeVisible()
        await settingsOpenButton.click()
        // The user tab should be selected by default on home
        await expect(userSettingsTab).toBeChecked()
        await themeColorSetting.fill(userThemeColor)
        await expect(logoLink).toHaveCSS('--primary-hue', userThemeColor)
        await settingsCloseButton.click()
      })

      await test.step('Set project theme color', async () => {
        // Open the project
        await projectLink.click()
        await settingsOpenButton.click()
        // The project tab should be selected by default within a project
        await expect(projectSettingsTab).toBeChecked()
        await themeColorSetting.fill(projectThemeColor)
        await expect(logoLink).toHaveCSS('--primary-hue', projectThemeColor)
      })

      await test.step('Refresh the application and see project setting applied', async () => {
        await page.reload()

        await expect(logoLink).toHaveCSS('--primary-hue', projectThemeColor)
        await settingsCloseButton.click()
      })

      await test.step(`Navigate back to the home view and see user setting applied`, async () => {
        await logoLink.click()
        await expect(logoLink).toHaveCSS('--primary-hue', userThemeColor)
      })

      await electronApp.close()
    }
  )

  test(
    `Closing settings modal should go back to the original file being viewed`,
    { tag: '@electron' },
    async ({ browser: _ }, testInfo) => {
      const { electronApp, page } = await setupElectron({
        testInfo,
        folderSetupFn: async () => {},
      })

      const {
        panesOpen,
        createAndSelectProject,
        pasteCodeInEditor,
        clickPane,
        createNewFileAndSelect,
        editorTextMatches,
      } = await getUtils(page, test)

      await page.setViewportSize({ width: 1200, height: 500 })
      page.on('console', console.log)

      await panesOpen([])

      await test.step('Precondition: No projects exist', async () => {
        await expect(page.getByTestId('home-section')).toBeVisible()
        const projectLinksPre = page.getByTestId('project-link')
        await expect(projectLinksPre).toHaveCount(0)
      })

      await createAndSelectProject('project-000')

      await clickPane('code')
      const kclCube = await fsp.readFile(
        'src/wasm-lib/tests/executor/inputs/cube.kcl',
        'utf-8'
      )
      await pasteCodeInEditor(kclCube)

      await clickPane('files')
      await createNewFileAndSelect('2.kcl')

      const kclCylinder = await fsp.readFile(
        'src/wasm-lib/tests/executor/inputs/cylinder.kcl',
        'utf-8'
      )
      await pasteCodeInEditor(kclCylinder)

      const settingsOpenButton = page.getByRole('link', {
        name: 'settings Settings',
      })
      const settingsCloseButton = page.getByTestId('settings-close-button')

      await test.step('Open and close settings', async () => {
        await settingsOpenButton.click()
        await settingsCloseButton.click()
      })

      await test.step('Postcondition: Same file content is in editor as before settings opened', async () => {
        await editorTextMatches(kclCylinder)
      })

      await electronApp.close()
    }
  )
})
