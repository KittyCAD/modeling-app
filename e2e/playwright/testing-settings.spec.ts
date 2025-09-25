import { join } from 'path'
import { PROJECT_SETTINGS_FILE_NAME } from '@src/lib/constants'
import type { SettingsLevel } from '@src/lib/settings/settingsTypes'
import type { DeepPartial } from '@src/lib/types'
import * as fsp from 'fs/promises'

import type { Settings } from '@rust/kcl-lib/bindings/Settings'

import {
  TEST_SETTINGS_CORRUPTED,
  TEST_SETTINGS_DEFAULT_THEME,
  TEST_SETTINGS_KEY,
} from '@e2e/playwright/storageStates'
import {
  createProject,
  executorInputPath,
  getUtils,
  inputRangeSlideFromCurrentTo,
  settingsToToml,
  tomlToSettings,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { Page } from '@playwright/test'

const settingsSwitchTab = (page: Page) => async (tab: 'user' | 'proj') => {
  const projectSettingsTab = page.getByRole('radio', { name: 'Project' })
  const userSettingsTab = page.getByRole('radio', { name: 'User' })
  const settingTheme = page.getByTestId('theme')
  switch (tab) {
    case 'user':
      await userSettingsTab.click()
      await expect(settingTheme).toBeVisible()
      break
    case 'proj':
      await projectSettingsTab.click()
      await expect(settingTheme).not.toBeVisible()
      break
    default:
      const _: never = tab
  }
}

test.describe(
  'Testing settings',
  {
    tag: ['@linux', '@macos', '@windows'],
  },
  () => {
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

      expect(storedSettings.settings?.app?.appearance?.theme).toBe('dark')

      // Check that the invalid settings were changed to good defaults
      expect(storedSettings.settings?.modeling?.base_unit).toBe('in')
      expect(storedSettings.settings?.modeling?.mouse_controls).toBe('zoo')
      // Commenting this out because tests need this to be set to work properly.
      // expect(storedSettings.settings?.app?.project_directory).toBe('')
      expect(storedSettings.settings?.project?.default_project_name).toBe(
        'untitled'
      )
    })

    test('Keybindings display the correct hotkey for Command Palette', async ({
      page,
      homePage,
    }) => {
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

    test('Project and user settings can be reset', async ({
      page,
      homePage,
    }) => {
      const u = await getUtils(page)
      await test.step(`Setup`, async () => {
        await page.setBodyDimensions({ width: 1200, height: 500 })
        await homePage.goToModelingScene()
        await u.waitForPageLoad()
        await page.waitForTimeout(1000)
      })

      // Selectors and constants
      const resetButton = (level: SettingsLevel) =>
        page.getByRole('button', {
          name: `Reset ${level}-level settings`,
        })
      const themeColorSetting = page.locator('#themeColor').getByRole('slider')

      const settingValues = {
        default: '259',
        // Because it's a slider, sometimes the values cannot physically be
        // dragged to. You need to adjust this until it works.
        user: '48',
        project: '77',
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
        // Verify we're looking at the project-level settings
        await settingsSwitchTab(page)('proj')
        await themeColorSetting.fill(settingValues.default)

        // Set project-level value
        await inputRangeSlideFromCurrentTo(
          themeColorSetting,
          settingValues.project
        )
        await expect(themeColorSetting).toHaveValue(settingValues.project)

        // Set user-level value
        // It's the same component so this could fill too soon.
        // We need to confirm to wait the user settings tab is loaded.
        await settingsSwitchTab(page)('user')
        await inputRangeSlideFromCurrentTo(
          themeColorSetting,
          settingValues.user
        )
        await expect(themeColorSetting).toHaveValue(settingValues.user)
      })

      await test.step('Reset project settings', async () => {
        await settingsSwitchTab(page)('proj')

        // Click the reset settings button.
        await resetButton('project').click()

        await expect(resetToast('project')).toBeVisible()
        await expect(resetToast('project')).not.toBeVisible()

        // Verify it is now set to the inherited user value
        await expect(themeColorSetting).toHaveValue(settingValues.user)

        await test.step(`Check that the user settings did not change`, async () => {
          await settingsSwitchTab(page)('user')
          await expect(themeColorSetting).toHaveValue(settingValues.user)
        })

        await test.step(`Set project-level again to test the user-level reset`, async () => {
          await settingsSwitchTab(page)('proj')
          await inputRangeSlideFromCurrentTo(
            themeColorSetting,
            settingValues.project
          )
          await settingsSwitchTab(page)('user')
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
          await settingsSwitchTab(page)('proj')
          await expect(themeColorSetting).toHaveValue(settingValues.project)
        })
      })
    })

    test(
      `Load desktop app with no settings file`,
      {
        tag: '@desktop',
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
        tag: '@desktop',
      },
      async ({ context, page, tronApp }, testInfo) => {
        if (!tronApp) {
          fail()
        }
        await tronApp.cleanProjectDir({
          app: {
            appearance: {
              color: 259,
            },
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

    test(
      'project settings reload on external change',
      { tag: '@desktop' },
      async ({ context, page }, testInfo) => {
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
            settingsToToml({
              settings: {
                app: {
                  appearance: {
                    color: parseFloat(color),
                  },
                },
                // TODO: make sure this isn't just working around a bug
                // where the existing data wouldn't be preserved?
                meta: {
                  id: '9379bcda-e1e4-4613-851e-a5c4f5c7e83d',
                },
              },
            })
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
      { tag: '@desktop' },
      async ({ context, page }, testInfo) => {
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
        const kclCube = await fsp.readFile(
          executorInputPath('cube.kcl'),
          'utf-8'
        )
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
        await page.setBodyDimensions({ width: 1200, height: 500 })
        await homePage.goToModelingScene()
        const toastMessage = page.getByText(
          `Successfully created "testDefault"`
        )
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
        await settingsSwitchTab(page)('user')
        await defaultUnitSection.hover()
        await defaultUnitRollbackButton.click()
        await projectSettingsTab.hover()
        await projectSettingsTab.click()
        await page.waitForTimeout(1000)
      })

      await test.step('Change modeling default unit within project tab', async () => {
        const changeUnitOfMeasureInProjectTab = async (
          unitOfMeasure: string
        ) => {
          await test.step(`Set modeling default unit to ${unitOfMeasure}`, async () => {
            await page
              .getByTestId('modeling-defaultUnit')
              .selectOption(`${unitOfMeasure}`)
            const toastMessage = page.getByText(
              `Set default unit to "${unitOfMeasure}" for this project`
            )

            // Assert visibility and disappearance
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
      await settingsSwitchTab(page)('user')
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
        const changeUnitOfMeasureInCommandBar = async (
          unitOfMeasure: string
        ) => {
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
          const button = page.locator('ul').getByRole('button', {
            name: copy,
            exact: true,
          })
          await button.click()
          const toastMessage = page.getByText(
            `Updated per-file units to ${unitOfMeasure}`
          )
          await expect(toastMessage).toBeVisible()
        }

        await changeUnitOfMeasureInGizmo('ft', 'Feet')
        await changeUnitOfMeasureInGizmo('in', 'Inches')
        await changeUnitOfMeasureInGizmo('yd', 'Yards')
        await changeUnitOfMeasureInGizmo('mm', 'Millimeters')
        await changeUnitOfMeasureInGizmo('cm', 'Centimeters')
        await changeUnitOfMeasureInGizmo('m', 'Meters')
      })
    })

    // This test checks if project level settings can be set to default values even if the user level setting is
    // not set to the default. There used to be a bug that the default was not serialized in rust and couldn't be set.
    test('Set project level settings to default values', async ({
      page,
      homePage,
    }) => {
      await test.step(`Setup`, async () => {
        await page.setBodyDimensions({ width: 1200, height: 800 })
        await homePage.goToModelingScene()
        await page
          .getByRole('button', { name: 'Start Sketch' })
          .waitFor({ state: 'visible' })
      })

      await test.step('Open settings', async () => {
        await page.getByRole('link', { name: 'Settings' }).last().click()
        await expect(
          page.getByRole('heading', { name: 'Settings', exact: true })
        ).toBeVisible()
      })

      await test.step('Set user-level settings', async () => {
        await settingsSwitchTab(page)('user')

        // Set user level unit to anything but the default
        const unitSelect = page.getByTestId('modeling-defaultUnit')
        await unitSelect.selectOption('ft')
        const toast = page.getByText(
          `Set default unit to "ft" as a user default`
        )
        await expect(toast).toBeVisible()
        await expect(toast).not.toBeVisible()
        await expect(unitSelect).toHaveValue('ft')

        // Make sure show debug panel is on by default  (it's On in the test setup)

        // Set show debug panel to On (by default it's Off)
        const showDebugPanel = page.locator('#showDebugPanel')
        await expect(showDebugPanel.getByRole('checkbox')).toBeChecked()
      })

      // Set project level unit to the default (meters) to make sure it's not skipped via serialization
      await test.step('Set project-level settings', async () => {
        const projectSettingsTab = page.getByRole('radio', { name: 'Project' })
        await projectSettingsTab.hover()
        await projectSettingsTab.click()

        // Change project level debug panel to off, see if it sticks
        const showDebugPanel = page.locator('#showDebugPanel')
        const showDebugPanelToggle = showDebugPanel.getByText('OffOn')
        await showDebugPanelToggle.click()
        await expect(showDebugPanel.getByRole('checkbox')).not.toBeChecked()
        const toastDebug = page.getByText(
          `Set show debug panel to "false" for this project`
        )
        await expect(toastDebug).toBeVisible()
        await expect(toastDebug).not.toBeVisible()

        await expect(showDebugPanel.getByRole('checkbox')).not.toBeChecked()

        // Change project level units to the default (m) and expect that to work
        const unitSelect = page.getByTestId('modeling-defaultUnit')
        await unitSelect.selectOption('m')
        const toast = page.getByText(`Set default unit to "m" for this project`)
        await expect(toast).toBeVisible()
        await expect(toast).not.toBeVisible()

        await expect(unitSelect).toHaveValue('m')
      })

      await test.step('Verify values per tab', async () => {
        await settingsSwitchTab(page)('user')
        let unitSelect = page.getByTestId('modeling-defaultUnit')
        await expect(unitSelect).toHaveValue('ft')

        await settingsSwitchTab(page)('proj')
        unitSelect = page.getByTestId('modeling-defaultUnit')
        await expect(unitSelect).toHaveValue('m')
      })

      // Close settings
      await page.getByTestId('settings-close-button').click()
    })

    test('Changing theme in sketch mode', async ({
      context,
      page,
      homePage,
      toolbar,
      scene,
      cmdBar,
    }) => {
      const u = await getUtils(page)
      await context.addInitScript(() => {
        localStorage.setItem(
          'persistCode',
          `sketch001 = startSketchOn(XZ)
    |> startProfile(at = [0, 0])
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
      await expect(toolbar.startSketchBtn).toBeEnabled({ timeout: 15_000 })
      await scene.settled(cmdBar)
      await page.waitForTimeout(1000)

      // Selectors and constants
      const lineToolButton = page.getByTestId('line')
      const segmentOverlays = page.getByTestId('segment-overlay')
      const sketchOriginLocation = { x: 600, y: 250 }
      const darkThemeSegmentColor: [number, number, number] = [249, 249, 249]
      const lightThemeSegmentColor: [number, number, number] = [28, 28, 28]

      await test.step(`Get into sketch mode`, async () => {
        await page.mouse.click(700, 200)
        await toolbar.editSketch()

        // We use the line tool as a proxy for sketch mode
        await expect(lineToolButton).toBeVisible()
        await expect(segmentOverlays).toHaveCount(5)
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
      const darkBackgroundColor: [number, number, number] = [87, 67, 107] // planes are on
      const lightBackgroundColor: [number, number, number] = [166, 149, 184] // planes are on
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
  }
)
