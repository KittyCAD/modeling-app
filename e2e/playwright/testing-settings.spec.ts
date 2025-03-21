import { test, expect } from './zoo-test'
import * as fsp from 'fs/promises'
import { join } from 'path'
import {
  getUtils,
  executorInputPath,
  createProject,
  tomlToSettings,
  TEST_COLORS,
  orRunWhenFullSuiteEnabled,
} from './test-utils'
import { SettingsLevel } from 'lib/settings/settingsTypes'
import { SETTINGS_FILE_NAME, PROJECT_SETTINGS_FILE_NAME } from 'lib/constants'
import {
  TEST_SETTINGS_KEY,
  TEST_SETTINGS_CORRUPTED,
  TEST_SETTINGS,
  TEST_SETTINGS_DEFAULT_THEME,
} from './storageStates'
import { DeepPartial } from 'lib/types'
import { Settings } from '@rust/kcl-lib/bindings/Settings'

test.describe('Testing settings', () => {
  test('Stored settings are validated and fall back to defaults', async ({
    page,
    homePage,
    tronApp,
  }) => {
    if (!tronApp) {
      fail()
    }
    // Override beforeEach test setup
    // with corrupted settings
    await tronApp.cleanProjectDir(
      TEST_SETTINGS_CORRUPTED as DeepPartial<Settings>
    )

    await page.setBodyDimensions({ width: 1200, height: 500 })

    // Check the settings were reset
    const storedSettings = tomlToSettings(
      await page.evaluate(
        ({ settingsKey }) => localStorage.getItem(settingsKey) || '',
        { settingsKey: TEST_SETTINGS_KEY }
      )
    )

    expect(storedSettings.settings?.app?.theme).toBe('dark')

    // Check that the invalid settings were changed to good defaults
    expect(storedSettings.settings?.modeling?.base_unit).toBe('in')
    expect(storedSettings.settings?.modeling?.mouse_controls).toBe('zoo')
    expect(storedSettings.settings?.app?.project_directory).toBe('')
    expect(storedSettings.settings?.project?.default_project_name).toBe(
      'project-$nnn'
    )
  })

  // The behavior is actually broken. Parent always takes precedence
  test('Project settings can be set and override user settings', async ({
    page,
    homePage,
  }) => {
    test.fixme(orRunWhenFullSuiteEnabled())
    const u = await getUtils(page)
    await test.step(`Setup`, async () => {
      await page.setBodyDimensions({ width: 1200, height: 500 })
      await homePage.goToModelingScene()
      await page
        .getByRole('button', { name: 'Start Sketch' })
        .waitFor({ state: 'visible' })
    })

    // Selectors and constants
    const paneButtonLocator = page.getByTestId('debug-pane-button')
    const headingLocator = page.getByRole('heading', {
      name: 'Settings',
      exact: true,
    })
    const inputLocator = page.locator('input[name="app-showDebugPanel"]')

    await test.step('Open settings dialog and set "Show debug panel" to on', async () => {
      await page.keyboard.press('ControlOrMeta+,')
      await expect(headingLocator).toBeVisible()

      /** Test to close https://github.com/KittyCAD/modeling-app/issues/2713 */
      await test.step(`Confirm that this dialog has a solid background`, async () => {
        await expect
          .poll(() => u.getGreatestPixDiff({ x: 600, y: 250 }, [28, 28, 28]), {
            timeout: 1000,
            message:
              'Checking for solid background, should not see default plane colors',
          })
          .toBeLessThan(15)
      })

      await page.locator('#showDebugPanel').getByText('OffOn').click()
    })

    // Close it and open again with keyboard shortcut, while KCL editor is focused
    // Put the cursor in the editor
    await test.step('Open settings with keyboard shortcut', async () => {
      await page.getByTestId('settings-close-button').click()
      await page.locator('.cm-content').click()
      await page.keyboard.press('ControlOrMeta+,')
      await expect(headingLocator).toBeVisible()
    })

    // Verify the toast appeared
    await expect(
      page.getByText(`Set show debug panel to "false" for this project`)
    ).toBeVisible()
    await expect(
      page.getByText(`Set show debug panel to "false" for this project`)
    ).not.toBeVisible()

    // Check that the debug panel button is gone
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
      page.locator('input[name="app-showDebugPanel"]')
    ).not.toBeChecked()
  })

  test('Keybindings display the correct hotkey for Command Palette', async ({
    page,
    homePage,
  }) => {
    // TODO: fix this test on windows after the electron migration
    test.skip(process.platform === 'win32', 'Skip on windows')
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()
    await u.waitForPageLoad()

    await test.step('Open keybindings settings', async () => {
      // Open the settings modal with the keyboard shortcut
      await page.keyboard.press('ControlOrMeta+,')

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

  test('Project and user settings can be reset', async ({ page, homePage }) => {
    test.fixme(orRunWhenFullSuiteEnabled())
    const u = await getUtils(page)
    await test.step(`Setup`, async () => {
      await page.setBodyDimensions({ width: 1200, height: 500 })
      await homePage.goToModelingScene()
      await u.waitForPageLoad()
      await page.waitForTimeout(1000)
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
    { tag: ['@electron', '@skipWin'] },
    async ({ context, page }, testInfo) => {
      test.fixme(orRunWhenFullSuiteEnabled())
      const projectName = 'bracket'
      const { dir: projectDirName } = await context.folderSetupFn(
        async (dir) => {
          const bracketDir = join(dir, projectName)
          await fsp.mkdir(bracketDir, { recursive: true })
          await fsp.copyFile(
            executorInputPath('cylinder-inches.kcl'),
            join(bracketDir, 'main.kcl')
          )
        }
      )

      await page.setBodyDimensions({ width: 1200, height: 500 })

      // Selectors and constants
      const tempProjectSettingsFilePath = join(
        projectDirName,
        projectName,
        PROJECT_SETTINGS_FILE_NAME
      )
      const tempUserSettingsFilePath = join(projectDirName, SETTINGS_FILE_NAME)
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

      await test.step('Set user theme color on home', async () => {
        await expect(settingsOpenButton).toBeVisible()
        await settingsOpenButton.click()
        // The user tab should be selected by default on home
        await expect(userSettingsTab).toBeChecked()
        await themeColorSetting.fill(userThemeColor)
        await expect(logoLink).toHaveCSS('--primary-hue', userThemeColor)
        await settingsCloseButton.click()
        await expect
          .poll(async () => fsp.readFile(tempUserSettingsFilePath, 'utf-8'), {
            message: 'Setting should now be written to the file',
            timeout: 5_000,
          })
          .toContain(`themeColor = "${userThemeColor}"`)
      })

      await test.step('Set project theme color', async () => {
        // Open the project
        await projectLink.click()
        await settingsOpenButton.click()
        // The project tab should be selected by default within a project
        await expect(projectSettingsTab).toBeChecked()
        await themeColorSetting.fill(projectThemeColor)
        await expect(logoLink).toHaveCSS('--primary-hue', projectThemeColor)
        await settingsCloseButton.click()
        // Make sure that the project settings file has been written to before continuing
        await expect
          .poll(
            async () => fsp.readFile(tempProjectSettingsFilePath, 'utf-8'),
            {
              message: 'Setting should now be written to the file',
              timeout: 5_000,
            }
          )
          .toContain(`themeColor = "${projectThemeColor}"`)
      })

      await test.step('Refresh the application and see project setting applied', async () => {
        // Make sure we're done navigating before we reload
        await expect(settingsCloseButton).not.toBeVisible()

        await page.reload({ waitUntil: 'domcontentloaded' })
        await expect(logoLink).toHaveCSS('--primary-hue', projectThemeColor)
      })

      await test.step(`Navigate back to the home view and see user setting applied`, async () => {
        await logoLink.click()
        await expect(logoLink).toHaveCSS('--primary-hue', userThemeColor)
      })
    }
  )

  test(
    `Load desktop app with no settings file`,
    {
      tag: '@electron',
    },
    async ({ page }, testInfo) => {
      await page.setBodyDimensions({ width: 1200, height: 500 })

      // Selectors and constants
      const errorHeading = page.getByRole('heading', {
        name: 'An unexpected error occurred',
      })
      const projectDirLink = page.getByText('Loaded from')

      // If the app loads without exploding we're in the clear
      await expect(errorHeading).not.toBeVisible()
      await expect(projectDirLink).toBeVisible()
    }
  )

  test(
    `Load desktop app with a settings file, but no project directory setting`,
    {
      tag: '@electron',
    },
    async ({ context, page, tronApp }, testInfo) => {
      if (!tronApp) {
        fail()
      }
      await tronApp.cleanProjectDir({
        app: {
          theme_color: '259',
        },
      })

      await page.setBodyDimensions({ width: 1200, height: 500 })

      // Selectors and constants
      const errorHeading = page.getByRole('heading', {
        name: 'An unexpected error occurred',
      })
      const projectDirLink = page.getByText('Loaded from')

      // If the app loads without exploding we're in the clear
      await expect(errorHeading).not.toBeVisible()
      await expect(projectDirLink).toBeVisible()
    }
  )

  // It was much easier to test the logo color than the background stream color.
  test(
    'user settings reload on external change, on project and modeling view',
    {
      tag: '@electron',
    },
    async ({ context, page, tronApp }, testInfo) => {
      test.fixme(orRunWhenFullSuiteEnabled())
      if (!tronApp) {
        fail()
      }

      await tronApp.cleanProjectDir({
        app: {
          // Doesn't matter what you set it to. It will
          // default to 264.5
          theme_color: '0',
        },
      })

      const { dir: projectDirName } = await context.folderSetupFn(
        async () => {}
      )

      await page.setBodyDimensions({ width: 1200, height: 500 })

      const logoLink = page.getByTestId('app-logo')
      const projectDirLink = page.getByText('Loaded from')

      await test.step('Wait for project view', async () => {
        await expect(projectDirLink).toBeVisible()
        await expect(logoLink).toHaveCSS('--primary-hue', '264.5')
      })

      const changeColor = async (color: string) => {
        const tempSettingsFilePath = join(projectDirName, SETTINGS_FILE_NAME)
        let tomlStr = await fsp.readFile(tempSettingsFilePath, 'utf-8')
        tomlStr = tomlStr.replace(/(themeColor = ")[0-9]+(")/, `$1${color}$2`)
        await fsp.writeFile(tempSettingsFilePath, tomlStr)
      }

      await test.step('Check color of logo changed', async () => {
        await changeColor('99')
        await expect(logoLink).toHaveCSS('--primary-hue', '99')
      })

      await test.step('Check color of logo changed when in modeling view', async () => {
        await createProject({ name: 'project-000', page })
        await changeColor('58')
        await expect(logoLink).toHaveCSS('--primary-hue', '58')
      })

      await test.step('Check going back to projects view still changes the color', async () => {
        await logoLink.click()
        await expect(projectDirLink).toBeVisible()
        await changeColor('21')
        await expect(logoLink).toHaveCSS('--primary-hue', '21')
      })
    }
  )

  test(
    'project settings reload on external change',
    { tag: '@electron' },
    async ({ context, page }, testInfo) => {
      test.fixme(orRunWhenFullSuiteEnabled())
      const { dir: projectDirName } = await context.folderSetupFn(
        async () => {}
      )

      await page.setBodyDimensions({ width: 1200, height: 500 })

      const logoLink = page.getByTestId('app-logo')
      const projectDirLink = page.getByText('Loaded from')

      await test.step('Wait for project view', async () => {
        await expect(projectDirLink).toBeVisible()
      })

      await createProject({ name: 'project-000', page })

      const changeColorFs = async (color: string) => {
        const tempSettingsFilePath = join(
          projectDirName,
          'project-000',
          PROJECT_SETTINGS_FILE_NAME
        )
        await fsp.writeFile(
          tempSettingsFilePath,
          `[settings.app]\nthemeColor = "${color}"`
        )
      }

      await test.step('Check the color is first starting as we expect', async () => {
        await expect(logoLink).toHaveCSS('--primary-hue', '264.5')
      })

      await test.step('Check color of logo changed', async () => {
        await changeColorFs('99')
        await expect(logoLink).toHaveCSS('--primary-hue', '99')
      })
    }
  )

  test(
    `Closing settings modal should go back to the original file being viewed`,
    { tag: '@electron' },
    async ({ context, page }, testInfo) => {
      // TODO: fix this test on windows after the electron migration
      test.skip(process.platform === 'win32', 'Skip on windows')
      await context.folderSetupFn(async (dir) => {
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

      await page.setBodyDimensions({ width: 1200, height: 500 })
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
    }
  )

  test('Changing modeling default unit', async ({ page, homePage }) => {
    await test.step(`Test setup`, async () => {
      // TODO: fix this test on windows after the electron migration
      test.skip(process.platform === 'win32', 'Skip on windows')
      await page.setBodyDimensions({ width: 1200, height: 500 })
      await homePage.goToModelingScene()
      const toastMessage = page.getByText(`Successfully created "testDefault"`)
      await expect(toastMessage).not.toBeVisible()
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
      await projectSettingsTab.hover()
      await projectSettingsTab.click()
      await page.waitForTimeout(1000)
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

          // Assert visibility and disapperance
          await expect(toastMessage).toBeVisible()
          await expect(toastMessage).not.toBeVisible()
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
    await userSettingsTab.hover()
    await userSettingsTab.click()
    await page.waitForTimeout(1000)

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
          await expect(toastMessage).not.toBeVisible()
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

  test('Changing theme in sketch mode', async ({
    context,
    page,
    homePage,
    toolbar,
    scene,
    cmdBar,
  }) => {
    // TODO: fix this test on windows after the electron migration
    test.skip(process.platform === 'win32', 'Skip on windows')
    const u = await getUtils(page)
    await context.addInitScript(() => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XZ)
    |> startProfileAt([0, 0], %)
    |> line(end = [5, 0])
    |> line(end = [0, 5])
    |> line(end = [-5, 0])
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
  extrude001 = extrude(sketch001, length = 5)
  `
      )
    })
    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)
    await page.waitForTimeout(1000)

    // Selectors and constants
    const lineToolButton = page.getByTestId('line')
    const segmentOverlays = page.getByTestId('segment-overlay')
    const sketchOriginLocation = { x: 600, y: 250 }
    const darkThemeSegmentColor: [number, number, number] = [215, 215, 215]
    const lightThemeSegmentColor: [number, number, number] = [90, 90, 90]

    await test.step(`Get into sketch mode`, async () => {
      await page.mouse.click(700, 200)
      await toolbar.editSketch()

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

  test(`Changing system theme preferences (via media query) should update UI and stream`, async ({
    page,
    homePage,
    tronApp,
  }) => {
    if (!tronApp) {
      fail()
    }

    await tronApp.cleanProjectDir({
      // Override the settings so that the theme is set to `system`
      ...TEST_SETTINGS_DEFAULT_THEME,
    })

    const u = await getUtils(page)

    // Selectors and constants
    const darkBackgroundCss = 'oklch(0.3012 0 264.5)'
    const lightBackgroundCss = 'oklch(0.9911 0 264.5)'
    const darkBackgroundColor = TEST_COLORS.DARK_MODE_BKGD
    const lightBackgroundColor: [number, number, number] = [245, 245, 245]
    const streamBackgroundPixelIsColor = async (
      color: [number, number, number]
    ) => {
      return u.getGreatestPixDiff({ x: 1000, y: 200 }, color)
    }
    const toolbar = page.locator('menu').filter({ hasText: 'Start Sketch' })

    await test.step(`Test setup`, async () => {
      await page.setBodyDimensions({ width: 1200, height: 500 })
      await homePage.goToModelingScene()
      await u.waitForPageLoad()
      await page.waitForTimeout(1000)
      await expect(toolbar).toBeVisible()
    })

    await test.step(`Check the background color is light before`, async () => {
      await expect(toolbar).toHaveCSS('background-color', lightBackgroundCss)
      await expect
        .poll(() => streamBackgroundPixelIsColor(lightBackgroundColor))
        .toBeLessThan(15)
    })

    await test.step(`Change media query preference to dark, emulating dusk with system theme`, async () => {
      await page.emulateMedia({ colorScheme: 'dark' })
    })

    await test.step(`Check the background color is dark after`, async () => {
      await expect(toolbar).toHaveCSS('background-color', darkBackgroundCss)
      await expect
        .poll(() => streamBackgroundPixelIsColor(darkBackgroundColor))
        .toBeLessThan(15)
    })
  })

  test(`Turning off "Show debug panel" with debug panel open leaves no phantom panel`, async ({
    context,
    page,
    homePage,
    tronApp,
  }) => {
    if (!tronApp) {
      fail()
    }

    await tronApp.cleanProjectDir({
      // Override beforeEach test setup
      // with debug panel open
      // but "show debug panel" set to false
      ...TEST_SETTINGS,
      app: { ...TEST_SETTINGS.app, show_debug_panel: false },
      modeling: { ...TEST_SETTINGS.modeling },
    })

    const u = await getUtils(page)

    await context.addInitScript(async () => {
      localStorage.setItem('persistModelingContext', '{"openPanes":["debug"]}')
    })
    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()

    // Constants and locators
    const resizeHandle = page.locator('.sidebar-resize-handles > div.block')
    const debugPaneButton = page.getByTestId('debug-pane-button')
    const commandsButton = page.getByRole('button', { name: 'Commands' })
    const debugPaneOption = page.getByRole('option', {
      name: 'Settings · app · show debug panel',
    })

    async function setShowDebugPanelTo(value: 'On' | 'Off') {
      await commandsButton.click()
      await debugPaneOption.click()
      await page.getByRole('option', { name: value }).click()
      await expect(
        page.getByText(
          `Set show debug panel to "${value === 'On'}" for this project`
        )
      ).toBeVisible()
    }

    await test.step(`Initial load with corrupted settings`, async () => {
      // Check that the debug panel is not visible
      await expect(debugPaneButton).not.toBeVisible()
      // Check the pane resize handle wrapper is not visible
      await expect(resizeHandle).not.toBeVisible()
    })

    await test.step(`Open code pane to verify we see the resize handles`, async () => {
      await u.openKclCodePanel()
      await expect(resizeHandle).toBeVisible()
      await u.closeKclCodePanel()
    })

    await test.step(`Turn on debug panel, open it`, async () => {
      await setShowDebugPanelTo('On')
      await expect(debugPaneButton).toBeVisible()
      // We want the logic to clear the phantom panel, so we shouldn't see
      // the real panel (and therefore the resize handle) yet
      await expect(resizeHandle).not.toBeVisible()
      await u.openDebugPanel()
      await expect(resizeHandle).toBeVisible()
    })

    await test.step(`Turn off debug panel setting with it open`, async () => {
      await setShowDebugPanelTo('Off')
      await expect(debugPaneButton).not.toBeVisible()
      await expect(resizeHandle).not.toBeVisible()
    })
  })

  test(`Change inline units setting`, async ({
    page,
    homePage,
    context,
    editor,
  }) => {
    const initialInlineUnits = 'yd'
    const editedInlineUnits = { short: 'mm', long: 'Millimeters' }
    const inlineSettingsString = (s: string) =>
      `@settings(defaultLengthUnit = ${s})`
    const unitsIndicator = page.getByRole('button', {
      name: 'Current units are:',
    })
    const unitsChangeButton = (name: string) =>
      page.getByRole('button', { name, exact: true })

    await context.folderSetupFn(async (dir) => {
      const bracketDir = join(dir, 'project-000')
      await fsp.mkdir(bracketDir, { recursive: true })
      await fsp.copyFile(
        executorInputPath('cube.kcl'),
        join(bracketDir, 'main.kcl')
      )
    })

    await test.step(`Initial units from settings are ignored`, async () => {
      await homePage.openProject('project-000')
      await expect(unitsIndicator).toHaveText('Current units are: mm')
    })

    await test.step(`Manually write inline settings`, async () => {
      await editor.openPane()
      await editor.replaceCode(
        `fn cube`,
        `${inlineSettingsString(initialInlineUnits)}
fn cube`
      )
      await expect(unitsIndicator).toContainText(initialInlineUnits)
    })

    await test.step(`Change units setting via lower-right control`, async () => {
      await unitsIndicator.click()
      await unitsChangeButton(editedInlineUnits.long).click()
      await expect(
        page.getByText(`Updated per-file units to ${editedInlineUnits.short}`)
      ).toBeVisible()
    })
  })

  /**
   * This test assumes that the default value of the "highlight edges" setting is "on".
   */
  test(`Toggle stream settings multiple times`, async ({
    page,
    scene,
    homePage,
    context,
    toolbar,
    cmdBar,
  }, testInfo) => {
    test.fixme(orRunWhenFullSuiteEnabled())
    await context.folderSetupFn(async (dir) => {
      const projectDir = join(dir, 'project-000')
      await fsp.mkdir(projectDir, { recursive: true })
      await fsp.copyFile(
        executorInputPath('cube.kcl'),
        join(projectDir, 'main.kcl')
      )
    })

    await test.step(`First snapshot`, async () => {
      await homePage.openProject('project-000')
      await toolbar.closePane('code')
      await expect(toolbar.startSketchBtn).toBeEnabled({ timeout: 20_000 })
      await scene.clickNoWhere()
    })

    const toast = (value: boolean) =>
      page.getByText(
        `Set highlight edges to "${String(value)}" as a user default`
      )

    await test.step(`Toggle highlightEdges off`, async () => {
      await cmdBar.openCmdBar()
      await cmdBar.chooseCommand('Settings · modeling · highlight edges')
      await cmdBar.selectOption({ name: 'off' }).click()
      const falseToast = toast(false)
      await expect(falseToast).toBeVisible()
      await falseToast.waitFor({ state: 'detached' })
    })

    await expect(scene.streamWrapper).not.toHaveScreenshot(
      'toggle-settings-initial.png',
      {
        maxDiffPixels: 15,
        mask: [page.getByTestId('model-state-indicator')],
      }
    )

    await test.step(`Toggle highlightEdges on`, async () => {
      await cmdBar.openCmdBar()
      await cmdBar.chooseCommand('Settings · modeling · highlight edges')
      await cmdBar.selectOption({ name: 'on' }).click()
      const trueToast = toast(true)
      await expect(trueToast).toBeVisible()
      await trueToast.waitFor({ state: 'detached' })
    })

    await expect(scene.streamWrapper).toHaveScreenshot(
      'toggle-settings-initial.png',
      {
        maxDiffPixels: 15,
        mask: [page.getByTestId('model-state-indicator')],
      }
    )
  })
})
