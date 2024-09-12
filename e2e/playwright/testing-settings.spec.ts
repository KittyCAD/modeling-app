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
import { SaveSettingsPayload, SettingsLevel } from 'lib/settings/settingsTypes'
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

  test('Keybindings display the correct hotkey for Command Palette', async ({
    page,
  }) => {
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    await u.waitForAuthSkipAppStart()

    await test.step('Open keybindings settings', async () => {
      // Open the settings modal with the browser keyboard shortcut
      await page.keyboard.press('ControlOrMeta+Shift+,')

      // Go to Keybindings tab.
      const keybindingsTab = page.getByRole('radio', { name: 'Keybindings' })
      await keybindingsTab.click()
    })

    // Go to the hotkey for Command Palette.
    const commandPalette = page.getByText('Toggle Command Palette')
    await commandPalette.scrollIntoViewIfNeeded()

    // The heading is above it and should be in view now.
    const commandPaletteHeading = page.getByRole('heading', {
      name: 'Command Palette',
    })
    // The hotkey is in a kbd element next to the heading.
    const hotkey = commandPaletteHeading.locator('+ div kbd')
    const text = process.platform === 'darwin' ? 'Command+K' : 'Control+K'
    await expect(hotkey).toHaveText(text)
  })

  test('Project and user settings can be reset', async ({ page }) => {
    const u = await getUtils(page)
    await test.step(`Setup`, async () => {
      await page.setViewportSize({ width: 1200, height: 500 })
      await u.waitForAuthSkipAppStart()
    })

    // Selectors and constants
    const projectSettingsTab = page.getByRole('radio', { name: 'Project' })
    const userSettingsTab = page.getByRole('radio', { name: 'User' })
    const resetButton = (level: SettingsLevel) =>
      page.getByRole('button', {
        name: `Reset ${level}-level settings`,
      })
    const themeColorSetting = page.locator('#themeColor').getByRole('slider')
    const settingValues = {
      default: '259',
      user: '120',
      project: '50',
    }
    const resetToast = (level: SettingsLevel) =>
      page.getByText(`${level}-level settings were reset`)

    await test.step(`Open the settings modal`, async () => {
      await page.getByRole('link', { name: 'Settings' }).last().click()
      await expect(
        page.getByRole('heading', { name: 'Settings', exact: true })
      ).toBeVisible()
    })

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
      await resetButton('project').click()

      await expect(resetToast('project')).toBeVisible()
      await expect(resetToast('project')).not.toBeVisible()

      // Verify it is now set to the inherited user value
      await expect(themeColorSetting).toHaveValue(settingValues.user)

      await test.step(`Check that the user settings did not change`, async () => {
        await userSettingsTab.click()
        await expect(themeColorSetting).toHaveValue(settingValues.user)
      })

      await test.step(`Set project-level again to test the user-level reset`, async () => {
        await projectSettingsTab.click()
        await themeColorSetting.fill(settingValues.project)
        await userSettingsTab.click()
      })
    })

    await test.step('Reset user settings', async () => {
      // Click the reset settings button.
      await resetButton('user').click()

      await expect(resetToast('user')).toBeVisible()
      await expect(resetToast('user')).not.toBeVisible()

      // Verify it is now set to the default value
      await expect(themeColorSetting).toHaveValue(settingValues.default)

      await test.step(`Check that the project settings did not change`, async () => {
        await projectSettingsTab.click()
        await expect(themeColorSetting).toHaveValue(settingValues.project)
      })
    })
  })

  test(
    `Project settings override user settings on desktop`,
    { tag: '@electron' },
    async ({ browser: _ }, testInfo) => {
      test.skip(
        process.platform === 'win32',
        'TODO: remove this skip https://github.com/KittyCAD/modeling-app/issues/3557'
      )
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
        await page.reload({ waitUntil: 'domcontentloaded' })

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
    `Load desktop app with no settings file`,
    { tag: '@electron' },
    async ({ browser: _ }, testInfo) => {
      const { electronApp, page } = await setupElectron({
        // This is what makes no settings file get created
        cleanProjectDir: false,
        testInfo,
      })

      await page.setViewportSize({ width: 1200, height: 500 })

      // Selectors and constants
      const errorHeading = page.getByRole('heading', {
        name: 'An unextected error occurred',
      })
      const projectDirLink = page.getByText('Loaded from')

      // If the app loads without exploding we're in the clear
      await expect(errorHeading).not.toBeVisible()
      await expect(projectDirLink).toBeVisible()

      await electronApp.close()
    }
  )

  test(
    `Load desktop app with a settings file, but no project directory setting`,
    { tag: '@electron' },
    async ({ browser: _ }, testInfo) => {
      const { electronApp, page } = await setupElectron({
        testInfo,
        appSettings: {
          app: {
            themeColor: '259',
          },
        },
      })

      await page.setViewportSize({ width: 1200, height: 500 })

      // Selectors and constants
      const errorHeading = page.getByRole('heading', {
        name: 'An unextected error occurred',
      })
      const projectDirLink = page.getByText('Loaded from')

      // If the app loads without exploding we're in the clear
      await expect(errorHeading).not.toBeVisible()
      await expect(projectDirLink).toBeVisible()

      await electronApp.close()
    }
  )

  test(
    `Closing settings modal should go back to the original file being viewed`,
    { tag: '@electron' },
    async ({ browser: _ }, testInfo) => {
      const { electronApp, page } = await setupElectron({
        testInfo,
        folderSetupFn: async (dir) => {
          const bracketDir = join(dir, 'project-000')
          await fsp.mkdir(bracketDir, { recursive: true })
          await fsp.copyFile(
            executorInputPath('cube.kcl'),
            join(bracketDir, 'main.kcl')
          )
          await fsp.copyFile(
            executorInputPath('cylinder.kcl'),
            join(bracketDir, '2.kcl')
          )
        },
      })
      const kclCube = await fsp.readFile(executorInputPath('cube.kcl'), 'utf-8')
      const kclCylinder = await fsp.readFile(
        executorInputPath('cylinder.kcl'),
        'utf8'
      )

      const {
        openKclCodePanel,
        openFilePanel,
        waitForPageLoad,
        selectFile,
        editorTextMatches,
      } = await getUtils(page, test)

      await page.setViewportSize({ width: 1200, height: 500 })
      page.on('console', console.log)

      await test.step('Precondition: Open to second project file', async () => {
        await expect(page.getByTestId('home-section')).toBeVisible()
        await page.getByText('project-000').click()
        await waitForPageLoad()
        await openKclCodePanel()
        await openFilePanel()
        await editorTextMatches(kclCube)

        await selectFile('2.kcl')
        await editorTextMatches(kclCylinder)
      })

      const settingsOpenButton = page.getByRole('link', {
        name: 'settings Settings',
      })
      const settingsCloseButton = page.getByTestId('settings-close-button')

      await test.step('Open and close settings', async () => {
        await settingsOpenButton.click()
        await expect(
          page.getByRole('heading', { name: 'Settings', exact: true })
        ).toBeVisible()
        await settingsCloseButton.click()
      })

      await test.step('Postcondition: Same file content is in editor as before settings opened', async () => {
        await editorTextMatches(kclCylinder)
      })

      await electronApp.close()
    }
  )

  test('Changing modeling default unit', async ({ page }) => {
    const u = await getUtils(page)
    await test.step(`Test setup`, async () => {
      await page.setViewportSize({ width: 1200, height: 500 })
      await u.waitForAuthSkipAppStart()
      await page
        .getByRole('button', { name: 'Start Sketch' })
        .waitFor({ state: 'visible' })
    })

    // Selectors and constants
    const userSettingsTab = page.getByRole('radio', { name: 'User' })
    const projectSettingsTab = page.getByRole('radio', { name: 'Project' })
    const defaultUnitSection = page.getByText(
      'default unitRoll back default unitRoll back to match'
    )
    const defaultUnitRollbackButton = page.getByRole('button', {
      name: 'Roll back default unit',
    })

    await test.step(`Open the settings modal`, async () => {
      await page.getByRole('link', { name: 'Settings' }).last().click()
      await expect(
        page.getByRole('heading', { name: 'Settings', exact: true })
      ).toBeVisible()
    })

    await test.step(`Reset unit setting`, async () => {
      await userSettingsTab.click()
      await defaultUnitSection.hover()
      await defaultUnitRollbackButton.click()
      await projectSettingsTab.click()
    })

    await test.step('Change modeling default unit within project tab', async () => {
      const changeUnitOfMeasureInProjectTab = async (unitOfMeasure: string) => {
        await test.step(`Set modeling default unit to ${unitOfMeasure}`, async () => {
          await page
            .getByTestId('modeling-defaultUnit')
            .selectOption(`${unitOfMeasure}`)
          const toastMessage = page.getByText(
            `Set default unit to "${unitOfMeasure}" for this project`
          )
          await expect(toastMessage).toBeVisible()
        })
      }
      await changeUnitOfMeasureInProjectTab('in')
      await changeUnitOfMeasureInProjectTab('ft')
      await changeUnitOfMeasureInProjectTab('yd')
      await changeUnitOfMeasureInProjectTab('mm')
      await changeUnitOfMeasureInProjectTab('cm')
      await changeUnitOfMeasureInProjectTab('m')
    })

    // Go to the user tab
    await userSettingsTab.click()
    await test.step('Change modeling default unit within user tab', async () => {
      const changeUnitOfMeasureInUserTab = async (unitOfMeasure: string) => {
        await test.step(`Set modeling default unit to ${unitOfMeasure}`, async () => {
          await page
            .getByTestId('modeling-defaultUnit')
            .selectOption(`${unitOfMeasure}`)
          const toastMessage = page.getByText(
            `Set default unit to "${unitOfMeasure}" as a user default`
          )
          await expect(toastMessage).toBeVisible()
        })
      }
      await changeUnitOfMeasureInUserTab('in')
      await changeUnitOfMeasureInUserTab('ft')
      await changeUnitOfMeasureInUserTab('yd')
      await changeUnitOfMeasureInUserTab('mm')
      await changeUnitOfMeasureInUserTab('cm')
      await changeUnitOfMeasureInUserTab('m')
    })

    // Close settings
    const settingsCloseButton = page.getByTestId('settings-close-button')
    await settingsCloseButton.click()

    await test.step('Change modeling default unit within command bar', async () => {
      const commands = page.getByRole('button', { name: 'Commands' })
      const changeUnitOfMeasureInCommandBar = async (unitOfMeasure: string) => {
        // Open command bar
        await commands.click()
        const settingsModelingDefaultUnitCommand = page.getByText(
          'Settings · modeling · default unit'
        )
        await settingsModelingDefaultUnitCommand.click()

        const commandOption = page.getByRole('option', {
          name: unitOfMeasure,
          exact: true,
        })
        await commandOption.click()

        const toastMessage = page.getByText(
          `Set default unit to "${unitOfMeasure}" for this project`
        )
        await expect(toastMessage).toBeVisible()
      }
      await changeUnitOfMeasureInCommandBar('in')
      await changeUnitOfMeasureInCommandBar('ft')
      await changeUnitOfMeasureInCommandBar('yd')
      await changeUnitOfMeasureInCommandBar('mm')
      await changeUnitOfMeasureInCommandBar('cm')
      await changeUnitOfMeasureInCommandBar('m')
    })

    await test.step('Change modeling default unit within gizmo', async () => {
      const changeUnitOfMeasureInGizmo = async (
        unitOfMeasure: string,
        copy: string
      ) => {
        const gizmo = page.getByRole('button', {
          name: 'Current units are: ',
        })
        await gizmo.click()
        const button = page.getByRole('button', {
          name: copy,
          exact: true,
        })
        await button.click()
        const toastMessage = page.getByText(
          `Set default unit to "${unitOfMeasure}" for this project`
        )
        await expect(toastMessage).toBeVisible()
      }

      await changeUnitOfMeasureInGizmo('in', 'Inches')
      await changeUnitOfMeasureInGizmo('ft', 'Feet')
      await changeUnitOfMeasureInGizmo('yd', 'Yards')
      await changeUnitOfMeasureInGizmo('mm', 'Millimeters')
      await changeUnitOfMeasureInGizmo('cm', 'Centimeters')
      await changeUnitOfMeasureInGizmo('m', 'Meters')
    })
  })

  test('Changing theme in sketch mode', async ({ page }) => {
    const u = await getUtils(page)
    await page.addInitScript(() => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> line([5, 0], %)
  |> line([0, 5], %)
  |> line([-5, 0], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(5, sketch001)
`
      )
    })
    await page.setViewportSize({ width: 1200, height: 500 })

    // Selectors and constants
    const editSketchButton = page.getByRole('button', { name: 'Edit Sketch' })
    const lineToolButton = page.getByTestId('line')
    const segmentOverlays = page.getByTestId('segment-overlay')
    const sketchOriginLocation = { x: 600, y: 250 }
    const darkThemeSegmentColor: [number, number, number] = [215, 215, 215]
    const lightThemeSegmentColor: [number, number, number] = [90, 90, 90]

    await test.step(`Get into sketch mode`, async () => {
      await u.waitForAuthSkipAppStart()
      await page.mouse.click(700, 200)
      await expect(editSketchButton).toBeVisible()
      await editSketchButton.click()

      // We use the line tool as a proxy for sketch mode
      await expect(lineToolButton).toBeVisible()
      await expect(segmentOverlays).toHaveCount(4)
      // but we allow more time to pass for animating to the sketch
      await page.waitForTimeout(1000)
    })

    await test.step(`Check the sketch line color before`, async () => {
      await expect
        .poll(() =>
          u.getGreatestPixDiff(sketchOriginLocation, darkThemeSegmentColor)
        )
        .toBeLessThan(15)
    })

    await test.step(`Change theme to light using command palette`, async () => {
      await page.keyboard.press('ControlOrMeta+K')
      await page.getByRole('option', { name: 'theme' }).click()
      await page.getByRole('option', { name: 'light' }).click()
      await expect(page.getByText('theme to "light"')).toBeVisible()

      // Make sure we haven't left sketch mode
      await expect(lineToolButton).toBeVisible()
    })

    await test.step(`Check the sketch line color after`, async () => {
      await expect
        .poll(() =>
          u.getGreatestPixDiff(sketchOriginLocation, lightThemeSegmentColor)
        )
        .toBeLessThan(15)
    })
  })
})
